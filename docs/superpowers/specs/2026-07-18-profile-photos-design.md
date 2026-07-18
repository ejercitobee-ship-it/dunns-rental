# Profile Photos — Design

**Date:** 2026-07-18
**Status:** Approved for planning
**Author:** Belle + Claude

## Goal

Tenants and realtors can set a profile photo from their portal; Belle can also set or replace anyone's photo from admin. The photo is stored in Belle's Google Drive, linked to the person's record, and shown as their avatar (replacing the initials circle) on the portal and in admin.

## Decisions (locked with Belle)

- **Storage: Google Drive.** Photos go into a "Profile Photos" folder in Belle's Drive; the Drive file id is stored on the person's record.
- **Who can set it: the person AND Belle.** A tenant/realtor sets their own from their portal; Belle sets or replaces anyone's from admin. For tenants this is a deliberate narrow exception to their view-plus-add-only rule (they may manage their own photo, nothing else).
- **Serving: one shared proxy.** A single authenticated endpoint streams a photo by its Drive file id; the id is only ever exposed to viewers already authorized to see that person (via the existing scoped serializers). Belle accepted this over stricter per-view scoping (face photos are low sensitivity, ids are unguessable).

## Non-goals

- No change to any other tenant/realtor data-access scoping.
- No photo history or cropping UI beyond a simple client-side resize.
- Staff (non-realtor) photos are a free side effect of the admin user endpoint but are not a goal.

---

## Data model

Migration `0013_tenant_photo.sql`:

```sql
-- Drive file id of the tenant's profile photo (in Belle's "Profile Photos"
-- Drive folder). NULL means no photo (show initials).
ALTER TABLE tenants ADD COLUMN photo_drive_id TEXT;
```

Realtors (and staff) are `user` records and reuse the existing unused `user.image` column to hold their photo's Drive file id. No migration needed for users.

A `photoUrl` derived field is added to the serialized shapes (see below): `photoUrl = driveId ? '/api/photo/' + driveId : null`.

---

## Drive storage

Add to `functions/lib/google.ts`:
- `ensurePhotoFolder(env)` — like `ensureRootFolder`, returns the id of a "Profile Photos" folder under the app root (created on first use, remembered in `app_settings` under a new key `google_photo_folder_id`, healed if deleted).

Upload reuses `uploadToDrive(env, folderId, name, contentType, blob)`; serve reuses `getDriveFileStream(env, fileId)`; remove reuses `deleteDriveFile(env, fileId)`. When a photo is replaced, the OLD Drive file is trashed after the new one is saved.

---

## Endpoints

### Serve (one proxy)
- `GET /api/photo/:id` — `requireUser` (any logged-in session: tenant, realtor, or staff). Streams the Drive file `:id` via `getDriveFileStream`, passing through Drive's `Content-Type`, with `Cache-Control: private, max-age=3600` so the browser caches the avatar. 404 if Drive returns not-found; 503 `DriveNotConnected` handled like other Drive endpoints.

### Upload / remove — self (portal)
- `POST /api/portal/photo` — `requireUser`; role must be `tenant` or `realtor`. Multipart `photo` file (image only, max 5 MB). Uploads to the Profile Photos folder, then stores the new id: for a `tenant`, on their own `tenants.photo_drive_id` (resolved via `tenantIdForUser`); for a `realtor`, on `user.image` (their `auth.id`). Trashes the previous photo file if there was one. Returns `{ photoUrl }`.
- `DELETE /api/portal/photo` — removes the caller's own photo: trashes the Drive file, nulls the field. Returns `{ success: true }`.

### Upload / remove — admin
- `POST /api/tenants/:id/photo` (gated `tenants_edit`) and `DELETE /api/tenants/:id/photo` — set/replace/remove a tenant's photo (`tenants.photo_drive_id`).
- `POST /api/admin/users/:id/photo` (gated `users_edit`) and `DELETE /api/admin/users/:id/photo` — set/replace/remove a user's photo (`user.image`); this is how Belle sets a realtor's photo.

All uploads validate the file is an image (`content-type` starts with `image/`) and within the size cap; the client resizes first so uploads are small.

---

## Serializers (add `photoUrl`)

