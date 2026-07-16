# Tenant and Realtor Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give tenants a login to see and correct their own information, see their lease's payment history, and upload documents; and give realtors time limited access to the tenants they placed.

**Architecture:** A separate `/portal` area with its own layout and its own endpoints under `functions/api/portal/`. Two new roles, `tenant` and `realtor`, carry no management permissions, so the existing `requirePermission` already refuses them everywhere in the management app. Every portal endpoint resolves the caller's own tenant from the session and never trusts a tenant id from the client.

**Tech Stack:** Cloudflare Pages Functions, D1 (SQLite), R2 (documents), React 19, React Router 7, Tailwind v4, Vitest.

## Global Constraints

- **The scoping rule, which is the whole product:** every portal endpoint resolves the caller's reachable tenant ids from the session. A client supplied id is only ever used to filter *within* that resolved set, never to fetch. There is no endpoint where a client id reaches a query unchecked.
- **The window rule:** a realtor's access to a tenant ends 30 days after the tenancy start date, or 30 days after the link was created, whichever is later.
- `tenants.notes` is never returned to, or writable by, a tenant or a realtor.
- Tenants may edit only their own person record. Rent, unit and lease dates are not on that record and must stay unreachable.
- On a shared lease a tenant sees the lease totals (due, paid, balance, status) and never a per person breakdown.
- Every endpoint keeps the auth pattern: `const auth = await requireUser(env, request);` then `if (auth instanceof Response) return auth;`.
- Rows are snake_case in D1, camelCase over the API. Conversion happens ONLY in `functions/lib/serializers.ts`.
- Dates: compare by integer parsing `YYYY-MM-DD`. NEVER `new Date(str)` for date math (UTC midnight reads a day early in America/Chicago). Use `yearOf`/`monthOf` from `src/lib/utils.ts` on the client. Server side, compare ISO date strings directly (they sort correctly) or parse with `Number(s.slice(...))`.
- Money math lives only in `src/lib/rent.ts`. The portal reuses `settleMonth`, `leasesOwingMonth`, `leaseCoversMonth`.
- No dashes as punctuation in user visible copy (no em dash, en dash, hyphen as a break). A lone "—" as an empty cell placeholder is house convention.
- Use `env.DB.batch([...])` for statements that must succeed together.
- Design system only: components in `src/components/ui/`, tokens in `src/index.css`. No new colors or fonts.

## Prerequisites, outside the code

Neither blocks building or local testing. Both block rollout. Belle does these.

1. **R2 is not enabled.** `wrangler.jsonc` has the `DOCS` binding commented out because the bucket does not exist, and every document endpoint returns a friendly 503. Uploads do not work today for anyone. Before rollout: enable R2 on the account, `wrangler r2 bucket create dunns-rental-docs`, and restore the binding `"r2_buckets": [{ "binding": "DOCS", "bucket_name": "dunns-rental-docs" }]`. A binding to a bucket that does not exist fails the deploy at the Function publish step, so create the bucket first.
2. **Resend's sending domain is unverified.** It delivers only to `info@mhdunnproperty.net`, so invites cannot reach a tenant. Verify `mhdunnproperty.net` in Resend (DNS records), then set `MAIL_FROM` to `MH Dunn Property <info@mhdunnproperty.net>`.

## Existing interfaces this builds on

- `functions/lib/session.ts`: `Env` (`DB`, `DOCS?`, `RESEND_API_KEY?`, `MAIL_FROM?`), `SessionUser` (`id`, `email`, `name`, `role`, `permissions`), `requireUser`, `requirePermission`, `jsonOk`, `jsonError`, `unauthorized`, `forbidden`, `serverError`, `hashPassword`, `generateTempPassword`.
- `functions/lib/email.ts`: `sendEmail(env, {to, subject, html, text})` returns false when `RESEND_API_KEY` is unset.
- `password_reset_tokens` (migration 0002): `id`, `user_id`, `token` UNIQUE, `expires_at`, `created_at`, `used_at`. The invite reuses this and the existing `/reset-password` page.
- `documents` (migration 0006): `id`, `name`, `r2_key`, `content_type`, `size`, `property_id`, `tenant_id`, `uploaded_by`, `created_at`. **`uploaded_by` already stores the user id.** No column needs adding.
- `tenants.user_id` exists (migration 0007) and is currently unused. It becomes the person to login link.
- `roles` table (migration 0004): `id`, `name`, `description`, `permissions` (JSON array), `is_system`.
- `src/lib/rent.ts`: `settleMonth(lease, payments, month, year)`, `leaseCoversMonth`, `leasesOwingMonth`.

## File structure

- Create `migrations/0008_portal.sql` — the `tenant_realtors` link table and the two new roles.
- Create `functions/lib/portal.ts` — the access core. Pure rules plus the session to scope resolvers. This is the security boundary; everything else calls it.
- Create `functions/lib/portal.test.ts` — tests for the pure rules.
- Create `functions/api/portal/me.ts` — the tenant's own record and lease (GET, PUT).
- Create `functions/api/portal/payments.ts` — the tenant's lease payment history.
- Create `functions/api/portal/documents/index.ts` — scoped list and upload.
- Create `functions/api/portal/documents/[id].ts` — scoped download.
- Create `functions/api/portal/realtor/tenants/index.ts` — the realtor's tenants.
- Create `functions/api/portal/realtor/tenants/[id].ts` — one tenant, scoped.
- Create `functions/api/tenants/[id]/invite.ts` — admin invites a tenant.
- Create `functions/api/tenants/[id]/realtors.ts` — admin links and unlinks a realtor.
- Create `src/components/PortalLayout/index.tsx` — the portal shell.
- Create `src/pages/portal/TenantHome.tsx`, `TenantPayments.tsx`, `TenantInfo.tsx`, `TenantDocuments.tsx`.
- Create `src/pages/portal/RealtorTenants.tsx`, `RealtorTenantDetail.tsx`.
- Modify `src/App.tsx` — portal routes and the role based landing.
- Modify `src/pages/TenantDetail.tsx` — invite button and realtor linking.
- Modify `functions/lib/serializers.ts` — a portal safe tenant serializer.

---

### Task 1: Migration and the two new roles

**Files:**
- Create: `migrations/0008_portal.sql`

