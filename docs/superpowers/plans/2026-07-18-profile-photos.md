# Profile Photos Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tenants and realtors can set a Drive-stored profile photo (Belle too, from admin), shown as their avatar across the portal and admin.

**Architecture:** Photos live in a "Profile Photos" folder in Belle's Google Drive; the Drive file id is stored on the tenant record (`tenants.photo_drive_id`) or the user record (`user.image` for realtors/staff). One authenticated proxy `GET /api/photo/:id` streams a photo from Drive; serializers expose a `photoUrl` only to already-authorized viewers. The browser resizes images to a small square before upload.

**Tech Stack:** Cloudflare Pages Functions + D1 (SQLite), Google Drive (OAuth, existing helpers), React 19 + TypeScript + Vite + Tailwind, Vitest.

## Global Constraints

- **No dashes** (em, en, or hyphen-as-a-break) in any user-visible copy. Belle's standing rule.
- **Storage is Google Drive.** Photos go to a "Profile Photos" folder; the Drive file id is stored on the record. Tenant photos on `tenants.photo_drive_id`; realtor/staff photos on `user.image`.
- **Who may set a photo:** the person (tenant or realtor, from their portal) and Belle (admin). For tenants this is the ONE write allowed on their otherwise view-plus-add-only portal.
- **Serving:** a single `GET /api/photo/:id` requiring any logged-in session; `photoUrl` is only ever placed in a serializer shape the viewer is already authorized to receive. Belle accepted this over stricter per-view scoping.
- **Uploads must be images** (`content-type` starts with `image/`) and within a 5 MB cap; the client resizes first so real uploads are ~20 to 40 KB.
- On replace, the OLD Drive file is trashed after the new one is saved. On remove, the Drive file is trashed and the field nulled.
- Next migration number is **0013**.
- `DriveNotConnected` is turned into a 503 by every Drive-touching endpoint, matching the document endpoints.
- Automated tests cover the pure validator; Drive/endpoint/UI behavior is verified by hand / at the DB level (no Pages+D1 harness).

---

## File Structure

- `migrations/0013_tenant_photo.sql` — `tenants.photo_drive_id`.
- `functions/lib/serializers.ts` — `photoUrl` on `serializePortalTenant`, `serializeTenant`.
- `functions/api/admin/users/index.ts` — select `image`; `serializeUser` gains `photoUrl`.
- `functions/lib/photos.ts` (new) — pure `validatePhotoFile`.
- `functions/lib/google.ts` — `ensurePhotoFolder`, `saveProfilePhoto`, `removeProfilePhoto`.
- `functions/api/photo/[id].ts` (new) — serve proxy.
- `functions/api/portal/photo.ts` (new) — self upload/remove.
- `functions/api/tenants/[id]/photo.ts` (new) — admin tenant upload/remove.
- `functions/api/admin/users/[id]/photo.ts` (new) — admin user upload/remove.
- `functions/api/portal/realtor/me.ts`, `functions/api/portal/my-realtors.ts` — add `photoUrl`.
- `src/lib/image.ts` (new) — `resizeImage`.
- `src/lib/api.ts` — `photoApi`.
- `src/components/ui/Avatar.tsx` (new).
- `src/pages/portal/{TenantInfo,RealtorDashboard,RealtorTenants,RealtorTenantDetail}.tsx`, `src/pages/{TenantDetail,Users}.tsx` — display + controls.

---

## Task 1: Migration and serializer photoUrl

**Files:**
- Create: `migrations/0013_tenant_photo.sql`
- Modify: `functions/lib/serializers.ts` (`serializePortalTenant`, `serializeTenant`)
- Modify: `functions/api/admin/users/index.ts` (`serializeUser` + its query/row type)

**Interfaces:**
- Produces: `tenants.photo_drive_id`; `serializePortalTenant(...).photoUrl`, `serializeTenant(...).photoUrl` (from `photo_drive_id`); `serializeUser(...).photoUrl` (from `image`). Shape: `photoUrl: string | null` = `id ? '/api/photo/' + id : null`.

- [ ] **Step 1: Write and apply the migration**

`migrations/0013_tenant_photo.sql`:

```sql
-- Drive file id of the tenant's profile photo, in Belle's Profile Photos Drive
-- folder. NULL means no photo (show initials).
ALTER TABLE tenants ADD COLUMN photo_drive_id TEXT;
```

