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
    'We received a request to reset your Dunn\'s Rental password.',
    'Open this link to choose a new one:',
    resetUrl,
    '',
    'This link expires in one hour and can only be used once.',
    'If you did not request this, you can ignore this email. Your password will not change.',
  ].join('\n');

  const html = `
  <div style="background:#f6f5f1;padding:32px 16px;font-family:'Hanken Grotesk',Helvetica,Arial,sans-serif;color:#1b1a17;">
    <div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e7e4dd;border-radius:12px;padding:32px;">
      <div style="font-family:Georgia,serif;font-size:20px;color:#1b1a17;margin-bottom:24px;">Dunn's Rental</div>
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

  return { subject: "Reset your Dunn's Rental password", html, text };
}

/** Portal invite email, sent when Belle invites a tenant to their own login. */
export function portalInviteEmail(inviteUrl: string, name?: string) {
  const greeting = name ? `Hi ${name},` : 'Hi,';
  return {
    subject: 'Your MH Dunn Property account',
    text: `${greeting}

MH Dunn Property has set up an account for you. You can see your lease, your rent history, and your documents, and you can correct your own details.

Set your password here: ${inviteUrl}

This link expires in 7 days.

MH Dunn Property`,
    html: `<p>${greeting}</p>
<p>MH Dunn Property has set up an account for you. You can see your lease, your rent history, and your documents, and you can correct your own details.</p>
<p><a href="${inviteUrl}">Set your password</a></p>
<p>This link expires in 7 days.</p>
<p>MH Dunn Property</p>`,
  };
}
