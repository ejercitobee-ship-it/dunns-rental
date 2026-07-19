import { describe, it, expect } from 'vitest';
import { validatePhotoFile, MAX_PHOTO_BYTES } from './photos';

const fakeFile = (type: string, size: number) =>
  ({ type, size, arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)) } as unknown as File);

describe('validatePhotoFile', () => {
  it('accepts an image within the size cap', () => {
    expect(validatePhotoFile(fakeFile('image/jpeg', 10_000))).toEqual({ ok: true });
  });
  it('rejects a non-image', () => {
    expect(validatePhotoFile(fakeFile('application/pdf', 10_000))).toEqual({ ok: false, error: 'Please choose an image file' });
  });
  it('rejects a missing file', () => {
    expect(validatePhotoFile(null as unknown as File)).toEqual({ ok: false, error: 'Please choose an image file' });
  });
  it('rejects an oversized file', () => {
    expect(validatePhotoFile(fakeFile('image/png', MAX_PHOTO_BYTES + 1))).toEqual({ ok: false, error: 'Image is too large (max 5 MB)' });
  });
});