**Interfaces:**
- Produces: the `tenant_realtors` table (`id`, `tenant_id`, `realtor_user_id`, `created_at`) and role rows `tenant` and `realtor`.

- [ ] **Step 1: Write the migration**

```sql
-- Links a realtor's user account to a tenant they placed. Belle creates these
-- by hand from the tenant's page. Access is derived from this row plus the
-- lease start date and the window rule, so nothing here stores an expiry that
-- could drift from the rule.
CREATE TABLE IF NOT EXISTS tenant_realtors (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  realtor_user_id TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  created_at INTEGER DEFAULT (unixepoch()),
  UNIQUE(tenant_id, realtor_user_id)
);

CREATE INDEX IF NOT EXISTS idx_tenant_realtors_tenant ON tenant_realtors(tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_realtors_realtor ON tenant_realtors(realtor_user_id);

-- Portal roles. Both carry an EMPTY permission list on purpose: they must not
-- reach a single management endpoint. Their access comes only from the portal
-- endpoints, which scope every query to the caller. is_system = 1 so they
-- cannot be deleted from Settings.
INSERT OR IGNORE INTO roles (id, name, description, permissions, is_system) VALUES
  ('tenant', 'Tenant', 'Portal only. Sees and edits their own information.', '[]', 1),
  ('realtor', 'Realtor', 'Portal only. Sees tenants they placed, within the access window.', '[]', 1);
```

- [ ] **Step 2: Apply to the local database and confirm**

Run:
```bash
npx wrangler d1 migrations apply dunns-rental-db --local
npx wrangler d1 execute dunns-rental-db --local --command "SELECT id, name, permissions FROM roles WHERE id IN ('tenant','realtor')"
```
Expected: both rows returned, each with `permissions` of `[]`.

**Never `--remote`.** Production is applied at the end, by hand, after review.

- [ ] **Step 3: Commit**

```bash
git add migrations/0008_portal.sql
git commit -m "feat: tenant_realtors link table and the tenant and realtor roles"
```

---

### Task 2: The access rules, as pure tested functions

The window rule is the one piece of portal logic with real arithmetic, so it is
pure and tested rather than buried in a query.

**Files:**
- Create: `functions/lib/portal.ts`
- Create: `functions/lib/portal.test.ts`

**Interfaces:**
- Produces: `realtorAccessEndsOn(leaseStartDate, linkedOnDate): string` and `realtorWindowOpen(leaseStartDate, linkedOnDate, today): boolean`. All parameters are `YYYY-MM-DD` strings.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, it, expect } from 'vitest';
import { realtorAccessEndsOn, realtorWindowOpen } from './portal';

describe('realtorAccessEndsOn', () => {
  it('ends 30 days after move in when the link came first', () => {
    expect(realtorAccessEndsOn('2026-03-01', '2026-02-20')).toBe('2026-03-31');
  });

  // Belle links realtors after the fact, including for tenants who moved in
  // long ago. Without the "whichever is later" half of the rule, linking them
  // would grant nothing at all.
  it('ends 30 days after the link when the link came later', () => {
    expect(realtorAccessEndsOn('2026-01-01', '2026-06-10')).toBe('2026-07-10');
  });

  it('crosses a month boundary correctly', () => {
    expect(realtorAccessEndsOn('2026-01-20', '2026-01-01')).toBe('2026-02-19');
  });

  it('crosses a year boundary correctly', () => {
    expect(realtorAccessEndsOn('2026-12-20', '2026-12-01')).toBe('2027-01-19');
  });
});

