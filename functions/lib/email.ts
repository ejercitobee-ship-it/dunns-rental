import type { Env } from './session';

const DEFAULT_FROM = 'MH Dunn Property <info@mhdunnproperty.net>';

/**
 * Send a transactional email via Resend. Returns false when no API key is
 * configured (so callers can degrade gracefully rather than fail).
 */
export async function sendEmail(
  env: Env,
  opts: { to: string; subject: string; html: string; text: string }
): Promise<boolean> {
  if (!env.RESEND_API_KEY) {
    console.error('sendEmail: RESEND_API_KEY is not set; no email was sent.');
    return false;
  }

  const from = env.MAIL_FROM || DEFAULT_FROM;
  let res: Response;
  try {
    res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [opts.to],
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
      }),
    });
  } catch (err) {
    console.error(`sendEmail: request to Resend failed: ${(err as Error).message}`);
    return false;
  }

  if (!res.ok) {
    // Resend explains rejections in the body (e.g. an unverified sending
    // domain, which caps delivery to the account's own address). Without this
    // the caller only sees a bare false and the real reason is lost.
    const detail = await res.text().catch(() => '');
    console.error(`sendEmail: Resend rejected the message from "${from}" to "${opts.to}" — ${res.status} ${detail}`);
    return false;
  }

  return true;
}

/**
 * A free-form email the office writes to a tenant, wrapped in the app's branded
 * shell. The body is plain text the office typed; newlines become paragraphs.
 */
export function officeTenantEmail(body: string, name?: string) {
  const greeting = name ? `Hi ${name},` : 'Hi,';
  const text = [greeting, '', body, '', '— MH Dunn Property'].join('\n');
  const paras = body
    .split(/\n{2,}/)
    .map(p => `<p style="margin:0 0 16px;font-size:15px;white-space:pre-wrap;">${escapeHtml(p)}</p>`)
    .join('');
  const html = `
  <div style="background:#f6f5f1;padding:32px 16px;font-family:'Hanken Grotesk',Helvetica,Arial,sans-serif;color:#1b1a17;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e7e4dd;border-radius:12px;padding:32px;">
      <div style="font-family:Georgia,serif;font-size:20px;color:#1b1a17;margin-bottom:24px;">MH Dunn Property</div>
      <p style="margin:0 0 16px;font-size:15px;">${escapeHtml(greeting)}</p>
      ${paras}
      <p style="margin:24px 0 0;font-size:13px;color:#6b6a63;">MH Dunn Property</p>
    </div>
  </div>`;
  return { html, text };
}

/** Minimal HTML escape so a typed message can't inject markup into the email. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** The one-time sign-in code email (email-based two-factor). */
export function loginCodeEmail(code: string, name?: string) {
  const greeting = name ? `Hi ${name},` : 'Hi,';
  const text = [
    greeting,
    '',
    `Your MH Dunn Property sign-in code is: ${code}`,
    '',
    'Enter it on the sign-in page to finish logging in. It expires in 10 minutes.',
    "If you did not try to sign in, you can ignore this email and your account stays secure.",
  ].join('\n');
  const html = `
  <div style="background:#f6f5f1;padding:32px 16px;font-family:'Hanken Grotesk',Helvetica,Arial,sans-serif;color:#1b1a17;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e7e4dd;border-radius:12px;padding:32px;text-align:center;">
      <div style="font-family:Georgia,serif;font-size:20px;color:#1b1a17;margin-bottom:8px;">MH Dunn Property</div>
      <p style="margin:0 0 20px;font-size:15px;color:#6b6a63;">${greeting} here is your sign-in code.</p>
      <div style="font-size:34px;letter-spacing:10px;font-weight:700;color:#24503f;background:#f2f5f2;border:1px solid #dfe7e1;border-radius:10px;padding:16px;">${code}</div>
      <p style="margin:20px 0 0;font-size:13px;color:#6b6a63;">Enter it on the sign-in page. It expires in 10 minutes. If this was not you, you can ignore this email.</p>
    </div>
  </div>`;
  return { html, text };
}

