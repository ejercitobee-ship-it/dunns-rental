# Realtor Placement + Available Units Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let realtors see available units and place a tenant (with emergency contact) into one, creating a draft lease Belle finalizes.

**Architecture:** A `needs_review` flag on leases marks realtor-created drafts. A draft lease is `status='active'` with a null start date; the rent-coverage primitive `leaseCoversMonth` treats a needs-review lease as covering no month, so a draft owes nothing anywhere until Belle edits the lease (which clears the flag). Realtors get a new available-units view and an extended add-tenant flow; placement is validated server side against a shared availability helper.

**Tech Stack:** Cloudflare Pages Functions + D1 (SQLite), React 19 + TypeScript + Vite + Tailwind, Vitest. Migrations applied with `npx wrangler d1 migrations apply dunns-rental-db --local` (prod `--remote` at the end).

## Global Constraints

- **No dashes** (em, en, or hyphen-as-a-break) in any user-visible copy. Commas, periods, colons instead. Belle's standing rule.
- Realtors never see the books, other tenants, payments, or financial history. The only new exposure is the vacant-unit list (with rent) and creating a draft lease on a vacant unit.
- A realtor **never sets rent, deposit, or lease dates.** On placement, rent is copied server side from the unit; dates and deposit are null. Rent is never taken from the request body.
- Placing a tenant into a unit is **optional** (a realtor may add a tenant with no unit).
- A draft lease (`needs_review = 1`) **owes no rent anywhere** until Belle finalizes it. This is money-critical: verify it.
- "Available" = a unit with no `active` or `paused` lease and unit `status != 'maintenance'`. Derived, never a manual flag.
- Next migration number is **0012** (0008 skipped historically).
- Automated tests cover pure logic (rent coverage, validator); endpoints/UI verified by hand / at the DB level.

---

## File Structure

- `migrations/0012_lease_review.sql` — `needs_review` column on leases.
- `functions/lib/serializers.ts` — `serializeLease` gains `needsReview`.
- `src/types/index.ts` — `Lease` gains `needsReview?`; add `AvailableUnit`.
- `src/lib/rent.ts` — `leaseCoversMonth` excludes needs-review leases.
- `functions/lib/units.ts` (new) — `availableUnits`, `isUnitAvailable`.
- `functions/api/portal/realtor/available-units.ts` (new) — realtor GET.
- `functions/lib/realtorTenants.ts` — emergency contact + draft-lease placement.
- `functions/api/portal/realtor/tenants/index.ts` — POST accepts new fields.
- `functions/api/portal/me.ts`, `functions/api/portal/payments.ts` — exclude draft leases.
- `functions/api/leases/[id].ts` — clear `needs_review` on update.
- `src/lib/api.ts` — `portalApi.availableUnits`, extended `addRealtorTenant`.
- `src/pages/portal/RealtorAvailableUnits.tsx` (new), `src/pages/portal/RealtorTenants.tsx`, `src/components/PortalLayout/index.tsx`, `src/App.tsx` — realtor UI.
- `src/pages/TenantDetail.tsx`, `src/pages/Rents.tsx` — "Needs review" badge.

---

## Task 1: needs_review column, serializer, and type

**Files:**
- Create: `migrations/0012_lease_review.sql`
- Modify: `functions/lib/serializers.ts` (`serializeLease`)
- Modify: `src/types/index.ts` (`Lease` interface)

**Interfaces:**
- Produces: `leases.needs_review` column; `serializeLease(...).needsReview: boolean`; `Lease.needsReview?: boolean`.

- [ ] **Step 1: Write the migration**

`migrations/0012_lease_review.sql`:

```sql
-- Draft leases a realtor created by placing a tenant into a unit. Belle
-- finalizes them (sets dates, confirms rent) and the flag clears. 0 = a normal
-- finalized lease; 1 = a realtor placement awaiting review.
ALTER TABLE leases ADD COLUMN needs_review INTEGER DEFAULT 0;
```

- [ ] **Step 2: Apply locally**

Run: `npx wrangler d1 migrations apply dunns-rental-db --local`
Expected: reports `0012_lease_review.sql` applied, no error.

