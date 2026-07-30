// TOTP (RFC 6238) for optional two-factor auth, using WebCrypto HMAC-SHA1.
// Used only for staff/owner logins; tenants and vendors are unaffected.

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Encode bytes as RFC 4648 base32 (no padding), the format authenticator apps use. */
export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

/** Decode a base32 string (ignoring spaces, padding, and case) to bytes. */
export function base32Decode(input: string): Uint8Array {
  const clean = input.replace(/=+$/,'').replace(/\s+/g, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32_ALPHABET.indexOf(ch);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

/** A fresh random base32 secret (20 bytes = 160 bits, the RFC-recommended size). */
export function generateSecret(): string {
  const bytes = new Uint8Array(20);
  crypto.getRandomValues(bytes);
  return base32Encode(bytes);
}

function counterBytes(counter: number): Uint8Array {
  const buf = new Uint8Array(8);
  // JS bit-ops are 32-bit; split hi/lo so counters past 2^31 still work.
  let hi = Math.floor(counter / 0x100000000);
  let lo = counter >>> 0;
  for (let i = 7; i >= 4; i--) { buf[i] = lo & 0xff; lo = Math.floor(lo / 256); }
  for (let i = 3; i >= 0; i--) { buf[i] = hi & 0xff; hi = Math.floor(hi / 256); }
  return buf;
}

/** The HOTP/TOTP value for a secret and counter, `digits` long (RFC 4226 truncation). */
async function hotp(secret: string, counter: number, digits: number): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw', base32Decode(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']
  );
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, counterBytes(counter)));
  const offset = mac[mac.length - 1] & 0x0f;
  const bin =
    ((mac[offset] & 0x7f) << 24) |
    ((mac[offset + 1] & 0xff) << 16) |
    ((mac[offset + 2] & 0xff) << 8) |
    (mac[offset + 3] & 0xff);
  return String(bin % 10 ** digits).padStart(digits, '0');
}

const STEP = 30; // seconds per code
const DIGITS = 6;

/** The current TOTP code for a secret (for tests / display; login uses verifyTotp). */
export async function totpCode(secret: string, forTime = Date.now()): Promise<string> {
  return hotp(secret, Math.floor(forTime / 1000 / STEP), DIGITS);
}

/**
 * Whether `code` is valid for `secret` now, allowing ±`window` steps of clock
 * drift (default 1 step = ±30s). Constant enough for this threat model.
 */
export async function verifyTotp(secret: string, code: string, window = 1, forTime = Date.now()): Promise<boolean> {
  const clean = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(clean)) return false;
  const counter = Math.floor(forTime / 1000 / STEP);
  for (let i = -window; i <= window; i++) {
    if (await hotp(secret, counter + i, DIGITS) === clean) return true;
  }
  return false;
}

/** The otpauth:// URI an authenticator app scans from a QR code. */
export function otpauthUrl(secret: string, account: string, issuer = 'MH Dunn Property'): string {
  const label = encodeURIComponent(`${issuer}:${account}`);
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(STEP) });
  return `otpauth://totp/${label}?${params.toString()}`;
}

/** Generate N human-typeable one-time backup codes (e.g. "a1b2-c3d4"). */
export function generateBackupCodes(n = 10): string[] {
  const codes: string[] = [];
  const alphabet = 'abcdefghijkmnpqrstuvwxyz23456789'; // no easily-confused chars
  for (let i = 0; i < n; i++) {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    const raw = Array.from(bytes, b => alphabet[b % alphabet.length]).join('');
    codes.push(`${raw.slice(0, 4)}-${raw.slice(4, 8)}`);
  }
  return codes;
}

/** SHA-256 hash of a backup code (they're high-entropy, so a fast hash is fine). */
export async function hashBackupCode(code: string): Promise<string> {
  const data = new TextEncoder().encode(code.trim().toLowerCase());
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return Array.from(digest, b => b.toString(16).padStart(2, '0')).join('');
}