Run: `npx wrangler d1 migrations apply dunns-rental-db --local`
Expected: `0013_tenant_photo.sql` applied, no error.

- [ ] **Step 2: Add photoUrl to the tenant serializers**

In `functions/lib/serializers.ts`, in `serializeTenant`'s returned object add:

```ts
    photoUrl: r.photo_drive_id ? `/api/photo/${r.photo_drive_id}` : null,
```

In `serializePortalTenant`'s returned object (the allowlist) add the same line:

```ts
    photoUrl: r.photo_drive_id ? `/api/photo/${r.photo_drive_id}` : null,
```

(Both read `r.photo_drive_id` from the raw tenant row. `serializePortalTenant` takes the raw row `r`; if it currently derives from `serializeTenant`, read `r.photo_drive_id` off the raw row it receives, not off the derived object.)

- [ ] **Step 3: Add photoUrl + image to serializeUser**

In `functions/api/admin/users/index.ts`:
- Add `image: string | null;` to the `UserRow` interface.
- In the users list SELECT, add `u.image` to the selected columns.
- In `serializeUser`, add to the returned object:

```ts
    photoUrl: r.image ? `/api/photo/${r.image}` : null,
```

- [ ] **Step 4: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add migrations/0013_tenant_photo.sql functions/lib/serializers.ts functions/api/admin/users/index.ts
git commit -m "Photos: tenant photo column and photoUrl on serializers"
```

---

## Task 2: Photo validation and Drive helpers

**Files:**
- Create: `functions/lib/photos.ts`
- Create: `functions/lib/photos.test.ts`
- Modify: `functions/lib/google.ts` (`ensurePhotoFolder`, `saveProfilePhoto`, `removeProfilePhoto`)

**Interfaces:**
- Produces:
  - `MAX_PHOTO_BYTES = 5 * 1024 * 1024`; `validatePhotoFile(file) -> { ok: true } | { ok: false; error: string }`.
  - `saveProfilePhoto(env, file: File, oldDriveId?: string) -> Promise<string>` (returns the new Drive file id; trashes `oldDriveId` if given).
  - `removeProfilePhoto(env, driveId: string) -> Promise<void>`.

- [ ] **Step 1: Write the failing validator test**

`functions/lib/photos.test.ts`:

```ts
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run functions/lib/photos.test.ts`
Expected: FAIL, cannot import `./photos`.

- [ ] **Step 3: Write the validator**

`functions/lib/photos.ts`:

```ts
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run functions/lib/photos.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Add the Drive helpers**

In `functions/lib/google.ts`:
- Add a settings key near the others: `const KEY_PHOTO_FOLDER = 'google_photo_folder_id';` and `const PHOTO_FOLDER_NAME = 'Profile Photos';`.
- Add `ensurePhotoFolder`, modeled EXACTLY on `ensureRootFolder` but as a subfolder of the root and using the photo key/name. Use the existing private `folderStatus`, `findFolder`, `createFolder`, `getSetting`, `putSetting`, and `ensureRootFolder`:

```ts
/** The Profile Photos folder, a subfolder of the app root, created on first use. */
async function ensurePhotoFolder(env: Env): Promise<string> {
  const existing = await getSetting(env, KEY_PHOTO_FOLDER);
  if (existing) {
    const status = await folderStatus(env, existing);
    if (status !== 'gone') return existing;
  }
  const root = await ensureRootFolder(env);
  const id = (await findFolder(env, PHOTO_FOLDER_NAME, root)) ?? (await createFolder(env, PHOTO_FOLDER_NAME, root));
  await putSetting(env, KEY_PHOTO_FOLDER, id);
  return id;
}

/**
 * Upload a profile photo to the Profile Photos folder and return its Drive id.
 * When replacing, trashes the old file AFTER the new one is saved so a failure
 * never loses the existing photo.
 */
export async function saveProfilePhoto(env: Env, file: File, oldDriveId?: string): Promise<string> {
  const folderId = await ensurePhotoFolder(env);
  const name = `photo-${crypto.randomUUID()}`;
  const uploaded = await uploadToDrive(env, folderId, name, file.type || 'image/jpeg', file);
  if (oldDriveId) {
    try { await deleteDriveFile(env, oldDriveId); } catch { /* old file already gone is fine */ }
  }
  return uploaded.id;
}

/** Remove a profile photo file from Drive. */
export async function removeProfilePhoto(env: Env, driveId: string): Promise<void> {
  await deleteDriveFile(env, driveId);
}
```

