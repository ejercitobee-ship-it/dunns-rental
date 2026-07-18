# Household Members + Users Page Tabs — Design

**Date:** 2026-07-17
**Status:** Approved for planning
**Author:** Belle + Claude

## Goal

Two related additions to Dunn's Rental:

1. **Household members** — a tenant (and Belle) can record the other people living in a unit as contact-only entries (name, phone, relationship). No login, no portal access, no rent — just a roster so everyone knows who is in each unit.
2. **Users page tabs** — split the single Users list into **Internal / Realtors / Tenants**, so Belle's staff are visually separated from the outside portal logins.

These ship together because both are user/household housekeeping, but they are independent and can be built and reviewed separately.

## Decisions (locked with Belle)

- An added person is a **household member (name/contact only)**: no login, no Drive folder, no rent, cannot be invited. Deliberately NOT a `tenants` record.
- **Both** the tenant (from their dashboard) and Belle (from admin) can **add, edit, and remove** household members.
- **Realtors get no new powers.** A realtor sees ONLY their linked (main) tenant's contact info (name, email, phone), that tenant's emergency contact, and documents (view/upload within the 30-day window) — exactly as shipped today. They never see the household list, and never any co-tenant's data. Their only change in this work is getting their own tab on the Users page.
- Users page splits into **three tabs**: Internal / Realtors / Tenants.

## Non-goals

- Household members do not get portal logins now or later in this work.
- No change to realtor capabilities beyond the Users tab grouping.
- No change to the lease/rent/payment model.

---

## Feature 1 — Household members

### Data model

New table (migration `0011_household.sql`; note 0008 was skipped historically, next free number is 0011):

```sql
CREATE TABLE IF NOT EXISTS household_members (
  id TEXT PRIMARY KEY,
  lease_id TEXT NOT NULL REFERENCES leases(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT,
  relationship TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);
CREATE INDEX IF NOT EXISTS idx_household_members_lease ON household_members(lease_id);
```

- **Attached to the lease, not the tenant.** "Who lives in the unit" is a property of the tenancy, and co-tenants on one lease share a single household roster. `ON DELETE CASCADE` so removing a lease removes its household (same rule as `lease_tenants`).
- Contact-only: no `user_id`, no money, no email. Nothing in the tenant/invite/Drive machinery can reach this table.

### Serializer

Add to `functions/lib/serializers.ts`:

```ts
export function serializeHouseholdMember(row: Record<string, unknown>) {
  return {
    id: row.id as string,
    leaseId: row.lease_id as string,
    name: row.name as string,
    phone: (row.phone as string) ?? null,
    relationship: (row.relationship as string) ?? null,
    createdAt: row.created_at as number,
  };
}
```

### Lease resolution helpers (portal isolation)

Add to `functions/lib/portal.ts`:

- `tenantLeaseIds(env, tenantId): Promise<string[]>` — every lease id the tenant is on (`SELECT lease_id FROM lease_tenants WHERE tenant_id = ?`). Used to authorize edits/deletes.
- `currentLeaseId(env, tenantId): Promise<string | null>` — the most recent non-ended lease, reusing the exact query already in `portal/me.ts`:
  `SELECT l.id FROM leases l JOIN lease_tenants lt ON lt.lease_id = l.id WHERE lt.tenant_id = ? AND l.status != 'ended' ORDER BY l.start_date DESC LIMIT 1`. Used as the target when a tenant adds a member.

### Admin API

Flat resource keyed by lease id. All gated on existing tenant permissions.

- `GET  /api/household?leaseId=<id>` — list members for a lease. Permission: `tenants_view`.
- `POST /api/household` — body `{ leaseId, name, phone?, relationship? }`. Permission: `tenants_edit`. 400 if `name` empty or `leaseId` missing/unknown.
- `PUT  /api/household/:id` — body `{ name, phone?, relationship? }`. Permission: `tenants_edit`. 404 if not found.
- `DELETE /api/household/:id` — Permission: `tenants_edit`. 404 if not found.

Files: `functions/api/household/index.ts` (GET, POST) and `functions/api/household/[id].ts` (PUT, DELETE).

### Portal API

The lease is always resolved from the session; the browser never supplies a lease id.