- `serializePortalTenant` (tenant portal self + realtor viewing their tenant): `photoUrl` from the tenant row's `photo_drive_id`.
- `serializeTenant` (admin tenant detail): `photoUrl` from `photo_drive_id`.
- `serializeUser` (admin users list): `photoUrl` from `image`.
- The realtor `me` profile (`/api/portal/realtor/me`): `photoUrl` from the realtor's `user.image`.
- The tenant's realtor contact (`/api/portal/my-realtors`): include the realtor's `photoUrl` from `user.image` (so a tenant sees their realtor's face).

Since these serializers already gate what each viewer receives, a `photoUrl` only reaches an authorized viewer.

---

## Client

`src/lib/api.ts`:
- `photoApi.uploadSelf(file)`, `photoApi.removeSelf()`.
- `photoApi.uploadTenant(tenantId, file)`, `photoApi.removeTenant(tenantId)`.
- `photoApi.uploadUser(userId, file)`, `photoApi.removeUser(userId)`.
- Uploads post multipart (no Content-Type header, like the document upload).

`src/lib/image.ts` (new): `resizeImage(file, max = 400): Promise<Blob>` — draws the image onto a canvas at up to `max`x`max` (preserving aspect, center-cropped to a square), exports JPEG at ~0.85 quality. Called before upload so Drive files stay ~20 to 40 KB.

---

## UI

A shared component `src/components/ui/Avatar.tsx`: `Avatar({ photoUrl, initials, className })` — renders an `<img src={photoUrl}>` when present, else the initials circle (matching the existing style). Used everywhere an avatar shows.

Swap initials for `Avatar` and add the set/remove control where appropriate:
- **Tenant portal** (`TenantInfo.tsx`, the tenant's own profile page): the tenant's own avatar at the top + an "Add/Change photo" and "Remove" control (calls `photoApi.uploadSelf`/`removeSelf`, resizing first). The page is otherwise read-only; the photo control is the single narrow write a tenant is allowed here.
- **Realtor dashboard** (`RealtorDashboard.tsx`): the realtor's own avatar + the same controls (`uploadSelf`/`removeSelf`).
- **Realtor viewing tenants** (`RealtorTenants.tsx` list, `RealtorTenantDetail.tsx`): show the tenant's `photoUrl` avatar (read only).
- **Admin tenant page** (`TenantDetail.tsx`): the tenant's avatar + admin set/replace/remove (`uploadTenant`/`removeTenant`), gated on `tenants_edit`.
- **Admin Users page** (`Users.tsx`): each user's avatar; for a realtor row, an admin set/replace/remove (`uploadUser`/`removeUser`), gated on `users_edit`.

Out of scope: the staff sidebar avatar in `components/Layout/index.tsx` stays initials (Belle asked for tenants and realtors; staff photos are not a goal).

---

## Testing

- No meaningful pure logic to unit test (the resize helper needs a browser canvas; the `photoUrl` derivation is trivial). 
- **Manual / DB-level verification:**
  - A tenant uploads a photo from their portal; it appears as their avatar there and on Belle's admin tenant page; the Drive file exists in the Profile Photos folder; `tenants.photo_drive_id` is set.
  - A realtor uploads their photo; it shows on their dashboard and on Belle's Users page; `user.image` is set.
  - Belle sets a tenant's and a realtor's photo from admin; replacing a photo trashes the old Drive file.
  - Removing a photo nulls the field, trashes the Drive file, and reverts to initials.
  - `GET /api/photo/:id` returns the image bytes for a logged-in user and 401 for a logged-out request.
  - A realtor sees their linked tenant's photo; a tenant sees their realtor's photo.

## Files touched

**Data:** `migrations/0013_tenant_photo.sql`; `functions/lib/serializers.ts` (photoUrl on serializePortalTenant, serializeTenant, serializeUser).

**Drive + endpoints:** `functions/lib/google.ts` (`ensurePhotoFolder`); `functions/api/photo/[id].ts` (serve); `functions/api/portal/photo.ts` (self upload/remove); `functions/api/tenants/[id]/photo.ts` (admin tenant); `functions/api/admin/users/[id]/photo.ts` (admin user); `functions/api/portal/realtor/me.ts` and `functions/api/portal/my-realtors.ts` (add photoUrl).

**Client + UI:** `src/lib/api.ts` (`photoApi`), `src/lib/image.ts` (resize), `src/components/ui/Avatar.tsx` (new); `src/pages/portal/{TenantInfo,RealtorDashboard,RealtorTenants,RealtorTenantDetail}.tsx`, `src/pages/{TenantDetail,Users}.tsx`.
