# Household Members + Users Page Tabs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a tenant and Belle record contact-only household members on a unit, and split the Users page into Internal / Realtors / Tenants tabs.

**Architecture:** A new lease-scoped `household_members` table with admin endpoints (`/api/household`, keyed by tenant, resolving that tenant's current lease server-side) and portal endpoints (`/api/portal/household`, resolving the caller's own lease from the session). Shared pure helpers do validation and lease resolution. The Users page change is frontend-only: a pure `userCategory` helper drives three tabs over the existing users list.

**Tech Stack:** Cloudflare Pages Functions + D1 (SQLite), React 19 + TypeScript + Vite + React Router, Vitest. Migrations applied with `wrangler d1 migrations apply dunns-rental-db` (`--local` first, `--remote` for prod).

## Global Constraints

- **No dashes** (em, en, or hyphen-as-a-break) in any user-visible copy. Use commas, periods, or colons. This is Belle's standing rule.
- Household members are **contact-only**: no login, no Drive folder, no rent, cannot be invited. They are NOT `tenants` records and live only in `household_members`.
- **Realtors never see household members**, and the realtor scope is otherwise unchanged (they see only their linked main tenant's contact info, emergency contact, and documents).
- Portal writes **resolve the lease from the session**, never from a client-supplied id. A portal caller acting on a member outside their own leases gets **404** (never 403), so the endpoint cannot be used to probe which member ids exist. This matches the existing `functions/api/portal/documents/[id].ts` pattern.
- Limits: **max 20 members per lease**; each of name/phone/relationship **max 120 chars**; **name is required**.
- Next free migration number is **0011** (0008 was skipped historically).
- Automated tests cover pure logic only (serializer, validator, `userCategory`); endpoints and UI are verified by hand against a local server, consistent with the rest of this project (no Pages+D1 integration harness).

---

## File Structure

**Feature 1 — Household members**
- `migrations/0011_household.sql` — new `household_members` table.
- `functions/lib/household.ts` — pure `validateHouseholdInput` + limit constants.
- `functions/lib/serializers.ts` — add `serializeHouseholdMember`.
- `functions/lib/portal.ts` — add `tenantLeaseIds`, `currentLeaseId`.
- `functions/api/household/index.ts` — admin GET (list by tenant) + POST.
- `functions/api/household/[id].ts` — admin PUT + DELETE.
- `functions/api/portal/household/index.ts` — portal GET + POST (own lease).
- `functions/api/portal/household/[id].ts` — portal PUT + DELETE (own lease).
- `src/lib/api.ts` — `HouseholdMember` type, `portalApi.household`, `householdApi`.
- `src/pages/portal/TenantHome.tsx` — "Who lives here" card.
- `src/pages/TenantDetail.tsx` — admin "Household" card.

**Feature 2 — Users tabs**
- `src/lib/userCategory.ts` — pure `userCategory(roleId)`.
- `src/pages/Users.tsx` — three-tab switcher over the users list.

---

## Task 1: Household table, serializer, and validator

**Files:**
- Create: `migrations/0011_household.sql`
- Create: `functions/lib/household.ts`
- Create: `functions/lib/household.test.ts`
- Modify: `functions/lib/serializers.ts` (add `serializeHouseholdMember` after `serializeTenant`)

**Interfaces:**
- Produces: `validateHouseholdInput(body) -> { ok: true, value: { name: string; phone: string | null; relationship: string | null } } | { ok: false, error: string }`; constants `MAX_HOUSEHOLD_FIELD = 120`, `MAX_HOUSEHOLD_MEMBERS = 20`; `serializeHouseholdMember(row) -> { id, leaseId, name, phone, relationship, createdAt }`.

- [ ] **Step 1: Write the migration**

`migrations/0011_household.sql`:

```sql
-- People who live in a unit, recorded as contact-only entries. NOT tenants:
-- no login, no Drive folder, no rent, cannot be invited. Attached to the lease
-- so co-tenants on one lease share a single household roster.
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

- [ ] **Step 2: Apply the migration locally**

Run: `npx wrangler d1 migrations apply dunns-rental-db --local`
Expected: reports `0011_household.sql` applied, no error.

- [ ] **Step 3: Write the failing validator test**

`functions/lib/household.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validateHouseholdInput, MAX_HOUSEHOLD_FIELD } from './household';

