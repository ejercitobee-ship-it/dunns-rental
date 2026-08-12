import type { D1Database, R2Bucket } from '@cloudflare/workers-types';
import { roleCan } from './permissions';

export interface Env {
  DB: D1Database;
  DOCS?: R2Bucket;
  /** Cloudflare Workers AI binding for the free AI Assistant. */
  AI?: Ai;
  /** Resend API key. When unset, password reset emails are not sent. */
  RESEND_API_KEY?: string;
  /** From address for outgoing mail, e.g. "MH Dunn Property <info@mhdunnproperty.net>" */
  MAIL_FROM?: string;
  /** Google OAuth client id for Drive storage. */
  GOOGLE_CLIENT_ID?: string;
  /** Google OAuth client secret. Never logged, never returned. */
  GOOGLE_CLIENT_SECRET?: string;
  /** Base64 of the VAPID private key JWK, for signing web push. When unset, push is off. */
  VAPID_PRIVATE_JWK?: string;
  /** Shared secret the scheduled rent-reminder worker presents to /api/cron/rent-due. */
  CRON_SECRET?: string;
  /** Anthropic API key for the AI Assistant (optional fallback). */
  ANTHROPIC_API_KEY?: string;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: string;
  /** Permissions for the user's role, loaded from the roles table. */
  permissions: string[] | null;
  /** The user's own profile photo Drive id and phone, for the self-profile UI. */
  image?: string | null;
  phone?: string | null;
  /** Whether the user has two-factor authentication enabled. */
  twoFactorEnabled?: boolean;
}

// ---------------------------------------------------------------------------
// Cookies
// ---------------------------------------------------------------------------

export function parseCookies(request: Request): Record<string, string> {
  const header = request.headers.get('Cookie');
  if (!header) return {};
  return header.split(';').reduce((acc, cookie) => {
    const index = cookie.indexOf('=');
    if (index === -1) return acc;
    const key = cookie.slice(0, index).trim();
    const value = cookie.slice(index + 1).trim();
    if (key) acc[key] = value;
    return acc;
  }, {} as Record<string, string>);
}

const SESSION_COOKIE = 'session';
/** How long a session lives without activity. Every authenticated request
 *  pushes the expiry forward by this amount, so active users stay signed in
 *  indefinitely and idle users get logged out after 15 minutes. */
const SESSION_IDLE_TIMEOUT = 15 * 60; // 15 minutes

export function sessionCookie(token: string): string {
  return `${SESSION_COOKIE}=${token}; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSION_IDLE_TIMEOUT}; Path=/`;
}

export function clearSessionCookie(): string {
  return `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Strict; Max-Age=0; Path=/`;
}

/**
 * Push the session's DB expiry forward by another idle-timeout window. Called
 * in the middleware's waitUntil so the DB stays consistent with the cookie.
 */
export async function renewSessionDb(env: Env, token: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const newExpiry = now + SESSION_IDLE_TIMEOUT;
  await env.DB.prepare('UPDATE session SET expires_at = ?, updated_at = ? WHERE token = ?')
    .bind(newExpiry, now, token)
    .run();
}

// ---------------------------------------------------------------------------
// Session lookup
// ---------------------------------------------------------------------------

/**
 * Resolve the authenticated user from the session cookie, or null if there is
 * no valid, unexpired session. Joins session -> user -> user_roles in a single
 * query so every endpoint gets the caller's role for free.
 */
export async function getSessionUser(
  env: Env,
  request: Request
): Promise<SessionUser | null> {
  const token = parseCookies(request)[SESSION_COOKIE];
  if (!token) return null;

  const now = Math.floor(Date.now() / 1000);
  const row = await env.DB.prepare(
    `SELECT u.id AS id, u.email AS email, u.name AS name, u.is_active AS is_active,
            u.image AS image, u.phone AS phone, u.totp_enabled AS totp_enabled,
            r.role AS role, ro.permissions AS permissions
       FROM session s
       JOIN user u ON u.id = s.user_id
       LEFT JOIN user_roles r ON r.user_id = u.id
       LEFT JOIN roles ro ON ro.id = r.role
      WHERE s.token = ? AND s.expires_at > ?`
  )
    .bind(token, now)
    .first<{
      id: string;
      email: string;
      name: string;
      is_active: number | null;
      image: string | null;
      phone: string | null;
      role: string | null;
      permissions: string | null;
      totp_enabled: number | null;
    }>();

  if (!row) return null;
  // Deactivated users are treated as signed out.
  if (row.is_active === 0) return null;

  let permissions: string[] | null = null;
  if (row.permissions) {
    try {
      const parsed = JSON.parse(row.permissions);
      if (Array.isArray(parsed)) permissions = parsed as string[];
    } catch {
      permissions = null;
    }
  }

  // Merge per-user permission overrides (grants beyond the role).
  // These are additive: if a user's role doesn't include 'finances_import'
  // but they have an override row for it, they get it.
  try {
    const { results: overrides } = await env.DB.prepare(
      'SELECT permission FROM user_permission_overrides WHERE user_id = ?'
    ).bind(row.id).all();
    if (overrides && overrides.length > 0) {
      const base = new Set(permissions || []);
      for (const o of overrides) base.add(o.permission as string);
      permissions = [...base];
    }
  } catch {
    // Table may not exist yet (pre-migration). Silently proceed with role perms only.
  }

  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role || 'viewer',
    permissions,
    image: row.image,
    phone: row.phone,
    twoFactorEnabled: !!row.totp_enabled,
  };
}