- [ ] **Step 6: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add functions/lib/photos.ts functions/lib/photos.test.ts functions/lib/google.ts
git commit -m "Photos: validator and Drive save/remove helpers"
```

---

## Task 3: Serve proxy

**Files:**
- Create: `functions/api/photo/[id].ts`

**Interfaces:**
- Consumes: `getDriveFileStream` (google.ts), `requireUser`, `Env`.
- Produces: `GET /api/photo/:id`.

- [ ] **Step 1: Write the endpoint**

`functions/api/photo/[id].ts`:

```ts
import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser } from '../../lib/session';
import { getDriveFileStream } from '../../lib/google';

/**
 * GET /api/photo/:id — stream a profile photo from Drive. Any logged-in user
 * may call it, but a photo id is only ever exposed to a viewer already
 * authorized to see that person (via the scoped serializers). Ids are
 * unguessable Drive ids. The browser caches by URL.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;

  try {
    const driveRes = await getDriveFileStream(env, params.id as string);
    if (!driveRes.ok) return new Response('Not found', { status: 404 });
    return new Response(driveRes.body, {
      status: 200,
      headers: {
        'Content-Type': driveRes.headers.get('Content-Type') || 'image/jpeg',
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch {
    return new Response('Not found', { status: 404 });
  }
};
```

- [ ] **Step 2: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add functions/api/photo/[id].ts
git commit -m "Photos: authenticated serve proxy"
```

---

## Task 4: Self upload and remove (portal)

**Files:**
- Create: `functions/api/portal/photo.ts`

**Interfaces:**
- Consumes: `validatePhotoFile` (photos.ts), `saveProfilePhoto`, `removeProfilePhoto`, `DriveNotConnected` (google.ts), `tenantIdForUser` (portal.ts), `requireUser`, `jsonOk`, `jsonError`, `serverError`, `Env`.
- Produces: `POST /api/portal/photo`, `DELETE /api/portal/photo`.

- [ ] **Step 1: Write the endpoint**

`functions/api/portal/photo.ts`:

```ts
import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser, jsonOk, jsonError, serverError } from '../../lib/session';
import { tenantIdForUser } from '../../lib/portal';
import { validatePhotoFile } from '../../lib/photos';
import { saveProfilePhoto, removeProfilePhoto, DriveNotConnected } from '../../lib/google';

// Read the caller's current photo Drive id: tenants from their tenant row,
// realtors from their user row. Returns { column, id, key } to update.
async function currentPhoto(env: Env, auth: { id: string; role: string }) {
  if (auth.role === 'tenant') {
    const tid = await tenantIdForUser(env, auth.id);
    if (!tid) return null;
    const row = await env.DB.prepare('SELECT photo_drive_id FROM tenants WHERE id = ?').bind(tid).first<{ photo_drive_id: string | null }>();
    return { table: 'tenants' as const, recordId: tid, column: 'photo_drive_id', old: row?.photo_drive_id ?? null };
  }
  if (auth.role === 'realtor') {
    const row = await env.DB.prepare('SELECT image FROM user WHERE id = ?').bind(auth.id).first<{ image: string | null }>();
    return { table: 'user' as const, recordId: auth.id, column: 'image', old: row?.image ?? null };
  }
  return null;
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;

  try {
    const target = await currentPhoto(env, auth);
    if (!target) return jsonError('Only a tenant or realtor can set a photo here', 403);

    const form = await request.formData();
    const file = form.get('photo') as unknown as File | null;
    const valid = validatePhotoFile(file);
    if (!valid.ok) return jsonError(valid.error, 400);

    const newId = await saveProfilePhoto(env, file as File, target.old ?? undefined);
    await env.DB.prepare(`UPDATE ${target.table} SET ${target.column} = ? WHERE id = ?`).bind(newId, target.recordId).run();
    return jsonOk({ success: true, data: { photoUrl: `/api/photo/${newId}` } });
  } catch (err) {
    if (err instanceof DriveNotConnected) return jsonError('Google Drive is not connected. Ask the office.', 503);
    return serverError();
  }
};

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;

  try {
    const target = await currentPhoto(env, auth);
    if (!target) return jsonError('Only a tenant or realtor can remove a photo here', 403);
    if (target.old) {
      try { await removeProfilePhoto(env, target.old); } catch { /* already gone is fine */ }
    }
    await env.DB.prepare(`UPDATE ${target.table} SET ${target.column} = NULL WHERE id = ?`).bind(target.recordId).run();
    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