describe('validateHouseholdInput', () => {
  it('accepts a name and trims, nulls blank optional fields', () => {
    const r = validateHouseholdInput({ name: '  Jane Doe  ', phone: '', relationship: ' spouse ' });
    expect(r).toEqual({ ok: true, value: { name: 'Jane Doe', phone: null, relationship: 'spouse' } });
  });

  it('rejects a missing or blank name', () => {
    expect(validateHouseholdInput({ name: '   ' })).toEqual({ ok: false, error: 'A name is required' });
    expect(validateHouseholdInput({})).toEqual({ ok: false, error: 'A name is required' });
  });

  it('rejects an over-long field', () => {
    const long = 'x'.repeat(MAX_HOUSEHOLD_FIELD + 1);
    expect(validateHouseholdInput({ name: long })).toEqual({ ok: false, error: 'Name is too long' });
  });
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run: `npx vitest run functions/lib/household.test.ts`
Expected: FAIL, cannot import from `./household` (module does not exist).

- [ ] **Step 5: Write the validator**

`functions/lib/household.ts`:

```ts
/** Longest allowed value for a household member's name, phone, or relationship. */
export const MAX_HOUSEHOLD_FIELD = 120;
/** Most household members allowed on one lease, a guard against abuse. */
export const MAX_HOUSEHOLD_MEMBERS = 20;

export interface HouseholdInput {
  name: string;
  phone: string | null;
  relationship: string | null;
}
export type HouseholdValidation =
  | { ok: true; value: HouseholdInput }
  | { ok: false; error: string };

/** Validate and normalise a household member payload. Pure, so it is testable. */
export function validateHouseholdInput(body: {
  name?: unknown;
  phone?: unknown;
  relationship?: unknown;
}): HouseholdValidation {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return { ok: false, error: 'A name is required' };
  if (name.length > MAX_HOUSEHOLD_FIELD) return { ok: false, error: 'Name is too long' };

  const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
  const relationship = typeof body.relationship === 'string' ? body.relationship.trim() : '';
  if (phone.length > MAX_HOUSEHOLD_FIELD) return { ok: false, error: 'Phone is too long' };
  if (relationship.length > MAX_HOUSEHOLD_FIELD) return { ok: false, error: 'Relationship is too long' };

  return { ok: true, value: { name, phone: phone || null, relationship: relationship || null } };
}
```

- [ ] **Step 6: Add the serializer**

In `functions/lib/serializers.ts`, add after `serializeTenant` (before `serializePortalTenant`):

```ts
export function serializeHouseholdMember(r: Row) {
  return {
    id: r.id,
    leaseId: r.lease_id,
    name: r.name,
    phone: r.phone ?? null,
    relationship: r.relationship ?? null,
    createdAt: r.created_at,
  };
}
```

- [ ] **Step 7: Run the test to verify it passes**

Run: `npx vitest run functions/lib/household.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 8: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add migrations/0011_household.sql functions/lib/household.ts functions/lib/household.test.ts functions/lib/serializers.ts
git commit -m "Household: table, validator, serializer"
```

---

## Task 2: Admin household endpoints

**Files:**
- Create: `functions/api/household/index.ts`
- Create: `functions/api/household/[id].ts`
- Modify: `functions/lib/portal.ts` (add `tenantLeaseIds`, `currentLeaseId`)

**Interfaces:**
- Consumes: `validateHouseholdInput`, `MAX_HOUSEHOLD_MEMBERS`, `serializeHouseholdMember` (Task 1); `requirePermission`, `jsonOk`, `jsonError`, `serverError`, `Env` from `functions/lib/session`.
- Produces: `currentLeaseId(env, tenantId) -> Promise<string | null>`, `tenantLeaseIds(env, tenantId) -> Promise<string[]>` (both in `portal.ts`); admin routes `GET/POST /api/household`, `PUT/DELETE /api/household/:id`.

- [ ] **Step 1: Add the lease-resolution helpers**

In `functions/lib/portal.ts`, add after `tenantIdForUser`:

```ts
/** Every lease id a tenant is on. Used to authorise edits to lease-scoped data. */
export async function tenantLeaseIds(env: Env, tenantId: string): Promise<string[]> {
  const { results } = await env.DB.prepare('SELECT lease_id FROM lease_tenants WHERE tenant_id = ?')
    .bind(tenantId)
    .all<{ lease_id: string }>();
  return (results || []).map(r => r.lease_id);
}

/** The tenant's current lease: most recent one they are on that has not ended. */
export async function currentLeaseId(env: Env, tenantId: string): Promise<string | null> {
  const row = await env.DB.prepare(
    `SELECT l.id FROM leases l
       JOIN lease_tenants lt ON lt.lease_id = l.id
      WHERE lt.tenant_id = ? AND l.status != 'ended'
      ORDER BY l.start_date DESC LIMIT 1`
  )
    .bind(tenantId)
    .first<{ id: string }>();
  return row?.id ?? null;
}
```

- [ ] **Step 2: Write the admin list + create endpoint**

`functions/api/household/index.ts`:

```ts
import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { currentLeaseId } from '../../lib/portal';
import { validateHouseholdInput, MAX_HOUSEHOLD_MEMBERS } from '../../lib/household';
import { serializeHouseholdMember } from '../../lib/serializers';

// GET /api/household?tenantId=... — household of the tenant's current lease.
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'tenants_view');
  if (auth instanceof Response) return auth;

  try {
    const tenantId = new URL(request.url).searchParams.get('tenantId');
    if (!tenantId) return jsonError('A tenant is required', 400);
    const leaseId = await currentLeaseId(env, tenantId);
    if (!leaseId) return jsonOk({ success: true, data: [] });

    const { results } = await env.DB.prepare(
      'SELECT * FROM household_members WHERE lease_id = ? ORDER BY created_at'
    ).bind(leaseId).all();
    return jsonOk({ success: true, data: (results || []).map(serializeHouseholdMember) });
  } catch {
    return serverError();
  }
};

// POST /api/household — add a member to the tenant's current lease.
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'tenants_edit');
  if (auth instanceof Response) return auth;

  try {
    const body = (await request.json()) as { tenantId?: string; name?: unknown; phone?: unknown; relationship?: unknown };
    if (!body.tenantId) return jsonError('A tenant is required', 400);
    const leaseId = await currentLeaseId(env, body.tenantId);
    if (!leaseId) return jsonError('This tenant has no active lease', 400);

    const valid = validateHouseholdInput(body);
    if (!valid.ok) return jsonError(valid.error, 400);

    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM household_members WHERE lease_id = ?')
      .bind(leaseId).first<{ n: number }>();
    if ((count?.n ?? 0) >= MAX_HOUSEHOLD_MEMBERS) {
      return jsonError('This unit already has the maximum number of household members', 400);
    }

    const id = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO household_members (id, lease_id, name, phone, relationship) VALUES (?, ?, ?, ?, ?)'
    ).bind(id, leaseId, valid.value.name, valid.value.phone, valid.value.relationship).run();

    const row = await env.DB.prepare('SELECT * FROM household_members WHERE id = ?').bind(id).first();
    return jsonOk({ success: true, data: serializeHouseholdMember(row as Record<string, unknown>) }, 201);
  } catch {
    return serverError();
  }
};
```

- [ ] **Step 3: Write the admin update + delete endpoint**

`functions/api/household/[id].ts`:

```ts
import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { validateHouseholdInput } from '../../lib/household';
import { serializeHouseholdMember } from '../../lib/serializers';

// PUT /api/household/:id — edit a member.
export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_edit');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const existing = await env.DB.prepare('SELECT id FROM household_members WHERE id = ?').bind(id).first();
    if (!existing) return jsonError('Household member not found', 404);

    const valid = validateHouseholdInput((await request.json()) as Record<string, unknown>);
    if (!valid.ok) return jsonError(valid.error, 400);

    await env.DB.prepare(
      'UPDATE household_members SET name = ?, phone = ?, relationship = ?, updated_at = unixepoch() WHERE id = ?'
    ).bind(valid.value.name, valid.value.phone, valid.value.relationship, id).run();

    const row = await env.DB.prepare('SELECT * FROM household_members WHERE id = ?').bind(id).first();
    return jsonOk({ success: true, data: serializeHouseholdMember(row as Record<string, unknown>) });
  } catch {
    return serverError();
  }
};

// DELETE /api/household/:id — remove a member.
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_edit');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const existing = await env.DB.prepare('SELECT id FROM household_members WHERE id = ?').bind(id).first();
    if (!existing) return jsonError('Household member not found', 404);
    await env.DB.prepare('DELETE FROM household_members WHERE id = ?').bind(id).run();
    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 5: Verify by hand against a local server**

Start the app: `npm run pages:dev` (or the project's existing dev command). With an admin session and a tenant that has an active lease, from the browser devtools console or curl with the session cookie:

```
POST /api/household {"tenantId":"<tid>","name":"Jane Doe","relationship":"spouse"}   -> 201, returns the member
GET  /api/household?tenantId=<tid>                                                    -> array with Jane Doe
PUT  /api/household/<mid> {"name":"Jane D","phone":"555"}                             -> 200, updated
POST /api/household {"tenantId":"<tid>","name":""}                                    -> 400 "A name is required"
DELETE /api/household/<mid>                                                           -> 200; GET no longer lists it
```

Expected: each response as noted.

- [ ] **Step 6: Commit**

```bash
git add functions/lib/portal.ts functions/api/household
git commit -m "Household: admin endpoints"
```

---

## Task 3: Portal household endpoints

**Files:**
- Create: `functions/api/portal/household/index.ts`
- Create: `functions/api/portal/household/[id].ts`

**Interfaces:**
- Consumes: `requireUser`, `jsonOk`, `jsonError`, `serverError`, `Env` from `functions/lib/session`; `tenantIdForUser`, `currentLeaseId`, `tenantLeaseIds` from `functions/lib/portal`; `validateHouseholdInput`, `MAX_HOUSEHOLD_MEMBERS`, `serializeHouseholdMember`.
- Produces: portal routes `GET/POST /api/portal/household`, `PUT/DELETE /api/portal/household/:id`, all scoped to the caller's own lease.

- [ ] **Step 1: Write the portal list + create endpoint**

`functions/api/portal/household/index.ts`:

```ts
import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser, jsonOk, jsonError, serverError } from '../../../lib/session';
import { tenantIdForUser, currentLeaseId } from '../../../lib/portal';
import { validateHouseholdInput, MAX_HOUSEHOLD_MEMBERS } from '../../../lib/household';
import { serializeHouseholdMember } from '../../../lib/serializers';

// GET /api/portal/household — the caller's own current-lease household.
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;

  try {
    const tenantId = await tenantIdForUser(env, auth.id);
    if (!tenantId) return jsonOk({ success: true, data: [] }); // realtors and others: none
    const leaseId = await currentLeaseId(env, tenantId);
    if (!leaseId) return jsonOk({ success: true, data: [] });

    const { results } = await env.DB.prepare(
      'SELECT * FROM household_members WHERE lease_id = ? ORDER BY created_at'
    ).bind(leaseId).all();
    return jsonOk({ success: true, data: (results || []).map(serializeHouseholdMember) });
  } catch {
    return serverError();
  }
};

