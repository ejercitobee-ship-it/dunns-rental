import type { Env } from './session';

const DEFAULT_FROM = "Dunn's Rental <info@mhdunnproperty.net>";

/**
 * Send a transactional email via Resend. Returns false when no API key is
 * configured (so callers can degrade gracefully rather than fail).
 */
export async function sendEmail(
  env: Env,
  opts: { to: string; subject: string; html: string; text: string }
): Promise<boolean> {
  if (!env.RESEND_API_KEY) return false;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: env.MAIL_FROM || DEFAULT_FROM,
      to: [opts.to],
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    }),
  });

  return res.ok;
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
