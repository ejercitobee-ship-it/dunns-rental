# Lease and Household Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move rent from the person to the unit's lease so multiple people can live in a unit without double counting income, and give each person a stable identity.

**Architecture:** A new `leases` table owns rent, dates and status for a tenancy on one unit. `tenants` becomes people only. A `lease_tenants` join links many people to a lease and lets a person appear on many leases over time. `rent_payments` hangs off `lease_id` and records `paid_by_tenant_id`. All money math moves into one pure, unit-tested module (`src/lib/rent.ts`) that every page reads from, so the Dashboard, Rents, Reports and Tax Report cannot disagree.

**Tech Stack:** Cloudflare Pages Functions, D1 (SQLite), React 19 + TypeScript + Vite, Tailwind v4, Vitest (added in Task 1).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-15-lease-household-model-design.md`. It wins over this plan on any conflict.
- Production has **0 tenants, 0 rent_payments, 0 documents** (1 property, 6 units). No data migration. Migration 0007 is destructive by design and must never run against a database that has tenant rows.
- Live site is `https://dunns-rental.pages.dev`, production branch `main`. Work on branch `lease-household-model`. Do not push to `main` until Task 13.
- Every backend endpoint keeps the existing auth pattern: `requirePermission(env, request, '<perm>')` then `if (auth instanceof Response) return auth;`. Never add an unauthenticated endpoint.
- Rows are snake_case in D1, camelCase over the API. Convert only in `functions/lib/serializers.ts`.
- Lease status values: `active` | `paused` | `ended`. Only `active` counts toward revenue.
- Money comparisons tolerate float drift (use the helpers in `src/lib/rent.ts`, never `===` on sums).
- Design system: use existing tokens (`bg-canvas`, `text-ink`, `text-muted`, `text-faint`, `border-line`, `bg-primary`, `text-primary`, `bg-primary-soft`, `text-positive`, `text-danger`, `text-warning`, `.eyebrow`, `.font-display`, `.tnum`). No raw slate/blue/gray classes.
- Build must pass after every task: `npm run build` (runs `tsc -b && tsc -p functions/tsconfig.json && vite build`).

---

### Task 1: Money math module with tests

The one place rent is calculated. Everything else reads from here.

**Files:**
- Modify: `package.json` (add vitest + test script)
- Create: `vitest.config.ts`
- Create: `src/lib/rent.ts`
- Test: `src/lib/rent.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `activeLeases(leases: Lease[]): Lease[]`
  - `monthlyRevenue(leases: Lease[]): number`
  - `settleMonth(lease: Lease, payments: RentPayment[], month: number, year: number): MonthSettlement`
  - `type MonthSettlement = { due: number; paid: number; balance: number; status: 'paid' | 'partial' | 'unpaid' }`
  - Types `Lease` and `RentPayment` are created in Task 6. For this task, define the minimal structural types inline in `src/lib/rent.ts` as shown, then Task 6 replaces them with imports.

- [ ] **Step 1: Install Vitest**

```bash
npm install -D vitest@^3
```

- [ ] **Step 2: Add the test script**

In `package.json`, add to `"scripts"` (keep the existing entries):

```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 3: Create the Vitest config**

Create `vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
```

- [ ] **Step 4: Write the failing tests**

Create `src/lib/rent.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { activeLeases, monthlyRevenue, settleMonth } from './rent';
import type { Lease, RentPayment } from './rent';

const lease = (over: Partial<Lease> = {}): Lease => ({
  id: 'L1',
  unitId: 'U1',
  propertyId: 'P1',
  startDate: '2026-01-01',
  endDate: '2027-01-01',
  monthlyRent: 1325,
  securityDeposit: 0,
  status: 'active',
  tenantIds: [],
  ...over,
});

const payment = (over: Partial<RentPayment> = {}): RentPayment => ({
  id: 'PMT1',
  leaseId: 'L1',
  amount: 1325,
  month: 7,
  year: 2026,
  status: 'paid',
  ...over,
});

describe('monthlyRevenue', () => {
  it('counts a lease once no matter how many people live there', () => {
    // The double-counting bug: two occupants must not mean two rents.
    expect(monthlyRevenue([lease()])).toBe(1325);
  });

  it('adds up multiple active leases', () => {
    expect(monthlyRevenue([lease(), lease({ id: 'L2', monthlyRent: 1300 })])).toBe(2625);
  });

  it('ignores ended and paused leases', () => {
    const leases = [
      lease(),
      lease({ id: 'L2', status: 'ended', monthlyRent: 999 }),
      lease({ id: 'L3', status: 'paused', monthlyRent: 888 }),
    ];
    expect(monthlyRevenue(leases)).toBe(1325);
  });

  it('returns 0 with no leases', () => {
    expect(monthlyRevenue([])).toBe(0);
  });
});

describe('activeLeases', () => {
  it('returns only active leases', () => {
    const result = activeLeases([lease(), lease({ id: 'L2', status: 'ended' })]);
    expect(result.map(l => l.id)).toEqual(['L1']);
  });
});

describe('settleMonth', () => {
  it('settles when one person pays in full', () => {
    const s = settleMonth(lease(), [payment()], 7, 2026);
    expect(s).toEqual({ due: 1325, paid: 1325, balance: 0, status: 'paid' });
  });

  it('settles when roommates split the month and it adds up', () => {
    const payments = [
      payment({ id: 'A', amount: 700, paidByTenantId: 'T1' }),
      payment({ id: 'B', amount: 625, paidByTenantId: 'T2' }),
    ];
    const s = settleMonth(lease(), payments, 7, 2026);
    expect(s.paid).toBe(1325);
    expect(s.status).toBe('paid');
    expect(s.balance).toBe(0);
  });

  it('reports partial with the remaining balance when short', () => {
    const s = settleMonth(lease(), [payment({ amount: 700 })], 7, 2026);
    expect(s).toEqual({ due: 1325, paid: 700, balance: 625, status: 'partial' });
  });

  it('reports unpaid when nothing was paid', () => {
    const s = settleMonth(lease(), [], 7, 2026);
    expect(s).toEqual({ due: 1325, paid: 0, balance: 1325, status: 'unpaid' });
  });

  it('ignores payments from other months, years and leases', () => {
    const payments = [
      payment({ id: 'A', month: 6 }),
      payment({ id: 'B', year: 2025 }),
      payment({ id: 'C', leaseId: 'OTHER' }),
    ];
    expect(settleMonth(lease(), payments, 7, 2026).paid).toBe(0);
  });

  it('does not fail on floating point drift', () => {
    const payments = [
      payment({ id: 'A', amount: 441.66 }),
      payment({ id: 'B', amount: 441.67 }),
      payment({ id: 'C', amount: 441.67 }),
    ];
    const s = settleMonth(lease({ monthlyRent: 1325 }), payments, 7, 2026);
    expect(s.status).toBe('paid');
    expect(s.balance).toBe(0);
  });

  it('treats overpayment as paid with no negative balance', () => {
    const s = settleMonth(lease(), [payment({ amount: 1400 })], 7, 2026);
    expect(s.status).toBe('paid');
    expect(s.balance).toBe(0);
  });
});
```