// POST /api/portal/household — add a member to the caller's current lease.
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;

  try {
    const tenantId = await tenantIdForUser(env, auth.id);
    if (!tenantId) return jsonError('Only a tenant can manage a household', 403);
    const leaseId = await currentLeaseId(env, tenantId);
    if (!leaseId) return jsonError('You have no active lease', 400);

    const valid = validateHouseholdInput((await request.json()) as Record<string, unknown>);
    if (!valid.ok) return jsonError(valid.error, 400);

    const count = await env.DB.prepare('SELECT COUNT(*) AS n FROM household_members WHERE lease_id = ?')
      .bind(leaseId).first<{ n: number }>();
    if ((count?.n ?? 0) >= MAX_HOUSEHOLD_MEMBERS) {
      return jsonError('You have reached the maximum number of household members', 400);
    }

    const id = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO household_members (id, lease_id, name, phone, relationship) VALUES (?, ?, ?, ?, ?)'
    ).bind(id, leaseId, valid.value.name, valid.value.phone, valid.value.relationship).run();

    const row = await env.DB.prepare('SELECT * FROM household_members WHERE id = ?').bind(id).first();
    return jsonOk({ success: true, data: serializeHouseholdMember(row as Record<string, unknown>) }, 201);
  } catch {
    return serverError();
  }
};
```

- [ ] **Step 2: Write the portal update + delete endpoint**

`functions/api/portal/household/[id].ts`:

```ts
import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser, jsonOk, jsonError, serverError } from '../../../lib/session';
import { tenantIdForUser, tenantLeaseIds } from '../../../lib/portal';
import { validateHouseholdInput } from '../../../lib/household';
import { serializeHouseholdMember } from '../../../lib/serializers';