describe('realtorWindowOpen', () => {
  it('is open on the move in day', () => {
    expect(realtorWindowOpen('2026-03-01', '2026-03-01', '2026-03-01')).toBe(true);
  });

  it('is open on the last day of the window', () => {
    expect(realtorWindowOpen('2026-03-01', '2026-03-01', '2026-03-31')).toBe(true);
  });

  it('is closed the day after the window', () => {
    expect(realtorWindowOpen('2026-03-01', '2026-03-01', '2026-04-01')).toBe(false);
  });

  it('is open for a late link even though move in was long ago', () => {
    expect(realtorWindowOpen('2026-01-01', '2026-06-10', '2026-07-01')).toBe(true);
  });

  it('is closed once a late link has itself aged out', () => {
    expect(realtorWindowOpen('2026-01-01', '2026-06-10', '2026-07-11')).toBe(false);
  });

  // A lease with no start date cannot anchor a move in, so the link date is
  // the only honest anchor.
  it('falls back to the link date when the lease has no start date', () => {
    expect(realtorWindowOpen(undefined, '2026-06-10', '2026-07-01')).toBe(true);
    expect(realtorWindowOpen(undefined, '2026-06-10', '2026-07-11')).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run functions/lib/portal.test.ts`
Expected: FAIL, "does not provide an export named 'realtorAccessEndsOn'".

- [ ] **Step 3: Implement**

```ts
/** How many days a realtor keeps access after the anchor date. */
const WINDOW_DAYS = 30;

/**
 * Add days to a YYYY-MM-DD date and return YYYY-MM-DD.
 *
 * Date.UTC keeps this off the local clock entirely: we are doing calendar
 * arithmetic on a plain date, not on an instant, so UTC is the safe frame.
 * Parsing with new Date('2026-03-01') would be UTC midnight read back through
 * a local getter, which is the bug that filed expenses a month early.
 */
function addDays(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86400000;
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * The last day a realtor may see a tenant.
 *
 * Thirty days from move in, or thirty days from the link, whichever is later.
 * Belle links realtors after the fact, so anchoring only on move in would mean
 * linking someone who moved in months ago granted nothing.
 */
export function realtorAccessEndsOn(
  leaseStartDate: string | undefined,
  linkedOnDate: string
): string {
  const fromLink = addDays(linkedOnDate, WINDOW_DAYS);
  if (!leaseStartDate) return fromLink;
  const fromMoveIn = addDays(leaseStartDate, WINDOW_DAYS);
  return fromMoveIn > fromLink ? fromMoveIn : fromLink;
}

/** Whether the realtor's window is still open on a given day, inclusive. */
export function realtorWindowOpen(
  leaseStartDate: string | undefined,
  linkedOnDate: string,
  today: string
): boolean {
  return today <= realtorAccessEndsOn(leaseStartDate, linkedOnDate);
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run functions/lib/portal.test.ts`
Expected: PASS, 11 tests.

Then run the whole suite to be sure nothing else moved: `npm test`
Expected: the 35 existing tests plus these.

- [ ] **Step 5: Commit**

```bash
git add functions/lib/portal.ts functions/lib/portal.test.ts
git commit -m "feat: the realtor access window rule, with tests"
```

---

### Task 3: The scope resolvers

Everything a portal endpoint may touch comes from here. No endpoint queries
`tenants`, `documents` or `rent_payments` by a client supplied id directly.

**Files:**
- Modify: `functions/lib/portal.ts`

**Interfaces:**
- Consumes: `Env`, `SessionUser` from `functions/lib/session.ts`; `realtorWindowOpen` from Task 2.
- Produces:
  - `tenantIdForUser(env, userId): Promise<string | null>`
  - `realtorTenantIds(env, userId, today): Promise<string[]>`
  - `reachableTenantIds(env, auth, today): Promise<string[]>`

- [ ] **Step 1: Implement the resolvers**

Append to `functions/lib/portal.ts`:

```ts
import type { Env, SessionUser } from './session';

/** Today as YYYY-MM-DD. The server has no timezone, so callers may pass one. */
export function serverToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/** The tenant record belonging to a login, or null. One user, one tenant. */
export async function tenantIdForUser(env: Env, userId: string): Promise<string | null> {
  const row = await env.DB.prepare('SELECT id FROM tenants WHERE user_id = ?')
    .bind(userId)
    .first<{ id: string }>();
  return row?.id ?? null;
}

/**
 * The tenants a realtor may currently see: linked to them, and still inside
 * the window. The window is anchored on the tenant's most recent lease start,
 * which is what "move in" means for that person.
 */
export async function realtorTenantIds(
  env: Env,
  userId: string,
  today: string
): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT tr.tenant_id AS tenant_id,
            date(tr.created_at, 'unixepoch') AS linked_on,
            (SELECT l.start_date
               FROM leases l
               JOIN lease_tenants lt ON lt.lease_id = l.id
              WHERE lt.tenant_id = tr.tenant_id
              ORDER BY l.start_date DESC
              LIMIT 1) AS lease_start
       FROM tenant_realtors tr
      WHERE tr.realtor_user_id = ?`
  )
    .bind(userId)
    .all<{ tenant_id: string; linked_on: string; lease_start: string | null }>();

  return (results || [])
    .filter(r => realtorWindowOpen(r.lease_start ?? undefined, r.linked_on, today))
    .map(r => r.tenant_id);
}

/**
 * Every tenant id this caller may reach, whoever they are. A tenant reaches
 * exactly themselves. A realtor reaches their linked tenants inside the window.
 * Anyone else reaches nothing through the portal.
 *
 * Endpoints filter within this set. They never fetch by a client supplied id.
 */
export async function reachableTenantIds(
  env: Env,
  auth: SessionUser,
  today: string
): Promise<string[]> {
  if (auth.role === 'tenant') {
    const id = await tenantIdForUser(env, auth.id);
    return id ? [id] : [];
  }
  if (auth.role === 'realtor') {
    return realtorTenantIds(env, auth.id, today);
  }
  return [];
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc -p functions/tsconfig.json`
Expected: no output.

Run: `npm test`
Expected: all tests still pass (the pure rules are untouched).

- [ ] **Step 3: Commit**

```bash
git add functions/lib/portal.ts
git commit -m "feat: portal scope resolvers, the one source of reachable tenants"
```

---

### Task 4: The tenant's own record and lease

**Files:**
- Create: `functions/api/portal/me.ts`
- Modify: `functions/lib/serializers.ts`

**Interfaces:**
- Consumes: `tenantIdForUser`, `serverToday`.
- Produces: `GET /api/portal/me` returning `{ tenant, lease, unit, property }`; `PUT /api/portal/me` updating the person record only.
- Produces: `serializePortalTenant(row)` in serializers, which is `serializeTenant` WITHOUT `notes`.

- [ ] **Step 1: Add the portal safe serializer**

In `functions/lib/serializers.ts`, below `serializeTenant`:

```ts
/**
 * A tenant as the portal may see them. Identical to serializeTenant minus
 * `notes`, which is Belle's private note about the person and is never shown
 * to the tenant or to a realtor.
 */
export function serializePortalTenant(r: Row) {
  const { notes, ...safe } = serializeTenant(r) as Record<string, unknown>;
  void notes;
  return safe;
}
```

- [ ] **Step 2: Implement the endpoint**

```ts
import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser, jsonOk, jsonError, serverError } from '../../lib/session';
import { tenantIdForUser } from '../../lib/portal';
import { serializePortalTenant, serializeLease, serializeUnit, serializeProperty } from '../../lib/serializers';

/** GET /api/portal/me — the caller's own person record, lease, unit, property. */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;
  if (auth.role !== 'tenant') return jsonError('Not a tenant account', 403);

  try {
    const tenantId = await tenantIdForUser(env, auth.id);
    if (!tenantId) return jsonError('No tenant record is linked to this login', 404);

    const tenant = await env.DB.prepare('SELECT * FROM tenants WHERE id = ?').bind(tenantId).first();

    // The tenant's current lease: the most recent one they are on that has not
    // ended. Scoped through lease_tenants, so it can only ever be their own.
    const lease = await env.DB.prepare(
      `SELECT l.* FROM leases l
         JOIN lease_tenants lt ON lt.lease_id = l.id
        WHERE lt.tenant_id = ? AND l.status != 'ended'
        ORDER BY l.start_date DESC LIMIT 1`
    ).bind(tenantId).first();

    const unit = lease?.unit_id
      ? await env.DB.prepare('SELECT * FROM units WHERE id = ?').bind(lease.unit_id).first()
      : null;
    const property = lease?.property_id
      ? await env.DB.prepare('SELECT * FROM properties WHERE id = ?').bind(lease.property_id).first()
      : null;

    return jsonOk({
      success: true,
      data: {
        tenant: serializePortalTenant(tenant as Record<string, unknown>),
        lease: lease ? serializeLease(lease as Record<string, unknown>) : null,
        unit: unit ? serializeUnit(unit as Record<string, unknown>) : null,
        property: property ? serializeProperty(property as Record<string, unknown>) : null,
      },
    });
  } catch {
    return serverError();
  }
};

/**
 * PUT /api/portal/me — the tenant corrects their own details.
 *
 * The column list is the whole security control here. It names only person
 * fields, so rent, unit, lease dates and notes are unreachable no matter what
 * the client sends. The row is chosen by the session, not by the body.
 */
export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;
  if (auth.role !== 'tenant') return jsonError('Not a tenant account', 403);

  try {
    const tenantId = await tenantIdForUser(env, auth.id);
    if (!tenantId) return jsonError('No tenant record is linked to this login', 404);

    const body = (await request.json()) as Record<string, unknown>;
    if (!body.firstName || !body.lastName) {
      return jsonError('First and last name are required', 400);
    }
    const ec = (body.emergencyContact ?? {}) as Record<string, unknown>;

    await env.DB.prepare(
      `UPDATE tenants SET
         first_name = ?, last_name = ?, email = ?, phone = ?,
         emergency_contact_name = ?, emergency_contact_phone = ?,
         emergency_contact_relationship = ?, updated_at = unixepoch()
       WHERE id = ?`
    ).bind(
      body.firstName,
      body.lastName,
      body.email ?? null,
      body.phone ?? null,
      ec.name ?? null,
      ec.phone ?? null,
      ec.relationship ?? null,
      tenantId
    ).run();

    const row = await env.DB.prepare('SELECT * FROM tenants WHERE id = ?').bind(tenantId).first();
    return jsonOk({ success: true, data: serializePortalTenant(row as Record<string, unknown>) });
  } catch {
    return serverError();
  }
};
```

- [ ] **Step 3: Verify**

Run: `npx tsc -p functions/tsconfig.json`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add functions/api/portal/me.ts functions/lib/serializers.ts
git commit -m "feat: portal endpoint for a tenant's own record and lease"
```

---

### Task 5: The tenant's payment history

**Files:**
- Create: `functions/api/portal/payments.ts`

**Interfaces:**
- Consumes: `tenantIdForUser`.
- Produces: `GET /api/portal/payments` returning `{ lease, payments }` where payments carry NO payer attribution.

- [ ] **Step 1: Implement**

```ts
import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser, jsonOk, jsonError, serverError } from '../../lib/session';
import { tenantIdForUser } from '../../lib/portal';
import { serializeLease } from '../../lib/serializers';

/**
 * GET /api/portal/payments — the payment history of the caller's own lease.
 *
 * Belle's decision: on a shared rent a tenant sees the lease totals and never
 * who paid what. So paid_by_tenant_id is not selected at all. It cannot leak
 * through a serializer if it never leaves the database.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;
  if (auth.role !== 'tenant') return jsonError('Not a tenant account', 403);

  try {
    const tenantId = await tenantIdForUser(env, auth.id);
    if (!tenantId) return jsonError('No tenant record is linked to this login', 404);

    const lease = await env.DB.prepare(
      `SELECT l.* FROM leases l
         JOIN lease_tenants lt ON lt.lease_id = l.id
        WHERE lt.tenant_id = ? AND l.status != 'ended'
        ORDER BY l.start_date DESC LIMIT 1`
    ).bind(tenantId).first();

    if (!lease) return jsonOk({ success: true, data: { lease: null, payments: [] } });

    // Only the columns a tenant may see. No payer, no uploaded_by, no notes.
    const { results } = await env.DB.prepare(
      `SELECT amount, due_date, paid_date, status, month, year
         FROM rent_payments
        WHERE lease_id = ?
        ORDER BY year DESC, month DESC`
    ).bind(lease.id).all();

    return jsonOk({
      success: true,
      data: {
        lease: serializeLease(lease as Record<string, unknown>),
        payments: (results || []).map(r => ({
          amount: r.amount,
          dueDate: r.due_date ?? undefined,
          paidDate: r.paid_date ?? undefined,
          status: r.status,
          month: r.month,
          year: r.year,
        })),
      },
    });
  } catch {
    return serverError();
  }
};
```

- [ ] **Step 2: Verify and commit**

Run: `npx tsc -p functions/tsconfig.json` (no output), then:
```bash
git add functions/api/portal/payments.ts
git commit -m "feat: portal payment history, lease totals with no payer attribution"
```

---

### Task 6: Portal documents, scoped

**Files:**
- Create: `functions/api/portal/documents/index.ts`
- Create: `functions/api/portal/documents/[id].ts`

**Interfaces:**
- Consumes: `reachableTenantIds`, `serverToday`.
- Produces: `GET /api/portal/documents?tenantId=`, `POST /api/portal/documents`, `GET /api/portal/documents/:id`.

- [ ] **Step 1: Implement list and upload**

```ts
import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser, jsonOk, jsonError, serverError } from '../../../lib/session';
import { reachableTenantIds, serverToday } from '../../../lib/portal';
import { serializeDoc } from '../../../lib/serializers';

/**
 * GET /api/portal/documents?tenantId=...
 *
 * tenantId is optional and is only ever used to narrow WITHIN the caller's
 * reachable set. An id outside that set yields nothing rather than an error,
 * so the endpoint cannot be used to probe which tenants exist.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;

  try {
    const reachable = await reachableTenantIds(env, auth, serverToday());
    if (reachable.length === 0) return jsonOk({ success: true, data: [] });

    const asked = new URL(request.url).searchParams.get('tenantId');
    const ids = asked ? reachable.filter(id => id === asked) : reachable;
    if (ids.length === 0) return jsonOk({ success: true, data: [] });

    const placeholders = ids.map(() => '?').join(',');
    const { results } = await env.DB.prepare(
      `SELECT * FROM documents WHERE tenant_id IN (${placeholders}) ORDER BY created_at DESC`
    ).bind(...ids).all();

    return jsonOk({ success: true, data: (results || []).map(serializeDoc) });
  } catch {
    return serverError();
  }
};

/**
 * POST /api/portal/documents — multipart upload for a reachable tenant.
 *
 * A tenant may only upload to themselves; a realtor to a tenant inside their
 * window. Both cases fall out of the reachable set, so there is no separate
 * branch to get wrong.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;

  if (!env.DOCS) {
    return jsonError('Document storage is not configured. Create the R2 bucket and bind it as DOCS.', 503);
  }

  try {
    const form = await request.formData();
    const file = form.get('file');
    const askedTenantId = String(form.get('tenantId') || '');
    if (!(file instanceof File)) return jsonError('A file is required', 400);
    if (!askedTenantId) return jsonError('A tenant is required', 400);

    const reachable = await reachableTenantIds(env, auth, serverToday());
    if (!reachable.includes(askedTenantId)) {
      return jsonError('You do not have access to that tenant', 403);
    }

    const id = crypto.randomUUID();
    const key = `tenants/${askedTenantId}/${id}-${file.name}`;
    await env.DOCS.put(key, file.stream(), {
      httpMetadata: { contentType: file.type || 'application/octet-stream' },
    });

    await env.DB.prepare(
      `INSERT INTO documents (id, name, r2_key, content_type, size, property_id, tenant_id, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, file.name, key, file.type || null, file.size, null, askedTenantId, auth.id).run();

    const row = await env.DB.prepare('SELECT * FROM documents WHERE id = ?').bind(id).first();
    return jsonOk({ success: true, data: serializeDoc(row as Record<string, unknown>) }, 201);
  } catch {
    return serverError();
  }
};
```

- [ ] **Step 2: Implement the scoped download**

```ts
import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser, jsonError, serverError } from '../../../lib/session';
import { reachableTenantIds, serverToday } from '../../../lib/portal';

/**
 * GET /api/portal/documents/:id — stream a document the caller may reach.
 *
 * The document is fetched, then its tenant is checked against the caller's
 * reachable set before a single byte is returned. A document belonging to
 * anyone else is a 404, not a 403, so the endpoint does not confirm that some
 * other tenant's document exists.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;
  if (!env.DOCS) return jsonError('Document storage is not configured', 503);

  try {
    const meta = await env.DB.prepare('SELECT * FROM documents WHERE id = ?')
      .bind(params.id as string)
      .first<{ r2_key: string; name: string; content_type: string | null; tenant_id: string | null }>();
    if (!meta) return jsonError('Document not found', 404);

    const reachable = await reachableTenantIds(env, auth, serverToday());
    if (!meta.tenant_id || !reachable.includes(meta.tenant_id)) {
      return jsonError('Document not found', 404);
    }

    const object = await env.DOCS.get(meta.r2_key);
    if (!object) return jsonError('Document not found', 404);

    return new Response(object.body as unknown as BodyInit, {
      headers: {
        'Content-Type': meta.content_type || 'application/octet-stream',
        'Content-Disposition': `inline; filename="${meta.name}"`,
      },
    });
  } catch {
    return serverError();
  }
};
```

- [ ] **Step 3: Verify and commit**

Run: `npx tsc -p functions/tsconfig.json` (no output).
```bash
git add functions/api/portal/documents/
git commit -m "feat: portal documents, scoped to the caller's reachable tenants"
```

---

### Task 7: The realtor's tenants

**Files:**
- Create: `functions/api/portal/realtor/tenants/index.ts`
- Create: `functions/api/portal/realtor/tenants/[id].ts`

**Interfaces:**
- Consumes: `realtorTenantIds`, `serverToday`, `serializePortalTenant`.
- Produces: `GET /api/portal/realtor/tenants`, `GET /api/portal/realtor/tenants/:id`.

- [ ] **Step 1: Implement the list**

```ts
import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser, jsonOk, jsonError, serverError } from '../../../../lib/session';
import { realtorTenantIds, serverToday } from '../../../../lib/portal';
import { serializePortalTenant } from '../../../../lib/serializers';

/** GET /api/portal/realtor/tenants — the realtor's tenants, inside the window. */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;
  if (auth.role !== 'realtor') return jsonError('Not a realtor account', 403);

  try {
    const ids = await realtorTenantIds(env, auth.id, serverToday());
    if (ids.length === 0) return jsonOk({ success: true, data: [] });

    const placeholders = ids.map(() => '?').join(',');
    const { results } = await env.DB.prepare(
      `SELECT t.*,
              (SELECT u.unit_number FROM units u
                 JOIN leases l ON l.unit_id = u.id
                 JOIN lease_tenants lt ON lt.lease_id = l.id
                WHERE lt.tenant_id = t.id
                ORDER BY l.start_date DESC LIMIT 1) AS unit_number
         FROM tenants t
        WHERE t.id IN (${placeholders})
        ORDER BY t.last_name, t.first_name`
    ).bind(...ids).all();

    return jsonOk({
      success: true,
      data: (results || []).map(r => ({
        ...serializePortalTenant(r as Record<string, unknown>),
        unitNumber: (r as Record<string, unknown>).unit_number ?? undefined,
      })),
    });
  } catch {
    return serverError();
  }
};
```

- [ ] **Step 2: Implement the single tenant view**

```ts
import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser, jsonOk, jsonError, serverError } from '../../../../lib/session';
import { realtorTenantIds, serverToday } from '../../../../lib/portal';
import { serializePortalTenant } from '../../../../lib/serializers';

/**
 * GET /api/portal/realtor/tenants/:id
 *
 * A tenant outside the realtor's window, or never linked to them, is a 404.
 * Same shape as the document rule: do not confirm that other tenants exist.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;
  if (auth.role !== 'realtor') return jsonError('Not a realtor account', 403);

  try {
    const id = params.id as string;
    const ids = await realtorTenantIds(env, auth.id, serverToday());
    if (!ids.includes(id)) return jsonError('Tenant not found', 404);

    const row = await env.DB.prepare('SELECT * FROM tenants WHERE id = ?').bind(id).first();
    if (!row) return jsonError('Tenant not found', 404);

    return jsonOk({ success: true, data: serializePortalTenant(row as Record<string, unknown>) });
  } catch {
    return serverError();
  }
};
```

- [ ] **Step 3: Verify and commit**

Run: `npx tsc -p functions/tsconfig.json` (no output).
```bash
git add functions/api/portal/realtor/
git commit -m "feat: realtor endpoints, scoped to linked tenants inside the window"
```

---

### Task 8: Admin invites a tenant, and links a realtor

**Files:**
- Create: `functions/api/tenants/[id]/invite.ts`
- Create: `functions/api/tenants/[id]/realtors.ts`
- Modify: `functions/lib/email.ts`

**Interfaces:**
- Consumes: `requirePermission`, `hashPassword`, `generateTempPassword`, `sendEmail`.
- Produces: `POST /api/tenants/:id/invite`; `GET|POST|DELETE /api/tenants/:id/realtors`; `portalInviteEmail(inviteUrl, name)`.

- [ ] **Step 1: Add the invite email**

In `functions/lib/email.ts`, alongside `passwordResetEmail`:

```ts
export function portalInviteEmail(inviteUrl: string, name?: string) {
  const greeting = name ? `Hi ${name},` : 'Hi,';
  return {
    subject: 'Your MH Dunn Property account',
    text: `${greeting}

MH Dunn Property has set up an account for you. You can see your lease, your rent history, and your documents, and you can correct your own details.

Set your password here: ${inviteUrl}

This link expires in 7 days.

MH Dunn Property`,
    html: `<p>${greeting}</p>
<p>MH Dunn Property has set up an account for you. You can see your lease, your rent history, and your documents, and you can correct your own details.</p>
<p><a href="${inviteUrl}">Set your password</a></p>
<p>This link expires in 7 days.</p>
<p>MH Dunn Property</p>`,
  };
}
```

- [ ] **Step 2: Implement the invite endpoint**

```ts
import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError, hashPassword, generateTempPassword } from '../../../lib/session';
import { sendEmail, portalInviteEmail } from '../../../lib/email';

const SEVEN_DAYS = 7 * 24 * 60 * 60;

/**
 * POST /api/tenants/:id/invite — give a tenant a portal login.
 *
 * Creates the user with the tenant role and an unguessable random password the
 * tenant never learns, links it to the tenant record, then emails a set
 * password link. The token reuses password_reset_tokens and the existing
 * /reset-password page, so there is one password setting flow, not two.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_edit');
  if (auth instanceof Response) return auth;

  try {
    const tenantId = params.id as string;
    const tenant = await env.DB.prepare('SELECT * FROM tenants WHERE id = ?')
      .bind(tenantId)
      .first<{ id: string; email: string | null; first_name: string; last_name: string; user_id: string | null }>();
    if (!tenant) return jsonError('Tenant not found', 404);
    if (!tenant.email) return jsonError('This tenant has no email address to invite', 400);
    if (tenant.user_id) return jsonError('This tenant already has a login', 400);

    const existing = await env.DB.prepare('SELECT id FROM user WHERE email = ?')
      .bind(tenant.email)
      .first();
    if (existing) return jsonError('Someone already uses that email address', 400);

    const userId = crypto.randomUUID();
    const name = `${tenant.first_name} ${tenant.last_name}`.trim();
    const passwordHash = await hashPassword(generateTempPassword());
    const token = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '');
    const now = Math.floor(Date.now() / 1000);

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO user (id, email, name, password_hash, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, 1, unixepoch(), unixepoch())`
      ).bind(userId, tenant.email, name, passwordHash),
      env.DB.prepare('INSERT INTO user_roles (user_id, role_id) VALUES (?, ?)').bind(userId, 'tenant'),
      env.DB.prepare('UPDATE tenants SET user_id = ?, updated_at = unixepoch() WHERE id = ?').bind(userId, tenantId),
      env.DB.prepare(
        'INSERT INTO password_reset_tokens (id, user_id, token, expires_at, created_at) VALUES (?, ?, ?, ?, ?)'
      ).bind(crypto.randomUUID(), userId, token, now + SEVEN_DAYS, now),
    ]);

    const inviteUrl = `${new URL(request.url).origin}/reset-password?token=${token}`;
    const mail = portalInviteEmail(inviteUrl, tenant.first_name);
    const sent = await sendEmail(env, { to: tenant.email, ...mail });

    // When mail is not configured the account still exists, so hand the link
    // back rather than stranding the tenant.
    return jsonOk({ success: true, data: { emailSent: sent, inviteUrl: sent ? undefined : inviteUrl } });
  } catch {
    return serverError();
  }
};
```

- [ ] **Step 3: Implement realtor linking**

```ts
import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../lib/session';
import { realtorAccessEndsOn } from '../../../lib/portal';

/** GET /api/tenants/:id/realtors — who is linked, and when their access ends. */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_view');
  if (auth instanceof Response) return auth;

  try {
    const tenantId = params.id as string;
    const { results } = await env.DB.prepare(
      `SELECT tr.id, tr.realtor_user_id, u.name, u.email,
              date(tr.created_at, 'unixepoch') AS linked_on,
              (SELECT l.start_date FROM leases l
                 JOIN lease_tenants lt ON lt.lease_id = l.id
                WHERE lt.tenant_id = tr.tenant_id
                ORDER BY l.start_date DESC LIMIT 1) AS lease_start
         FROM tenant_realtors tr
         JOIN user u ON u.id = tr.realtor_user_id
        WHERE tr.tenant_id = ?`
    ).bind(tenantId).all<{ id: string; realtor_user_id: string; name: string; email: string; linked_on: string; lease_start: string | null }>();

    return jsonOk({
      success: true,
      data: (results || []).map(r => ({
        id: r.id,
        realtorUserId: r.realtor_user_id,
        name: r.name,
        email: r.email,
        linkedOn: r.linked_on,
        accessEndsOn: realtorAccessEndsOn(r.lease_start ?? undefined, r.linked_on),
      })),
    });
  } catch {
    return serverError();
  }
};

/** POST /api/tenants/:id/realtors — link a realtor. Body: { realtorUserId }. */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_edit');
  if (auth instanceof Response) return auth;

  try {
    const tenantId = params.id as string;
    const body = (await request.json()) as { realtorUserId?: string };
    if (!body.realtorUserId) return jsonError('A realtor is required', 400);

    const realtor = await env.DB.prepare(
      `SELECT u.id FROM user u
         JOIN user_roles ur ON ur.user_id = u.id
        WHERE u.id = ? AND ur.role_id = 'realtor'`
    ).bind(body.realtorUserId).first();
    if (!realtor) return jsonError('That user is not a realtor', 400);

    await env.DB.prepare(
      'INSERT OR IGNORE INTO tenant_realtors (id, tenant_id, realtor_user_id) VALUES (?, ?, ?)'
    ).bind(crypto.randomUUID(), tenantId, body.realtorUserId).run();

    return jsonOk({ success: true }, 201);
  } catch {
    return serverError();
  }
};

/** DELETE /api/tenants/:id/realtors?realtorUserId=... — unlink immediately. */
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_edit');
  if (auth instanceof Response) return auth;

  try {
    const realtorUserId = new URL(request.url).searchParams.get('realtorUserId');
    if (!realtorUserId) return jsonError('A realtor is required', 400);
    await env.DB.prepare('DELETE FROM tenant_realtors WHERE tenant_id = ? AND realtor_user_id = ?')
      .bind(params.id as string, realtorUserId)
      .run();
    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
```

- [ ] **Step 4: Verify and commit**

Run: `npx tsc -p functions/tsconfig.json` (no output).
```bash
git add functions/api/tenants/ functions/lib/email.ts
git commit -m "feat: invite a tenant to the portal, and link realtors to a tenant"
```

---

### Task 9: The portal shell and the role based landing

**Files:**
- Create: `src/components/PortalLayout/index.tsx`
- Modify: `src/App.tsx`
- Modify: `src/types/index.ts`
- Modify: `src/lib/api.ts`

**Interfaces:**
- Produces: `PortalLayout`, the `/portal` routes, `portalApi` client, and `isPortalRole(role)`.

- [ ] **Step 1: Add the types and API client**

In `src/types/index.ts`:

```ts
/** Roles that belong in the portal and must never reach the management app. */
export const PORTAL_ROLES = ['tenant', 'realtor'] as const;

export function isPortalRole(roleId?: string): boolean {
  return roleId === 'tenant' || roleId === 'realtor';
}

export interface PortalPayment {
  amount: number;
  dueDate?: string;
  paidDate?: string;
  status: 'paid' | 'pending' | 'overdue' | 'partial';
  month: number;
  year: number;
}
```

In `src/lib/api.ts`, following the shape of the existing clients:

```ts
export const portalApi = {
  me: () => apiRequest('/api/portal/me'),
  updateMe: (data: unknown) => apiRequest('/api/portal/me', { method: 'PUT', body: JSON.stringify(data) }),
  payments: () => apiRequest('/api/portal/payments'),
  documents: (tenantId?: string) =>
    apiRequest(`/api/portal/documents${tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : ''}`),
  realtorTenants: () => apiRequest('/api/portal/realtor/tenants'),
  realtorTenant: (id: string) => apiRequest(`/api/portal/realtor/tenants/${id}`),
};
```

- [ ] **Step 2: Build the portal shell**

`src/components/PortalLayout/index.tsx`: a simple top bar with the MH Dunn logo, the signed in name, a Sign out button, and tabs. Tenant tabs: Home, Payments, My information, Documents. Realtor tabs: My tenants. Use `bg-canvas`, `bg-surface`, `border-line` and the existing `Button`. It does NOT import the management `Layout` or `AppContext`.

- [ ] **Step 3: Route the portal and keep the two worlds apart**

In `src/App.tsx`, add a guard beside `ProtectedRoute`:

```tsx
/**
 * The portal wall on the client. The real wall is server side: tenant and
 * realtor roles hold no permissions, so requirePermission refuses them on every
 * management endpoint. This only stops them loading a page that would show them
 * nothing but errors.
 */
function PortalRoute({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, user } = useAuth();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (!isPortalRole(user?.role.id)) return <Navigate to="/" replace />;
  return <>{children}</>;
}
```

Update `RootRoute` so a portal user never lands on the dashboard:

```tsx
function RootRoute() {
  const { isAuthenticated, user } = useAuth();
  if (!isAuthenticated) return <Home />;
  if (isPortalRole(user?.role.id)) return <Navigate to="/portal" replace />;
  return <Layout><Dashboard /></Layout>;
}
```

Add the routes:

```tsx
<Route path="/portal" element={<PortalRoute><PortalLayout><PortalIndex /></PortalLayout></PortalRoute>} />
<Route path="/portal/payments" element={<PortalRoute><PortalLayout><TenantPayments /></PortalLayout></PortalRoute>} />
<Route path="/portal/information" element={<PortalRoute><PortalLayout><TenantInfo /></PortalLayout></PortalRoute>} />
<Route path="/portal/documents" element={<PortalRoute><PortalLayout><TenantDocuments /></PortalLayout></PortalRoute>} />
<Route path="/portal/tenants/:id" element={<PortalRoute><PortalLayout><RealtorTenantDetail /></PortalLayout></PortalRoute>} />
```

`PortalIndex` renders `TenantHome` for a tenant and `RealtorTenants` for a realtor.

Also add `ProtectedRoute` a portal bounce, so a tenant who deep links to `/rents` is sent to the portal rather than to the dashboard:

```tsx
if (isPortalRole(user?.role.id)) return <Navigate to="/portal" replace />;
```

- [ ] **Step 4: Verify and commit**

Run: `npx tsc -b` (no output) and `npm run build` (green).
```bash
git add src/components/PortalLayout src/App.tsx src/types/index.ts src/lib/api.ts
git commit -m "feat: the portal shell, its routes, and the role based landing"
```

---

### Task 10: The tenant's pages

**Files:**
- Create: `src/pages/portal/TenantHome.tsx`, `src/pages/portal/TenantPayments.tsx`, `src/pages/portal/TenantInfo.tsx`, `src/pages/portal/TenantDocuments.tsx`

- [ ] **Step 1: TenantHome**

Calls `portalApi.me()`. Shows the unit and property, the lease term, the monthly rent, and this month's status via `settleMonth` from `src/lib/rent.ts`. All hooks before any early return: this app has already had a React #310 white screen from a `useMemo` after a return.

- [ ] **Step 2: TenantPayments**

Calls `portalApi.payments()`. A table of month, rent due, paid, balance and status, newest first. Figures come from `settleMonth`. No payer column: on a shared lease a tenant never sees who paid what.

- [ ] **Step 3: TenantInfo**

Calls `portalApi.me()`, renders a form over the person fields (first name, last name, email, phone, emergency contact name, phone, relationship) and saves with `portalApi.updateMe()`. No rent, unit, lease or notes field exists on this form because none of them is on the record.

- [ ] **Step 4: TenantDocuments**

Calls `portalApi.documents()`, lists them with a download link to `/api/portal/documents/:id`, and offers an upload posting multipart to `/api/portal/documents` with `tenantId`. Guard the submit with a `useRef` set synchronously and cleared in a `finally`; a `useState` guard lands too late and a double click uploads twice.

Include the disclosure verbatim:

> Documents you upload can be seen by the realtor who placed you, for the first 30 days of your tenancy.

- [ ] **Step 5: Verify and commit**

Run: `npx tsc -b` and `npm run build`.
```bash
git add src/pages/portal
git commit -m "feat: the tenant's portal pages"
```

---

### Task 11: The realtor's pages, and the admin controls

**Files:**
- Create: `src/pages/portal/RealtorTenants.tsx`, `src/pages/portal/RealtorTenantDetail.tsx`
- Modify: `src/pages/TenantDetail.tsx`

- [ ] **Step 1: RealtorTenants**

Calls `portalApi.realtorTenants()`. A list of the realtor's tenants with the unit they were placed in, each linking to the detail page. When the list is empty say so plainly, and explain why:

> No tenants to show. Access to a tenant ends 30 days after they move in.

- [ ] **Step 2: RealtorTenantDetail**

Calls `portalApi.realtorTenant(id)` and `portalApi.documents(id)`. Shows the tenant's details read only, lists their documents with download links, and offers an upload. No edit controls at all: a realtor may view and upload, nothing more.

- [ ] **Step 3: The admin controls on the tenant page**

In `src/pages/TenantDetail.tsx` add a Portal access card, visible with `tenants_edit`:
- If the tenant has no login: an Invite to portal button posting to `/api/tenants/:id/invite`. On success toast "Invite sent". If the response carries an `inviteUrl` (mail not configured), show it so Belle can pass it on.
- Realtors: the list from `GET /api/tenants/:id/realtors` showing each name and "Access ends on {accessEndsOn}", a picker of users with the realtor role to link, and a Remove control per row.

- [ ] **Step 4: Verify and commit**

Run: `npx tsc -b` and `npm run build`.
```bash
git add src/pages/portal src/pages/TenantDetail.tsx
git commit -m "feat: the realtor's pages, and portal controls on the tenant page"
```

---

### Task 12: Verify the walls by hand, then ship

**Files:** none. This is verification.

The scoping is the product, so it is exercised against a real local server with
real accounts rather than reasoned about.

- [ ] **Step 1: Stand up a local server with real data**

```bash
npm run build
npx wrangler pages dev dist --port 8790 --compatibility-date 2025-05-20
```
Register a staff account, add a property, a unit, two tenants on separate leases (call them A and B), and a rent payment. Never `--remote`.

- [ ] **Step 2: Prove a tenant cannot reach another tenant**

Invite tenant A, set their password, sign in as A. Then, signed in as A:

```bash
# A's own record: expect 200
curl -s -b cookies.txt http://localhost:8790/api/portal/me
# B's documents by id: expect an empty list, never B's files
curl -s -b cookies.txt "http://localhost:8790/api/portal/documents?tenantId=<B_ID>"
# A management endpoint: expect 403
curl -s -o /dev/null -w "%{http_code}\n" -b cookies.txt http://localhost:8790/api/tenants
# B's document by id: expect 404
curl -s -o /dev/null -w "%{http_code}\n" -b cookies.txt http://localhost:8790/api/portal/documents/<B_DOC_ID>
```
Expected: `/api/tenants` is 403 because the tenant role holds no permissions. B's document is 404. B's documents list is empty.

- [ ] **Step 2b: Prove a tenant cannot change what they must not**

PUT `/api/portal/me` with `{"firstName":"A","lastName":"A","monthlyRent":1,"notes":"x","unitId":"..."}`. Then check the database:
```bash
npx wrangler d1 execute dunns-rental-db --local --command "SELECT notes FROM tenants WHERE id = '<A_ID>'"
```
Expected: `notes` unchanged, no rent or unit altered anywhere. The extra keys are ignored because the UPDATE names only person columns.

- [ ] **Step 3: Prove the realtor window**

Create a realtor user, link them to tenant A. Sign in as the realtor: A appears. Then age the link past the window and confirm A disappears:
```bash
npx wrangler d1 execute dunns-rental-db --local --command "UPDATE tenant_realtors SET created_at = unixepoch() - (60*86400) WHERE tenant_id = '<A_ID>'"
npx wrangler d1 execute dunns-rental-db --local --command "UPDATE leases SET start_date = '2020-01-01' WHERE id = '<A_LEASE_ID>'"
```
Reload the realtor's page. Expected: the list is empty, and `GET /api/portal/realtor/tenants/<A_ID>` is 404.

- [ ] **Step 4: Prove staff are unaffected**

Sign in as staff. The Dashboard, Rent Management, Reports and Tax Report show the same figures as before this branch. A staff member visiting `/portal` is sent to the dashboard.

- [ ] **Step 5: Full check and the final review**

```bash
npx tsc -b && npm run build && npm test
```
Expected: clean, green, and all tests passing.

- [ ] **Step 6: Ship**

Prerequisites first, both Belle's to do: create the R2 bucket and restore the `DOCS` binding, and verify `mhdunnproperty.net` in Resend. Then:

```bash
npx wrangler d1 migrations apply dunns-rental-db --remote
```
Confirm 0008 applies and that `roles` now holds `tenant` and `realtor`. Then merge to `main` and push, which deploys.

---

## Self-review

**Spec coverage.** Separate portal area: Tasks 9, 10, 11. Invited by email: Task 8. Tenant edits everything about themselves: Task 4, with `notes` excluded there and in the serializer. Lease totals with no payer: Task 5, enforced by not selecting the column. Realtor linked after the fact: Task 8. Window lapses: Tasks 2, 3. Realtor sees everything on the tenant: Tasks 6, 7. Realtor view and upload only: Tasks 6, 7, 11. Disclosure: Task 10. Tested rules: Task 2 for the arithmetic, Task 12 for the walls. Prerequisites: recorded up front and in Task 12.

**Gap found and closed.** The spec said to add `documents.uploaded_by_user_id`. The column already exists as `uploaded_by` and already stores the user id, so no migration touches `documents`. The spec is wrong on that detail; this plan is right.

**Honest limit.** This project has no integration harness for Pages Functions plus D1, so the cross tenant rules are proven by hand in Task 12 against a real local server rather than by automated tests. Only the window arithmetic is unit tested. Adding a Workers test pool would be a larger project than the portal itself and is not attempted here.
