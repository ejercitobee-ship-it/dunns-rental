import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, getSessionUser, jsonOk, jsonError, serverError } from '../../lib/session';
import { getSetting, putSetting } from '../../lib/google';
import { sendPushToUser } from '../../lib/push';
import { sendEmail, rentReminderEmail } from '../../lib/email';
import { SITE_URL } from '../../lib/site';

const DEFAULT_PAYMENT_INSTRUCTIONS = 'Pay your rent by Zelle to 7739917112.';
const STATE_KEY = 'rentReminderState';

interface RentSettings {
  rentDueDay: number;
  paymentInstructions: string;
}

/** Read the rent due day and payment instructions from app_settings. */
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
    } catch {
      /* fall through to defaults */
    }
  }
  return { rentDueDay, paymentInstructions };
}

/** Today's calendar date in the property's timezone (America/Chicago). The
 * worker fires this at 13:00 UTC, when Chicago is already on the same day, so
 * the day-of-month check lands on the intended date regardless of DST. */
function chicagoToday(): { day: number; monthKey: string; monthLabel: string } {
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
  return { day, monthKey: `${year}-${month}`, monthLabel };
}

interface RecipientRow {
  tenant_id: string;
  user_id: string | null;
  first_name: string | null;
  email: string | null;
  lease_due_day: number | null;
}

/**
 * POST /api/cron/rent-due — send the monthly "your rent is due" reminder to
 * every tenant on an active lease. Triggered on the rent due day by the
 * scheduled worker (which presents the CRON_SECRET); an admin may also call it.
 *
 * Guards against sending twice: it records the month it last sent and skips a
 * repeat call in the same month. `?dryRun=1` reports who would be notified
 * without sending or recording anything.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  // Authorize either the scheduled worker (bearer CRON_SECRET) or a signed-in
  // admin (so it can be triggered by hand and to keep the surface small).
  const auth = request.headers.get('Authorization') || '';
  const presented = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
  const cronOk = !!env.CRON_SECRET && presented === env.CRON_SECRET;
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
    const { day, monthKey, monthLabel } = chicagoToday();

    // Every distinct tenant on an active lease, with the lease's per-lease due
    // day (NULL = use the global setting).
    const { results: allRows } = await env.DB.prepare(
      `SELECT DISTINCT t.id AS tenant_id, t.user_id, t.first_name, t.email,
              l.rent_due_day AS lease_due_day
         FROM leases l
         JOIN lease_tenants lt ON lt.lease_id = l.id
         JOIN tenants t ON t.id = lt.tenant_id
        WHERE l.status = 'active'`
    ).all<RecipientRow>();

    const recipients = (allRows || []).filter(r => {
      const effectiveDay = r.lease_due_day ?? globalDueDay;
      return effectiveDay === day;
    });

    if (dryRun) {
      return jsonOk({
        success: true,
        dryRun: true,
        globalDueDay,
        today: day,
        month: monthKey,
        totalActive: (allRows || []).length,
        dueToday: recipients.length,
        withLogin: recipients.filter((r) => r.user_id).length,
        withEmail: recipients.filter((r) => r.email).length,
      });
    }

    if (recipients.length === 0) {
      return jsonOk({ success: true, skipped: 'no leases due today', globalDueDay, today: day });
    }

    // Never send the same day twice.
    const dayKey = `${monthKey}-${String(day).padStart(2, '0')}`;
    const stateRaw = await getSetting(env, STATE_KEY);
    let lastSentDay = '';
    if (stateRaw) {
      try {
        const st = JSON.parse(stateRaw) as { lastSentDay?: string; lastSentMonth?: string };
        lastSentDay = st.lastSentDay || st.lastSentMonth || '';
      } catch { /* ignore */ }
    }
    if (lastSentDay === dayKey) {
      return jsonOk({ success: true, skipped: 'already sent today', day: dayKey });
    }

    const portalUrl = `${SITE_URL}/portal/payments`;
    let pushed = 0;
    let emailed = 0;

    for (const r of recipients) {
      // Best-effort per tenant: one failure must not stop the rest.
      try {
        if (r.user_id) {
          await sendPushToUser(env, r.user_id, {
            title: 'Rent is due',
            body: `Your rent for ${monthLabel} is due today.`,
            url: '/portal/payments',
          });
          pushed++;
        }
      } catch (err) {
        console.error(`rent-due: push failed for tenant ${r.tenant_id}: ${(err as Error).message}`);
      }
      try {
        if (r.email) {
          const mail = rentReminderEmail({
            monthLabel,
            portalUrl,
            paymentInstructions,
            name: r.first_name || undefined,
          });
          const ok = await sendEmail(env, { to: r.email, ...mail });
          if (ok) emailed++;
        }
      } catch (err) {
        console.error(`rent-due: email failed for tenant ${r.tenant_id}: ${(err as Error).message}`);
      }
    }

    await putSetting(env, STATE_KEY, JSON.stringify({ lastSentDay: dayKey }));

    return jsonOk({
      success: true,
      month: monthKey,
      recipients: recipients.length,
      pushed,
      emailed,
    });
  } catch {
    return serverError();
  }
};
