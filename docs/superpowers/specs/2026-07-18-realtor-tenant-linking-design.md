# Realtor Tenant Linking — Design

**Date:** 2026-07-18
**Status:** Approved for planning
**Author:** Belle + Claude

## Goal

Two refinements to how tenants get attached to realtors:

1. **Admin side:** when adding a tenant to a realtor, offer two modes: link an existing tenant who has no realtor yet (a dropdown), or create a brand-new tenant. Today only "create new" exists.
2. **Realtor portal:** relabel the realtor's add action to make it clearly a "New Tenant" flow, with a one-line note that it creates a new person in the system. No behavior change; realtors stay create-new only (privacy).

## Decisions (locked with Belle)

- Admin add-tenant-for-realtor supports **both**: link an existing unlinked tenant OR create a new one.
- "No realtor yet" means a tenant not linked to **any** realtor (absent from `tenant_realtors`).
- Realtors on their own portal can **only create new tenants**, never see or pick existing ones (privacy rule, unchanged from the shipped feature).

## Non-goals

- No change to the realtor's create-new behavior or to the privacy rule.
- No merge/unlink changes; unlinking already exists on the tenant page.
- No new schema.

---

## Part A — Admin: link existing or create new

### New endpoint
- `GET /api/tenants/unlinked` — tenants not linked to any realtor, for the picker. Returns `[{ id, firstName, lastName }]`, ordered by last then first name. Gated on `tenants_edit` (it exists only to serve the linking flow).
  - Query: `SELECT id, first_name, last_name FROM tenants WHERE id NOT IN (SELECT tenant_id FROM tenant_realtors) ORDER BY last_name, first_name`.
  - File: `functions/api/tenants/unlinked.ts`. This is a STATIC route, which Cloudflare Pages resolves before the dynamic `functions/api/tenants/[id].ts`, so `/api/tenants/unlinked` will not be captured as a tenant id.

### Client
- `tenantsApi.listUnlinked(): Promise<{ id: string; firstName: string; lastName: string }[]>` calling `GET /api/tenants/unlinked`.
- Reuse the existing `tenantsApi.linkRealtor(tenantId, realtorUserId)` (POST `/api/tenants/:id/realtors`) to link, and the existing `realtorsApi.addTenant(realtorUserId, data)` to create new. No new link/create endpoints.

### Admin modal (`src/pages/Users.tsx`, the "Add tenant for this realtor" modal)
- Add a mode toggle at the top of the modal: **Link existing tenant** and **Create new tenant** (default to Link existing).
- **Link existing:** when the modal opens for a realtor, fetch `tenantsApi.listUnlinked()` into state and render a `<select>` of those tenants (label "LastName, FirstName"). On submit, call `tenantsApi.linkRealtor(selectedTenantId, addTenantTarget.id)`. If the list is empty, show "Every tenant already has a realtor. Create a new one instead." and hide the dropdown.
- **Create new:** the existing name/contact form, calling `realtorsApi.addTenant(addTenantTarget.id, tenantForm)` (unchanged).
- On success in either mode: success toast, close the modal, and reset the mode/selection/form state. Guard against a double submit is not required beyond the existing pattern, but disable the submit button while a request is in flight.

### Isolation
Unchanged. This is admin-only (`tenants_edit`). The unlinked list is only reachable by staff who can link.

---

## Part B — Realtor portal: clearer "New Tenant" label

In `src/pages/portal/RealtorTenants.tsx`:
- Relabel the existing "Add tenant" button and the form heading to **"New Tenant"**.
- Keep the existing helper copy, or adjust it to: "This creates a new person in your list and in the system. If they are already in the system, ask the office to link them instead." (no dashes).
- No functional change: it still calls `portalApi.addRealtorTenant` (create new only).

---

## Data model

No schema changes. Uses existing `tenants`, `tenant_realtors`.

## Testing

- No new pure logic to unit test (the unlinked query is SQL, verified by hand).
- **Manual verification:**
  - Admin: on a realtor, open Add tenant, choose "Link existing", see only tenants with no realtor, link one, confirm it appears in that realtor's dashboard and no longer appears in the unlinked list.
  - Admin: choose "Create new", create a tenant, confirm it links and shows for the realtor.
  - A tenant already linked to any realtor does not appear in the dropdown.
  - Realtor portal: the action reads "New Tenant" and still creates a new tenant that reflects in admin.

## Files touched

**Part A:** `functions/api/tenants/unlinked.ts` (new), `src/lib/api.ts` (`tenantsApi.listUnlinked`), `src/pages/Users.tsx` (modal two modes).

**Part B:** `src/pages/portal/RealtorTenants.tsx` (label + copy).
