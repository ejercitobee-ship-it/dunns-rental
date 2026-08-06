import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, getSessionUser, jsonOk, jsonError, serverError } from '../../lib/session';
import { getSetting, putSetting } from '../../lib/google';
import { sendEmail } from '../../lib/email';
import { sendPushToUser } from '../../lib/push';

const STATE_KEY = 'expenseReminderState';
const REMINDER_DAYS = 3;

interface RecurringExpense {
  id: string;
  property_id: string | null;
  unit_id: string | null;
  category: string;
  amount: number;
  date: string;          // YYYY-MM-DD
  description: string | null;
  vendor: string | null;
  recurring_frequency: string; // monthly | quarterly | yearly
}

/** Days in a given month (1-indexed). */
function daysInMonth(y: number, m: number): number {
  return new Date(y, m, 0).getDate();
}

/**
 * Given the original expense date and its frequency, calculate the next
 * occurrence on or after today (Chicago time). Returns YYYY-MM-DD or null
 * if something is wrong with the data.
 */
function nextDueDate(origDateStr: string, frequency: string, todayStr: string): string | null {
  const parts = origDateStr.split('-');
  if (parts.length < 3) return null;
  const origD = Number(parts[2]);
  const step = frequency === 'monthly' ? 1 : frequency === 'quarterly' ? 3 : 12;

  let y = Number(parts[0]);
  let m = Number(parts[1]);

  // Step forward from the original date until we land on or after today.
  // Safety cap at 600 iterations (50 years of monthly).
  for (let i = 0; i < 600; i++) {
    m += step;
    while (m > 12) { m -= 12; y++; }
    const day = Math.min(origD, daysInMonth(y, m));
    const candidate = `${y}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (candidate >= todayStr) return candidate;
  }
  return null;
}

/** Today in America/Chicago as YYYY-MM-DD. */
function chicagoToday(): string {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** Add N days to a YYYY-MM-DD string. */
function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T12:00:00');
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function prettyDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function money(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function frequencyLabel(f: string): string {
  if (f === 'monthly') return 'Monthly';
  if (f === 'quarterly') return 'Quarterly';
  if (f === 'yearly') return 'Yearly';
  return f;
}

function categoryLabel(cat: string): string {
  return cat.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

interface UpcomingExpense {
  expense: RecurringExpense;
  dueDate: string;
  propertyName: string;
}

/**
 * POST /api/cron/expense-reminders — check for recurring expenses that are
 * due within the next few days and send a reminder to admins. Triggered
 * daily by the scheduled worker (CRON_SECRET) or by an admin manually.
 *
 * Each expense only triggers one reminder per occurrence (tracked via
 * app_settings).
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

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

    const today = chicagoToday();
    const windowEnd = addDays(today, REMINDER_DAYS);

    // All recurring expenses with a frequency set.
    const { results: rows } = await env.DB.prepare(
      `SELECT e.id, e.property_id, e.unit_id, e.category, e.amount, e.date,
              e.description, e.vendor, e.recurring_frequency
         FROM expenses e
        WHERE e.is_recurring = 1
          AND e.recurring_frequency IS NOT NULL
          AND e.recurring_frequency != ''`
    ).all<RecurringExpense>();

    // Load property names for the notification.
    const { results: propRows } = await env.DB.prepare(
      'SELECT id, name FROM properties'
    ).all<{ id: string; name: string }>();
    const propMap = new Map((propRows || []).map(p => [p.id, p.name]));

    // Load previously reminded state.
    const stateRaw = await getSetting(env, STATE_KEY);
    let reminded: Record<string, string> = {};
    if (stateRaw) {
      try { reminded = JSON.parse(stateRaw) as Record<string, string>; } catch { /* fresh */ }
    }

    const upcoming: UpcomingExpense[] = [];
    for (const exp of (rows || [])) {
      const dueDate = nextDueDate(exp.date, exp.recurring_frequency, today);
      if (!dueDate) continue;
      // Is it within our window? (today <= dueDate <= today + REMINDER_DAYS)
      if (dueDate < today || dueDate > windowEnd) continue;
      // Already reminded for this exact due date?
      if (reminded[exp.id] === dueDate) continue;

      upcoming.push({
        expense: exp,
        dueDate,
        propertyName: exp.property_id ? (propMap.get(exp.property_id) || 'Unknown property') : '',
      });
    }

    if (dryRun) {
      return jsonOk({
        success: true,
        dryRun: true,
        today,
        windowEnd,
        totalRecurring: (rows || []).length,
        upcoming: upcoming.map(u => ({
          id: u.expense.id,
          description: u.expense.description,
          vendor: u.expense.vendor,
          amount: u.expense.amount,
          dueDate: u.dueDate,
          property: u.propertyName,
          frequency: u.expense.recurring_frequency,
        })),
      });
    }

    if (upcoming.length === 0) {
      return jsonOk({ success: true, skipped: 'no recurring expenses due soon', today });
    }

    // Admins who should receive the reminder.
    const { results: adminRows } = await env.DB.prepare(
      `SELECT id, email FROM user WHERE role IN ('super_admin', 'admin') AND email IS NOT NULL`
    ).all<{ id: string; email: string }>();
    const admins = (adminRows || []).filter(a => a.email);

    if (admins.length === 0) {
      return jsonOk({ success: true, skipped: 'no admin emails', upcoming: upcoming.length });
    }

    // Build the notification content.
    const lines = upcoming.map(u => {
      const label = u.expense.description || categoryLabel(u.expense.category);
      const vendor = u.expense.vendor ? ` (${u.expense.vendor})` : '';
      const prop = u.propertyName ? ` · ${u.propertyName}` : '';
      return `${label}${vendor}: ${money(u.expense.amount)}, due ${prettyDate(u.dueDate)}${prop}`;
    });

    // Push notification to each admin.
    let pushed = 0;
    let emailed = 0;
    const pushTitle = upcoming.length === 1
      ? 'Recurring expense coming due'
      : `${upcoming.length} recurring expenses coming due`;
    const pushBody = upcoming.length === 1
      ? lines[0]
      : lines.slice(0, 3).join('\n') + (upcoming.length > 3 ? `\n+${upcoming.length - 3} more` : '');

    for (const admin of admins) {
      try {
        await sendPushToUser(env, admin.id, {
          title: pushTitle,
          body: pushBody,
          url: '/expenses',
        });
        pushed++;
      } catch (err) {
        console.error(`expense-reminders: push failed for ${admin.id}: ${(err as Error).message}`);
      }

      try {
        const email = buildReminderEmail(upcoming);
        const ok = await sendEmail(env, { to: admin.email, ...email });
        if (ok) emailed++;
      } catch (err) {
        console.error(`expense-reminders: email failed for ${admin.email}: ${(err as Error).message}`);
      }
    }

    // Mark these as reminded so we don't send again for the same due date.
    for (const u of upcoming) {
      reminded[u.expense.id] = u.dueDate;
    }
    // Prune entries for due dates that have passed (keep state lean).
    for (const [id, dueDate] of Object.entries(reminded)) {
      if (dueDate < today) delete reminded[id];
    }
    await putSetting(env, STATE_KEY, JSON.stringify(reminded));

    return jsonOk({
      success: true,
      today,
      upcoming: upcoming.length,
      pushed,
      emailed,
    });
  } catch (err) {
    console.error('expense-reminders error:', err);
    return serverError();
  }
};

/** Build the reminder email (subject + html + text). */
function buildReminderEmail(items: UpcomingExpense[]): { subject: string; html: string; text: string } {
  const count = items.length;
  const subject = count === 1
    ? `Recurring expense due soon: ${items[0].expense.description || categoryLabel(items[0].expense.category)}`
    : `${count} recurring expenses due soon`;

  const textLines = [
    'Hi,',
    '',
    count === 1
      ? 'You have a recurring expense coming due:'
      : `You have ${count} recurring expenses coming due:`,
    '',
  ];

  let htmlRows = '';
  for (const u of items) {
    const label = u.expense.description || categoryLabel(u.expense.category);
    const vendor = u.expense.vendor || '';
    const prop = u.propertyName || '';
    const freq = frequencyLabel(u.expense.recurring_frequency);

    textLines.push(`  ${label}${vendor ? ` (${vendor})` : ''}: ${money(u.expense.amount)}, due ${prettyDate(u.dueDate)}${prop ? ` · ${prop}` : ''} [${freq}]`);

    htmlRows += `
      <tr>
        <td style="padding:8px 12px;border-bottom:1px solid #e7e4dd;font-size:14px;">${label}${vendor ? `<br><span style="color:#8a887f;font-size:12px;">${vendor}</span>` : ''}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e7e4dd;font-size:14px;text-align:right;white-space:nowrap;">${money(u.expense.amount)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e7e4dd;font-size:13px;color:#3a382f;white-space:nowrap;">${prettyDate(u.dueDate)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #e7e4dd;font-size:12px;color:#8a887f;">${prop}<br>${freq}</td>
      </tr>`;
  }

  textLines.push('', 'Log into the app to record these payments.', '', 'MH Dunn Property');

  const html = `
  <div style="background:#f6f5f1;padding:32px 16px;font-family:'Hanken Grotesk',Helvetica,Arial,sans-serif;color:#1b1a17;">
    <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e7e4dd;border-radius:12px;padding:32px;">
      <div style="font-family:Georgia,serif;font-size:20px;color:#1b1a17;margin-bottom:24px;">MH Dunn Property</div>
      <p style="margin:0 0 16px;font-size:15px;">Hi,</p>
      <p style="margin:0 0 20px;font-size:15px;line-height:1.55;">
        ${count === 1
          ? 'You have a recurring expense coming due:'
          : `You have <strong>${count}</strong> recurring expenses coming due:`}
      </p>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;margin-bottom:20px;">
        <tr style="background:#f6f5f1;">
          <th style="padding:8px 12px;text-align:left;font-size:12px;font-weight:600;color:#3a382f;">Expense</th>
          <th style="padding:8px 12px;text-align:right;font-size:12px;font-weight:600;color:#3a382f;">Amount</th>
          <th style="padding:8px 12px;text-align:left;font-size:12px;font-weight:600;color:#3a382f;">Due</th>
          <th style="padding:8px 12px;text-align:left;font-size:12px;font-weight:600;color:#3a382f;">Details</th>
        </tr>
        ${htmlRows}
      </table>
      <p style="margin:0;font-size:14px;color:#3a382f;">Log into the app to record these payments.</p>
      <hr style="border:none;border-top:1px solid #e7e4dd;margin:24px 0 16px;">
      <p style="margin:0;font-size:12px;color:#8a887f;">MH Dunn Property</p>
    </div>
  </div>`.trim();

  return { subject, html, text: textLines.join('\n') };
}
