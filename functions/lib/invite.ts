import { type Env, hashPassword, generateTempPassword } from './session';
import { sendEmail, portalInviteEmail } from './email';
import { companySettings } from './receipts';
import { SITE_URL } from './site';

const SEVEN_DAYS = 7 * 24 * 60 * 60;

/**
 * Issue a fresh set-password token for a login and email the branded invite
 * link, using the company identity from settings. Shared by tenant and handyman
 * invites and by resends, so every invite looks the same and a resend always
 * hands over a working link. Passwords live on the `account` table, so a token
 * here sets the password through the existing /reset-password page.
 */
export async function sendInviteLink(
  env: Env,
  userId: string,
  firstName: string,
  toEmail: string,
  resend: boolean,
  opts?: { kind?: 'portal' | 'account' }
): Promise<{ sent: boolean; inviteUrl: string }> {
  const now = Math.floor(Date.now() / 1000);
  const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
  await env.DB.prepare(
    'INSERT INTO password_reset_tokens (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), userId, token, now + SEVEN_DAYS, now).run();

  const inviteUrl = `${SITE_URL}/reset-password?token=${token}`;
  const c = await companySettings(env);
  const cityStateZip = [[c.city, c.state].filter(Boolean).join(', '), c.zipCode].filter(Boolean).join(' ');
  const contact = [c.address, cityStateZip, [c.phone, c.email].filter(Boolean).join(' · ')]
    .filter(s => s && s.trim()).join(' · ');
  const mail = portalInviteEmail(inviteUrl, firstName, { companyName: c.companyName, contact, resend, kind: opts?.kind });
  const sent = await sendEmail(env, { to: toEmail, ...mail });
  return { sent, inviteUrl };
}

/**
 * Create a portal login (user + credential account + role) for someone who does
 * not have one yet. Returns the new user id. Throws 'email-taken' if the email
 * is already on a user, so callers can surface a clean message.
 *
 * The email is stored lowercased because sign-in lowercases what the user types
 * before the lookup; without this a login with any capital letter could set a
 * password and then never sign in. Passwords live on `account`
 * (provider_id = 'credential') and the role on `user_roles.role`, matching the
 * tenant invite and sign-up flows.
 */
export async function createPortalLogin(
  env: Env,
  opts: { email: string; name: string; role: string }
): Promise<string> {
  const email = opts.email.trim().toLowerCase();
  const existing = await env.DB.prepare('SELECT id FROM user WHERE email = ?').bind(email).first();
  if (existing) throw new Error('email-taken');

  const userId = crypto.randomUUID();
  const passwordHash = await hashPassword(generateTempPassword());
  const now = Math.floor(Date.now() / 1000);

  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO user (id, name, email, email_verified, image, is_active, created_at, updated_at)
       VALUES (?, ?, ?, 0, NULL, 1, ?, ?)`
    ).bind(userId, opts.name, email, now, now),
    env.DB.prepare(
      'INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(crypto.randomUUID(), email, 'credential', userId, passwordHash, now, now),
    env.DB.prepare(
      'INSERT INTO user_roles (id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    ).bind(crypto.randomUUID(), userId, opts.role, now, now),
  ]);

  return userId;
}
