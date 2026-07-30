import { type Env } from './session';
import { sendEmail, loginCodeEmail } from './email';

const CODE_TTL = 10 * 60; // seconds a code is valid
const MAX_ATTEMPTS = 5;
const DEVICE_TTL = 30 * 24 * 60 * 60; // 30 days for a remembered device

/** SHA-256 hex of a value (codes/tokens are high-entropy, so a fast hash is fine). */
async function sha256Hex(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return Array.from(digest, b => b.toString(16).padStart(2, '0')).join('');
}

/** A random 6-digit login code. */
function makeCode(): string {
  return String(crypto.getRandomValues(new Uint32Array(1))[0] % 1_000_000).padStart(6, '0');
}

/**
 * Issue a fresh login code for a user (replacing any pending one) and email it.
 * Returns whether the email was accepted; the code is stored regardless so a
 * retry/resend flow works.
 */
export async function issueAndSendEmailCode(env: Env, userId: string, email: string | null, name?: string): Promise<boolean> {
  const code = makeCode();
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    `INSERT INTO login_codes (user_id, code_hash, expires_at, attempts, created_at)
     VALUES (?, ?, ?, 0, ?)
     ON CONFLICT(user_id) DO UPDATE SET code_hash = excluded.code_hash, expires_at = excluded.expires_at, attempts = 0`
  ).bind(userId, await sha256Hex(code), now + CODE_TTL, now).run();

  if (!email) return false;
  const { html, text } = loginCodeEmail(code, name);
  return sendEmail(env, { to: email, subject: `Your MH Dunn Property sign-in code: ${code}`, html, text });
}

/** Verify a login code; consumes it on success, counts attempts, respects expiry. */
export async function verifyEmailCode(env: Env, userId: string, code: string): Promise<boolean> {
  const clean = (code || '').replace(/\s+/g, '');
  if (!/^\d{6}$/.test(clean)) return false;
  const row = await env.DB.prepare('SELECT code_hash, expires_at, attempts FROM login_codes WHERE user_id = ?')
    .bind(userId).first<{ code_hash: string; expires_at: number; attempts: number }>();
  if (!row) return false;
  const now = Math.floor(Date.now() / 1000);
  if (now > row.expires_at || row.attempts >= MAX_ATTEMPTS) return false;

  if (await sha256Hex(clean) === row.code_hash) {
    await env.DB.prepare('DELETE FROM login_codes WHERE user_id = ?').bind(userId).run();
    return true;
  }
  await env.DB.prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE user_id = ?').bind(userId).run();
  return false;
}

/** Create a remembered-device token for a user; returns the raw token for a cookie. */
export async function issueTrustedDevice(env: Env, userId: string): Promise<string> {
  const token = crypto.randomUUID() + crypto.randomUUID();
  const now = Math.floor(Date.now() / 1000);
  await env.DB.prepare(
    'INSERT INTO trusted_devices (id, user_id, token_hash, expires_at, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), userId, await sha256Hex(token), now + DEVICE_TTL, now).run();
  return token;
}

/** Whether this browser's token is a valid, unexpired trusted device for the user. */
export async function checkTrustedDevice(env: Env, userId: string, token: string | undefined): Promise<boolean> {
  if (!token) return false;
  const row = await env.DB.prepare(
    'SELECT id FROM trusted_devices WHERE user_id = ? AND token_hash = ? AND expires_at > ?'
  ).bind(userId, await sha256Hex(token), Math.floor(Date.now() / 1000)).first();
  return !!row;
}

/** The remembered-device cookie (30 days, locked down like the session cookie). */
export function trustedDeviceCookie(token: string): string {
  return `td=${token}; HttpOnly; Secure; SameSite=Strict; Max-Age=${DEVICE_TTL}; Path=/`;
}
