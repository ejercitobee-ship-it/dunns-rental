/** Largest allowed profile-photo upload before client resize. */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/** A profile photo upload must be an image within the size cap. Pure. */
export function validatePhotoFile(file: File | null): { ok: true } | { ok: false; error: string } {
  if (!file || typeof file.arrayBuffer !== 'function' || !file.type || !file.type.startsWith('image/')) {
    return { ok: false, error: 'Please choose an image file' };
  }
  if (file.size > MAX_PHOTO_BYTES) {
    return { ok: false, error: 'Image is too large (max 5 MB)' };
  }
  return { ok: true };
}