- `GET  /api/portal/household` — members of the caller's **current** lease. Empty array if the tenant has no active lease. Realtors get `[]` (out of scope for them).
- `POST /api/portal/household` — body `{ name, phone?, relationship? }`. Adds to the caller's current lease (`currentLeaseId`). 400 `"You have no active lease"` if none. 400 if `name` empty.
- `PUT  /api/portal/household/:id` — edit. Loads the member, and only proceeds if `member.lease_id` is in `tenantLeaseIds(caller)`. Otherwise 404 (not 403, so the endpoint cannot be used to probe which member ids exist), matching the existing portal-documents pattern.
- `DELETE /api/portal/household/:id` — same ownership check, same 404-on-miss rule.

Files: `functions/api/portal/household/index.ts` (GET, POST) and `functions/api/portal/household/[id].ts` (PUT, DELETE). Callers authenticate with `requireUser`; role must be `tenant` (realtors resolve to no reachable household).

**Validation:** `name` trimmed, required, max 120 chars. `phone`, `relationship` optional, trimmed, max 120 chars, stored `null` when blank. A sane cap of **20 members per lease** rejects abuse with a 400.

### Tenant dashboard UI

On `src/pages/portal/TenantHome.tsx`, add a **"Who lives here"** card:

- Lists each member: `name` — `relationship` (if set), with `phone` (if set).
- An **Add person** inline form: name (required), phone, relationship. Submit calls `POST /api/portal/household`.
- Each row has **Edit** and **Remove** (Remove behind a confirm dialog, matching the app's existing `ConfirmDialog`).
- If the tenant has no active lease, the card shows a short "Once your lease is active you can add the people living with you." message instead of the form.

Add `portalApi.household` methods (`list`, `add`, `update`, `remove`) to `src/lib/api.ts`.

### Admin UI

On `src/pages/TenantDetail.tsx`, add a **Household** card for the tenant's current lease:

- Same list + add/edit/remove, gated on `hasPermission('tenants_edit')` for the write controls (view for `tenants_view`).
- Resolves the tenant's current lease from the lease data the page already loads; if the tenant has no active lease, shows "No active lease."
- Uses a new `tenantsApi`/`householdApi` client for the `/api/household` endpoints.

### Isolation summary (the security contract)

- A tenant can only ever read or change household members of a lease they are on. The lease is resolved from their login for reads and for adds; for edits/deletes the member's lease is checked against `tenantLeaseIds(caller)`.
- Realtors reach no household members.
- The admin endpoints require `tenants_view` / `tenants_edit`, which the portal roles (`tenant`, `realtor`) do not have, so a portal login cannot call them.

---

## Feature 2 — Users page tabs

### Categorization

A pure helper (unit-tested) decides which tab a user belongs to, by role id:

```ts
export type UserCategory = 'internal' | 'realtor' | 'tenant';
export function userCategory(roleId: string): UserCategory {
  if (roleId === 'tenant') return 'tenant';
  if (roleId === 'realtor') return 'realtor';
  return 'internal';
}
```

Everything that is not a portal role is Internal, so new staff roles need no maintenance here.

### UI (`src/pages/Users.tsx`)

- Add a tab switcher: **Internal / Realtors / Tenants**, each showing its count.
- Filter the table to the active tab (applied before the existing search filter, which keeps working within the tab).
- **Add User** button appears only on the **Internal** tab. On Realtors and Tenants, show a one-line note: "Realtors are added by linking them from a tenant's page." / "Tenants get portal access by inviting them from their page."
- Delete/edit controls behave exactly as today (the delete FK fix already shipped), so a tenant or realtor login can be removed from its tab.
- Default tab: Internal.

No backend change — the users list already includes every login with its role.

---

## Testing

- **Unit tests (automated):** `userCategory` mapping (internal/realtor/tenant, and an unknown role falls to internal); household validation rules (empty name rejected, cap enforced) via a small pure validator if extracted.
- **Manual verification (no Pages+D1 integration harness, consistent with the rest of the project):**
  - Tenant adds/edits/removes a household member; it appears on Belle's admin tenant page and vice-versa.
  - A tenant cannot edit or delete a household member on a lease they are not on (404).
  - A realtor sees no household controls and `GET /api/portal/household` returns `[]`.
  - Users page: staff under Internal, an invited tenant under Tenants, a linked realtor under Realtors; Add User only on Internal.

## Files touched

**Feature 1:** `migrations/0011_household.sql`, `functions/lib/serializers.ts`, `functions/lib/portal.ts`, `functions/api/household/{index,[id]}.ts`, `functions/api/portal/household/{index,[id]}.ts`, `src/lib/api.ts`, `src/pages/portal/TenantHome.tsx`, `src/pages/TenantDetail.tsx`.

**Feature 2:** `src/pages/Users.tsx`, plus a small `userCategory` helper + its test.