- [ ] **Step 3: Add needsReview to serializeLease**

In `functions/lib/serializers.ts`, inside `serializeLease`'s returned object, add after the `status` line:

```ts
    needsReview: !!r.needs_review,
```

(Leave `serializePortalLease` untouched: it is a separate allowlist and must NOT expose this to the portal.)

- [ ] **Step 4: Add needsReview to the Lease type**

In `src/types/index.ts`, add to the `Lease` interface (near `status`):

```ts
  needsReview?: boolean;
```

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add migrations/0012_lease_review.sql functions/lib/serializers.ts src/types/index.ts
git commit -m "Leases: needs_review flag, serializer, type"
```

---

## Task 2: A draft lease owes no rent (rent math)

**Files:**
- Modify: `src/lib/rent.ts` (`leaseCoversMonth`)
- Modify: `src/lib/rent.test.ts` (add a test)

**Interfaces:**
- Consumes: `Lease.needsReview` (Task 1).
- Produces: `leaseCoversMonth` and everything built on it (`leasesOwingMonth`, `settleMonth`) treat a `needsReview` lease as owing nothing.

- [ ] **Step 1: Write the failing test**

In `src/lib/rent.test.ts`, add (adapt the object to the test file's existing lease factory if one exists; otherwise use a literal):

```ts
import { leaseCoversMonth, leasesOwingMonth } from './rent';