```

Note: the `${target.table}` / `${target.column}` interpolation is safe because both come from the fixed literals in `currentPhoto`, never from request input.

- [ ] **Step 2: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add functions/api/portal/photo.ts
git commit -m "Photos: tenant and realtor set/remove their own photo"
```

---

## Task 5: Admin upload and remove

**Files:**
- Create: `functions/api/tenants/[id]/photo.ts`
- Create: `functions/api/admin/users/[id]/photo.ts`

**Interfaces:**
- Consumes: `validatePhotoFile`, `saveProfilePhoto`, `removeProfilePhoto`, `DriveNotConnected`, `requirePermission`, `jsonOk`, `jsonError`, `serverError`, `Env`.
- Produces: `POST/DELETE /api/tenants/:id/photo` (gated `tenants_edit`), `POST/DELETE /api/admin/users/:id/photo` (gated `users_edit`).

- [ ] **Step 1: Write the tenant photo endpoint**

`functions/api/tenants/[id]/photo.ts`:

```ts
import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../lib/session';
import { validatePhotoFile } from '../../../lib/photos';
import { saveProfilePhoto, removeProfilePhoto, DriveNotConnected } from '../../../lib/google';

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_edit');
  if (auth instanceof Response) return auth;
  try {
    const id = params.id as string;
    const row = await env.DB.prepare('SELECT photo_drive_id FROM tenants WHERE id = ?').bind(id).first<{ photo_drive_id: string | null }>();
    if (!row) return jsonError('Tenant not found', 404);
    const form = await request.formData();
    const file = form.get('photo') as unknown as File | null;
    const valid = validatePhotoFile(file);
    if (!valid.ok) return jsonError(valid.error, 400);
    const newId = await saveProfilePhoto(env, file as File, row.photo_drive_id ?? undefined);
    await env.DB.prepare('UPDATE tenants SET photo_drive_id = ?, updated_at = unixepoch() WHERE id = ?').bind(newId, id).run();
    return jsonOk({ success: true, data: { photoUrl: `/api/photo/${newId}` } });
  } catch (err) {
    if (err instanceof DriveNotConnected) return jsonError('Google Drive is not connected. Connect it in Settings.', 503);
    return serverError();
  }
};

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_edit');
  if (auth instanceof Response) return auth;
  try {
    const id = params.id as string;
    const row = await env.DB.prepare('SELECT photo_drive_id FROM tenants WHERE id = ?').bind(id).first<{ photo_drive_id: string | null }>();
    if (!row) return jsonError('Tenant not found', 404);
    if (row.photo_drive_id) { try { await removeProfilePhoto(env, row.photo_drive_id); } catch { /* gone is fine */ } }
    await env.DB.prepare('UPDATE tenants SET photo_drive_id = NULL, updated_at = unixepoch() WHERE id = ?').bind(id).run();
    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
```

- [ ] **Step 2: Write the user photo endpoint**

`functions/api/admin/users/[id]/photo.ts` — the same shape, gated on `users_edit`, table `user`, column `image`, no `updated_at` literal change beyond `updated_at = ?` if the table has it (it does; bind `Math.floor(Date.now()/1000)`), 404 message `'User not found'`. Imports come from `../../../../lib/session`, `../../../../lib/photos`, `../../../../lib/google` (four levels up). Concretely:

