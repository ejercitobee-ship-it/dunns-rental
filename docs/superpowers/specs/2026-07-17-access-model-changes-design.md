# Access Model Changes — Design

**Date:** 2026-07-17
**Status:** Approved for planning
**Author:** Belle + Claude

## Goal

Four related access changes:

1. **Tenants become view + add only** in the portal: no editing their own profile, no editing or removing household members.
2. **Realtors can add a new tenant** from their dashboard; it is created and immediately linked to them.
3. **Super Admin can add a tenant on a realtor's behalf** from admin.
4. **Super Admin gets an unrestricted (force) delete** that overrides today's safety guards and purges financial history.

## Decisions (locked with Belle)

- Tenant restriction scope: **household AND own profile**. A tenant may still view everything, add household members, and upload documents. They may NOT edit their own profile, nor edit or remove household members.
- Realtor add-tenant: **create and auto-link**. A new person record is created and immediately linked to that realtor (appears in their list, 30-day window starts from the link). Realtor enters name and contact only.
- Realtor add-tenant **always creates a brand-new record, never attaches to an existing tenant** (a security rule: otherwise a realtor could type a known email and gain access to someone else's tenant). Duplicates are Belle's to merge in admin.
- Super Admin "add on a realtor's behalf": from a realtor's row in admin, Super Admin creates a tenant and links it to that realtor (same create-and-link logic).
- Super Admin force-delete: deletes a tenant and **purges the rent payments recorded as paid by them**; deletes a staff login even when it owns records, **purging that login's expenses and incomes**, and **reassigning any Properties/Units it owns to the acting Super Admin** (option b: the portfolio survives, only "history" is purged). Regular Admins keep today's guarded behavior (409 when a login owns records; tenant deletion preserves payment rows).

## Non-goals

- No change to what a realtor can VIEW (still only their linked main tenant's contact info, emergency contact, and documents).
- No merge-duplicate-tenants tool (Belle handles duplicates by hand for now).
- Realtor-created tenants carry no lease/unit/rent; Belle completes those in admin later.

---

## Part 1 — Tenant portal: view + add only

### Backend
- **Disable tenant profile edit.** Remove the `onRequestPut` handler in `functions/api/portal/me.ts` (the tenant self-edit). `PUT /api/portal/me` no longer exists, so a crafted request cannot edit the tenant record either.
- **Disable tenant household edit/remove.** Remove `functions/api/portal/household/[id].ts` (the portal PUT/DELETE). `functions/api/portal/household/index.ts` keeps GET (list) and POST (add). The admin household edit/remove (`functions/api/household/[id].ts`) is unchanged.

### Frontend
- `src/pages/portal/TenantInfo.tsx`: becomes read-only. Remove the edit form, the Save control, and the `portalApi.updateMe` call; render the tenant's details as static fields.
- `src/pages/portal/TenantHome.tsx` (`HouseholdCard`): remove the per-row Edit and Remove controls and their state (`editingId`, `toRemove`, the `ConfirmDialog`, and the `update`/`remove` handlers). Keep the list and the add form.
- `src/lib/api.ts`: remove `portalApi.updateMe` and `portalApi.household.update` / `portalApi.household.remove` (now unused by the portal). `householdApi.update`/`remove` (admin) stay.

### Rule
A tenant can view everything, add a household member, and upload a document. Every edit and every remove is gone from the tenant's portal and its endpoints.

---

## Part 2 — Realtor adds a new tenant

### Shared creation logic
A helper `createTenantForRealtor(env, realtorUserId, input)` (new `functions/lib/realtorTenants.ts`) validates the input, creates the `tenants` row (person-only, `user_id` NULL), and inserts a `tenant_realtors` link with `created_at = now`, in one `env.DB.batch`. It ALWAYS inserts a new tenant; it never looks up or attaches to an existing one. Input is `{ firstName, lastName, email?, phone? }`, validated by a small pure `validateTenantContact` (name required, fields trimmed and length-capped, like `validateHouseholdInput`). Returns the new tenant's serialized summary.

### Portal endpoint
- `POST /api/portal/realtor/tenants` (add `onRequestPost` to `functions/api/portal/realtor/tenants/index.ts`). `requireUser`; the caller's role must be `realtor` (else 403). Calls `createTenantForRealtor(env, auth.id, body)`. The new tenant then resolves through the existing `realtorTenantIds` (window anchored on the link date, since there is no lease yet: `realtorAccessEndsOn(undefined, linkedOn)` = 30 days from the link).

### Frontend
- `src/pages/portal/RealtorTenants.tsx`: add an "Add tenant" button that opens a small form (first name, last name, email, phone), posts to the new endpoint, and refreshes the list. Copy makes clear this creates a new person record.
- `src/lib/api.ts`: `portalApi.addRealtorTenant(data)`.

### Isolation
Unchanged: the realtor sees only the linked tenant's contact info, emergency contact, and documents (`serializePortalTenant` allowlist). Creating a tenant does not widen that.

---

## Part 3 — Super Admin adds a tenant on a realtor's behalf

### Admin endpoint
- `POST /api/realtors/:id/tenants` (new `functions/api/realtors/[id]/tenants.ts`). Gated on `tenants_create` (Super Admin, Admin, and Manager hold it). `:id` is the realtor's user id. Validates that the id is an active `realtor`-role user, then calls the SAME `createTenantForRealtor(env, realtorId, body)` helper. Returns the created tenant.

### Frontend
- On the Users page Realtors tab (`src/pages/Users.tsx`), each realtor row gets an "Add tenant" action that opens a small form (first/last name, email, phone) and posts to `POST /api/realtors/:id/tenants`, so Belle can seed a realtor's dashboard for them.
- `src/lib/api.ts`: `realtorsApi.addTenant(realtorUserId, data)`.

---

## Part 4 — Super Admin force-delete

Both delete endpoints branch on `auth.role === 'super_admin'`. Non-super-admin callers keep today's behavior exactly.

### Tenant delete (`functions/api/tenants/[id].ts`, DELETE)
- Non-super-admin: unchanged (cascades `lease_tenants`/`tenant_realtors`/household, nulls `rent_payments.paid_by_tenant_id`, removes an orphan login).
- Super Admin: additionally `DELETE FROM rent_payments WHERE paid_by_tenant_id = :tenantId` (purge the payment history recorded as paid by this person) as part of the same batch, before deleting the tenant. Documents tied to the tenant are already removed by the existing flow.

### User (login) delete (`functions/api/admin/users/[id].ts`, DELETE)
- Non-super-admin: unchanged (returns 409 when the user owns properties/expenses/incomes; otherwise the existing FK-safe `deleteUserStatements` batch).
- Super Admin: skip the 409 guard and instead, in one batch:
  - `UPDATE properties SET user_id = :actingSuperAdminId WHERE user_id = :targetId` (reassign the portfolio to the acting Super Admin so it survives — option b),
  - `DELETE FROM expenses WHERE user_id = :targetId` and `DELETE FROM incomes WHERE user_id = :targetId` (purge that login's financial history),
  - then the existing `deleteUserStatements(env, targetId)` (which nulls `tenants`/`leases`/`maintenance` refs and removes session/account/roles/metadata/user).
- The "cannot delete your own account" check stays for every role.

### Frontend
- The delete confirmation dialogs, when the current user is Super Admin, use stronger copy stating that history will be permanently purged (tenant: "this also permanently deletes their payment history"; user: "this permanently deletes their income and expense records and reassigns their properties to you"). No dashes in the copy.
- `auth`/role is already available in the UI via `useAuth`; gate the stronger copy on the current user's role being `super_admin`.

---

## Data model

No schema changes. All four parts use existing tables (`tenants`, `tenant_realtors`, `rent_payments`, `expenses`, `incomes`, `properties`). The realtor auto-link reuses `tenant_realtors` and the existing window rule in `functions/lib/portal.ts`.

## Security and isolation summary

- Tenants lose every write except add-household and upload-document; the edit/remove endpoints are gone, not just hidden.
- Realtor add-tenant only ever creates new records; it can never attach to or reveal an existing tenant.
- Force-delete and history purge are gated strictly on `auth.role === 'super_admin'` in the endpoint, never on a client flag; Admin and Manager cannot trigger it.
- The admin add-for-realtor endpoint is gated on `tenants_create` and validates the target is a realtor.

## Testing

- **Unit (automated):** `validateTenantContact` (name required, length caps, trimming). Reuse the `folderStatusFrom`/`validateHouseholdInput` testing style.
- **Manual verification (no Pages+D1 integration harness):**
  - Tenant portal shows no edit/remove: Info page read-only, household add works but no edit/remove, `PUT /api/portal/me` and `PUT/DELETE /api/portal/household/:id` return 404/405.
  - Realtor adds a tenant; it appears in their list, resolves through the window, and the realtor still sees only the allowlisted fields. A second realtor cannot see it.
  - Admin adds a tenant for a realtor; it links and appears in that realtor's dashboard.
  - Super Admin deletes a tenant with payments and the payment rows are gone; deletes a staff login that owns a property and an expense, and the property is reassigned to the Super Admin while the expense is purged and the login removed. A regular Admin still gets the 409 on the same login.

## Files touched

**Part 1:** `functions/api/portal/me.ts` (remove PUT), delete `functions/api/portal/household/[id].ts`, `src/pages/portal/TenantInfo.tsx`, `src/pages/portal/TenantHome.tsx`, `src/lib/api.ts`.

**Part 2:** `functions/lib/realtorTenants.ts` (new, with `validateTenantContact` + `createTenantForRealtor`), `functions/api/portal/realtor/tenants/index.ts` (add POST), `src/pages/portal/RealtorTenants.tsx`, `src/lib/api.ts`.

**Part 3:** `functions/api/realtors/[id]/tenants.ts` (new), `src/pages/Users.tsx`, `src/lib/api.ts`.

**Part 4:** `functions/api/tenants/[id].ts` (DELETE), `functions/api/admin/users/[id].ts` (DELETE), the delete-confirmation copy in `src/pages/Users.tsx` and `src/pages/TenantDetail.tsx` (or wherever tenant delete is triggered).