describe('draft (needs review) leases owe nothing', () => {
  const draft = {
    id: 'd1', unitId: 'u1', propertyId: 'p1',
    startDate: undefined, endDate: undefined,
    monthlyRent: 900, securityDeposit: 0, status: 'active' as const,
    notes: undefined, tenantIds: [], pauses: [], needsReview: true,
  };

  it('a needs-review lease covers no month', () => {
    expect(leaseCoversMonth(draft, 7, 2026)).toBe(false);
  });

  it('a needs-review lease is never owed', () => {
    expect(leasesOwingMonth([draft], 7, 2026)).toEqual([]);
  });

  it('once finalized (needsReview false) it covers again', () => {
    expect(leaseCoversMonth({ ...draft, needsReview: false, startDate: '2026-01-01' }, 7, 2026)).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/rent.test.ts`
Expected: FAIL (the first two assertions fail; today a null-start lease covers every month).

- [ ] **Step 3: Implement**

In `src/lib/rent.ts`, at the TOP of `leaseCoversMonth`, before the existing checks:

```ts
export function leaseCoversMonth(lease: Lease, month: number, year: number): boolean {
  // A draft lease a realtor created (awaiting Belle's review) owes no rent
  // anywhere until she finalizes it. Excluding it here — the coverage
  // primitive — keeps it out of leasesOwingMonth AND settleMonth at once, so a
  // draft (which has a null start date) never bills every month by mistake.
  if (lease.needsReview) return false;
  const target = year * 12 + month;
  if (lease.startDate && target < yearMonthOf(lease.startDate)) return false;
  if (lease.endDate && target > yearMonthOf(lease.endDate)) return false;
  return true;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/rent.test.ts`
Expected: PASS (all, including the pre-existing tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/rent.ts src/lib/rent.test.ts
git commit -m "Rent: a needs-review draft lease owes nothing until finalized"
```

---

## Task 3: Available-units helper and endpoint

**Files:**
- Create: `functions/lib/units.ts`
- Create: `functions/api/portal/realtor/available-units.ts`
- Modify: `src/lib/api.ts` (`AvailableUnit` type note is in Task 4; here add the client method)

**Interfaces:**
- Consumes: `requireUser`, `jsonOk`, `jsonError`, `serverError`, `Env` from `functions/lib/session`.
- Produces: `availableUnits(env) -> Promise<Row[]>`; `isUnitAvailable(env, unitId) -> Promise<boolean>`; `GET /api/portal/realtor/available-units`; `portalApi.availableUnits()`.

- [ ] **Step 1: Write the units helper**

`functions/lib/units.ts`:

```ts
import type { Env } from './session';

const AVAILABLE_WHERE =
  `u.status != 'maintenance'
     AND NOT EXISTS (SELECT 1 FROM leases l WHERE l.unit_id = u.id AND l.status IN ('active','paused'))`;

/** Vacant units (no active/paused lease, not in maintenance) with their property. */
export async function availableUnits(env: Env) {
  const { results } = await env.DB.prepare(
    `SELECT u.id, u.unit_number, u.bedrooms, u.bathrooms, u.square_feet,
            u.monthly_rent, u.description,
            p.address, p.city, p.state, p.zip_code
       FROM units u
       JOIN properties p ON p.id = u.property_id
      WHERE ${AVAILABLE_WHERE}
      ORDER BY p.address, u.unit_number`
  ).all();
  return results || [];
}

/** Whether a single unit is currently available to place a tenant into. */
export async function isUnitAvailable(env: Env, unitId: string): Promise<boolean> {
  const row = await env.DB.prepare(
    `SELECT 1 AS ok FROM units u WHERE u.id = ? AND ${AVAILABLE_WHERE}`
  ).bind(unitId).first<{ ok: number }>();
  return !!row;
}
```

- [ ] **Step 2: Write the endpoint**

`functions/api/portal/realtor/available-units.ts`:

```ts
import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser, jsonOk, jsonError, serverError } from '../../../lib/session';
import { availableUnits } from '../../../lib/units';

// GET /api/portal/realtor/available-units — vacant units a realtor may market.
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;
  if (auth.role !== 'realtor') return jsonError('Not a realtor account', 403);

  try {
    const rows = await availableUnits(env);
    return jsonOk({
      success: true,
      data: rows.map(r => {
        const u = r as Record<string, unknown>;
        return {
          id: u.id,
          unitNumber: u.unit_number,
          bedrooms: u.bedrooms,
          bathrooms: u.bathrooms,
          squareFeet: u.square_feet,
          monthlyRent: u.monthly_rent,
          description: u.description ?? undefined,
          address: u.address ?? undefined,
          city: u.city ?? undefined,
          state: u.state ?? undefined,
          zipCode: u.zip_code ?? undefined,
        };
      }),
    });
  } catch {
    return serverError();
  }
};
```

- [ ] **Step 3: Add the client method and type**

In `src/lib/api.ts`, add near the portal types:

```ts
export interface AvailableUnit {
  id: string;
  unitNumber: string;
  bedrooms?: number;
  bathrooms?: number;
  squareFeet?: number;
  monthlyRent: number;
  description?: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
}
```

Inside `portalApi`, add:

```ts
  availableUnits: (): Promise<AvailableUnit[]> => apiRequest('/portal/realtor/available-units'),
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Verify the query at the DB level (controller)**

The controller seeds a vacant unit and a unit with an active lease, and confirms `availableUnits` returns only the vacant one. No HTTP auth needed.

- [ ] **Step 6: Commit**

```bash
git add functions/lib/units.ts functions/api/portal/realtor/available-units.ts src/lib/api.ts
git commit -m "Realtor: available-units helper, endpoint, client"
```

---

## Task 4: Realtor Available Units page and tab

**Files:**
- Create: `src/pages/portal/RealtorAvailableUnits.tsx`
- Modify: `src/components/PortalLayout/index.tsx` (REALTOR_TABS)
- Modify: `src/App.tsx` (route + import)

**Interfaces:**
- Consumes: `portalApi.availableUnits`, `AvailableUnit` (Task 3); `Card`, `CardContent`; `formatCurrency` from `../../lib/utils`.

- [ ] **Step 1: Write the page**

`src/pages/portal/RealtorAvailableUnits.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Card, CardContent } from '../../components/ui/Card';
import { portalApi, type AvailableUnit } from '../../lib/api';
import { formatCurrency } from '../../lib/utils';

export function RealtorAvailableUnits() {
  const [units, setUnits] = useState<AvailableUnit[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    portalApi.availableUnits()
      .then((u) => { if (!cancelled) setUnits(u); })
      .catch(() => { if (!cancelled) setUnits([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) return <p className="text-sm text-muted">Loading available units.</p>;

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Marketing</p>
        <h1 className="font-display text-2xl text-ink mt-1">Available units</h1>
        <p className="text-sm text-muted mt-1">Vacant units you can market. Place a tenant from the New Tenant form.</p>
      </div>

      {units.length === 0 ? (
        <Card><CardContent className="p-6"><p className="text-sm text-muted">No units are available right now.</p></CardContent></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {units.map((u) => {
            const addr = [u.address, u.city, [u.state, u.zipCode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
            const specs = [
              u.bedrooms != null ? `${u.bedrooms} bed` : null,
              u.bathrooms != null ? `${u.bathrooms} bath` : null,
              u.squareFeet ? `${u.squareFeet} sq ft` : null,
            ].filter(Boolean).join(' · ');
            return (
              <Card key={u.id}>
                <CardContent className="p-5 space-y-2">
                  <p className="font-display text-lg font-medium text-ink">Unit {u.unitNumber}</p>
                  {addr && <p className="text-sm text-muted">{addr}</p>}
                  {specs && <p className="text-sm text-muted">{specs}</p>}
                  <p className="font-display text-xl text-ink tnum">{formatCurrency(u.monthlyRent)} <span className="text-sm text-muted">per month</span></p>
                  {u.description && <p className="text-sm text-muted">{u.description}</p>}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add the tab**

In `src/components/PortalLayout/index.tsx`, change `REALTOR_TABS` to:

```ts
const REALTOR_TABS = [
  { name: 'Dashboard', path: '/portal' },
  { name: 'My tenants', path: '/portal/tenants' },
  { name: 'Available', path: '/portal/available' },
];
```

- [ ] **Step 3: Add the route**

In `src/App.tsx`, import the page with the other portal imports:

```tsx
import { RealtorAvailableUnits } from './pages/portal/RealtorAvailableUnits';
```

Add a route next to the other `/portal/*` routes:

```tsx
      <Route path="/portal/available" element={
        <PortalRoute>
          <PortalLayout><RealtorAvailableUnits /></PortalLayout>
        </PortalRoute>
      } />
```

- [ ] **Step 4: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: typecheck clean, build succeeds (ignore the pre-existing >500 kB chunk warning).

- [ ] **Step 5: Commit**

```bash
git add src/pages/portal/RealtorAvailableUnits.tsx src/components/PortalLayout/index.tsx src/App.tsx
git commit -m "Realtor: Available units page and tab"
```

---

## Task 5: Placement in the realtor-tenants helper

**Files:**
- Modify: `functions/lib/realtorTenants.ts`
- Modify: `functions/lib/realtorTenants.test.ts`

**Interfaces:**
- Consumes: `isUnitAvailable` (Task 3).
- Produces: extended `TenantContactInput` (with emergency fields); `validateTenantContact` keeps them; `class UnitUnavailable extends Error`; `createTenantForRealtor(env, realtorUserId, value, unitId?)` creating a draft lease when `unitId` is given.

- [ ] **Step 1: Write the failing validator test**

In `functions/lib/realtorTenants.test.ts`, add:

```ts
it('keeps trimmed emergency contact fields when present', () => {
  const r = validateTenantContact({
    firstName: 'Jane', lastName: 'Doe',
    emergencyName: '  Bob  ', emergencyPhone: ' 555 ', emergencyRelationship: ' Spouse ',
  });
  expect(r).toEqual({
    ok: true,
    value: { firstName: 'Jane', lastName: 'Doe', email: null, phone: null,
      emergencyName: 'Bob', emergencyPhone: '555', emergencyRelationship: 'Spouse' },
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run functions/lib/realtorTenants.test.ts`
Expected: FAIL (value has no emergency fields yet).

- [ ] **Step 3: Extend the validator and helper**

Replace the contents of `functions/lib/realtorTenants.ts` with:

```ts
import type { Env } from './session';
import { isUnitAvailable } from './units';

/** Longest allowed value for any tenant contact field. */
export const MAX_CONTACT_FIELD = 120;

/** Thrown when a realtor tries to place a tenant into a unit that is no longer available. */
export class UnitUnavailable extends Error {
  constructor() {
    super('That unit is no longer available');
    this.name = 'UnitUnavailable';
  }
}

export interface TenantContactInput {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  emergencyName: string | null;
  emergencyPhone: string | null;
  emergencyRelationship: string | null;
}
export type ContactValidation =
  | { ok: true; value: TenantContactInput }
  | { ok: false; error: string };

/** Validate and normalise a new tenant's name, contact, and emergency contact. Pure. */
export function validateTenantContact(body: {
  firstName?: unknown;
  lastName?: unknown;
  email?: unknown;
  phone?: unknown;
  emergencyName?: unknown;
  emergencyPhone?: unknown;
  emergencyRelationship?: unknown;
}): ContactValidation {
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  const firstName = str(body.firstName);
  const lastName = str(body.lastName);
  if (!firstName || !lastName) return { ok: false, error: 'First and last name are required' };

  const email = str(body.email);
  const phone = str(body.phone);
  const emergencyName = str(body.emergencyName);
  const emergencyPhone = str(body.emergencyPhone);
  const emergencyRelationship = str(body.emergencyRelationship);
  for (const v of [firstName, lastName, email, phone, emergencyName, emergencyPhone, emergencyRelationship]) {
    if (v.length > MAX_CONTACT_FIELD) return { ok: false, error: 'A field is too long' };
  }
  return {
    ok: true,
    value: {
      firstName, lastName,
      email: email || null,
      phone: phone || null,
      emergencyName: emergencyName || null,
      emergencyPhone: emergencyPhone || null,
      emergencyRelationship: emergencyRelationship || null,
    },
  };
}

/**
 * Create a new person-only tenant and link it to a realtor in one batch. Always
 * inserts a NEW tenant (never attaches to an existing one). When `unitId` is
 * given, also create a DRAFT lease on that unit: rent copied from the unit,
 * dates and deposit blank, needs_review = 1 for Belle to finalize. The unit is
 * re-checked as available first; if it is not, throws UnitUnavailable. Returns
 * the new tenants row.
 */
export async function createTenantForRealtor(
  env: Env,
  realtorUserId: string,
  value: TenantContactInput,
  unitId?: string
): Promise<Record<string, unknown>> {
  const tenantId = crypto.randomUUID();

  const statements = [
    env.DB.prepare(
      `INSERT INTO tenants (id, first_name, last_name, email, phone,
         emergency_contact_name, emergency_contact_phone, emergency_contact_relationship)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      tenantId, value.firstName, value.lastName, value.email, value.phone,
      value.emergencyName, value.emergencyPhone, value.emergencyRelationship
    ),
    env.DB.prepare(
      'INSERT OR IGNORE INTO tenant_realtors (id, tenant_id, realtor_user_id) VALUES (?, ?, ?)'
    ).bind(crypto.randomUUID(), tenantId, realtorUserId),
  ];

  if (unitId) {
    if (!(await isUnitAvailable(env, unitId))) throw new UnitUnavailable();
    // Copy the unit's rent and property server side; the realtor never sets money.
    const unit = await env.DB.prepare('SELECT property_id, monthly_rent FROM units WHERE id = ?')
      .bind(unitId).first<{ property_id: string | null; monthly_rent: number | null }>();
    const leaseId = crypto.randomUUID();
    statements.push(
      env.DB.prepare(
        `INSERT INTO leases (id, unit_id, property_id, monthly_rent, security_deposit,
           status, start_date, needs_review)
         VALUES (?, ?, ?, ?, NULL, 'active', NULL, 1)`
      ).bind(leaseId, unitId, unit?.property_id ?? null, unit?.monthly_rent ?? 0),
      env.DB.prepare(
        'INSERT OR IGNORE INTO lease_tenants (id, lease_id, tenant_id) VALUES (?, ?, ?)'
      ).bind(crypto.randomUUID(), leaseId, tenantId)
    );
  }

  await env.DB.batch(statements);
  const row = await env.DB.prepare('SELECT * FROM tenants WHERE id = ?').bind(tenantId).first();
  return row as Record<string, unknown>;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run functions/lib/realtorTenants.test.ts`
Expected: PASS (existing tests still pass; the new emergency-contact test passes).

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add functions/lib/realtorTenants.ts functions/lib/realtorTenants.test.ts
git commit -m "Realtor tenants: emergency contact and draft-lease placement"
```

---

## Task 6: Realtor add-tenant endpoint and form

**Files:**
- Modify: `functions/api/portal/realtor/tenants/index.ts` (POST)
- Modify: `src/lib/api.ts` (`addRealtorTenant`)
- Modify: `src/pages/portal/RealtorTenants.tsx` (form)

**Interfaces:**
- Consumes: `validateTenantContact`, `createTenantForRealtor`, `UnitUnavailable` (Task 5); `portalApi.availableUnits` (Task 3).

- [ ] **Step 1: Update the POST handler**

In `functions/api/portal/realtor/tenants/index.ts`, change the import to include `UnitUnavailable`:

```ts
import { validateTenantContact, createTenantForRealtor, UnitUnavailable } from '../../../../lib/realtorTenants';
```

Replace the body of `onRequestPost`'s `try` block with:

```ts
    const body = (await request.json()) as Record<string, unknown>;
    const valid = validateTenantContact(body);
    if (!valid.ok) return jsonError(valid.error, 400);
    const unitId = typeof body.unitId === 'string' && body.unitId ? body.unitId : undefined;
    try {
      const row = await createTenantForRealtor(env, auth.id, valid.value, unitId);
      return jsonOk({ success: true, data: serializePortalTenant(row) }, 201);
    } catch (err) {
      if (err instanceof UnitUnavailable) return jsonError('That unit is no longer available', 409);
      throw err;
    }
```

- [ ] **Step 2: Extend the client method**

In `src/lib/api.ts`, replace `addRealtorTenant` with:

```ts
  addRealtorTenant: (data: {
    firstName: string; lastName: string; email?: string; phone?: string;
    emergencyName?: string; emergencyPhone?: string; emergencyRelationship?: string;
    unitId?: string;
  }): Promise<PortalPerson> =>
    apiRequest('/portal/realtor/tenants', { method: 'POST', body: JSON.stringify(data) }),
```

- [ ] **Step 3: Extend the New Tenant form**

In `src/pages/portal/RealtorTenants.tsx`:
- Extend the `form` state with `emergencyName`, `emergencyPhone`, `emergencyRelationship`, and `unitId` (all strings, default `''`).
- On the form open, load available units: `portalApi.availableUnits().then(setUnits)` into a `units` state (`AvailableUnit[]`), imported from `../../lib/api`.
- Add three emergency-contact inputs (Emergency contact name, phone, relationship) and a unit `<select>` (options: a blank "No unit yet" plus each available unit labelled `${u.address ? u.address + ', ' : ''}Unit ${u.unitNumber} (${formatCurrency(u.monthlyRent)})`, value `u.id`). Import `formatCurrency` from `../../lib/utils`.
- Pass all fields to `portalApi.addRealtorTenant`, sending `unitId: form.unitId || undefined`.
- Helper copy under the form: "Choosing a unit places this tenant there as a draft. The office sets the rent and dates." (no dashes).
- After a successful add, refresh both the tenants list and the available units (a placed unit is no longer available), and reset the form.

- [ ] **Step 4: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: typecheck clean, build succeeds.

- [ ] **Step 5: Commit**

```bash
git add functions/api/portal/realtor/tenants/index.ts src/lib/api.ts src/pages/portal/RealtorTenants.tsx
git commit -m "Realtor: add-tenant endpoint and form with emergency contact and unit placement"
```

---

## Task 7: Keep draft leases out of the tenant portal

**Files:**
- Modify: `functions/api/portal/me.ts`
- Modify: `functions/api/portal/payments.ts`

**Interfaces:**
- Consumes: `leases.needs_review` (Task 1).
- Produces: the tenant portal never resolves a draft lease as the caller's current lease.

- [ ] **Step 1: Exclude drafts in portal/me**

In `functions/api/portal/me.ts`, in the current-lease query, change the `WHERE` so a draft is skipped. The clause `AND l.status != 'ended'` becomes:

```sql
        WHERE lt.tenant_id = ? AND l.status != 'ended' AND (l.needs_review IS NULL OR l.needs_review = 0)
```

- [ ] **Step 2: Exclude drafts in portal/payments**

In `functions/api/portal/payments.ts`, make the same change to its current-lease query's `WHERE` clause (`AND (l.needs_review IS NULL OR l.needs_review = 0)`).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add functions/api/portal/me.ts functions/api/portal/payments.ts
git commit -m "Portal: a tenant never sees an unfinalized draft lease"
```

---

## Task 8: Admin finalize — badge and clear on save

**Files:**
- Modify: `functions/api/leases/[id].ts` (clear `needs_review` on update)
- Modify: `src/pages/TenantDetail.tsx` (badge)
- Modify: `src/pages/Rents.tsx` (badge)

**Interfaces:**
- Consumes: `Lease.needsReview` (Task 1).
- Produces: editing a lease clears its draft flag; the admin shows a "Needs review" badge on a draft lease.

- [ ] **Step 1: Clear needs_review on lease update**

In `functions/api/leases/[id].ts`, in the `UPDATE leases SET ...` statement, add `needs_review = 0,` to the SET list (e.g. right after `status = ?,`). No new bind parameter is needed (it is a literal). So the SET becomes:

```sql
          unit_id = ?, property_id = ?, start_date = ?, end_date = ?, monthly_rent = ?,
          security_deposit = ?, status = ?, needs_review = 0, notes = ?, updated_at = unixepoch()
```

- [ ] **Step 2: Badge on the tenant detail tenancy**

In `src/pages/TenantDetail.tsx`, where the tenant's lease/tenancy is shown (the `lease` from `getTenantLeases`), render a small badge when `lease.needsReview`:

```tsx
{lease?.needsReview && (
  <Badge variant="warning">Needs review</Badge>
)}
```

Place it in the tenancy card header near the lease status. `Badge` is already imported in this file.

- [ ] **Step 3: Badge on the Rents page**

In `src/pages/Rents.tsx`, where each lease/tenancy row is rendered, add the same `{lease.needsReview && <Badge variant="warning">Needs review</Badge>}` next to the status. Import `Badge` from `../components/ui/Badge` if not already imported.

- [ ] **Step 4: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: typecheck clean, build succeeds.

- [ ] **Step 5: Verify at the DB level (controller)**

The controller seeds a draft lease (`needs_review=1`), runs the leases PUT statement, and confirms `needs_review` is 0 afterward.

- [ ] **Step 6: Commit**

```bash
git add functions/api/leases/[id].ts src/pages/TenantDetail.tsx src/pages/Rents.tsx
git commit -m "Admin: needs-review badge and clear the flag when a lease is saved"
```

---

## Self-Review

**Spec coverage:**
- Available units (rule, endpoint, page, tab, rent shown) → Tasks 3 + 4.
- Emergency contact + optional unit placement → Tasks 5 + 6.
- Draft lease (rent from unit, blank dates/deposit, needs_review) → Task 5.
- Draft owes nothing (the flagged risk) → Task 2 (rent math) + Task 7 (portal). 
- Belle finalizes: badge + clear on save → Task 8.
- needs_review column/type/serializer → Task 1.
- Realtor never sets rent/dates; unit validated available; always-new tenant → Task 5.

**Placeholder scan:** backend and rent-math steps carry full code (current code was read to write exact edits). The two UI form tasks (6 form, 8 badges) describe concrete deltas against existing components with exact copy, state fields, and the label format, rather than pasting whole large files.

**Type consistency:** `needsReview` is the name in `serializeLease`, `Lease`, `leaseCoversMonth`, and the badges. `TenantContactInput` gains the emergency fields in Task 5 and is produced by `validateTenantContact` and consumed by `createTenantForRealtor`; the endpoint (Task 6) passes the validated value plus `unitId`. `AvailableUnit` is defined in Task 3 and consumed in Tasks 4 and 6. `UnitUnavailable` is thrown in Task 5 and caught in Task 6.

**Production migration:** after all tasks pass and merge, apply `0012_lease_review.sql` to prod with `npx wrangler d1 migrations apply dunns-rental-db --remote` before the feature is used live.
