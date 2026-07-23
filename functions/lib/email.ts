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