/**
 * Load a member only if it belongs to a lease the caller is on. Returns null
 * both when the member is missing and when it is out of scope, so the caller
 * answers 404 either way and cannot probe which member ids exist.
 */
async function ownMemberLeaseId(env: Env, callerTenantId: string, memberId: string): Promise<string | null> {
  const member = await env.DB.prepare('SELECT lease_id FROM household_members WHERE id = ?')
    .bind(memberId).first<{ lease_id: string }>();
  if (!member) return null;
  const leases = await tenantLeaseIds(env, callerTenantId);
  return leases.includes(member.lease_id) ? member.lease_id : null;
}

// PUT /api/portal/household/:id — edit a member on the caller's own lease.
export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;

  try {
    const tenantId = await tenantIdForUser(env, auth.id);
    if (!tenantId) return jsonError('Household member not found', 404);
    const id = params.id as string;
    if (!(await ownMemberLeaseId(env, tenantId, id))) return jsonError('Household member not found', 404);

    const valid = validateHouseholdInput((await request.json()) as Record<string, unknown>);
    if (!valid.ok) return jsonError(valid.error, 400);

    await env.DB.prepare(
      'UPDATE household_members SET name = ?, phone = ?, relationship = ?, updated_at = unixepoch() WHERE id = ?'
    ).bind(valid.value.name, valid.value.phone, valid.value.relationship, id).run();

    const row = await env.DB.prepare('SELECT * FROM household_members WHERE id = ?').bind(id).first();
    return jsonOk({ success: true, data: serializeHouseholdMember(row as Record<string, unknown>) });
  } catch {
    return serverError();
  }
};