- [ ] **Step 5: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL, cannot resolve `./rent`.

- [ ] **Step 6: Write the implementation**

Create `src/lib/rent.ts`:

```ts
// The single source of truth for rent math. Every page reads from here so the
// Dashboard, Rents, Reports and Tax Report cannot disagree with each other.
//
// Task 6 moves Lease and RentPayment into src/types and this file imports them
// instead of declaring them.

export type LeaseStatus = 'active' | 'paused' | 'ended';

export interface Lease {
  id: string;
  unitId: string;
  propertyId?: string;
  startDate?: string;
  endDate?: string;
  monthlyRent: number;
  securityDeposit?: number;
  status: LeaseStatus;
  notes?: string;
  /** Ids of the people on this lease. Must match the shared type in Task 6. */
  tenantIds: string[];
}

export interface RentPayment {
  id: string;
  leaseId: string;
  paidByTenantId?: string;
  amount: number;
  month: number;
  year: number;
  status?: string;
  dueDate?: string;
  paidDate?: string;
  receivedDate?: string;
  paymentMethod?: string;
  notes?: string;
}

export interface MonthSettlement {
  due: number;
  paid: number;
  balance: number;
  status: 'paid' | 'partial' | 'unpaid';
}

/** Money is compared to the cent; anything closer than half a cent is equal. */
const EPSILON = 0.005;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function activeLeases(leases: Lease[]): Lease[] {
  return leases.filter(l => l.status === 'active');
}

/**
 * Total rent per month across active leases. Counted once per lease, which is
 * what stops income doubling when more than one person lives in a unit.
 */
export function monthlyRevenue(leases: Lease[]): number {
  return round2(activeLeases(leases).reduce((sum, l) => sum + (l.monthlyRent || 0), 0));
}

/** Payments recorded against one lease for one month. */
export function paymentsForMonth(
  leaseId: string,
  payments: RentPayment[],
  month: number,
  year: number
): RentPayment[] {
  return payments.filter(p => p.leaseId === leaseId && p.month === month && p.year === year);
}

/**
 * What is owed, what came in, and whether the month is settled. Several
 * payments may add up to one month's rent (roommates splitting it).
 */
export function settleMonth(
  lease: Lease,
  payments: RentPayment[],
  month: number,
  year: number
): MonthSettlement {
  const due = round2(lease.monthlyRent || 0);
  const paid = round2(
    paymentsForMonth(lease.id, payments, month, year).reduce((sum, p) => sum + (p.amount || 0), 0)
  );

  if (paid <= 0) return { due, paid: 0, balance: due, status: 'unpaid' };
  if (paid + EPSILON >= due) return { due, paid, balance: 0, status: 'paid' };
  return { due, paid, balance: round2(due - paid), status: 'partial' };
}
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test`
Expected: PASS, 13 tests.

- [ ] **Step 8: Commit**

```bash
git add package.json package-lock.json vitest.config.ts src/lib/rent.ts src/lib/rent.test.ts
git commit -m "feat: add tested rent math module

One place that decides revenue and whether a month is settled, so the
Dashboard, Rents, Reports and Tax Report cannot disagree. Counting rent per
lease instead of per person is the fix for income double counting."
```

---

### Task 2: Database migration

**Files:**
- Create: `migrations/0007_leases.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: tables `leases`, `lease_tenants`; reshaped `tenants`, `rent_payments`.

> **Destructive.** This drops and recreates `tenants` and `rent_payments`. It is safe only because both are empty. Step 2 proves that before applying.

- [ ] **Step 1: Write the migration**

Create `migrations/0007_leases.sql`:

```sql
-- Rent moves from the person to the unit's lease.
-- Destructive: drops and recreates tenants and rent_payments. Safe only while
-- both are empty (verified before running). See
-- docs/superpowers/specs/2026-07-15-lease-household-model-design.md

DROP TABLE IF EXISTS rent_payments;
DROP TABLE IF EXISTS tenants;

