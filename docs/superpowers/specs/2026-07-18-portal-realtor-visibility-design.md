# Portal Realtor Visibility — Design

**Date:** 2026-07-18
**Status:** Approved for planning
**Author:** Belle + Claude

## Goal

Two portal additions:

1. **Tenant sees their realtor:** a "Your realtor" card on the tenant dashboard with the realtor's name, email, and phone.
2. **Realtor dashboard:** the realtor portal gets a Dashboard landing page showing the realtor's own profile (view only) and a small summary, with "My tenants" moved to its own tab.

## Decisions (locked with Belle)

- The tenant sees their realtor's contact info **always** (even after the realtor's 30-day access window to that tenant has lapsed). It is just contact info.
- The realtor's dashboard profile is **view only**. The realtor cannot edit their name, email, or phone; Belle updates those from admin.
- The realtor dashboard shows their profile **plus a small summary**: total tenants placed, and how many are currently inside their active window. It links through to My tenants.

## Non-goals

- No editing of realtor or tenant profiles from the portal (both are view only there now).
- No change to what a realtor sees about a tenant (still the linked tenant's contact, emergency contact, and documents).
- No schema changes.

---

## Feature 1 — Tenant sees their realtor

### Endpoint
- `GET /api/portal/my-realtors` (tenant-role only; `requireUser`, then `auth.role === 'tenant'` else 403). Resolves the tenant from the session via `tenantIdForUser(auth.id)`, then:
  - `SELECT u.name, u.email, u.phone FROM user u JOIN tenant_realtors tr ON tr.realtor_user_id = u.id WHERE tr.tenant_id = ? ORDER BY u.name`.
  - Returns `[{ name, email, phone }]`. No window filter (always). Empty array if the tenant has no realtor or no tenant record.

### Client
- `portalApi.myRealtors(): Promise<{ name: string | null; email: string; phone: string | null }[]>`.

### UI
- `src/pages/portal/TenantHome.tsx`: a "Your realtor" card listing each linked realtor's name, email, and phone. If the array is empty, the card does not render. (A tenant usually has one realtor; render all if more.)

### Isolation
The realtor list is resolved from the tenant's own session id, never a client-supplied id. A tenant only ever sees their own realtor(s).

---

## Feature 2 — Realtor dashboard

### Endpoint
- `GET /api/portal/realtor/me` (realtor-role only; `requireUser`, then `auth.role === 'realtor'` else 403). Returns:
  - `profile`: `{ name, email, phone }` from `SELECT name, email, phone FROM user WHERE id = ?` bound to `auth.id`.
  - `tenantsPlaced`: `SELECT COUNT(*) AS n FROM tenant_realtors WHERE realtor_user_id = ?` (total ever linked to this realtor).
  - `tenantsInWindow`: `(await realtorTenantIds(env, auth.id, serverToday())).length` (currently inside the 30-day window), reusing the existing helper in `functions/lib/portal.ts`.
  - Response shape: `{ profile: { name, email, phone }, tenantsPlaced: number, tenantsInWindow: number }`.

### Client
- `portalApi.realtorMe(): Promise<{ profile: { name: string | null; email: string; phone: string | null }; tenantsPlaced: number; tenantsInWindow: number }>`.

### UI
- New page `src/pages/portal/RealtorDashboard.tsx`:
  - A profile card: name, email, phone, view only, with a line "To update these details, please contact the office." (no dashes).
  - A summary: "Tenants placed: N" and "In your active window: N".
  - A button linking to `/portal/tenants` (My tenants).

### Routing changes (`src/App.tsx`, `src/components/PortalLayout/index.tsx`)
- `PortalIndex` (at `/portal`): for a realtor, render `RealtorDashboard` (was `RealtorTenants`).
- Add a route `/portal/tenants` rendering `RealtorTenants` (the list). `/portal/tenants/:id` stays `RealtorTenantDetail`, unchanged. `RealtorTenants` already links to `/portal/tenants/:id`, so its internal links do not change.
- `REALTOR_TABS` becomes: `{ Dashboard: /portal }`, `{ My tenants: /portal/tenants }`. `TENANT_TABS` unchanged.

### Isolation
The realtor's profile and counts are resolved from `auth.id`, never a client-supplied id. A realtor only ever sees their own data.

---

## Data model

No schema changes. Uses `user` (name, email, phone), `tenant_realtors`, and the existing `realtorTenantIds` window logic.

## Testing

- No new pure logic worth a unit test (both endpoints are SQL + the existing `realtorTenantIds`). Verify the queries against local D1 by hand.
- **Manual verification:**
  - A tenant linked to a realtor sees the "Your realtor" card with the correct name/email/phone; a tenant with no realtor sees no card; the card still shows after the realtor's window would have lapsed.
  - A realtor lands on the Dashboard, sees their own profile (view only, no edit control), and correct counts (placed vs in-window); "My tenants" is a separate tab and still works, including opening a tenant's detail.
  - A tenant hitting `/api/portal/realtor/me` gets 403; a realtor hitting `/api/portal/my-realtors` gets 403.

## Files touched

**Feature 1:** `functions/api/portal/my-realtors.ts` (new), `src/lib/api.ts` (`portalApi.myRealtors`), `src/pages/portal/TenantHome.tsx` (card).

**Feature 2:** `functions/api/portal/realtor/me.ts` (new), `src/lib/api.ts` (`portalApi.realtorMe`), `src/pages/portal/RealtorDashboard.tsx` (new), `src/App.tsx` (routes), `src/components/PortalLayout/index.tsx` (tabs).
