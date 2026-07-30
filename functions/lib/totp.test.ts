import { describe, it, expect } from 'vitest';
import { base32Encode, base32Decode, totpCode, verifyTotp, generateSecret, generateBackupCodes, hashBackupCode } from './totp';

// RFC 6238 test secret: ASCII "12345678901234567890" -> base32.
const RFC_SECRET = base32Encode(new TextEncoder().encode('12345678901234567890'));

describe('base32', () => {
  it('round-trips bytes', () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255, 128, 64]);
    expect(Array.from(base32Decode(base32Encode(bytes)))).toEqual(Array.from(bytes));
  });
  it('encodes the RFC secret to a known value', () => {
    expect(RFC_SECRET).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
  });
});

describe('totpCode (RFC 6238 SHA-1 vectors, 6-digit)', () => {
  // The RFC's 8-digit vectors truncated to their last 6 digits.
  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ])('T=%i -> %s', async (t, expected) => {
    expect(await totpCode(RFC_SECRET, t * 1000)).toBe(expected);
  });
});

describe('verifyTotp', () => {
  it('accepts the current code', async () => {
    const code = await totpCode(RFC_SECRET, 1111111111 * 1000);
    expect(await verifyTotp(RFC_SECRET, code, 1, 1111111111 * 1000)).toBe(true);
  });
  it('accepts a code one step off (drift window)', async () => {
    const prev = await totpCode(RFC_SECRET, (1111111111 - 30) * 1000);
    expect(await verifyTotp(RFC_SECRET, prev, 1, 1111111111 * 1000)).toBe(true);
  });
  it('rejects a code two steps off', async () => {
    const old = await totpCode(RFC_SECRET, (1111111111 - 90) * 1000);
    expect(await verifyTotp(RFC_SECRET, old, 1, 1111111111 * 1000)).toBe(false);
  });
  it('rejects a malformed code', async () => {
    expect(await verifyTotp(RFC_SECRET, 'abc', 1)).toBe(false);
    expect(await verifyTotp(RFC_SECRET, '12345', 1)).toBe(false);
  });
});

describe('secrets and backup codes', () => {
  it('generates a 32-char base32 secret', () => {
    expect(generateSecret()).toMatch(/^[A-Z2-7]{32}$/);
  });
  it('generates distinct formatted backup codes', () => {
    const codes = generateBackupCodes(10);
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    for (const c of codes) expect(c).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}$/);
  });
  it('hashes a backup code stably and case-insensitively', async () => {
    expect(await hashBackupCode('A1B2-C3D4')).toBe(await hashBackupCode('a1b2-c3d4'));
    expect(await hashBackupCode('a1b2-c3d4')).not.toBe(await hashBackupCode('zzzz-zzzz'));
  });
});