// ---------------------------------------------------------------------------
// Standard JSON responses (no stack traces leak to clients)
// ---------------------------------------------------------------------------

export function jsonOk(data: unknown, status = 200, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...(extraHeaders || {}) },
  });
}

export function jsonError(message: string, status: number): Response {
  return new Response(JSON.stringify({ success: false, error: message }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export const unauthorized = () => jsonError('Authentication required', 401);
export const forbidden = () => jsonError('You do not have permission to do that', 403);
export const serverError = () => jsonError('Internal server error', 500);

// ---------------------------------------------------------------------------
// Guards — return the SessionUser on success, or a ready-to-return Response.
// Usage:
//   const auth = await requirePermission(env, request, 'properties_view');
//   if (auth instanceof Response) return auth;
//   // auth is now a SessionUser
// ---------------------------------------------------------------------------

export async function requireUser(env: Env, request: Request): Promise<SessionUser | Response> {
  const user = await getSessionUser(env, request);
  return user ?? unauthorized();
}

/**
 * Guard for actions reserved to the workspace owner. Only the super_admin role
 * passes; every other role (even admin) gets a 403. Use for the few operations
 * that should never be delegated, e.g. editing a recorded expense.
 */
export async function requireSuperAdmin(env: Env, request: Request): Promise<SessionUser | Response> {
  const user = await getSessionUser(env, request);
  if (!user) return unauthorized();
  if (user.role !== 'super_admin') return forbidden();
  return user;
}

export async function requirePermission(
  env: Env,
  request: Request,
  permission: string
): Promise<SessionUser | Response> {
  const user = await getSessionUser(env, request);
  if (!user) return unauthorized();
  // Super admin always passes, even if the super_admin role's stored
  // permissions were edited down, so the owner can never be locked out.
  // Otherwise prefer the role's live permissions from the DB; fall back to the
  // built-in map if the role predates the roles table (e.g. before migration 0004).
  const allowed =
    user.role === 'super_admin' ||
    (user.permissions ? user.permissions.includes(permission) : roleCan(user.role, permission));
  if (!allowed) return forbidden();
  return user;
}

// ---------------------------------------------------------------------------
// Password hashing (PBKDF2 via WebCrypto, with legacy SHA-256 upgrade path)
// ---------------------------------------------------------------------------

const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_KEYLEN = 32; // bytes
const SALT_LEN = 16; // bytes

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    keyMaterial,
    PBKDF2_KEYLEN * 8
  );
  return new Uint8Array(bits);
}

/** Generate a random temporary password to hand to a user out of band. */
export function generateTempPassword(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%';
  const random = crypto.getRandomValues(new Uint8Array(16));
  let password = '';
  for (let i = 0; i < 16; i++) password += chars.charAt(random[i] % chars.length);
  return password;
}

/** Hash a password for storage. Format: pbkdf2$<iterations>$<saltB64>$<hashB64> */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LEN));
  const hash = await pbkdf2(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2$${PBKDF2_ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

function constantTimeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

async function legacySha256Hex(password: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(password));
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Verify a password against a stored hash.
 * Returns { valid, needsUpgrade }. needsUpgrade is true when the stored value
 * is a legacy unsalted SHA-256 hash that verified correctly, signalling the
 * caller to re-hash and persist the modern format.
 */
export async function verifyPassword(
  password: string,
  stored: string
): Promise<{ valid: boolean; needsUpgrade: boolean }> {
  if (stored.startsWith('pbkdf2$')) {
    const [, iterStr, saltB64, hashB64] = stored.split('$');
    const iterations = parseInt(iterStr, 10);
    if (!iterations || !saltB64 || !hashB64) return { valid: false, needsUpgrade: false };
    const salt = fromBase64(saltB64);
    const expected = fromBase64(hashB64);
    const actual = await pbkdf2(password, salt, iterations);
    return { valid: constantTimeEqual(actual, expected), needsUpgrade: false };
  }

  // Legacy: unsalted SHA-256 hex (64 chars). Verify then flag for upgrade.
  if (/^[0-9a-f]{64}$/i.test(stored)) {
    const hex = await legacySha256Hex(password);
    const valid = constantTimeEqual(
      new TextEncoder().encode(hex),
      new TextEncoder().encode(stored.toLowerCase())
    );
    return { valid, needsUpgrade: valid };
  }

  return { valid: false, needsUpgrade: false };
}