-- A tenancy on one unit. Owns the money, the dates and the state.
CREATE TABLE IF NOT EXISTS leases (
  id TEXT PRIMARY KEY,
  unit_id TEXT REFERENCES units(id) ON DELETE SET NULL,
  property_id TEXT REFERENCES properties(id) ON DELETE SET NULL,
  start_date TEXT,
  end_date TEXT,
  monthly_rent REAL NOT NULL DEFAULT 0,
  security_deposit REAL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active', -- active | paused | ended
  notes TEXT,
  user_id TEXT REFERENCES user(id),
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

-- A person. No rent, no lease dates, no status: all of that lives on the lease.
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  notes TEXT,
  emergency_contact_name TEXT,
  emergency_contact_phone TEXT,
  emergency_contact_relationship TEXT,
  user_id TEXT REFERENCES user(id),
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

-- Who lives on which lease. Many people per lease; a person may appear on many
-- leases over time (renewal, or moving unit) and stays the same person.
CREATE TABLE IF NOT EXISTS lease_tenants (
  id TEXT PRIMARY KEY,
  lease_id TEXT NOT NULL REFERENCES leases(id) ON DELETE CASCADE,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_at INTEGER DEFAULT (unixepoch()),
  UNIQUE(lease_id, tenant_id)
);

-- Rent is owed by the lease. paid_by_tenant_id records who the money came from.
CREATE TABLE IF NOT EXISTS rent_payments (
  id TEXT PRIMARY KEY,
  lease_id TEXT NOT NULL REFERENCES leases(id) ON DELETE CASCADE,
  paid_by_tenant_id TEXT REFERENCES tenants(id) ON DELETE SET NULL,
  amount REAL NOT NULL,
  due_date TEXT,
  paid_date TEXT,
  received_date TEXT,
  status TEXT DEFAULT 'pending',
  month INTEGER,
  year INTEGER,
  payment_method TEXT,
  uploaded_by TEXT,
  uploaded_at TEXT,
  notes TEXT,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_leases_unit ON leases(unit_id);
CREATE INDEX IF NOT EXISTS idx_leases_status ON leases(status);
CREATE INDEX IF NOT EXISTS idx_lease_tenants_lease ON lease_tenants(lease_id);
CREATE INDEX IF NOT EXISTS idx_lease_tenants_tenant ON lease_tenants(tenant_id);
CREATE INDEX IF NOT EXISTS idx_rent_payments_lease ON rent_payments(lease_id);
CREATE INDEX IF NOT EXISTS idx_rent_payments_period ON rent_payments(year, month);
```

- [ ] **Step 2: Prove the local database has nothing to lose**

Run:
```bash
npx wrangler d1 execute dunns-rental-db --local --command "SELECT (SELECT COUNT(*) FROM tenants) AS t, (SELECT COUNT(*) FROM rent_payments) AS p"
```
Expected: both counts are 0. If either is not 0, STOP and report to the user instead of running the migration.

- [ ] **Step 3: Apply locally**

Run:
```bash
npx wrangler d1 execute dunns-rental-db --local --file=migrations/0007_leases.sql
```
Expected: `"success": true`.

- [ ] **Step 4: Verify the new shape**

Run:
```bash
npx wrangler d1 execute dunns-rental-db --local --command "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('leases','lease_tenants','tenants','rent_payments') ORDER BY name"
```
Expected: all four listed.

- [ ] **Step 5: Commit**

```bash
git add migrations/0007_leases.sql
git commit -m "feat: add leases and lease_tenants, reshape tenants and payments

Rent, dates and status move to the lease. Tenants become people. Payments are
owed by a lease and record who paid. Safe to drop and recreate because both
tables are empty in every environment."
```

---

### Task 3: Serializers and the leases API

**Files:**
- Modify: `functions/lib/serializers.ts`
- Create: `functions/api/leases/index.ts`
- Create: `functions/api/leases/[id].ts`

**Interfaces:**
- Consumes: `requirePermission`, `jsonOk`, `jsonError`, `serverError` from `functions/lib/session`.
- Produces:
  - `serializeLease(r: Row)` returning `{ id, unitId, propertyId, startDate, endDate, monthlyRent, securityDeposit, status, notes, tenantIds }`
  - `GET/POST /api/leases`, `GET/PUT/DELETE /api/leases/:id`
  - POST body: `{ unitId, propertyId?, startDate?, endDate?, monthlyRent, securityDeposit?, status?, notes?, tenantIds?: string[] }`

- [ ] **Step 1: Update the serializers**

In `functions/lib/serializers.ts`, replace the whole `serializeTenant` function with this (rent, lease dates and status are gone), and add `serializeLease`:

```ts
export function serializeTenant(r: Row) {
  const hasEmergency =
    r.emergency_contact_name || r.emergency_contact_phone || r.emergency_contact_relationship;
  return {
    id: r.id,
    firstName: r.first_name,
    lastName: r.last_name,
    email: r.email ?? undefined,
    phone: r.phone ?? undefined,
    notes: r.notes ?? undefined,
    emergencyContact: hasEmergency
      ? {
          name: r.emergency_contact_name ?? '',
          phone: r.emergency_contact_phone ?? '',
          relationship: r.emergency_contact_relationship ?? '',
        }
      : undefined,
  };
}

export function serializeLease(r: Row) {
  return {
    id: r.id,
    unitId: r.unit_id ?? undefined,
    propertyId: r.property_id ?? undefined,
    startDate: r.start_date ?? undefined,
    endDate: r.end_date ?? undefined,
    monthlyRent: r.monthly_rent ?? 0,
    securityDeposit: r.security_deposit ?? 0,
    status: r.status ?? 'active',
    notes: r.notes ?? undefined,
    // Filled in by the leases endpoints, which join lease_tenants.
    tenantIds: (r.tenantIds as string[]) ?? [],
  };
}
```

Also replace `serializePayment` so it speaks lease:

```ts
export function serializePayment(r: Row) {
  return {
    id: r.id,
    leaseId: r.lease_id ?? undefined,
    paidByTenantId: r.paid_by_tenant_id ?? undefined,
    amount: r.amount,
    dueDate: r.due_date,
    paidDate: r.paid_date ?? undefined,
    receivedDate: r.received_date ?? undefined,
    status: r.status,
    month: r.month,
    year: r.year,
    notes: r.notes ?? undefined,
    paymentMethod: r.payment_method ?? undefined,
    uploadedBy: r.uploaded_by ?? undefined,
    uploadedAt: r.uploaded_at ?? undefined,
  };
}
```

- [ ] **Step 2: Create the leases collection endpoint**

Create `functions/api/leases/index.ts`:

```ts
import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { serializeLease } from '../../lib/serializers';

/** Attach the tenant ids on each lease in one extra query. */
export async function withTenantIds(env: Env, rows: Record<string, unknown>[]) {
  if (!rows.length) return [];
  const { results } = await env.DB.prepare('SELECT lease_id, tenant_id FROM lease_tenants').all<{
    lease_id: string;
    tenant_id: string;
  }>();
  const byLease = new Map<string, string[]>();
  for (const link of results || []) {
    const list = byLease.get(link.lease_id) || [];
    list.push(link.tenant_id);
    byLease.set(link.lease_id, list);
  }
  return rows.map(r =>
    serializeLease({ ...r, tenantIds: byLease.get(r.id as string) || [] })
  );
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'tenants_view');
  if (auth instanceof Response) return auth;

  try {
    const { results } = await env.DB.prepare('SELECT * FROM leases ORDER BY created_at DESC').all();
    return jsonOk({ success: true, data: await withTenantIds(env, results || []) });
  } catch {
    return serverError();
  }
};

/**
 * Confirm every id in tenantIds exists in tenants, in one query. Returns the
 * ids that could NOT be found (empty when all are valid).
 */
export async function findMissingTenantIds(env: Env, tenantIds: string[]): Promise<string[]> {
  if (!tenantIds.length) return [];
  const placeholders = tenantIds.map(() => '?').join(', ');
  const { results } = await env.DB.prepare(
    `SELECT id FROM tenants WHERE id IN (${placeholders})`
  )
    .bind(...tenantIds)
    .all<{ id: string }>();
  const found = new Set((results || []).map(r => r.id));
  return tenantIds.filter(tid => !found.has(tid));
}

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'tenants_create');
  if (auth instanceof Response) return auth;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (!body.unitId) return jsonError('A unit is required', 400);
    if (body.monthlyRent === undefined || body.monthlyRent === null) {
      return jsonError('Monthly rent is required', 400);
    }

    const unit = await env.DB.prepare('SELECT id, property_id FROM units WHERE id = ?')
      .bind(body.unitId)
      .first<{ id: string; property_id: string }>();
    if (!unit) return jsonError('Unit not found', 404);

    // Validate every tenant id BEFORE any write, so a bad id never reaches
    // the insert (an FK violation there would happen mid-batch).
    const tenantIds = Array.isArray(body.tenantIds) ? (body.tenantIds as string[]) : [];
    if (tenantIds.length) {
      const missing = await findMissingTenantIds(env, tenantIds);
      if (missing.length) return jsonError('One or more tenants could not be found', 400);
    }

    // The lease row and its occupant links commit or fail together: batch()
    // runs D1 statements as a single atomic transaction (raw BEGIN/COMMIT are
    // not supported here). Without this, a failure partway through leaves an
    // orphaned lease with no occupants.
    const id = crypto.randomUUID();
    const statements = [
      env.DB.prepare(
        `INSERT INTO leases (id, unit_id, property_id, start_date, end_date, monthly_rent, security_deposit, status, notes, user_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        id,
        body.unitId,
        body.propertyId ?? unit.property_id ?? null,
        body.startDate ?? null,
        body.endDate ?? null,
        body.monthlyRent,
        body.securityDeposit ?? 0,
        body.status ?? 'active',
        body.notes ?? null,
        auth.id
      ),
      ...tenantIds.map(tid =>
        env.DB.prepare(
          'INSERT OR IGNORE INTO lease_tenants (id, lease_id, tenant_id) VALUES (?, ?, ?)'
        ).bind(crypto.randomUUID(), id, tid)
      ),
    ];
    await env.DB.batch(statements);

    const row = await env.DB.prepare('SELECT * FROM leases WHERE id = ?').bind(id).first();
    const [data] = await withTenantIds(env, [row as Record<string, unknown>]);
    return jsonOk({ success: true, data }, 201);
  } catch {
    return serverError();
  }
};
```

- [ ] **Step 3: Create the single lease endpoint**

Create `functions/api/leases/[id].ts`:

```ts
import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { withTenantIds, findMissingTenantIds } from './index';

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_view');
  if (auth instanceof Response) return auth;

  try {
    const row = await env.DB.prepare('SELECT * FROM leases WHERE id = ?')
      .bind(params.id as string)
      .first();
    if (!row) return jsonError('Lease not found', 404);
    const [data] = await withTenantIds(env, [row as Record<string, unknown>]);
    return jsonOk({ success: true, data });
  } catch {
    return serverError();
  }
};

export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_edit');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const body = (await request.json()) as Record<string, unknown>;

    // Validate BEFORE any write. `tenantIds` is null when the caller sent no
    // list at all (occupants are left untouched); it is an array (possibly
    // empty, to clear the list) when the caller sent one.
    const tenantIds = Array.isArray(body.tenantIds) ? (body.tenantIds as string[]) : null;
    if (tenantIds && tenantIds.length) {
      const missing = await findMissingTenantIds(env, tenantIds);
      if (missing.length) return jsonError('One or more tenants could not be found', 400);
    }

    // The lease update, the occupant DELETE and the re-inserts commit or fail
    // together via batch(). Previously the DELETE committed independently, so
    // a later insert failure silently wiped the occupant list while the
    // caller saw a 500 and assumed nothing changed.
    const statements = [
      env.DB.prepare(
        `UPDATE leases SET
          unit_id = ?, property_id = ?, start_date = ?, end_date = ?, monthly_rent = ?,
          security_deposit = ?, status = ?, notes = ?, updated_at = unixepoch()
         WHERE id = ?`
      ).bind(
        body.unitId ?? null,
        body.propertyId ?? null,
        body.startDate ?? null,
        body.endDate ?? null,
        body.monthlyRent ?? 0,
        body.securityDeposit ?? 0,
        body.status ?? 'active',
        body.notes ?? null,
        id
      ),
    ];

    // Replace the occupant list when the caller sends one.
    if (tenantIds) {
      statements.push(env.DB.prepare('DELETE FROM lease_tenants WHERE lease_id = ?').bind(id));
      for (const tid of tenantIds) {
        statements.push(
          env.DB.prepare(
            'INSERT OR IGNORE INTO lease_tenants (id, lease_id, tenant_id) VALUES (?, ?, ?)'
          ).bind(crypto.randomUUID(), id, tid)
        );
      }
    }

    await env.DB.batch(statements);

    const row = await env.DB.prepare('SELECT * FROM leases WHERE id = ?').bind(id).first();
    if (!row) return jsonError('Lease not found', 404);
    const [data] = await withTenantIds(env, [row as Record<string, unknown>]);
    return jsonOk({ success: true, data });
  } catch {
    return serverError();
  }
};

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_delete');
  if (auth instanceof Response) return auth;

  try {
    await env.DB.prepare('DELETE FROM leases WHERE id = ?').bind(params.id as string).run();
    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
```

- [ ] **Step 4: Verify it compiles**

Run: `npx tsc -p functions/tsconfig.json`
Expected: no output (success).

- [ ] **Step 5: Commit**

```bash
git add functions/lib/serializers.ts functions/api/leases
git commit -m "feat: add leases API and reshape tenant/payment serializers"
```

---

### Task 4: Reshape the tenants API to people

**Files:**
- Modify: `functions/api/tenants/index.ts`
- Modify: `functions/api/tenants/[id].ts`

**Interfaces:**
- Consumes: `serializeTenant` (Task 3).
- Produces: `GET/POST /api/tenants`, `GET/PUT/DELETE /api/tenants/:id`. Body: `{ firstName, lastName, email?, phone?, notes?, emergencyContact?: { name, phone, relationship } }`. No rent, unit or lease fields.

- [ ] **Step 1: Replace the collection endpoint**

Replace the entire contents of `functions/api/tenants/index.ts`:

```ts
import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { serializeTenant } from '../../lib/serializers';

interface EmergencyContact {
  name?: string;
  phone?: string;
  relationship?: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'tenants_view');
  if (auth instanceof Response) return auth;

  try {
    const { results } = await env.DB.prepare('SELECT * FROM tenants ORDER BY created_at DESC').all();
    return jsonOk({ success: true, data: (results || []).map(serializeTenant) });
  } catch {
    return serverError();
  }
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'tenants_create');
  if (auth instanceof Response) return auth;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const ec = (body.emergencyContact as EmergencyContact) || {};

    if (!body.firstName || !body.lastName) {
      return jsonError('First and last name are required', 400);
    }

    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO tenants (id, first_name, last_name, email, phone, notes,
        emergency_contact_name, emergency_contact_phone, emergency_contact_relationship, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        body.firstName,
        body.lastName,
        body.email ?? null,
        body.phone ?? null,
        body.notes ?? null,
        ec.name ?? null,
        ec.phone ?? null,
        ec.relationship ?? null,
        auth.id
      )
      .run();

    const row = await env.DB.prepare('SELECT * FROM tenants WHERE id = ?').bind(id).first();
    return jsonOk({ success: true, data: serializeTenant(row as Record<string, unknown>) }, 201);
  } catch {
    return serverError();
  }
};
```

- [ ] **Step 2: Replace the single tenant endpoint**

Replace the entire contents of `functions/api/tenants/[id].ts`:

```ts
import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { serializeTenant } from '../../lib/serializers';

interface EmergencyContact {
  name?: string;
  phone?: string;
  relationship?: string;
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_view');
  if (auth instanceof Response) return auth;

  try {
    const row = await env.DB.prepare('SELECT * FROM tenants WHERE id = ?')
      .bind(params.id as string)
      .first();
    if (!row) return jsonError('Tenant not found', 404);
    return jsonOk({ success: true, data: serializeTenant(row as Record<string, unknown>) });
  } catch {
    return serverError();
  }
};

export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_edit');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const body = (await request.json()) as Record<string, unknown>;
    const ec = (body.emergencyContact as EmergencyContact) || {};

    await env.DB.prepare(
      `UPDATE tenants SET
        first_name = ?, last_name = ?, email = ?, phone = ?, notes = ?,
        emergency_contact_name = ?, emergency_contact_phone = ?, emergency_contact_relationship = ?,
        updated_at = unixepoch()
       WHERE id = ?`
    )
      .bind(
        body.firstName,
        body.lastName,
        body.email ?? null,
        body.phone ?? null,
        body.notes ?? null,
        ec.name ?? null,
        ec.phone ?? null,
        ec.relationship ?? null,
        id
      )
      .run();

    const row = await env.DB.prepare('SELECT * FROM tenants WHERE id = ?').bind(id).first();
    if (!row) return jsonError('Tenant not found', 404);
    return jsonOk({ success: true, data: serializeTenant(row as Record<string, unknown>) });
  } catch {
    return serverError();
  }
};

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_delete');
  if (auth instanceof Response) return auth;

  try {
    await env.DB.prepare('DELETE FROM tenants WHERE id = ?').bind(params.id as string).run();
    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc -p functions/tsconfig.json`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add functions/api/tenants
git commit -m "feat: tenants API now describes a person, not a tenancy"
```

---

### Task 5: Reshape the payments API

**Files:**
- Modify: `functions/api/payments/index.ts`
- Modify: `functions/api/payments/[id].ts`

**Interfaces:**
- Consumes: `serializePayment` (Task 3).
- Produces: payments keyed by `leaseId` with `paidByTenantId`. Body: `{ leaseId, paidByTenantId?, amount, month, year, dueDate?, paidDate?, receivedDate?, status?, paymentMethod?, notes? }`.

- [ ] **Step 1: Rewrite the INSERT in the collection endpoint**

In `functions/api/payments/index.ts`, replace the whole `onRequestPost` with:

```ts
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'rents_record');
  if (auth instanceof Response) return auth;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (!body.leaseId) return jsonError('A lease is required', 400);
    if (body.amount === undefined || body.amount === null) {
      return jsonError('Amount is required', 400);
    }

    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO rent_payments (id, lease_id, paid_by_tenant_id, amount, due_date, paid_date,
        received_date, status, month, year, payment_method, uploaded_by, uploaded_at, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        body.leaseId,
        body.paidByTenantId ?? null,
        body.amount,
        body.dueDate ?? null,
        body.paidDate ?? null,
        body.receivedDate ?? null,
        body.status ?? 'pending',
        body.month ?? null,
        body.year ?? null,
        body.paymentMethod ?? null,
        body.uploadedBy ?? auth.id,
        body.uploadedAt ?? null,
        body.notes ?? null
      )
      .run();

    const row = await env.DB.prepare('SELECT * FROM rent_payments WHERE id = ?').bind(id).first();
    return jsonOk({ success: true, data: serializePayment(row as Record<string, unknown>) }, 201);
  } catch {
    return serverError();
  }
};
```

- [ ] **Step 2: Rewrite the UPDATE in the single payment endpoint**

In `functions/api/payments/[id].ts`, replace the `UPDATE` statement and its bindings inside `onRequestPut` with:

```ts
    // lease_id is NOT NULL: reject a payment with no lease here rather than
    // letting D1 raise a raw constraint error.
    if (!body.leaseId) return jsonError('A lease is required', 400);
    if (body.amount === undefined || body.amount === null) {
      return jsonError('Amount is required', 400);
    }

    await env.DB.prepare(
      `UPDATE rent_payments SET
        lease_id = ?, paid_by_tenant_id = ?, amount = ?, due_date = ?, paid_date = ?,
        received_date = ?, status = ?, month = ?, year = ?, payment_method = ?,
        uploaded_by = ?, uploaded_at = ?, notes = ?, updated_at = unixepoch()
       WHERE id = ?`
    )
      .bind(
        body.leaseId,
        body.paidByTenantId ?? null,
        body.amount,
        body.dueDate ?? null,
        body.paidDate ?? null,
        body.receivedDate ?? null,
        body.status ?? 'pending',
        body.month ?? null,
        body.year ?? null,
        body.paymentMethod ?? null,
        body.uploadedBy ?? null,
        body.uploadedAt ?? null,
        body.notes ?? null,
        id
      )
      .run();
