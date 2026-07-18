# Realtor Placement + Available Units — Design

**Date:** 2026-07-18
**Status:** Approved for planning
**Author:** Belle + Claude

## Goal

Turn the realtor portal into a placement and marketing partner tool:

1. Realtors see **available (vacant) units** to market, including the asking rent.
2. Realtors add a tenant with an **emergency contact** and can **place them into a unit**, which creates a **draft lease** for Belle to finalize.
3. Belle reviews and finalizes every realtor-created draft; nothing counts as final until she does.

## Decisions (locked with Belle)

- Placing a tenant into a unit creates a **draft lease**: rent pre-filled from the unit's listed rent; dates and deposit left blank; flagged "needs review." The realtor never sets rent, deposit, or dates.
- The available-units view **shows the asking rent** to realtors.
- Picking a unit when adding a tenant is **optional**: a realtor may add a tenant now and Belle places them later, or the realtor places them immediately.
- "Available" is derived (no active or paused lease, and unit not in maintenance), never a manual flag, matching how admin already computes occupancy.
- A placed unit **immediately drops off the available list** so two realtors cannot double-book it.

## Non-goals

- Realtors still never see the books, other tenants, payments, or financial history. The only new exposure is the vacant-unit list (with rent) and the ability to create a draft lease on a vacant unit.
- No change to the realtor's existing view scope of their own tenants (contact, emergency contact, documents, address).
- Belle finalizes drafts using the existing admin lease editing; no new lease-editor screen is built.

---

## Data model

Migration `0012_lease_review.sql`:

```sql
-- Draft leases a realtor created by placing a tenant into a unit. Belle
-- finalizes them (sets dates, confirms rent) and the flag clears. 0 = a normal
-- finalized lease; 1 = created by a realtor placement, awaiting review.
ALTER TABLE leases ADD COLUMN needs_review INTEGER DEFAULT 0;
```

`serializeLease` gains `needsReview: !!r.needs_review`. This is for the admin app only; the portal lease serializer (`serializePortalLease`) is a separate allowlist and does NOT include it, so it never reaches a tenant or realtor.

---

## Part 1 — Available units (realtor)

### Availability rule (shared helper)
A unit is available when it has **no lease with status `active` or `paused`** and its own `status` is not `maintenance`. Add a helper in `functions/lib/units.ts` (new):
- `availableUnits(env)` → rows of vacant units joined to their property, ordered by property then unit number.
- `isUnitAvailable(env, unitId)` → boolean, used to guard placement against a double-book.

Availability SQL core:
```sql
SELECT u.*, p.address, p.city, p.state, p.zip_code
  FROM units u
  JOIN properties p ON p.id = u.property_id
 WHERE u.status != 'maintenance'
   AND NOT EXISTS (
     SELECT 1 FROM leases l
      WHERE l.unit_id = u.id AND l.status IN ('active','paused'))
 ORDER BY p.address, u.unit_number
```

### Endpoint
- `GET /api/portal/realtor/available-units` (realtor-role only). Returns `[{ id, unitNumber, bedrooms, bathrooms, squareFeet, monthlyRent, description, address, city, state, zipCode }]`.

### Client + UI
- `portalApi.availableUnits()`.
- New realtor tab **Available** at `/portal/available`, page `src/pages/portal/RealtorAvailableUnits.tsx`: a card per unit showing the address, `Unit N`, beds/baths/size, the monthly rent, and description. Add `{ name: 'Available', path: '/portal/available' }` to `REALTOR_TABS` and the route in `App.tsx`.

---

## Part 2 — Realtor places a tenant (emergency contact + optional unit)

### Shared creation logic
Extend `functions/lib/realtorTenants.ts`:
- `validateTenantContact` gains optional emergency contact: input may include `emergencyName`, `emergencyPhone`, `emergencyRelationship` (all optional, trimmed, length-capped); returns them in `value`.
- `createTenantForRealtor(env, realtorUserId, value, unitId?)`:
  - Inserts the tenant including the emergency contact columns.
  - Inserts the `tenant_realtors` link (as today, always a new tenant).
  - If `unitId` is provided: re-check `isUnitAvailable(env, unitId)`; if not available, throw a typed `UnitUnavailable` error (endpoint returns 409). Otherwise create a **draft lease** and link the tenant:
    - `leases`: `unit_id = unitId`, `property_id = (the unit's property)`, `monthly_rent = (the unit's monthly_rent)`, `status = 'active'`, `needs_review = 1`, `start_date = NULL`, `security_deposit = NULL`.
    - `lease_tenants`: link the new tenant to the new lease.
  - Runs as one `env.DB.batch` so a tenant is never created half-placed.

