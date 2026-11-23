import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, getSessionUser, jsonOk, jsonError, serverError, constantTimeStrEqual } from '../../lib/session';
import { logActivityStmt } from '../../lib/activity';
import { getManagementUserIds, notifyMultiple } from '../../lib/notify';
import { calculateLateFee } from '../../lib/late-fee-calc';

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function chicagoToday(): { day: number; monthNum: number; yearNum: number; dateStr: string } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const year = Number(get('year'));
  const month = Number(get('month'));
  const day = Number(get('day'));
  return {
    day,
    monthNum: month,
    yearNum: year,
    dateStr: `${get('year')}-${get('month')}-${get('day')}`,
  };
}

interface LeaseRow {
  lease_id: string;
  property_id: string | null;
  unit_id: string | null;
  monthly_rent: number;
  lease_due_day: number | null;
  late_fee_amount: number | null;
  late_fee_type: string;
  late_fee_grace_days: number;
  late_fee_jurisdiction: string | null;
  late_fee_effective_date: string | null;
}

/**
 * POST /api/cron/late-fees — auto-assess late fees for leases that have
 * late_fee_enabled = 1, where the grace period has passed and rent for the
 * current month is still unpaid. Called daily by the rent-reminder worker.
 *
 * Logic:
 * 1. Find all active leases with late_fee_enabled = 1
 * 2. For each, check if rent for this month is unpaid
 * 3. Check if today > dueDay + graceDays (grace period expired)
 * 4. Check no late fee already exists for this lease/month/year
 * 5. If all pass, insert a late fee
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  const auth = request.headers.get('Authorization') || '';
  const presented = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const cronOk = !!env.CRON_SECRET && constantTimeStrEqual(presented, env.CRON_SECRET);
  if (!cronOk) {
    const user = await getSessionUser(env, request);
    if (!user) return jsonError('Not authorized', 401);
    const canTrigger = user.role === 'super_admin' ||
      (user.permissions ? user.permissions.includes('settings_edit') : false);
    if (!canTrigger) return jsonError('Not authorized', 401);
  }

  try {
    const { day, monthNum, yearNum, dateStr } = chicagoToday();

    // Exclude tenants with an active eviction (adding charges during litigation is risky).
    const { results: rows } = await env.DB.prepare(
      `SELECT l.id AS lease_id, l.property_id, l.unit_id, l.monthly_rent,
              l.rent_due_day AS lease_due_day,
              p.late_fee_amount, p.late_fee_type, p.late_fee_grace_days,
              p.late_fee_jurisdiction, p.late_fee_effective_date
         FROM leases l
         LEFT JOIN properties p ON p.id = l.property_id
        WHERE l.status = 'active'
          AND l.late_fee_enabled = 1
          AND NOT EXISTS (
            SELECT 1 FROM evictions e
             WHERE e.lease_id = l.id
               AND e.status NOT IN ('completed', 'dismissed')
          )`
    ).all<LeaseRow>();

    if (!rows || rows.length === 0) {
      return jsonOk({ success: true, assessed: 0, reason: 'no eligible leases' });
    }

    // Read global rent due day from settings as fallback.
    let globalDueDay = 1;
    try {
      const raw = await env.DB.prepare(
        "SELECT value FROM app_settings WHERE key = 'rent'"
      ).first<{ value: string }>();
      if (raw?.value) {
        const parsed = JSON.parse(raw.value) as { rentDueDay?: number };
        if (typeof parsed.rentDueDay === 'number') globalDueDay = parsed.rentDueDay;
      }
    } catch { /* use default */ }

    let assessed = 0;
    const skipped: string[] = [];

    for (const row of rows) {
      const dueDay = row.lease_due_day ?? globalDueDay;
      const graceDays = row.late_fee_grace_days ?? 5;

      // Grace period: fee is eligible the day AFTER dueDay + graceDays.
      // e.g. due day 1, grace 5 → eligible on day 7 (day > 6).
      if (day <= dueDay + graceDays) {
        skipped.push(`${row.lease_id}: still in grace period`);
        continue;
      }

      // Effective date gate: skip if the property has an effective date
      // and the current month is before it (lets Belle enable now for Dec).
      if (row.late_fee_effective_date) {
        const [effYear, effMonth] = row.late_fee_effective_date.split('-').map(Number);
        if (yearNum < effYear || (yearNum === effYear && monthNum < effMonth)) {
          skipped.push(`${row.lease_id}: before effective date ${row.late_fee_effective_date}`);
          continue;
        }
      }

      // Calculate fee: custom amount takes priority; jurisdiction formula is the fallback.
      const feeAmount = calculateLateFee({
        monthlyRent: row.monthly_rent,
        jurisdiction: row.late_fee_jurisdiction,
        configuredAmount: row.late_fee_amount,
        feeType: row.late_fee_type,
      });
      if (feeAmount <= 0) {
        skipped.push(`${row.lease_id}: no fee amount (no jurisdiction or property config)`);
        continue;
      }

      // Check if rent is fully paid for this month. A tenant who made a
      // partial payment should still get the late fee. Sum from allocations
      // first (a single payment can cover multiple months), then add legacy
      // payments that have no allocations for backwards compatibility.
      const { total: totalPaid } = await env.DB.prepare(
        `SELECT
           COALESCE((
             SELECT SUM(pa.amount) FROM payment_allocations pa
              JOIN rent_payments rp ON rp.id = pa.payment_id
             WHERE pa.lease_id = ? AND pa.month = ? AND pa.year = ?
               AND pa.type = 'rent' AND rp.status = 'paid'
           ), 0)
           +
           COALESCE((
             SELECT SUM(rp.amount) FROM rent_payments rp
             WHERE rp.lease_id = ? AND rp.month = ? AND rp.year = ?
               AND rp.status = 'paid'
               AND NOT EXISTS (
                 SELECT 1 FROM payment_allocations pa2
                  WHERE pa2.payment_id = rp.id
               )
           ), 0)
           AS total`
      ).bind(
        row.lease_id, monthNum, yearNum,
        row.lease_id, monthNum, yearNum
      ).first<{ total: number }>() ?? { total: 0 };

      if (totalPaid >= row.monthly_rent) {
        skipped.push(`${row.lease_id}: rent fully paid ($${totalPaid})`);
        continue;
      }

      // Check no late fee already exists for this period.
      const existing = await env.DB.prepare(
        'SELECT id FROM late_fees WHERE lease_id = ? AND month = ? AND year = ?'
      ).bind(row.lease_id, monthNum, yearNum).first();
      if (existing) {
        skipped.push(`${row.lease_id}: late fee already exists`);
        continue;
      }

      // Pick the first tenant on this lease for the record.
      const tenantRow = await env.DB.prepare(
        'SELECT tenant_id FROM lease_tenants WHERE lease_id = ? LIMIT 1'
      ).bind(row.lease_id).first<{ tenant_id: string }>();

      const id = crypto.randomUUID();
      await env.DB.batch([
        env.DB.prepare(
          `INSERT INTO late_fees (id, lease_id, tenant_id, property_id, unit_id, month, year, amount, assessed_date, status, notes, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'outstanding', ?, 'system')`
        ).bind(
          id,
          row.lease_id,
          tenantRow?.tenant_id ?? null,
          row.property_id,
          row.unit_id,
          monthNum,
          yearNum,
          feeAmount,
          dateStr,
          'Auto-assessed: grace period expired',
        ),
        logActivityStmt(env.DB, { id: 'system', name: 'System' } as any, {
          module: 'finances',
          action: 'Auto-assessed a late fee',
          targetType: 'late_fee',
          targetId: id,
          description: `$${feeAmount} late fee for ${MONTHS[monthNum - 1]} ${yearNum}`,
          newValues: { amount: feeAmount, month: monthNum, year: yearNum, leaseId: row.lease_id },
        }),
      ]);

      assessed++;
    }

    // Notify management about auto-assessed fees.
    if (assessed > 0) {
      context.waitUntil(
        getManagementUserIds(env).then(userIds =>
          notifyMultiple(env, userIds.map(uid => ({
            userId: uid,
            type: 'payment',
            category: 'late_fee_assessed',
            title: `${assessed} late fee${assessed > 1 ? 's' : ''} auto-assessed`,
            message: `${MONTHS[monthNum - 1]} ${yearNum}`,
            entityType: 'late_fee',
            route: '/rent',
          })))
        ).catch(() => {})
      );
    }

    return jsonOk({ success: true, assessed, skippedCount: skipped.length });
  } catch (err) {
    console.error('late-fees cron error:', err);
    return serverError();
  }
};