```ts
import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../../lib/session';
import { validatePhotoFile } from '../../../../lib/photos';
import { saveProfilePhoto, removeProfilePhoto, DriveNotConnected } from '../../../../lib/google';

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'users_edit');
  if (auth instanceof Response) return auth;
  try {
    const id = params.id as string;
    const row = await env.DB.prepare('SELECT image FROM user WHERE id = ?').bind(id).first<{ image: string | null }>();
    if (!row) return jsonError('User not found', 404);
    const form = await request.formData();
    const file = form.get('photo') as unknown as File | null;
    const valid = validatePhotoFile(file);
    if (!valid.ok) return jsonError(valid.error, 400);
    const newId = await saveProfilePhoto(env, file as File, row.image ?? undefined);
    await env.DB.prepare('UPDATE user SET image = ?, updated_at = ? WHERE id = ?').bind(newId, Math.floor(Date.now() / 1000), id).run();
    return jsonOk({ success: true, data: { photoUrl: `/api/photo/${newId}` } });
  } catch (err) {
    if (err instanceof DriveNotConnected) return jsonError('Google Drive is not connected. Connect it in Settings.', 503);
    return serverError();
  }
};

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'users_edit');
  if (auth instanceof Response) return auth;
  try {
    const id = params.id as string;
    const row = await env.DB.prepare('SELECT image FROM user WHERE id = ?').bind(id).first<{ image: string | null }>();
    if (!row) return jsonError('User not found', 404);
    if (row.image) { try { await removeProfilePhoto(env, row.image); } catch { /* gone is fine */ } }
    await env.DB.prepare('UPDATE user SET image = NULL, updated_at = ? WHERE id = ?').bind(Math.floor(Date.now() / 1000), id).run();
    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
```

- [ ] **Step 3: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add functions/api/tenants/[id]/photo.ts functions/api/admin/users/[id]/photo.ts
git commit -m "Photos: admin set/remove a tenant's or user's photo"
```

---

## Task 6: photoUrl on realtor/me and my-realtors

**Files:**
- Modify: `functions/api/portal/realtor/me.ts`
- Modify: `functions/api/portal/my-realtors.ts`

**Interfaces:**
- Produces: the realtor's own `profile.photoUrl`; each realtor contact in `my-realtors` gains `photoUrl`.

- [ ] **Step 1: realtor/me profile photoUrl**

In `functions/api/portal/realtor/me.ts`, the profile SELECT already reads `name, email, phone` from `user`; add `image`:

```ts
    const profile = await env.DB.prepare('SELECT name, email, phone, image FROM user WHERE id = ?')
```

and in the returned `profile` object add:

```ts
          photoUrl: profile?.image ? `/api/photo/${profile.image}` : null,
```

(Update the row type to include `image: string | null`.)

- [ ] **Step 2: my-realtors photoUrl**

In `functions/api/portal/my-realtors.ts`, the SELECT reads `u.name, u.email, u.phone`; add `u.image`, and in the mapped result add `photoUrl: r.image ? \`/api/photo/${r.image}\` : null` (update the row type to include `image: string | null`).

- [ ] **Step 3: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add functions/api/portal/realtor/me.ts functions/api/portal/my-realtors.ts
git commit -m "Photos: expose realtor photoUrl to their dashboard and their tenants"
```

---

## Task 7: Client helpers and Avatar component

**Files:**
- Create: `src/lib/image.ts`
- Create: `src/components/ui/Avatar.tsx`
- Modify: `src/lib/api.ts` (`photoApi`)

**Interfaces:**
- Produces: `resizeImage(file, max?) -> Promise<Blob>`; `<Avatar photoUrl initials className />`; `photoApi.{ uploadSelf, removeSelf, uploadTenant, removeTenant, uploadUser, removeUser }`.

- [ ] **Step 1: Write the resize helper**

`src/lib/image.ts`:

```ts
/**
 * Resize an image file to a centered square of at most `max` px, exported as a
 * JPEG Blob, so a profile photo stays a light file. Runs in the browser.
 */
export function resizeImage(file: File, max = 400): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const side = Math.min(img.width, img.height);
      const sx = (img.width - side) / 2;
      const sy = (img.height - side) / 2;
      const size = Math.min(max, side);
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('Could not process the image'));
      ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not process the image'))), 'image/jpeg', 0.85);
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read the image')); };
    img.src = url;
  });
}
```

- [ ] **Step 2: Write the Avatar component**

`src/components/ui/Avatar.tsx`:

```tsx
interface AvatarProps {
  photoUrl?: string | null;
  initials: string;
  className?: string;
}