// DELETE /api/portal/household/:id — remove a member on the caller's own lease.
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;

  try {
    const tenantId = await tenantIdForUser(env, auth.id);
    if (!tenantId) return jsonError('Household member not found', 404);
    const id = params.id as string;
    if (!(await ownMemberLeaseId(env, tenantId, id))) return jsonError('Household member not found', 404);

    await env.DB.prepare('DELETE FROM household_members WHERE id = ?').bind(id).run();
    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
```

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Verify isolation by hand**

With two tenant logins A and B on different leases (seed via the admin endpoints or DB), signed in as tenant A:

```
GET    /api/portal/household                          -> only A's lease members
POST   /api/portal/household {"name":"Kid A"}         -> 201, added to A's lease
PUT    /api/portal/household/<B's member id> {...}    -> 404
DELETE /api/portal/household/<B's member id>          -> 404
```

Signed in as a realtor login: `GET /api/portal/household` -> `[]`; `POST` -> 403.

Expected: each as noted; A can never touch B's members.

- [ ] **Step 5: Commit**

```bash
git add functions/api/portal/household
git commit -m "Household: portal endpoints, scoped to the caller's lease"
```

---

## Task 4: Tenant dashboard household card

**Files:**
- Modify: `src/lib/api.ts` (add `HouseholdMember` type and `portalApi.household`)
- Modify: `src/pages/portal/TenantHome.tsx` (add the "Who lives here" card)

**Interfaces:**
- Consumes: portal routes from Task 3; existing `apiRequest`, `API_BASE`, `portalApi`, `Card`, `CardContent`, `Button`, `ConfirmDialog`, `useToast`.
- Produces: `HouseholdMember` type; `portalApi.household.{ list, add, update, remove }`.

- [ ] **Step 1: Add the type and client methods**

In `src/lib/api.ts`, add near the other portal types:

```ts
export interface HouseholdMember {
  id: string;
  leaseId: string;
  name: string;
  phone: string | null;
  relationship: string | null;
  createdAt: number;
}
export interface HouseholdInput {
  name: string;
  phone?: string;
  relationship?: string;
}
```

Inside the `portalApi` object (after `realtorTenant`), add:

```ts
  household: {
    list: (): Promise<HouseholdMember[]> => apiRequest('/portal/household'),
    add: (data: HouseholdInput): Promise<HouseholdMember> =>
      apiRequest('/portal/household', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: HouseholdInput): Promise<HouseholdMember> =>
      apiRequest(`/portal/household/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id: string): Promise<{ success: boolean }> =>
      apiRequest(`/portal/household/${id}`, { method: 'DELETE' }),
  },
```

- [ ] **Step 2: Add the "Who lives here" card to the tenant dashboard**

In `src/pages/portal/TenantHome.tsx`, import the pieces and render a card below the existing content. The card:
- loads `portalApi.household.list()` on mount into `members` state;
- shows each member as `name` with `relationship` and `phone` when present, each with an Edit and a Remove control;
- has an inline add form (name required, phone and relationship optional) that calls `portalApi.household.add` then refreshes the list;
- Remove opens the shared `ConfirmDialog` and calls `portalApi.household.remove` on confirm;
- when `me.lease` is null, renders the copy "Once your lease is active you can add the people living with you." instead of the form.

Concrete component to add and render (place `<HouseholdCard hasLease={!!me?.lease} />` after the last card in the returned JSX):

```tsx
import { useState, useEffect } from 'react';
import { Card, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useToast } from '../../context/ToastContext';
import { portalApi, type HouseholdMember } from '../../lib/api';

function HouseholdCard({ hasLease }: { hasLease: boolean }) {
  const { showToast } = useToast();
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [form, setForm] = useState({ name: '', phone: '', relationship: '' });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [toRemove, setToRemove] = useState<HouseholdMember | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (hasLease) portalApi.household.list().then(setMembers).catch(() => {});
  }, [hasLease]);

  const resetForm = () => { setForm({ name: '', phone: '', relationship: '' }); setEditingId(null); };

  const submit = async () => {
    if (!form.name.trim() || busy) return;
    setBusy(true);
    try {
      if (editingId) await portalApi.household.update(editingId, form);
      else await portalApi.household.add(form);
      setMembers(await portalApi.household.list());
      resetForm();
      showToast('Saved.', 'success');
    } catch (err) {
      showToast((err as Error).message || 'Could not save.', 'error');
    } finally { setBusy(false); }
  };

  const confirmRemove = async () => {
    if (!toRemove) return;
    try {
      await portalApi.household.remove(toRemove.id);
      setMembers(members.filter(m => m.id !== toRemove.id));
      showToast('Removed.', 'success');
    } catch (err) {
      showToast((err as Error).message || 'Could not remove.', 'error');
    } finally { setToRemove(null); }
  };

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <h2 className="font-display text-lg font-medium text-ink">Who lives here</h2>
        {!hasLease ? (
          <p className="text-muted text-sm">Once your lease is active you can add the people living with you.</p>
        ) : (
          <>
            <ul className="space-y-2">
              {members.map(m => (
                <li key={m.id} className="flex items-center justify-between gap-3 border-b border-line pb-2">
                  <div>
                    <p className="text-ink font-medium">{m.name}</p>
                    <p className="text-muted text-sm">
                      {[m.relationship, m.phone].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => { setEditingId(m.id); setForm({ name: m.name, phone: m.phone ?? '', relationship: m.relationship ?? '' }); }}>Edit</Button>
                    <Button variant="outline" size="sm" onClick={() => setToRemove(m)}>Remove</Button>
                  </div>
                </li>
              ))}
              {members.length === 0 && <li className="text-muted text-sm">No one added yet.</li>}
            </ul>
            <div className="grid gap-2 sm:grid-cols-3">
              <input className="rounded-lg border border-line px-3 py-2 text-sm" placeholder="Name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
              <input className="rounded-lg border border-line px-3 py-2 text-sm" placeholder="Relationship" value={form.relationship} onChange={e => setForm({ ...form, relationship: e.target.value })} />
              <input className="rounded-lg border border-line px-3 py-2 text-sm" placeholder="Phone" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div className="flex gap-2">
              <Button size="sm" disabled={!form.name.trim() || busy} onClick={submit}>{editingId ? 'Save changes' : 'Add person'}</Button>
              {editingId && <Button variant="outline" size="sm" onClick={resetForm}>Cancel</Button>}
            </div>
          </>
        )}
      </CardContent>
      <ConfirmDialog
        isOpen={!!toRemove}
        onClose={() => setToRemove(null)}
        onConfirm={confirmRemove}
        title="Remove household member"
        message={`Remove ${toRemove?.name} from the people who live here?`}
        confirmText="Remove"
      />
    </Card>
  );
}
```

Note: move the imports to the top of the file with the existing imports rather than duplicating; keep the `HouseholdCard` definition in the same file, below `TenantHome`.

- [ ] **Step 3: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: typecheck clean, build succeeds.

- [ ] **Step 4: Verify in the browser**

Sign in as a tenant with an active lease. On the dashboard: add a person, see it listed, edit it, remove it (confirm dialog). Sign in as a tenant with no active lease: the card shows the "Once your lease is active" copy and no form.

- [ ] **Step 5: Commit**

```bash
git add src/lib/api.ts src/pages/portal/TenantHome.tsx
git commit -m "Household: tenant dashboard card"
```

---

## Task 5: Admin household card on the tenant page

**Files:**
- Modify: `src/lib/api.ts` (add `householdApi`)
- Modify: `src/pages/TenantDetail.tsx` (add the "Household" card)

**Interfaces:**
- Consumes: admin routes from Task 2; `HouseholdMember`, `HouseholdInput` (Task 4); existing `Card`, `Button`, `ConfirmDialog`, `useToast`, `hasPermission`.
- Produces: `householdApi.{ list, add, update, remove }`.

- [ ] **Step 1: Add the admin client methods**

In `src/lib/api.ts`, add a top-level export near `tenantsApi`:

```ts
export const householdApi = {
  list: (tenantId: string): Promise<HouseholdMember[]> =>
    apiRequest(`/household?tenantId=${encodeURIComponent(tenantId)}`),
  add: (tenantId: string, data: HouseholdInput): Promise<HouseholdMember> =>
    apiRequest('/household', { method: 'POST', body: JSON.stringify({ tenantId, ...data }) }),
  update: (id: string, data: HouseholdInput): Promise<HouseholdMember> =>
    apiRequest(`/household/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  remove: (id: string): Promise<{ success: boolean }> =>
    apiRequest(`/household/${id}`, { method: 'DELETE' }),
};
```

- [ ] **Step 2: Add the admin Household card**

In `src/pages/TenantDetail.tsx`, add a card that mirrors the tenant one but uses `householdApi` with the page's `id` (the tenant id) and gates the add/edit/remove controls on `hasPermission('tenants_edit')`. It loads `householdApi.list(id)` on mount. If the list load returns empty because the tenant has no active lease, the card still shows an empty state; add the copy "This tenant has no active lease, so there is no household to manage." only when the tenant has no active lease (detect via the lease data the page already loads; if the page has no lease object, show that copy and hide the form).

Reuse the same visual structure as `HouseholdCard` from Task 4 (list rows, inline add form, ConfirmDialog). Concrete differences:
- `useState` + `useEffect(() => { householdApi.list(id).then(setMembers).catch(()=>{}); }, [id])`.
- add: `householdApi.add(id, form)`; update: `householdApi.update(editingId, form)`; remove: `householdApi.remove(m.id)`.
- Wrap the add form and the Edit/Remove buttons in `{hasPermission('tenants_edit') && ( ... )}` so a view-only admin sees the roster but no controls.

- [ ] **Step 3: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: typecheck clean, build succeeds.

- [ ] **Step 4: Verify in the browser**

As an admin, open a tenant who has an active lease: see the household the tenant added, add one yourself, confirm it appears on the tenant's own dashboard, edit and remove. Open a tenant with no active lease: the card shows the no-lease copy.

- [ ] **Step 5: Commit**

```bash
git add src/lib/api.ts src/pages/TenantDetail.tsx
git commit -m "Household: admin card on the tenant page"
```

---

## Task 6: userCategory helper

**Files:**
- Create: `src/lib/userCategory.ts`
- Create: `src/lib/userCategory.test.ts`

**Interfaces:**
- Produces: `type UserCategory = 'internal' | 'realtor' | 'tenant'`; `userCategory(roleId: string) -> UserCategory`.

- [ ] **Step 1: Write the failing test**

`src/lib/userCategory.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { userCategory } from './userCategory';

describe('userCategory', () => {
  it('maps the two portal roles', () => {
    expect(userCategory('tenant')).toBe('tenant');
    expect(userCategory('realtor')).toBe('realtor');
  });

  it('treats every other role as internal', () => {
    for (const r of ['super_admin', 'admin', 'manager', 'viewer', 'accountant', 'anything']) {
      expect(userCategory(r)).toBe('internal');
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/lib/userCategory.test.ts`
Expected: FAIL, cannot import `./userCategory`.

- [ ] **Step 3: Write the helper**

`src/lib/userCategory.ts`:

```ts
export type UserCategory = 'internal' | 'realtor' | 'tenant';

/** Which Users-page tab a login belongs to, decided by its role id. */
export function userCategory(roleId: string): UserCategory {
  if (roleId === 'tenant') return 'tenant';
  if (roleId === 'realtor') return 'realtor';
  return 'internal';
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/lib/userCategory.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/userCategory.ts src/lib/userCategory.test.ts
git commit -m "Users tabs: userCategory helper"
```

---

## Task 7: Users page three tabs

**Files:**
- Modify: `src/pages/Users.tsx`

**Interfaces:**
- Consumes: `userCategory`, `UserCategory` (Task 6); existing `users`, `hasPermission`, `filteredUsers` search logic.

- [ ] **Step 1: Add tab state and filtering**

In `src/pages/Users.tsx`:
- Import: `import { userCategory, type UserCategory } from '../lib/userCategory';`
- Add state: `const [tab, setTab] = useState<UserCategory>('internal');`
- Narrow the list to the tab BEFORE the existing search filter. Change the existing `const filteredUsers = users.filter(user => { ...search... })` so its base is `users.filter(u => userCategory(u.roleId) === tab)`. Concretely:

```tsx
const inTab = users.filter(u => userCategory(u.roleId) === tab);
const filteredUsers = inTab.filter(user => {
  // ...keep the existing search predicate body unchanged...
});
```

- [ ] **Step 2: Render the tab switcher with counts**

Above the users table, add:

```tsx
const counts = {
  internal: users.filter(u => userCategory(u.roleId) === 'internal').length,
  realtor: users.filter(u => userCategory(u.roleId) === 'realtor').length,
  tenant: users.filter(u => userCategory(u.roleId) === 'tenant').length,
};
const TABS: { key: UserCategory; label: string }[] = [
  { key: 'internal', label: 'Internal' },
  { key: 'realtor', label: 'Realtors' },
  { key: 'tenant', label: 'Tenants' },
];
```

```tsx
<div className="flex gap-1 border-b border-line mb-4">
  {TABS.map(t => (
    <button
      key={t.key}
      onClick={() => setTab(t.key)}
      className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
        tab === t.key ? 'border-primary text-ink' : 'border-transparent text-muted hover:text-ink'
      }`}
    >
      {t.label} <span className="text-faint">({counts[t.key]})</span>
    </button>
  ))}
</div>
```

- [ ] **Step 3: Scope the Add User button and add a note**

- Wrap the existing "Add User" button so it renders only on the Internal tab: `{tab === 'internal' && ( ...existing Add User button... )}`.
- On the Realtors and Tenants tabs, show a one-line note above the table:

```tsx
{tab === 'tenant' && (
  <p className="text-muted text-sm mb-3">Tenants get portal access by inviting them from their own page.</p>
)}
{tab === 'realtor' && (
  <p className="text-muted text-sm mb-3">Realtors are added by linking them from a tenant's page.</p>
)}
```

- [ ] **Step 4: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: typecheck clean, build succeeds.

- [ ] **Step 5: Verify in the browser**

Open the Users page. Confirm three tabs with correct counts; staff under Internal, an invited tenant under Tenants, a linked realtor under Realtors; search works within a tab; Add User shows only on Internal; the notes show on the other two tabs.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Users.tsx
git commit -m "Users tabs: Internal / Realtors / Tenants"
```

---

## Self-Review

**Spec coverage:**
- Household table (lease-scoped, contact-only, cascade) → Task 1.
- Serializer, validator, limits → Task 1.
- Admin CRUD (Belle adds/edits/removes) → Task 2 + Task 5.
- Portal CRUD scoped to own lease, 404 on out-of-scope, realtors excluded → Task 3.
- Tenant dashboard card → Task 4. Admin card → Task 5.
- Users three tabs, Add User on Internal only, notes on the others → Tasks 6 + 7.
- Realtor scope unchanged → no task touches the realtor endpoints or `serializePortalTenant`; household endpoints return `[]`/403 for realtors (Task 3).

**Placeholder scan:** none — every code step contains full code; UI steps that describe rather than paste (Task 5 admin card) reuse the fully-shown Task 4 component and list only the concrete deltas.

**Type consistency:** `HouseholdMember`/`HouseholdInput` defined in Task 4 and reused in Task 5; `serializeHouseholdMember` shape (`{ id, leaseId, name, phone, relationship, createdAt }`) matches `HouseholdMember`; `validateHouseholdInput` return shape consumed consistently in Tasks 2 and 3; `userCategory`/`UserCategory` defined in Task 6 and used in Task 7.

**Production migration:** after all tasks pass and merge, apply `0011_household.sql` to prod with `npx wrangler d1 migrations apply dunns-rental-db --remote` before the feature is used live.