/** Password reset email, styled to match the app. */
export function passwordResetEmail(resetUrl: string, name?: string) {
  const greeting = name ? `Hi ${name},` : 'Hi,';
  const text = [
    greeting,
    '',
    'We received a request to reset your MH Dunn Property password.',
    'Open this link to choose a new one:',
    resetUrl,
    '',
    'This link expires in one hour and can only be used once.',
    'If you did not request this, you can ignore this email. Your password will not change.',
  ].join('\n');

  const html = `
  <div style="background:#f6f5f1;padding:32px 16px;font-family:'Hanken Grotesk',Helvetica,Arial,sans-serif;color:#1b1a17;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e7e4dd;border-radius:12px;padding:32px;">
      <div style="font-family:Georgia,serif;font-size:20px;color:#1b1a17;margin-bottom:24px;">MH Dunn Property</div>
      <p style="margin:0 0 16px;font-size:15px;">${greeting}</p>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.55;">
        We received a request to reset your password. Choose a new one using the button below.
      </p>
      <p style="margin:0 0 24px;">
        <a href="${resetUrl}"
           style="display:inline-block;background:#24503f;color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:8px;font-size:15px;font-weight:500;">
          Reset your password
        </a>
      </p>
      <p style="margin:0 0 16px;font-size:13px;color:#75726a;line-height:1.55;">
        This link expires in one hour and can only be used once. If the button does not work, paste this into your browser:
      </p>
      <p style="margin:0 0 24px;font-size:12px;color:#75726a;word-break:break-all;">${resetUrl}</p>
      <p style="margin:0;font-size:13px;color:#75726a;line-height:1.55;">
        If you did not request this, you can ignore this email. Your password will not change.
      </p>
    </div>
  </div>`;

  return { subject: 'Reset your MH Dunn Property password', html, text };
}

/** Monthly "your rent is due" reminder, sent on the rent due day. */
/** Email sent to a prospective tenant with their secure, no-login signing link. */
export function signingLinkEmail(url: string, name?: string) {
  const greeting = name ? `Hi ${name},` : 'Hi,';
  const text = [
    greeting,
    '',
    'Your documents from MH Dunn Property are ready to review and sign.',
    'Open this secure link to view them and upload your signed copies. No account or password is needed:',
    url,
    '',
    'If you have any questions, just reply to this email or call the office.',
    '',
    'The MH Dunn Property Team',
  ].join('\n');

  const html = `
  <div style="background:#f6f5f1;padding:32px 16px;font-family:'Hanken Grotesk',Helvetica,Arial,sans-serif;color:#1b1a17;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e7e4dd;border-radius:12px;padding:32px;">
      <div style="font-family:Georgia,serif;font-size:20px;color:#1b1a17;margin-bottom:24px;">MH Dunn Property</div>
      <p style="margin:0 0 16px;font-size:15px;">${greeting}</p>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.55;">
        Your documents are ready to review and sign. Open the secure link below to view them and upload your signed copies. No account or password is needed.
      </p>
      <p style="margin:0 0 24px;">
        <a href="${url}"
           style="display:inline-block;background:#24503f;color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:8px;font-size:15px;font-weight:500;">
          Review and sign your documents
        </a>
      </p>
      <p style="margin:0 0 16px;font-size:13px;color:#75726a;line-height:1.55;">
        If the button does not work, paste this into your browser:
      </p>
      <p style="margin:0 0 24px;font-size:12px;color:#75726a;word-break:break-all;">${url}</p>
      <p style="margin:0;font-size:13px;color:#75726a;line-height:1.55;">
        Questions? Just reply to this email or call the office.<br>The MH Dunn Property Team
      </p>
    </div>
  </div>`;

  return { subject: 'Your MH Dunn Property documents are ready to sign', html, text };
}

export function rentReminderEmail(opts: {
  monthLabel: string;
  portalUrl: string;
  paymentInstructions?: string;
  name?: string;
}) {
  const greeting = opts.name ? `Hi ${opts.name},` : 'Hi,';
  const instructions = (opts.paymentInstructions || '').trim();

  const text = [
    greeting,
    '',
    `This is a friendly reminder that your rent for ${opts.monthLabel} is due today.`,
    instructions ? `\n${instructions}` : '',
    '',
    `You can view your balance and payment details in your portal:`,
    opts.portalUrl,
    '',
    'Thank you,',
    'MH Dunn Property',
  ].filter((line) => line !== '').join('\n');

  const html = `
  <div style="background:#f6f5f1;padding:32px 16px;font-family:'Hanken Grotesk',Helvetica,Arial,sans-serif;color:#1b1a17;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e7e4dd;border-radius:12px;padding:32px;">
      <div style="font-family:Georgia,serif;font-size:20px;color:#1b1a17;margin-bottom:24px;">MH Dunn Property</div>
      <p style="margin:0 0 16px;font-size:15px;">${greeting}</p>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.55;">
        This is a friendly reminder that your rent for <strong>${opts.monthLabel}</strong> is due today.
      </p>
      ${instructions ? `<p style="margin:0 0 20px;font-size:14px;line-height:1.6;color:#3a382f;background:#f2f1ea;border-radius:8px;padding:14px 16px;">${instructions}</p>` : ''}
      <p style="margin:0 0 24px;">
        <a href="${opts.portalUrl}"
           style="display:inline-block;background:#24503f;color:#ffffff;text-decoration:none;padding:11px 22px;border-radius:8px;font-size:15px;font-weight:500;">
          View your portal
        </a>
      </p>
      <p style="margin:0;font-size:13px;color:#75726a;line-height:1.55;">
        Thank you,<br>MH Dunn Property
      </p>
    </div>
  </div>`;

  return { subject: `Your rent for ${opts.monthLabel} is due`, html, text };
}

