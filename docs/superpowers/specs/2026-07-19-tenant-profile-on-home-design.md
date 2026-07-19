# Tenant Profile on the Home Page — Design

**Date:** 2026-07-19
**Status:** Approved for planning
**Author:** Belle + Claude

## Goal

Surface the tenant's own profile (photo, contact details, emergency contact) on their portal Home page, matching the realtor Dashboard which already leads with a profile card. Then retire the now-duplicate "My information" tab.

## Decisions (locked with Belle)

- Tenant Home gains a profile card at the top: photo with Add/Change/Remove, name, email, phone, and emergency contact (name, phone, relationship).
- Details stay read-only except the photo ("To update your details, contact us"), same as today.
- The separate "My information" tab is removed: its page is deleted, its nav tab dropped, and `/portal/information` redirects to `/portal` so old bookmarks still land on Home.
- Realtor portal is unchanged (it already shows a profile card on its Dashboard).

## Non-goals

- No API change. The Home page already calls `portalApi.me()`, which returns the tenant with `firstName`, `lastName`, `email`, `phone`, `emergencyContact`, and `photoUrl` — everything the card needs.
- No change to rent, payments, documents, the household/realtor cards, or the management app.
- No change to how photos are stored/served (reuses `photoApi.uploadSelf` / `removeSelf`, `resizeImage`, and the `Avatar` component, exactly as the retired Info page and the realtor Dashboard do).

## Changes

**`src/pages/portal/TenantHome.tsx`** — add a local `ProfileCard` component (sibling to the existing `HouseholdCard` / `RealtorCard`), rendered first inside the returned layout. It takes the loaded `tenant` and:
- holds its own `photoUrl` (seeded from `tenant.photoUrl`), `photoBusy`, and a file-input ref;
- `handlePhotoPick` (resize -> `photoApi.uploadSelf` -> cache-bust the url) and `handlePhotoRemove` (`photoApi.removeSelf`), identical to the current Info page / realtor Dashboard;
- renders the `Avatar` + upload controls, then name, email, phone, and an emergency-contact block, with the "To update your details, contact us" note.

The Home page's existing `portalApi.me()` load already provides `me.tenant`; pass it to `ProfileCard`. No second fetch.

**`src/components/PortalLayout/index.tsx`** — remove `{ name: 'My information', path: '/portal/information' }` from `TENANT_TABS`.

**`src/App.tsx`** — replace the `/portal/information` route element with `<Navigate to="/portal" replace />` (keep the path so bookmarks redirect), and remove the now-unused `TenantInfo` import.

**`src/pages/portal/TenantInfo.tsx`** — delete (its content now lives in `ProfileCard`).

## Testing

- **Build/typecheck:** `npm run build` stays green (both tsc passes), including the removed import.
- **Behavioral (manual, live after deploy):** a tenant's Home page shows their photo, name, email, phone, and emergency contact at the top; Add/Change/Remove photo works there; the "My information" tab is gone from the nav; visiting `/portal/information` redirects to Home; Payments/Documents tabs and the realtor Dashboard are unchanged.

There is no new pure logic to unit-test (the card is presentational and reuses existing photo APIs).

## Rollout

UI-only change on `feature/tenant-profile-on-home` (branched off `main`). No migration. Deploy = merge to `main` + push (Cloudflare auto-deploys). Verify on the live portal as a tenant after deploy.
