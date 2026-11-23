import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, getSessionUser, jsonOk, jsonError, serverError, constantTimeStrEqual } from '../../lib/session';
import { getSetting, putSetting } from '../../lib/google';
import { sendPushToUser } from '../../lib/push';
import { sendEmail, rentReminderEmail, rentPreReminderEmail, rentGraceWarningEmail } from '../../lib/email';
import { SITE_URL } from '../../lib/site';
import { lateFeeDescription } from '../../lib/late-fee-calc';

const DEFAULT_PAYMENT_INSTRUCTIONS = 'Pay rent via Zelle to 773-991-7112, payable to Marlene Dunn.';
const STATE_KEY = 'rentReminderState';

type Touch = 'pre' | 'due' | 'grace';

interface RentSettings {
  rentDueDay: number;
  paymentInstructions: string;
}

async function rentSettings(env: Env): Promise<RentSettings> {
  const raw = await getSetting(env, 'rent');
  let rentDueDay = 1;
  let paymentInstructions = DEFAULT_PAYMENT_INSTRUCTIONS;
  if (raw) {
    try {
      const r = JSON.parse(raw) as { rentDueDay?: unknown; paymentInstructions?: unknown };
      if (typeof r.rentDueDay === 'number' && r.rentDueDay >= 1 && r.rentDueDay <= 31) {
        rentDueDay = Math.floor(r.rentDueDay);
      }
      if (typeof r.paymentInstructions === 'string' && r.paymentInstructions.trim()) {
        paymentInstructions = r.paymentInstructions;
      }
    } catch { /* fall through to defaults */ }
  }
  return { rentDueDay, paymentInstructions };
}

function chicagoToday(): { day: number; monthNum: number; yearNum: number; monthKey: string; monthLabel: string } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  const year = get('year');
  const month = get('month');
  const day = Number(get('day'));
  const monthLabel = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    month: 'long',
    year: 'numeric',
  }).format(now);
  return { day, monthNum: Number(month), yearNum: Number(year), monthKey: `${year}-${month}`, monthLabel };
}

interface RecipientRow {
  tenant_id: string;
  user_id: string | null;
  first_name: string | null;
  email: string | null;
  lease_due_day: number | null;
  late_fee_enabled: number;
  late_fee_amount: number | null;
  late_fee_type: string | null;
  late_fee_grace_days: number | null;
  late_fee_jurisdiction: string | null;
  monthly_rent: number;
}

/**
 * Determine which touch (if any) a tenant should receive today.
 *
 * Touch 1 ("pre"):   3 days before the due day
 * Touch 2 ("due"):   the due day itself
 * Touch 3 ("grace"): 3 days into the grace period (dueDay + 3)
 */
function touchForToday(day: number, dueDay: number): Touch | null {
  if (day === dueDay) return 'due';
  // 3 days before. Handle month wrap: if due day is 1-3, the pre-reminder
  // falls in the previous month and would have been sent then. The cron
  // runs daily so we only check the current calendar day.
  const preTrigger = dueDay - 3;
  if (preTrigger >= 1 && day === preTrigger) return 'pre';
  // Grace warning on day dueDay + 3.
  const graceDay = dueDay + 3;
  if (day === graceDay) return 'grace';
  return null;
}

