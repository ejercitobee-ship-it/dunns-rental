import type { Env } from './session';
import { sendEmail } from './email';
import { renderTemplate, type PersonalizationContext } from './personalize';
import { resolveRecipients, type RecipientFilter, type ResolvedRecipient } from './recipients';
import { companySettings } from './receipts';
import { SITE_URL } from './site';

function money(n: number | null | undefined): string {
  if (n === null || n === undefined) return '';
  return '$' + Number(n).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function escapeHtmlText(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Wrap rendered campaign content in the branded MH Dunn email shell. */
function wrapCampaignHtml(innerHtml: string, companyName: string): string {
  return `
<div style="background:#f6f5f1;padding:32px 16px;font-family:'Hanken Grotesk',Helvetica,Arial,sans-serif;color:#1b1a17;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e7e4dd;border-radius:12px;">
    <div style="padding:26px 32px 16px;border-bottom:1px solid #eeece6;">
      <div style="font-size:20px;font-weight:bold;color:#24503f;">${escapeHtmlText(companyName)}</div>
    </div>
    <div style="padding:24px 32px;font-size:15px;line-height:1.55;">
      ${innerHtml}
      <div style="margin-top:20px;">
        <a href="${SITE_URL}/portal" style="display:inline-block;padding:10px 24px;background:#24503f;color:#ffffff;text-decoration:none;border-radius:8px;font-size:14px;font-weight:600;">Open your portal</a>
      </div>
    </div>
    <div style="padding:16px 32px;border-top:1px solid #eeece6;font-size:11px;color:#8a887f;">
      ${escapeHtmlText(companyName)}
    </div>
  </div>
</div>`.trim();
}

interface TenantCtxRow {
  tenant_id: string;
  first_name: string | null;
  last_name: string | null;
  prop_name: string | null;
  prop_addr: string | null;
  city: string | null;
  state: string | null;
  zip_code: string | null;
  unit_number: string | null;
  monthly_rent: number | null;
  start_date: string | null;
  end_date: string | null;
}

/** Build a personalization context for each tenant id, in one query. */
async function buildContexts(
  env: Env,
  tenantIds: string[],
  company: { companyName: string; email: string; phone: string }
): Promise<Map<string, PersonalizationContext>> {
  const base = (): PersonalizationContext => ({
    management_company_name: company.companyName,
    management_email: company.email,
    management_phone: company.phone,
    tenant_portal_link: `${SITE_URL}/portal`,
  });

  const map = new Map<string, PersonalizationContext>();
  if (tenantIds.length === 0) return map;
  const ph = tenantIds.map(() => '?').join(',');
  const { results } = await env.DB.prepare(
    `SELECT t.id AS tenant_id, t.first_name, t.last_name,
            p.name AS prop_name, p.address AS prop_addr, p.city, p.state, p.zip_code,
            u.unit_number, l.monthly_rent, l.start_date, l.end_date
       FROM tenants t
       LEFT JOIN leases l ON l.id = (
         SELECT l2.id FROM leases l2
           JOIN lease_tenants lt2 ON lt2.lease_id = l2.id
          WHERE lt2.tenant_id = t.id AND l2.status = 'active'
          ORDER BY l2.start_date DESC LIMIT 1
       )
       LEFT JOIN properties p ON p.id = l.property_id
       LEFT JOIN units u ON u.id = l.unit_id
      WHERE t.id IN (${ph})`
  ).bind(...tenantIds).all<TenantCtxRow>();

  for (const r of results || []) {
    const addr = [r.prop_addr, [r.city, r.state].filter(Boolean).join(', '), r.zip_code].filter((s) => s && String(s).trim()).join(' ');
    map.set(r.tenant_id, {
      ...base(),
      tenant_name: `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim(),
      first_name: r.first_name ?? '',
      last_name: r.last_name ?? '',
      property_name: r.prop_name ?? '',
      property_address: addr,
      unit_number: r.unit_number ?? '',
      rent_amount: money(r.monthly_rent),
      lease_start_date: r.start_date ?? '',
      lease_end_date: r.end_date ?? '',
    });
  }
  return map;
}

export interface SendResult { started: boolean; recipientCount: number; reason?: string }

/**
 * Send a campaign to its resolved recipients. Idempotent: the campaign is
 * claimed by moving it draft/scheduled -> processing in a guarded UPDATE, so a
 * second call (retry, double click) does nothing. Recipient rows are created up
 * front; the per-recipient send then runs in waitUntil and marks each row and
 * the campaign's final status/counts. Email only; personalization fills the
 * tenant's known fields and leaves unknown ones blank.
 */
export async function sendCampaign(
  env: Env,
  campaignId: string,
  waitUntil: (p: Promise<unknown>) => void
): Promise<SendResult> {
  const campaign = await env.DB.prepare(
    'SELECT id, name, subject, body_html, recipient_filter, status FROM email_campaigns WHERE id = ?'
  ).bind(campaignId).first<{ id: string; name: string; subject: string; body_html: string; recipient_filter: string | null; status: string }>();
  if (!campaign) return { started: false, recipientCount: 0, reason: 'not_found' };
  if (campaign.status !== 'draft' && campaign.status !== 'scheduled') {
    return { started: false, recipientCount: 0, reason: 'already_sent' };
  }

  // Claim the campaign so it can only be sent once.
  const claim = await env.DB.prepare(
    "UPDATE email_campaigns SET status = 'processing', updated_at = unixepoch() WHERE id = ? AND status IN ('draft','scheduled')"
  ).bind(campaignId).run();
  if (!claim.meta.changes) return { started: false, recipientCount: 0, reason: 'already_sent' };

  let filter: RecipientFilter = {};
  try { filter = campaign.recipient_filter ? JSON.parse(campaign.recipient_filter) : {}; } catch { /* empty */ }
  const recipients = await resolveRecipients(env, filter);

  if (recipients.length === 0) {
    await env.DB.prepare("UPDATE email_campaigns SET status = 'draft', recipient_count = 0 WHERE id = ?").bind(campaignId).run();
    return { started: false, recipientCount: 0, reason: 'no_recipients' };
  }

  // Create a queued row per recipient (so progress survives and is auditable).
  const now = Math.floor(Date.now() / 1000);
  const rowStmts = recipients.map((r: ResolvedRecipient) =>
    env.DB.prepare(
      'INSERT INTO campaign_recipients (id, campaign_id, tenant_id, email, name, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(crypto.randomUUID(), campaignId, r.tenantId ?? null, r.email, r.name, 'queued', now)
  );
  // D1 batch caps around 100 statements; chunk the inserts.
  for (let i = 0; i < rowStmts.length; i += 50) await env.DB.batch(rowStmts.slice(i, i + 50));
  await env.DB.prepare('UPDATE email_campaigns SET recipient_count = ? WHERE id = ?').bind(recipients.length, campaignId).run();

  waitUntil((async () => {
    const company = await companySettings(env);
    const tenantIds = recipients.filter((r) => r.tenantId).map((r) => r.tenantId!) as string[];
    const contexts = await buildContexts(env, tenantIds, company);
    const fallback: PersonalizationContext = {
      management_company_name: company.companyName,
      management_email: company.email,
      management_phone: company.phone,
      tenant_portal_link: `${SITE_URL}/portal`,
    };

    let sent = 0;
    let failed = 0;
    for (const r of recipients) {
      const ctx = (r.tenantId && contexts.get(r.tenantId)) || fallback;
      try {
        const subject = renderTemplate(campaign.subject, ctx) || campaign.name;
        const inner = renderTemplate(campaign.body_html, ctx);
        const html = wrapCampaignHtml(inner, company.companyName);
        const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        const ok = await sendEmail(env, { to: r.email, subject, html, text });
        if (ok) {
          sent++;
          await env.DB.prepare("UPDATE campaign_recipients SET status = 'sent', sent_at = unixepoch() WHERE campaign_id = ? AND email = ?").bind(campaignId, r.email).run();
        } else {
          failed++;
          await env.DB.prepare("UPDATE campaign_recipients SET status = 'failed', error = 'provider rejected' WHERE campaign_id = ? AND email = ?").bind(campaignId, r.email).run();
        }
      } catch (err) {
        failed++;
        await env.DB.prepare("UPDATE campaign_recipients SET status = 'failed', error = ? WHERE campaign_id = ? AND email = ?")
          .bind(String((err as Error).message || 'error').slice(0, 300), campaignId, r.email).run();
      }
    }

    const finalStatus = failed === 0 ? 'sent' : sent === 0 ? 'failed' : 'partially_delivered';
    await env.DB.prepare(
      "UPDATE email_campaigns SET status = ?, sent_count = ?, failed_count = ?, sent_at = unixepoch(), updated_at = unixepoch() WHERE id = ?"
    ).bind(finalStatus, sent, failed, campaignId).run();
    console.log(`campaign ${campaignId}: ${sent} sent, ${failed} failed of ${recipients.length}`);
  })());

  return { started: true, recipientCount: recipients.length };
}