/** A person's avatar: their photo when set, else an initials circle. */
export function Avatar({ photoUrl, initials, className = 'w-10 h-10' }: AvatarProps) {
  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt=""
        className={`${className} rounded-full object-cover bg-primary-soft`}
      />
    );
  }
  return (
    <div className={`${className} rounded-full bg-primary-soft flex items-center justify-center`}>
      <span className="text-xs font-semibold text-primary">{initials}</span>
    </div>
  );
}
```

- [ ] **Step 3: Add the client methods**

In `src/lib/api.ts`, add a `photoApi` export. Uploads post multipart with no Content-Type header (like `portalApi.uploadDocument`), field name `photo`:

```ts
export const photoApi = {
  uploadSelf: (file: Blob): Promise<{ photoUrl: string }> => postPhoto('/portal/photo', file),
  removeSelf: (): Promise<{ success: boolean }> => apiRequest('/portal/photo', { method: 'DELETE' }),
  uploadTenant: (tenantId: string, file: Blob): Promise<{ photoUrl: string }> => postPhoto(`/tenants/${tenantId}/photo`, file),
  removeTenant: (tenantId: string): Promise<{ success: boolean }> => apiRequest(`/tenants/${tenantId}/photo`, { method: 'DELETE' }),
  uploadUser: (userId: string, file: Blob): Promise<{ photoUrl: string }> => postPhoto(`/admin/users/${userId}/photo`, file),
  removeUser: (userId: string): Promise<{ success: boolean }> => apiRequest(`/admin/users/${userId}/photo`, { method: 'DELETE' }),
};

async function postPhoto(path: string, file: Blob): Promise<{ photoUrl: string }> {
  const fd = new FormData();
  fd.append('photo', file, 'photo.jpg');
  const res = await fetch(`${API_BASE}${path}`, { method: 'POST', credentials: 'include', body: fd });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Upload failed' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  const data = await res.json();
  return data.data !== undefined ? data.data : data;
}
```

(`API_BASE` and `apiRequest` already exist at the top of the file.)

- [ ] **Step 4: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: typecheck clean, build succeeds (ignore the pre-existing >500 kB chunk warning).

- [ ] **Step 5: Commit**

```bash
git add src/lib/image.ts src/components/ui/Avatar.tsx src/lib/api.ts
git commit -m "Photos: client resize helper, Avatar component, photoApi"
```

---

## Task 8: Show avatars (read-only display)

**Files:**
- Modify: `src/pages/portal/RealtorTenants.tsx`, `src/pages/portal/RealtorTenantDetail.tsx`, `src/pages/TenantDetail.tsx`, `src/pages/Users.tsx`

**Interfaces:**
- Consumes: `Avatar` (Task 7); `photoUrl` on the serialized shapes (Tasks 1, 6). `PortalPerson`/`RealtorTenantSummary` gain `photoUrl?: string | null`, `Tenant` gains `photoUrl?: string | null`, `ApiUser` gains `photoUrl?: string | null` — add these optional fields to the types in `src/lib/api.ts`/`src/types` so the components can read them.

- [ ] **Step 1: Add photoUrl to the frontend types**

In `src/lib/api.ts` add `photoUrl?: string | null;` to `PortalPerson` (so `RealtorTenantSummary` and the realtor contact inherit it) and to `ApiUser`. In `src/types/index.ts` add `photoUrl?: string | null;` to the `Tenant` interface. In the `RealtorMe` type (src/lib/api.ts) add `photoUrl: string | null` to its `profile`.

- [ ] **Step 2: Swap initials for Avatar in each read-only spot**

Replace the hand-rolled initials circle with `<Avatar photoUrl={person.photoUrl} initials={`${person.firstName?.[0] ?? ''}${person.lastName?.[0] ?? ''}`} className="..." />`, keeping each existing size class, in:
- `RealtorTenants.tsx` (the list row avatar).
- `RealtorTenantDetail.tsx` (the header avatar; the tenant is `tenant`).
- `TenantDetail.tsx` (the header avatar; the tenant is `tenant`).
- `Users.tsx` (the per-user avatar; the user has `photoUrl`).
Import `Avatar` from `../../components/ui/Avatar` (portal pages) or `../components/ui/Avatar` (admin pages).

- [ ] **Step 3: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: typecheck clean, build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/lib/api.ts src/types/index.ts src/pages/portal/RealtorTenants.tsx src/pages/portal/RealtorTenantDetail.tsx src/pages/TenantDetail.tsx src/pages/Users.tsx
git commit -m "Photos: show avatars where people appear"
```

---

## Task 9: Photo controls (set / remove)