/** Lease status change notification to a tenant. */
export function leaseStatusEmail(opts: {
  name: string;
  propertyAddress: string;
  unitNumber?: string;
  statusLabel: string;
  effectiveDate: string;
  reason?: string;
  contact?: string;
}) {
  const greeting = `Hi ${opts.name},`;
  const unit = opts.unitNumber ? ` Unit ${opts.unitNumber}` : '';
  const location = `${opts.propertyAddress}${unit}`;
  const reasonLine = opts.reason ? `\nReason: ${opts.reason}\n` : '';
  const contactLine = opts.contact || 'MH Dunn Property';

  const text = [
    greeting,
    '',
    `Your lease information for ${location} has been updated.`,
    '',
    `New Status: ${opts.statusLabel}`,
    `Effective Date: ${opts.effectiveDate}`,
    reasonLine,
    'If you have any questions, please contact us.',
    '',
    contactLine,
  ].filter(l => l !== '').join('\n');

  const reasonBlock = opts.reason
    ? `<p style="margin:0 0 16px;font-size:14px;color:#3a382f;background:#f2f1ea;border-radius:8px;padding:12px 16px;">
        <strong>Reason:</strong> ${escapeHtml(opts.reason)}
      </p>`
    : '';

  const html = `
  <div style="background:#f6f5f1;padding:32px 16px;font-family:'Hanken Grotesk',Helvetica,Arial,sans-serif;color:#1b1a17;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e7e4dd;border-radius:12px;padding:32px;">
      <div style="font-family:Georgia,serif;font-size:20px;color:#1b1a17;margin-bottom:24px;">MH Dunn Property</div>
      <p style="margin:0 0 16px;font-size:15px;">${escapeHtml(greeting)}</p>
      <p style="margin:0 0 16px;font-size:15px;line-height:1.55;">
        Your lease information for <strong>${escapeHtml(location)}</strong> has been updated.
      </p>
      <div style="margin:0 0 20px;background:#f4f5f3;border:1px solid #e2e0d8;border-radius:10px;padding:16px 20px;">
        <p style="margin:0 0 8px;font-size:14px;"><strong>New Status:</strong> ${escapeHtml(opts.statusLabel)}</p>
        <p style="margin:0;font-size:14px;"><strong>Effective Date:</strong> ${escapeHtml(opts.effectiveDate)}</p>
      </div>
      ${reasonBlock}
      <p style="margin:0 0 16px;font-size:15px;line-height:1.55;">
        If you have any questions, please contact MH Dunn Property.
      </p>
      <p style="margin:24px 0 0;font-size:13px;color:#6b6a63;">${escapeHtml(contactLine)}</p>
    </div>
  </div>`;

  return {
    subject: 'Your Lease Information Has Been Updated',
    html,
    text,
  };
}

/**
 * Invite email with a set-password link. Used for tenant/realtor/handyman portal
 * logins and, with kind 'account', for internal team members. The wording is the
 * only difference: portal invitees "sign in to their portal", team members get
 * "an account for the management app".
 */