/**
 * POST /api/cron/rent-due — 3-touch rent reminder sequence.
 *
 * Touch 1 (3 days before due): friendly heads-up to pay early.
 * Touch 2 (due day): rent is due today, with late fee warning.
 * Touch 3 (grace day 3): urgent warning, late fee coming in X days.
 *
 * Each touch is sent at most once per month per tenant (tracked in
 * app_settings). The cron fires daily; it checks every active lease
 * and sends the appropriate touch for today's date relative to each
 * tenant's individual due day.
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
    const url = new URL(request.url);
    const dryRun = url.searchParams.get('dryRun') === '1';

    const { rentDueDay: globalDueDay, paymentInstructions } = await rentSettings(env);
    const { day, monthNum, yearNum, monthKey, monthLabel } = chicagoToday();

    // All active tenants who have NOT fully paid this month's rent.
    const { results: allRows } = await env.DB.prepare(
      `SELECT DISTINCT t.id AS tenant_id, t.user_id, t.first_name, t.email,
              l.rent_due_day AS lease_due_day, l.late_fee_enabled, l.monthly_rent,
              p.late_fee_amount, p.late_fee_type, p.late_fee_grace_days, p.late_fee_jurisdiction
         FROM leases l
         JOIN lease_tenants lt ON lt.lease_id = l.id
         JOIN tenants t ON t.id = lt.tenant_id
         LEFT JOIN properties p ON p.id = l.property_id
        WHERE l.status = 'active'
          AND NOT EXISTS (
            SELECT 1 FROM rent_payments rp
             WHERE rp.lease_id = l.id
               AND rp.month = ?1
               AND rp.year = ?2
               AND rp.status = 'paid'
          )`
    ).bind(monthNum, yearNum).all<RecipientRow>();

    // Determine which touch each tenant gets today.
    const tagged: { row: RecipientRow; touch: Touch }[] = [];
    for (const row of allRows || []) {
      const dueDay = row.lease_due_day ?? globalDueDay;
      const touch = touchForToday(day, dueDay);
      if (touch) tagged.push({ row, touch });
    }

    if (dryRun) {
      const counts = { pre: 0, due: 0, grace: 0 };
      for (const t of tagged) counts[t.touch]++;
      return jsonOk({
        success: true,
        dryRun: true,
        globalDueDay,
        today: day,
        month: monthKey,
        totalUnpaid: (allRows || []).length,
        touches: counts,
      });
    }

    if (tagged.length === 0) {
      return jsonOk({ success: true, skipped: 'no reminders to send today', globalDueDay, today: day });
    }

    // Dedup guard: never send the same touch on the same day twice.
    const dayKey = `${monthKey}-${String(day).padStart(2, '0')}`;
    const stateRaw = await getSetting(env, STATE_KEY);
    let sentToday = false;
    if (stateRaw) {
      try {
        const st = JSON.parse(stateRaw) as { lastSentDay?: string };
        sentToday = st.lastSentDay === dayKey;
      } catch { /* ignore */ }
    }
    if (sentToday) {
      return jsonOk({ success: true, skipped: 'already sent today', day: dayKey });
    }

    const portalUrl = `${SITE_URL}/portal/payments`;
    let pushed = 0;
    let emailed = 0;
    const touchCounts = { pre: 0, due: 0, grace: 0 };

    for (const { row: r, touch } of tagged) {
      const dueDay = r.lease_due_day ?? globalDueDay;
      const grace = r.late_fee_grace_days ?? 5;

      // Build late fee info for due and grace touches.
      let feeStr = '';
      if (r.late_fee_enabled) {
        feeStr = lateFeeDescription({
          monthlyRent: r.monthly_rent,
          jurisdiction: r.late_fee_jurisdiction,
          configuredAmount: r.late_fee_amount,
          feeType: r.late_fee_type || 'flat',
        });
      }

      // Push notification
      try {
        if (r.user_id) {
          let pushTitle = '';
          let pushBody = '';

          if (touch === 'pre') {
            pushTitle = 'Rent due in 3 days';
            pushBody = `Your rent for ${monthLabel} is due on the ${ordinal(dueDay)}. Tap to pay now and avoid any hassle.`;
          } else if (touch === 'due') {
            pushTitle = 'Rent is due';
            pushBody = `Your rent for ${monthLabel} is due today.`;
            if (feeStr) pushBody += ` A late fee of ${feeStr} will apply after the ${grace} day grace period.`;
          } else {
            const remaining = grace - 3;
            pushTitle = 'Rent is past due';
            if (remaining > 0 && feeStr) {
              pushBody = `Your rent for ${monthLabel} is past due. A late fee of ${feeStr} will be assessed in ${remaining} day${remaining > 1 ? 's' : ''} if not paid.`;
            } else if (feeStr) {
              pushBody = `Your rent for ${monthLabel} is past due. A late fee of ${feeStr} will be assessed shortly.`;
            } else {
              pushBody = `Your rent for ${monthLabel} is past due. Please pay as soon as possible.`;
            }
          }

          await sendPushToUser(env, r.user_id, {
            title: pushTitle,
            body: pushBody,
            url: '/portal/payments',
          });
          pushed++;
        }
      } catch (err) {
        console.error(`rent-due [${touch}]: push failed for tenant ${r.tenant_id}: ${(err as Error).message}`);
      }

      // Email
      try {
        if (r.email) {
          let mail: { subject: string; html: string; text: string };

          if (touch === 'pre') {
            mail = rentPreReminderEmail({
              monthLabel,
              portalUrl,
              paymentInstructions,
              name: r.first_name || undefined,
              dueDay,
            });
          } else if (touch === 'due') {
            const lateFeeWarning = feeStr
              ? `A late fee of ${feeStr} will be applied if payment is not received within ${grace} days of the due date.`
              : undefined;
            mail = rentReminderEmail({
              monthLabel,
              portalUrl,
              paymentInstructions,
              name: r.first_name || undefined,
              lateFeeWarning,
            });
          } else {
            const remaining = grace - 3;
            mail = rentGraceWarningEmail({
              monthLabel,
              portalUrl,
              name: r.first_name || undefined,
              feeStr,
              graceDaysRemaining: remaining > 0 ? remaining : 0,
            });
          }

          const ok = await sendEmail(env, { to: r.email, ...mail });
          if (ok) emailed++;
        }
      } catch (err) {
        console.error(`rent-due [${touch}]: email failed for tenant ${r.tenant_id}: ${(err as Error).message}`);
      }

      touchCounts[touch]++;
    }

    await putSetting(env, STATE_KEY, JSON.stringify({ lastSentDay: dayKey }));

    return jsonOk({
      success: true,
      month: monthKey,
      today: day,
      touches: touchCounts,
      pushed,
      emailed,
    });
  } catch {
    return serverError();
  }
};

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