```

- [ ] **Step 3: Verify it compiles**

Run: `npx tsc -p functions/tsconfig.json`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add functions/api/payments
git commit -m "feat: rent payments are owed by a lease and record who paid"
```

---

### Task 6: Frontend types and API client

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/lib/rent.ts` (import shared types instead of declaring them)
- Modify: `src/lib/api.ts`

**Interfaces:**
- Consumes: the endpoints from Tasks 3 to 5.
- Produces: `Lease`, `LeaseStatus`, reshaped `Tenant`, reshaped `RentPayment` in `src/types`; `leasesApi` in `src/lib/api.ts`.

- [ ] **Step 1: Update the shared types**

In `src/types/index.ts`, replace the `Tenant` and `RentPayment` interfaces and add `Lease`:

```ts
export type LeaseStatus = 'active' | 'paused' | 'ended';

export interface Lease {
  id: string;
  unitId: string;
  propertyId?: string;
  startDate?: string;
  endDate?: string;
  monthlyRent: number;
  securityDeposit?: number;
  status: LeaseStatus;
  notes?: string;
  tenantIds: string[];
}

/** A person. Rent and lease dates live on the Lease. */
export interface Tenant {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  notes?: string;
  emergencyContact?: {
    name: string;
    phone: string;
    relationship: string;
  };
}