### Endpoint
- `POST /api/portal/realtor/tenants` (realtor-only) accepts `{ firstName, lastName, email?, phone?, emergencyName?, emergencyPhone?, emergencyRelationship?, unitId? }`, validates, calls `createTenantForRealtor(env, auth.id, value, unitId)`. Returns the created tenant (portal shape). 409 if the chosen unit is no longer available.

### UI
- `src/pages/portal/RealtorTenants.tsx` "New Tenant" form gains: emergency contact fields (name, phone, relationship) and an optional **unit** `<select>` populated from `portalApi.availableUnits()` (label "address, Unit N, rent"). Helper copy notes that choosing a unit creates a placement the office will finalize, and that they never set the rent or dates.
- `portalApi.addRealtorTenant` gains the new fields.

### Isolation
Realtor-only; the unit is validated server-side as available; rent is copied from the unit (never client-supplied); dates/deposit are null. A realtor cannot place into an occupied unit, cannot set money, and still only ever sees their own tenants.

---

## Part 3 — Belle finalizes drafts

- **Admin add-for-realtor endpoint** (`POST /api/realtors/:id/tenants`) keeps working unchanged (person only): the shared helper's new params are optional, so passing none reproduces today's behavior.
- **Surfacing:** `needsReview` rides on the serialized lease. The admin shows a **"Needs review"** badge on a draft lease on the tenant's detail page (the tenancy card) and on the Rents management list.
- **Clearing:** the lease PUT (`functions/api/leases/[id].ts`) sets `needs_review = 0` whenever a lease is updated. So when Belle opens the draft, sets the real dates/rent/deposit, and saves, it becomes a normal finalized lease. (Editing = finalizing.)

---

## Risk to verify

A draft lease is `status='active'` with a **null `start_date`**. The rent math (`leasesOwingMonth` / `settleMonth`) must treat a lease with no start date as owing nothing, so a draft never generates phantom "unpaid" rows, dashboard alarms, or tenant-portal balances before Belle finalizes it. Confirm this during implementation; if the math does not already short-circuit on a missing start date, the draft must be represented so it owes nothing until finalized.

## Testing

- **Unit (automated):** the extended `validateTenantContact` (emergency fields trimmed/capped; still requires first and last name). Reuse the existing `realtorTenants.test.ts` style.
- **Manual / DB-level verification (no Pages+D1 harness):**
  - `availableUnits` returns only units with no active/paused lease and not in maintenance; a unit with an active lease is absent.
  - A realtor placing a tenant into a unit creates the tenant, the realtor link, and a draft lease (`needs_review=1`, rent = unit rent, null dates), and that unit disappears from `availableUnits`.
  - Placing into a now-occupied unit returns 409.
  - Adding a realtor tenant with NO unit still works (person + emergency contact only, no lease).
  - Editing the draft lease in admin clears `needs_review`.
  - A realtor still cannot reach any other tenant or any financial data.

## Files touched

**Data:** `migrations/0012_lease_review.sql`, `functions/lib/serializers.ts` (serializeLease `needsReview`).

**Part 1:** `functions/lib/units.ts` (new, `availableUnits` + `isUnitAvailable`), `functions/api/portal/realtor/available-units.ts` (new), `src/lib/api.ts` (`portalApi.availableUnits`, `AvailableUnit` type), `src/pages/portal/RealtorAvailableUnits.tsx` (new), `src/components/PortalLayout/index.tsx` (Available tab), `src/App.tsx` (route).

**Part 2:** `functions/lib/realtorTenants.ts` (emergency + unit + draft lease), `functions/api/portal/realtor/tenants/index.ts` (POST accepts new fields), `src/pages/portal/RealtorTenants.tsx` (form fields + unit picker), `src/lib/api.ts` (`addRealtorTenant` fields).

**Part 3:** `functions/api/leases/[id].ts` (clear `needs_review` on update), admin badge in `src/pages/TenantDetail.tsx` and `src/pages/Rents.tsx`.
