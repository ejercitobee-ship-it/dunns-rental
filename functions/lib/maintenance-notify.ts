import { type Env } from './session';
import { sendEmail } from './email';
import { companySettings } from './receipts';
import { tradeMatches } from './maintenance';
import { serializeHandyman } from './serializers';

/** A tenant availability window, as stored on the request. */
export interface AvailabilityWindow {
  date: string;
  start: string;
  end: string;
}

/** Everything the emails need about a request, resolved by the caller. */
export interface RequestNotice {
  id: string;
  title: string;
  category?: string | null;
  description?: string | null;
  priority?: string | null;
  tenantName?: string | null;
  locationLabel?: string | null; // "123 Main St, Unit 4B"
  availability?: AvailabilityWindow[];
  scheduledFor?: string | null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 'YYYY-MM-DD' -> 'Jul 22, 2026', without going through a UTC Date. */
export function prettyDay(dateOnly?: string | null): string {
  if (!dateOnly) return '';
  const [y, m, d] = dateOnly.split('-').map(Number);
  if (!y || !m || !d) return dateOnly;
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** '9:00 to 12:00' style label for a window. */
function windowLabel(w: AvailabilityWindow): string {
  const day = prettyDay(w.date);
  const time = [w.start, w.end].filter(Boolean).join(' to ');
  return [day, time].filter(Boolean).join(', ');
}

export function availabilityText(windows?: AvailabilityWindow[]): string {
  if (!windows || windows.length === 0) return 'No specific times given';
  return windows.map(windowLabel).join('; ');
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** A plain, branded HTML shell shared by the maintenance emails. */
function shell(companyName: string, heading: string, rows: [string, string][], cta?: { url: string; label: string }): string {
  const body = rows
    .map(
      ([k, v]) =>
        `<tr><td style="padding:4px 12px 4px 0;color:#6b6b6b;white-space:nowrap;vertical-align:top;">${esc(k)}</td><td style="padding:4px 0;color:#1a1a1a;">${esc(v)}</td></tr>`
    )
    .join('');
  const button = cta
    ? `<p style="margin:20px 0 0;"><a href="${cta.url}" style="background:#24503f;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;display:inline-block;font-weight:600;">${esc(cta.label)}</a></p>`
    : '';
  return `<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;max-width:520px;margin:0 auto;padding:24px;">
    <div style="font-size:18px;font-weight:bold;color:#24503f;margin-bottom:4px;">${esc(companyName)}</div>
    <h2 style="font-size:17px;color:#1a1a1a;margin:12px 0 16px;">${esc(heading)}</h2>
    <table style="font-size:14px;border-collapse:collapse;">${body}</table>
    ${button}
  </div>`;
}

function textBlock(companyName: string, heading: string, rows: [string, string][], ctaUrl?: string): string {
  const lines = [companyName, '', heading, '', ...rows.map(([k, v]) => `${k}: ${v}`)];
  if (ctaUrl) lines.push('', ctaUrl);
  return lines.join('\n');
}

/**
 * Email every active handyman whose trade matches the request, plus the office,
 * when a new request comes in. Best-effort: callers run this in waitUntil, and a
 * mail failure never blocks the request.
 */
export async function notifyNewRequest(env: Env, origin: string, req: RequestNotice): Promise<void> {
  const c = await companySettings(env);
  const portalUrl = `${origin}/portal`;
  const rows: [string, string][] = [
    ['Issue', req.title],
    ['Category', req.category || 'General'],
    ['Location', req.locationLabel || 'Not set'],
    ['Availability', availabilityText(req.availability)],
  ];
  if (req.description) rows.push(['Details', req.description]);

  // Matching handymen with a login and email.
  const { results } = await env.DB.prepare(
    `SELECT h.* FROM handymen h
       JOIN user u ON u.id = h.user_id
      WHERE h.is_active = 1 AND u.is_active = 1 AND h.email IS NOT NULL AND h.email != ''`
  ).all();

  const heading = `New ${(req.category || 'general')} job available`;
  const html = shell(c.companyName, heading, rows, { url: portalUrl, label: 'Open your portal' });
  const text = textBlock(c.companyName, heading, rows, portalUrl);

  for (const row of results || []) {
    const h = serializeHandyman(row as Record<string, unknown>);
    const email = typeof h.email === 'string' ? h.email : '';
    if (!email || !tradeMatches(h.trades, req.category)) continue;
    await sendEmail(env, { to: email, subject: heading, html, text });
  }

  // The office copy.
  if (c.email) {
    const adminHeading = `New maintenance request from ${req.tenantName || 'a tenant'}`;
    await sendEmail(env, {
      to: c.email,
      subject: adminHeading,
      html: shell(c.companyName, adminHeading, rows),
      text: textBlock(c.companyName, adminHeading, rows),
    });
  }
}

/**
 * Email the tenant when their request changes hands or state. Best-effort.
 * `toEmail` is the tenant's own email; `heading` is the human summary.
 */
export async function notifyTenant(
  env: Env,
  toEmail: string | null | undefined,
  heading: string,
  rows: [string, string][]
): Promise<void> {
  if (!toEmail) return;
  const c = await companySettings(env);
  await sendEmail(env, {
    to: toEmail,
    subject: heading,
    html: shell(c.companyName, heading, rows),
    text: textBlock(c.companyName, heading, rows),
  });
}

/** Email the office. Best-effort. */
export async function notifyOffice(env: Env, heading: string, rows: [string, string][]): Promise<void> {
  const c = await companySettings(env);
  if (!c.email) return;
  await sendEmail(env, {
    to: c.email,
    subject: heading,
    html: shell(c.companyName, heading, rows),
    text: textBlock(c.companyName, heading, rows),
  });
}