export interface RentPayment {
  id: string;
  leaseId: string;
  paidByTenantId?: string;
  amount: number;
  dueDate?: string;
  paidDate?: string;
  receivedDate?: string;
  status: 'paid' | 'pending' | 'overdue' | 'partial';
  month: number;
  year: number;
  notes?: string;
  paymentMethod?: PaymentMethod;
  uploadedBy?: string;
  uploadedAt?: string;
}
```

- [ ] **Step 2: Point the rent module at the shared types**

In `src/lib/rent.ts`, delete the locally declared `LeaseStatus`, `Lease` and `RentPayment` and replace them with a re-export so existing imports keep working:

```ts
import type { Lease, RentPayment } from '../types';
export type { Lease, RentPayment };
```

Leave `MonthSettlement`, `activeLeases`, `monthlyRevenue`, `paymentsForMonth` and `settleMonth` exactly as they are.

- [ ] **Step 3: Run the tests to confirm nothing broke**

Run: `npm test`
Expected: PASS, 13 tests.

- [ ] **Step 4: Add the leases API client**

In `src/lib/api.ts`, add `Lease` to the type import from `../types`, and add after `tenantsApi`:

```ts
// Leases API
export const leasesApi = {
  getAll: (): Promise<Lease[]> => apiRequest('/leases'),
  getById: (id: string): Promise<Lease> => apiRequest(`/leases/${id}`),
  create: (data: Omit<Lease, 'id'>): Promise<Lease> =>
    apiRequest('/leases', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Lease): Promise<Lease> =>
    apiRequest(`/leases/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) => apiRequest(`/leases/${id}`, { method: 'DELETE' }),
};
```

- [ ] **Step 5: Commit**

```bash
git add src/types/index.ts src/lib/rent.ts src/lib/api.ts
git commit -m "feat: add Lease type and API client, reshape Tenant and RentPayment"
```

---

### Task 7: AppContext carries leases

**Files:**
- Modify: `src/context/AppContext.tsx`

**Interfaces:**
- Consumes: `leasesApi` (Task 6).
- Produces: on `useApp()`: `leases: Lease[]`, `addLease(lease: Omit<Lease,'id'>): Promise<void>`, `updateLease(lease: Lease): Promise<void>`, `deleteLease(id: string): Promise<void>`. `addTenant` now takes `Omit<Tenant,'id'>` and returns the created `Tenant`.

- [ ] **Step 1: Add leases to state**

In `src/context/AppContext.tsx`:
- Add `Lease` to the type import from `../types` and `leasesApi` to the import from `../lib/api`.
- Add `leases: Lease[];` to `interface AppState`.
- Add `leases: [],` to `initialState`.
- Add to the `Action` union:

```ts
  | { type: 'ADD_LEASE'; payload: Lease }
  | { type: 'UPDATE_LEASE'; payload: Lease }
  | { type: 'DELETE_LEASE'; payload: string }
```

- Add to the reducer, before `default:`:

```ts
    case 'ADD_LEASE':
      return { ...state, leases: [action.payload, ...state.leases] };
    case 'UPDATE_LEASE':
      return {
        ...state,
        leases: state.leases.map(l => (l.id === action.payload.id ? action.payload : l)),
      };
    case 'DELETE_LEASE':
      return { ...state, leases: state.leases.filter(l => l.id !== action.payload) };
```

- [ ] **Step 2: Load leases with everything else**

In `refreshData`, add `leasesApi.getAll()` to the `Promise.all` array and `leases` to both the destructured result and the `SET_STATE` payload. Add `leases: []` to the sign-out clearing payload.

- [ ] **Step 3: Add the lease actions**

Add these next to the other CRUD functions, and add `addLease`, `updateLease`, `deleteLease` to `AppContextType` and to the provider `value`:

```ts
  const addLease = async (lease: Omit<Lease, 'id'>) => {
    const created = await leasesApi.create(lease);
    dispatch({ type: 'ADD_LEASE', payload: created });
  };

  const updateLease = async (lease: Lease) => {
    const updated = await leasesApi.update(lease.id, lease);
    dispatch({ type: 'UPDATE_LEASE', payload: updated });
  };

  const deleteLease = async (id: string) => {
    await leasesApi.delete(id);
    dispatch({ type: 'DELETE_LEASE', payload: id });
  };
```

- [ ] **Step 4: Make addTenant return the person**

Change `addTenant` so callers can attach the new person to a lease, and update its signature in `AppContextType` to `(tenant: Omit<Tenant, 'id'>) => Promise<Tenant>`:

```ts
  const addTenant = async (tenant: Omit<Tenant, 'id'>) => {
    const created = await tenantsApi.create(tenant);
    dispatch({ type: 'ADD_TENANT', payload: created });
    return created;
  };
```

Also change `updateTenant` to take the full person (the old partial-merge signature is no longer needed) and update `AppContextType` to `(tenant: Tenant) => Promise<void>`:

```ts
  const updateTenant = async (tenant: Tenant) => {
    const updated = await tenantsApi.update(tenant.id, tenant);
    dispatch({ type: 'UPDATE_TENANT', payload: updated });
  };
```

- [ ] **Step 5: Fix the helper selectors**

`getUnitTenant` and `getPropertyTenants` referenced fields that no longer exist on a person. Replace them with lease-aware versions and update their entries in `AppContextType`:

```ts
  const getUnitLease = useCallback(
    (unitId: string) => state.leases.find(l => l.unitId === unitId && l.status !== 'ended'),
    [state.leases]
  );

  const getLeaseTenants = useCallback(
    (leaseId: string) => {
      const lease = state.leases.find(l => l.id === leaseId);
      if (!lease) return [];
      return state.tenants.filter(t => lease.tenantIds.includes(t.id));
    },
    [state.leases, state.tenants]
  );

  const getTenantLeases = useCallback(
    (tenantId: string) => state.leases.filter(l => l.tenantIds.includes(tenantId)),
    [state.leases]
  );
```

Declare them in `AppContextType` as:

```ts
  getUnitLease: (unitId: string) => Lease | undefined;
  getLeaseTenants: (leaseId: string) => Tenant[];
  getTenantLeases: (tenantId: string) => Lease[];
```

Remove `getUnitTenant` and `getPropertyTenants` from the interface and the value.

- [ ] **Step 6: Verify the app compiles as far as the context**

Run: `npx tsc -b`
Expected: errors ONLY in `src/pages/*` (they still use the old shapes). Tasks 8 to 12 fix those. If there is an error inside `src/context/AppContext.tsx`, fix it before moving on.

- [ ] **Step 7: Commit**

```bash
git add src/context/AppContext.tsx
git commit -m "feat: AppContext loads leases and exposes lease-aware selectors"
```

---

### Task 8: Tenants list and the individual person page

**Files:**
- Modify: `src/pages/Tenants.tsx`
- Create: `src/pages/TenantDetail.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `useApp()` leases/tenants and `getUnitLease`, `getLeaseTenants`, `getTenantLeases` (Task 7); `settleMonth` (Task 1).
- Produces: route `/tenants/:id` rendering `TenantDetail`.

- [ ] **Step 1: Rewrite the Tenants page as a people list**

Rewrite `src/pages/Tenants.tsx` so it lists people. For each person derive their current lease via `getTenantLeases(t.id).find(l => l.status !== 'ended')`. Columns: Person (name plus who they live with), Property and Unit, Contact, Lease term, Rent (from the lease), Status (lease status badge, or "No tenancy"). The row links to `/tenants/${t.id}`. Keep the search box (match on name, email, phone). Stat cards become: Total People, Housed (people on an active lease), Expiring Soon (active leases ending within 60 days), Monthly Revenue (`monthlyRevenue(leases)` from `src/lib/rent`). Delete the old add/edit tenant modals and the rent, lease date and status fields from this page; adding a tenancy now lives in Task 9 and editing a person lives on the detail page.

- [ ] **Step 2: Create the person page**

Create `src/pages/TenantDetail.tsx` showing, for the `:id` person: their name and contact, an Edit form for person fields only (first/last/email/phone/notes/emergency contact) saving via `updateTenant`, their housemates (from `getLeaseTenants` of their current lease), their tenancy summary (unit, term, rent, status), their Documents section (reuse the upload and list behaviour currently in the Tenants view modal, using `documentsApi`), and their payment history (payments where `paidByTenantId === id`, newest first, showing month, amount, method and date). Use `Card`, `Badge`, `Button`, `Modal` and the design tokens.

- [ ] **Step 3: Add the route**

In `src/App.tsx`, import `TenantDetail` and add inside `<Routes>` after the `/tenants` route:

```tsx
      <Route path="/tenants/:id" element={
        <ProtectedRoute requiredPermission="tenants_view">
          <Layout><TenantDetail /></Layout>
        </ProtectedRoute>
      } />
```

- [ ] **Step 4: Verify**

Run: `npm run build`
Expected: no errors from `Tenants.tsx`, `TenantDetail.tsx` or `App.tsx`. Errors may remain in `Rents.tsx`, `Dashboard.tsx`, `Reports.tsx` and `TaxReport.tsx` until Tasks 9 to 12.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Tenants.tsx src/pages/TenantDetail.tsx src/App.tsx
git commit -m "feat: people-first tenants list and individual person page"
```

---

### Task 9: Add and edit a tenancy

**Files:**
- Modify: `src/pages/Tenants.tsx`

**Interfaces:**
- Consumes: `addLease`, `updateLease`, `addTenant` (Task 7).
- Produces: an "Add Tenancy" modal on the Tenants page.

- [ ] **Step 1: Build the tenancy modal**

Add an "Add Tenancy" button to the Tenants page header opening a modal with two parts:
1. **The tenancy:** unit select (units without an active lease), start date, end date, monthly rent, security deposit, notes.
2. **The people:** a repeatable row list (first name, last name, email, phone) starting with one row, an "Add another person" button, and a remove control on each row beyond the first. At least one person is required.

On submit: create each person with `addTenant` collecting the returned ids, then call `addLease` with `{ unitId, propertyId, startDate, endDate, monthlyRent: Number(...), securityDeposit: Number(...), status: 'active', notes, tenantIds }`. Show a success toast, close, and reset. On failure show `showToast((err as Error).message, 'error')` and leave the modal open so nothing is retyped.

- [ ] **Step 2: Add tenancy actions to each row**

On a person's row, add an actions menu with "Pause rent", "End tenancy" and "Resume" that call `updateLease({ ...lease, status: 'paused' | 'ended' | 'active' })` on their current lease, each behind a `confirm()`. These act on the tenancy, not the person, per the spec.

- [ ] **Step 3: Verify by hand**

Run `npm run build`, then restart the dev server:
```bash
taskkill //F //IM workerd.exe 2>/dev/null; npx wrangler pages dev dist --port 8788 --compatibility-date 2025-05-20
```
Sign in, add a tenancy on Unit A for $1,325 with two people, and confirm both appear in the list sharing one unit and one rent.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Tenants.tsx
git commit -m "feat: add a tenancy with rent set once and any number of people"
```

---

### Task 10: Rent Management by lease

**Files:**
- Modify: `src/pages/Rents.tsx`

**Interfaces:**
- Consumes: `settleMonth`, `monthlyRevenue` (Task 1); `leases`, `getLeaseTenants` (Task 7).
- Produces: none (leaf page).

- [ ] **Step 1: Rebuild the payments table around leases**

The table lists **one row per active lease per month** for the selected year, not one row per payment. Each row shows: unit and property, the occupants' names, the period, rent due, paid so far, balance, and a status badge from `settleMonth(lease, rentPayments, month, year).status` (`paid`, `partial`, `unpaid`). Keep the year filter and the search box (match unit, property or occupant name).

- [ ] **Step 2: Record a payment against a lease**

The "Record Payment" action on a row opens a modal with: amount (defaulting to the outstanding balance), who paid (a select of that lease's occupants from `getLeaseTenants`), date received, and payment method. Submitting calls `addRentPayment({ leaseId, paidByTenantId, amount: Number(amount), month, year, status: 'paid', receivedDate, paidDate: receivedDate, paymentMethod, dueDate })`. Because a month can take several payments, do not block a second payment on an already partially paid month.

- [ ] **Step 3: Fix the stat cards and the CSV export**

Stat cards: Total Collected (sum of payments in the year), Outstanding (sum of `settleMonth(...).balance` across active leases and elapsed months of the year), Collection Rate, Overdue count. Update `exportToCSV` headers to `Property, Unit, Occupants, Month, Year, Due, Paid, Balance, Status` and build rows from the lease rows. Update the CSV import to resolve a unit to its active lease and set `leaseId` (and `paidByTenantId` when the named person is on that lease), skipping rows whose unit has no active lease and reporting the count.

- [ ] **Step 4: Verify by hand**

With the dev server running, on the tenancy from Task 9: record $700 from person one, confirm the month shows partial with a $625 balance, then record $625 from person two and confirm the month shows paid with no balance.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Rents.tsx
git commit -m "feat: rent is tracked per lease per month and records who paid"
```

---

### Task 11: Unit view shows the tenancy and its occupants

`Properties.tsx` currently calls `getUnitTenant`, which Task 7 removed. It will not
compile until this task lands.

**Files:**
- Modify: `src/pages/Properties.tsx`

**Interfaces:**
- Consumes: `getUnitLease`, `getLeaseTenants` (Task 7).
- Produces: none (leaf page).

- [ ] **Step 1: Swap the removed selector for the lease-aware ones**

At line 24, change the `useApp()` destructure from `getPropertyUnits, getUnitTenant` to
`getPropertyUnits, getUnitLease, getLeaseTenants`.

- [ ] **Step 2: Show the tenancy rather than a single tenant**

At the unit card (around line 349), replace `const tenant = getUnitTenant(unit.id);` with:

```tsx
                    const lease = getUnitLease(unit.id);
                    const occupants = lease ? getLeaseTenants(lease.id) : [];
```

Then render the occupancy block from the lease instead of one tenant: when `lease`
exists show every occupant's name (comma separated), the lease rent via
`formatCurrency(lease.monthlyRent)` labelled "Rent", the term from
`lease.startDate` to `lease.endDate`, and a `Badge` for `lease.status`. When there
is no lease, keep the existing vacant treatment. Leave `unit.monthlyRent`
(the unit's asking rent) alone: it is the listed price, separate from what a
current tenancy actually charges.

- [ ] **Step 3: Verify**

Run: `npm run build`
Expected: no errors from `Properties.tsx`. Errors may remain in `Dashboard.tsx`,
`Reports.tsx` and `TaxReport.tsx` until Task 12.

- [ ] **Step 4: Commit**

```bash
git add src/pages/Properties.tsx
git commit -m "feat: unit view shows the current tenancy and everyone in it"
```

---

### Task 12: Dashboard, Reports and Tax Report read the rent module

**Files:**
- Modify: `src/pages/Dashboard.tsx`
- Modify: `src/pages/Reports.tsx`
- Modify: `src/pages/TaxReport.tsx`

**Interfaces:**
- Consumes: `monthlyRevenue`, `settleMonth`, `activeLeases` (Task 1).
- Produces: none (leaf pages).

- [ ] **Step 1: Dashboard**

Replace the tenant-derived rent maths in the `stats` memo:
- `totalTenants` becomes the number of people on an active lease.
- `projectedYearlyIncome` becomes `monthlyRevenue(leases) * 12`.
- `totalOwed` becomes the sum of `settleMonth(...).balance` over active leases for elapsed months of the current year.
- `occupiedUnits` counts units that have an active lease.
`upcomingRenewals` reads from active leases (`endDate` within 90 days), showing the unit and its occupants' names rather than one tenant.

- [ ] **Step 2: Reports**

The rent roll becomes one row per active lease: property and unit, occupants (comma separated), monthly rent, lease end, and this month's status from `settleMonth`. Totals: Scheduled Rent is `monthlyRevenue(leases)`; Collected This Month is payments in the current month; Outstanding is the sum of `settleMonth(...).balance` for the current month. Outstanding Balances lists leases whose current month is `partial` or `unpaid`, showing the unit, occupants, balance and status. Update the CSV export headers to `Property, Unit, Occupants, Monthly Rent, Lease End, This Month`.

- [ ] **Step 3: Tax Report**

`rentIncome` already reads paid rent payments and needs no change to its source. Confirm it still compiles against the reshaped `RentPayment`, and update the property breakdown so `propertyRent` filters payments by joining through the lease: build a `leaseId -> propertyId` map from `leases` and match on that instead of `payment.propertyId` (which no longer exists).

- [ ] **Step 4: Verify**

Run: `npm run build`
Expected: PASS with no errors anywhere.
Run: `npm test`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add src/pages/Dashboard.tsx src/pages/Reports.tsx src/pages/TaxReport.tsx
git commit -m "feat: dashboard, reports and tax report count rent per lease"
```

---

### Task 13: Verify the whole thing, then ship

**Files:** none (verification and deploy).

- [ ] **Step 1: Run every check**

```bash
npm test && npm run build
```
Expected: 13 tests pass, build succeeds.

- [ ] **Step 2: Walk the spec's verification list by hand**

With the dev server running against a freshly migrated local database, confirm each and note the result:

1. A tenancy with two people shows rent **once** in Dashboard revenue (not doubled).
2. A month split across two payments settles when they add up.
3. A short payment shows partial with the correct balance.
4. One person paying in full settles the month.
5. Ending a lease and starting a new one on the same unit keeps the old lease, its payments, and correct tax figures.
6. Dashboard, Rent Management, Reports and Tax Report agree on the same numbers.

- [ ] **Step 3: Prove production still has nothing to lose**

```bash
npx wrangler d1 execute dunns-rental-db --remote --command "SELECT (SELECT COUNT(*) FROM tenants) AS t, (SELECT COUNT(*) FROM rent_payments) AS p"
```
Expected: both 0. If either is not 0, STOP and report to the user: someone entered data and this needs a migration instead.

- [ ] **Step 4: Apply the migration to production**

```bash
npx wrangler d1 execute dunns-rental-db --remote --file=migrations/0007_leases.sql
```
Expected: `"success": true`.

- [ ] **Step 5: Ship**

```bash
git checkout main && git merge lease-household-model --ff-only && git push origin main
```

- [ ] **Step 6: Verify the live site**

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://dunns-rental.pages.dev/
curl -s -o /dev/null -w "%{http_code}\n" https://dunns-rental.pages.dev/api/leases
```
Expected: `200` then `401` (the API is alive and still refuses anonymous callers). Confirm the newest Production deployment is not marked `Failure`:

```bash
npx wrangler pages deployment list --project-name dunns-rental | grep Production | head -1
```