export function portalInviteEmail(
  inviteUrl: string,
  name?: string,
  opts?: { companyName?: string; contact?: string; resend?: boolean; kind?: 'portal' | 'account' }
) {
  const companyName = opts?.companyName || 'MH Dunn Property';
  const contact = opts?.contact || '';
  const greeting = name ? `Hi ${name},` : 'Hi,';
  const account = opts?.kind === 'account';
  const noun = account ? 'account' : 'portal';
  const heading = opts?.resend ? 'Set your password' : `Your ${companyName} ${noun} is ready`;
  const intro = opts?.resend
    ? `Here is a fresh link to set your password for your ${companyName} ${noun}.`
    : account
    ? `${companyName} has created your account for the management app. Set your password below to sign in.`
    : `${companyName} has set up your online portal. Sign in to see your information and keep your own details up to date.`;

  const text = `${greeting}

${intro}

Set your password: ${inviteUrl}

This link expires in 7 days.

If you do not see this email in your inbox, please check your spam or junk folder, and add info@mhdunnproperty.net to your contacts so future messages arrive.

${companyName}${contact ? `\n${contact}` : ''}`;

  const html = `
<div style="background:#f4f5f3;padding:24px 12px;font-family:Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;background:#ffffff;border:1px solid #e2e0d8;border-radius:12px;">
      <tr><td style="padding:28px 32px 18px;border-bottom:1px solid #eeece6;">
        <div style="font-size:20px;font-weight:bold;color:#24503f;">${companyName}</div>
        ${contact ? `<div style="font-size:12px;color:#8a887f;margin-top:6px;">${contact}</div>` : ''}
      </td></tr>
      <tr><td style="padding:26px 32px 6px;">
        <div style="font-size:17px;font-weight:bold;color:#1c1a17;">${heading}</div>
        <p style="font-size:14px;color:#1c1a17;line-height:1.6;margin:14px 0 6px;">${greeting}</p>
        <p style="font-size:14px;color:#1c1a17;line-height:1.6;margin:0 0 20px;">${intro}</p>
        <table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="background:#24503f;border-radius:8px;">
          <a href="${inviteUrl}" style="display:inline-block;padding:12px 26px;color:#ffffff;font-size:14px;font-weight:bold;text-decoration:none;">Set your password</a>
        </td></tr></table>
        <p style="font-size:12px;color:#8a887f;line-height:1.6;margin:20px 0 0;">This link expires in 7 days. If the button doesn't work, paste this address into your browser:<br><a href="${inviteUrl}" style="color:#24503f;word-break:break-all;">${inviteUrl}</a></p>
        <p style="font-size:12px;color:#8a887f;line-height:1.6;margin:12px 0 0;">Not in your inbox? Check your spam or junk folder, and add info@mhdunnproperty.net to your contacts so future messages arrive.</p>
      </td></tr>
      <tr><td style="padding:16px 32px;border-top:1px solid #eeece6;font-size:11px;color:#8a887f;">
        ${companyName}${contact ? ` &nbsp;&middot;&nbsp; ${contact}` : ''}
      </td></tr>
    </table>
  </td></tr></table>
</div>`.trim();

  return {
    subject: opts?.resend ? `Set your password — ${companyName}` : `Your ${companyName} ${noun}`,
    text,
    html,
  };
}

export function calendarEventEmail(opts: {
  type: 'created' | 'updated' | 'cancelled' | 'reminder';
  title: string;
  eventDate: string;
  propertyName?: string;
  unitLabel?: string;
  description?: string;
  category?: string;
  priority?: string;
  reminderInfo?: string;
}) {
  const TYPE_LABELS: Record<string, string> = {
    created: 'New Event Scheduled',
    updated: 'Event Updated',
    cancelled: 'Event Cancelled',
    reminder: 'Upcoming Event Reminder',
  };

  const heading = TYPE_LABELS[opts.type] || 'Calendar Event';
  const catLabel = opts.category ? opts.category.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()) : '';

  const rows: string[] = [];
  rows.push(`Event: ${opts.title}`);
  if (catLabel) rows.push(`Category: ${catLabel}`);
  rows.push(`Date: ${opts.eventDate}`);
  if (opts.propertyName) rows.push(`Property: ${opts.propertyName}`);
  if (opts.unitLabel) rows.push(`Unit: ${opts.unitLabel}`);
  if (opts.priority && opts.priority !== 'medium') rows.push(`Priority: ${opts.priority.charAt(0).toUpperCase() + opts.priority.slice(1)}`);
  if (opts.description) rows.push(`Description: ${opts.description}`);
  if (opts.reminderInfo) rows.push(`Reminder: ${opts.reminderInfo}`);

  const text = [heading, '', ...rows, '', '— MH Dunn Property'].join('\n');

  const detailRows = rows.map(r => {
    const [label, ...rest] = r.split(': ');
    const val = rest.join(': ');
    return `<tr><td style="padding:6px 0;font-size:14px;color:#8a887f;vertical-align:top;width:100px;">${escapeHtml(label)}</td><td style="padding:6px 0 6px 8px;font-size:14px;color:#1c1a17;">${escapeHtml(val)}</td></tr>`;
  }).join('');

  const html = `
<div style="background:#f4f5f3;padding:24px 12px;font-family:'Hanken Grotesk',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;background:#ffffff;border:1px solid #e2e0d8;border-radius:12px;">
      <tr><td style="padding:28px 32px 18px;border-bottom:1px solid #eeece6;">
        <div style="font-size:20px;font-weight:bold;color:#24503f;">MH Dunn Property</div>
      </td></tr>
      <tr><td style="padding:26px 32px 20px;">
        <div style="font-size:17px;font-weight:bold;color:#1c1a17;margin-bottom:16px;">${escapeHtml(heading)}</div>
        <table role="presentation" cellpadding="0" cellspacing="0" width="100%">${detailRows}</table>
      </td></tr>
      <tr><td style="padding:16px 32px;border-top:1px solid #eeece6;font-size:11px;color:#8a887f;">
        MH Dunn Property
      </td></tr>
    </table>
  </td></tr></table>
</div>`.trim();

  return { subject: `${heading}: ${opts.title}`, html, text };
}
