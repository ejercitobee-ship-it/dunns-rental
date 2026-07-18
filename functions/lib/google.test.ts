import { describe, it, expect } from 'vitest';
import { folderStatusFrom } from './google';

// The rule that fixed the duplicate "MH Dunn Property Documents" root: only a
// definite 404 or a trashed folder counts as "gone" and lets the app make or
// adopt another. Every other failure is "unknown" and must reuse the stored id,
// never fork a second folder.
describe('folderStatusFrom', () => {
  it('is alive for a 200 that is not trashed', () => {
    expect(folderStatusFrom(true, 200, false)).toBe('alive');
    expect(folderStatusFrom(true, 200, undefined)).toBe('alive');
  });

  it('is gone for a trashed folder or a 404', () => {
    expect(folderStatusFrom(true, 200, true)).toBe('gone');
    expect(folderStatusFrom(false, 404, undefined)).toBe('gone');
  });

  it('is unknown for transient/auth failures, so the caller does not fork', () => {
    for (const status of [401, 403, 429, 500, 502, 503, 0]) {
      expect(folderStatusFrom(false, status, undefined)).toBe('unknown');
    }
  });
});