**Files:**
- Modify: `src/pages/portal/TenantInfo.tsx`, `src/pages/portal/RealtorDashboard.tsx`, `src/pages/TenantDetail.tsx`, `src/pages/Users.tsx`

**Interfaces:**
- Consumes: `photoApi` and `resizeImage` (Task 7), `Avatar` (Task 7), `useToast`.

- [ ] **Step 1: Self controls on the tenant Info page and realtor dashboard**

In `src/pages/portal/TenantInfo.tsx` and `src/pages/portal/RealtorDashboard.tsx`: at the top of the page, show the person's `<Avatar>` and below it a hidden file input plus "Add photo" / "Change photo" and "Remove" controls. On file pick: `const blob = await resizeImage(file); const { photoUrl } = await photoApi.uploadSelf(blob);` then update local state so the avatar refreshes (append a cache-buster like `?t=${Date.now()}` to the shown src so the browser reloads it), and toast "Photo updated." Remove calls `photoApi.removeSelf()` then clears the shown photo. Guard against a double submit with a `busy` flag. For TenantInfo this is the one write the page allows; it stays otherwise read-only. The tenant's current `photoUrl` comes from `portalApi.me()` (tenant) / the realtor's from `portalApi.realtorMe()` (already loaded on those pages).

- [ ] **Step 2: Admin control on the tenant page**

In `src/pages/TenantDetail.tsx`, next to the tenant header `<Avatar>`, when `hasPermission('tenants_edit')`, add the same file-pick + Remove controls calling `photoApi.uploadTenant(id, blob)` / `photoApi.removeTenant(id)` (resize first). Refresh the displayed avatar (cache-buster) and toast.

- [ ] **Step 3: Admin control on the Users page (realtor rows)**

In `src/pages/Users.tsx`, on a realtor row (or the row action area), when `hasPermission('users_edit')`, add a small "Photo" control (file pick + Remove) calling `photoApi.uploadUser(user.id, blob)` / `photoApi.removeUser(user.id)` (resize first), then refresh that user's avatar. Keep it unobtrusive (e.g. in the row's action menu / buttons area).

- [ ] **Step 4: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: typecheck clean, build succeeds.

- [ ] **Step 5: Commit**

```bash
git add src/pages/portal/TenantInfo.tsx src/pages/portal/RealtorDashboard.tsx src/pages/TenantDetail.tsx src/pages/Users.tsx
git commit -m "Photos: set and remove controls for self and admin"
```

---

## Self-Review

**Spec coverage:**
- Drive storage + Profile Photos folder → Task 2 (`ensurePhotoFolder`, `saveProfilePhoto`).
- tenants.photo_drive_id + realtor via user.image → Task 1 (column), Tasks 4/5 (writes).
- Serve proxy (one authenticated endpoint) → Task 3.
- Self upload/remove (tenant narrow exception, realtor) → Task 4.
- Admin upload/remove (tenant, user) → Task 5.
- photoUrl on serializers (portal tenant, admin tenant, admin user, realtor me, my-realtors) → Tasks 1 + 6.
- Client resize + photoApi + Avatar → Task 7.
- Display everywhere + controls → Tasks 8 + 9.
- Image-only + 5 MB validation → Task 2 (validator), used by Tasks 4/5.
- Replace trashes old; remove trashes + nulls → Tasks 2/4/5.

**Placeholder scan:** backend and lib tasks carry full code. The two UI tasks (8, 9) describe concrete deltas against existing components (the `Avatar` swap pattern and the resize-then-upload handler are shown in full once), with exact method names, copy, and gating — the established pattern for this project's UI tasks.

**Type consistency:** `photoUrl` (string | null) is the field name in every serializer (Tasks 1, 6) and every frontend type + `Avatar` prop (Tasks 7, 8). `saveProfilePhoto(env, file, oldDriveId?)` / `removeProfilePhoto(env, driveId)` (Task 2) are consumed with those signatures in Tasks 4 and 5. `validatePhotoFile` (Task 2) returns `{ok:true}|{ok:false,error}` and is consumed the same way. `photoApi` method names (Task 7) match their calls in Task 9. `resizeImage(file, max?)` returns a `Blob`, which `photoApi.upload*` accept.

**Production migration:** after all tasks pass and merge, apply `0013_tenant_photo.sql` to prod with `npx wrangler d1 migrations apply dunns-rental-db --remote` before the feature is used live.
