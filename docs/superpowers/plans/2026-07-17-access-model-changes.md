# Access Model Changes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restrict tenants to view + add only, let realtors (and admins on their behalf) create tenants, and give Super Admin an unrestricted force-delete that purges financial history.

**Architecture:** Tenant write endpoints are removed (not hidden). A shared `createTenantForRealtor` helper backs both the realtor portal add and the admin add-for-realtor. The two delete endpoints branch on `auth.role === 'super_admin'` to purge history and override guards; everyone else keeps today's behavior.

**Tech Stack:** Cloudflare Pages Functions + D1 (SQLite), React 19 + TypeScript + Vite + Tailwind, Vitest. No schema changes.

## Global Constraints

- **No dashes** (em, en, or hyphen-as-a-break) in any user-visible copy. Use commas, periods, colons. Belle's standing rule.
- Tenants are **view + add only**: they may view everything, add a household member, and upload a document. No editing their profile, no editing or removing household members. The edit/remove endpoints are deleted, not merely hidden.
- Realtor add-tenant **always creates a brand-new tenant record; it never looks up or attaches to an existing tenant** (a security rule).
- Force-delete and history purge are gated **strictly on `auth.role === 'super_admin'` inside the endpoint**, never on a client-supplied flag. Admin and Manager keep today's guarded behavior.
- On a Super Admin user force-delete, **Properties owned by the target are reassigned to the acting Super Admin** (never deleted); only expenses/incomes (financial history) are purged.
- The admin add-for-realtor endpoint is gated on `tenants_create` and must validate the target id is an active `realtor`-role user.
- No database schema changes.
- Automated tests cover pure logic (`validateTenantContact`); endpoints and UI are verified by hand, consistent with the rest of this project (no Pages+D1 integration harness).

---

## File Structure

**Part 1 — Tenant lockdown**
- `functions/api/portal/me.ts` — remove the `onRequestPut` handler.
- `functions/api/portal/household/[id].ts` — delete the file (removes portal PUT/DELETE).
- `src/pages/portal/TenantInfo.tsx` — read-only.
- `src/pages/portal/TenantHome.tsx` — household card add-only.
- `src/lib/api.ts` — drop `portalApi.updateMe`, `portalApi.household.update`, `portalApi.household.remove`.

**Part 2 — Realtor add tenant**
- `functions/lib/realtorTenants.ts` — `validateTenantContact` + `createTenantForRealtor` (new).
- `functions/lib/realtorTenants.test.ts` — validator test (new).
- `functions/api/portal/realtor/tenants/index.ts` — add `onRequestPost`.
- `src/pages/portal/RealtorTenants.tsx` — Add tenant form.
- `src/lib/api.ts` — `portalApi.addRealtorTenant`.

**Part 3 — Admin add tenant for realtor**
- `functions/api/realtors/[id]/tenants.ts` — admin POST (new).
- `src/pages/Users.tsx` — Add-tenant action on the Realtors tab.
- `src/lib/api.ts` — `realtorsApi.addTenant`.

**Part 4 — Super Admin force-delete**
- `functions/api/tenants/[id].ts` — DELETE purges payments for super admin.
- `functions/api/admin/users/[id].ts` — DELETE force path for super admin.
- `src/pages/TenantDetail.tsx` — add a Delete-tenant control with super-admin-aware copy.
- `src/pages/Users.tsx` — super-admin-aware user-delete copy.

---

## Task 1: Tenant backend lockdown

**Files:**
- Modify: `functions/api/portal/me.ts` (remove `onRequestPut`)
- Delete: `functions/api/portal/household/[id].ts`

**Interfaces:**
- Produces: `PUT /api/portal/me` no longer exists; `PUT`/`DELETE /api/portal/household/:id` no longer exist.

- [ ] **Step 1: Remove the tenant self-edit handler**

In `functions/api/portal/me.ts`, delete the entire `export const onRequestPut ...` block (from the `/** PUT /api/portal/me ... */` comment through its closing `};`). Keep `onRequestGet` and the imports it still uses. After removal, `serializePortalTenant` is still used by `onRequestGet`, so leave that import.

- [ ] **Step 2: Delete the portal household edit/remove endpoint**

Run: `git rm functions/api/portal/household/[id].ts`

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. (If `serializePortalTenant` or any import becomes unused in `me.ts`, remove that specific import to satisfy the compiler.)

- [ ] **Step 4: Commit**

```bash
git add functions/api/portal/me.ts
git commit -m "Tenant lockdown: remove portal self-edit and household edit/remove endpoints"
```

---

## Task 2: Tenant frontend lockdown

**Files:**
- Modify: `src/pages/portal/TenantInfo.tsx` (read-only)
- Modify: `src/pages/portal/TenantHome.tsx` (household add-only)
- Modify: `src/lib/api.ts` (drop unused portal write methods)

**Interfaces:**
- Consumes: nothing new. Removes calls to `portalApi.updateMe`, `portalApi.household.update`, `portalApi.household.remove`.

- [ ] **Step 1: Make TenantInfo read-only**

In `src/pages/portal/TenantInfo.tsx`: remove the `<form onSubmit={handleSubmit}>`, the editable inputs, the Save button, the `handleSubmit`/`saving` state, and the `portalApi.updateMe(...)` call. Render the tenant's fields (first name, last name, email, phone, emergency contact) as static read-only rows using the same labels and layout the form used. Keep the page's data loading (`portalApi.me()` or whatever it currently uses). Add a short line at the top of the details card: "To update your details, please contact us." (no dashes).

- [ ] **Step 2: Make the household card add-only**

In `src/pages/portal/TenantHome.tsx`, in the `HouseholdCard` component: remove the per-row **Edit** and **Remove** buttons, the `editingId`, `toRemove`, and edit/remove handlers, the `ConfirmDialog`, and any calls to `portalApi.household.update` / `portalApi.household.remove`. Keep: the members list (name, relationship, phone) with no action buttons, and the add form calling `portalApi.household.add`. The card still shows the "Once your lease is active you can add the people living with you." copy when there is no lease.

- [ ] **Step 3: Drop the now-unused client methods**

In `src/lib/api.ts`: remove `updateMe` from `portalApi`, and remove `update` and `remove` from `portalApi.household` (keep `portalApi.household.list` and `.add`). Leave `householdApi` (admin) untouched.

- [ ] **Step 4: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: typecheck clean, build succeeds (ignore the pre-existing "chunks larger than 500 kB" warning). If the compiler flags an unused import in either page, remove that specific import.

- [ ] **Step 5: Commit**

```bash
git add src/pages/portal/TenantInfo.tsx src/pages/portal/TenantHome.tsx src/lib/api.ts
git commit -m "Tenant lockdown: read-only profile and add-only household in the portal"
```

---

## Task 3: Realtor-tenant creation helper

**Files:**
- Create: `functions/lib/realtorTenants.ts`
- Create: `functions/lib/realtorTenants.test.ts`

**Interfaces:**
- Consumes: `Env` from `functions/lib/session`.
- Produces:
  - `interface TenantContactInput { firstName: string; lastName: string; email: string | null; phone: string | null }`
  - `validateTenantContact(body) -> { ok: true; value: TenantContactInput } | { ok: false; error: string }`
  - `createTenantForRealtor(env, realtorUserId: string, value: TenantContactInput) -> Promise<Record<string, unknown>>` (returns the newly created `tenants` row)

- [ ] **Step 1: Write the failing validator test**

`functions/lib/realtorTenants.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { validateTenantContact, MAX_CONTACT_FIELD } from './realtorTenants';

describe('validateTenantContact', () => {
  it('accepts first and last name, trims, nulls blank optional fields', () => {
    const r = validateTenantContact({ firstName: '  Jane ', lastName: 'Doe ', email: '', phone: ' 555 ' });
    expect(r).toEqual({ ok: true, value: { firstName: 'Jane', lastName: 'Doe', email: null, phone: '555' } });
  });

  it('requires both first and last name', () => {
    expect(validateTenantContact({ firstName: 'Jane' })).toEqual({ ok: false, error: 'First and last name are required' });
    expect(validateTenantContact({ lastName: 'Doe' })).toEqual({ ok: false, error: 'First and last name are required' });
    expect(validateTenantContact({})).toEqual({ ok: false, error: 'First and last name are required' });
  });

  it('rejects an over-long field', () => {
    const long = 'x'.repeat(MAX_CONTACT_FIELD + 1);
    expect(validateTenantContact({ firstName: long, lastName: 'Doe' })).toEqual({ ok: false, error: 'A field is too long' });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run functions/lib/realtorTenants.test.ts`
Expected: FAIL, cannot import from `./realtorTenants`.

- [ ] **Step 3: Write the helper**

`functions/lib/realtorTenants.ts`:

```ts
import type { Env } from './session';

/** Longest allowed value for any tenant contact field. */
export const MAX_CONTACT_FIELD = 120;

export interface TenantContactInput {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
}
export type ContactValidation =
  | { ok: true; value: TenantContactInput }
  | { ok: false; error: string };

/** Validate and normalise the name and contact fields for a new tenant. Pure. */
export function validateTenantContact(body: {
  firstName?: unknown;
  lastName?: unknown;
  email?: unknown;
  phone?: unknown;
}): ContactValidation {
  const firstName = typeof body.firstName === 'string' ? body.firstName.trim() : '';
  const lastName = typeof body.lastName === 'string' ? body.lastName.trim() : '';
  if (!firstName || !lastName) return { ok: false, error: 'First and last name are required' };

  const email = typeof body.email === 'string' ? body.email.trim() : '';
  const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
  for (const v of [firstName, lastName, email, phone]) {
    if (v.length > MAX_CONTACT_FIELD) return { ok: false, error: 'A field is too long' };
  }
  return { ok: true, value: { firstName, lastName, email: email || null, phone: phone || null } };
}

/**
 * Create a new person-only tenant and link it to a realtor in one batch. Always
 * inserts a NEW tenant: it never looks up an existing one, so a realtor can
 * never attach to (and thereby see) a tenant they did not create. The link's
 * created_at defaults to unixepoch(), which anchors the realtor's 30-day window
 * from now. Returns the new tenants row.
 */
export async function createTenantForRealtor(
  env: Env,
  realtorUserId: string,
  value: TenantContactInput
): Promise<Record<string, unknown>> {
  const tenantId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO tenants (id, first_name, last_name, email, phone) VALUES (?, ?, ?, ?, ?)'
    ).bind(tenantId, value.firstName, value.lastName, value.email, value.phone),
    env.DB.prepare(
      'INSERT OR IGNORE INTO tenant_realtors (id, tenant_id, realtor_user_id) VALUES (?, ?, ?)'
    ).bind(crypto.randomUUID(), tenantId, realtorUserId),
  ]);
  const row = await env.DB.prepare('SELECT * FROM tenants WHERE id = ?').bind(tenantId).first();
  return row as Record<string, unknown>;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run functions/lib/realtorTenants.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Typecheck and commit**

Run: `npx tsc --noEmit`
Expected: no errors.

```bash
git add functions/lib/realtorTenants.ts functions/lib/realtorTenants.test.ts
git commit -m "Realtor tenants: validateTenantContact + createTenantForRealtor helper"
```

---

## Task 4: Realtor adds a tenant (portal)

**Files:**
- Modify: `functions/api/portal/realtor/tenants/index.ts` (add `onRequestPost`)
- Modify: `src/pages/portal/RealtorTenants.tsx` (Add tenant form)
- Modify: `src/lib/api.ts` (`portalApi.addRealtorTenant`)

**Interfaces:**
- Consumes: `validateTenantContact`, `createTenantForRealtor` (Task 3); `requireUser`, `jsonOk`, `jsonError`, `serverError`; `serializePortalTenant`.
- Produces: `POST /api/portal/realtor/tenants`; `portalApi.addRealtorTenant(data) -> Promise<...>`.

- [ ] **Step 1: Add the portal POST handler**

In `functions/api/portal/realtor/tenants/index.ts`, add below the existing `onRequestGet`, and add the two imports to the top:

```ts
import { validateTenantContact, createTenantForRealtor } from '../../../../lib/realtorTenants';
```

```ts
/**
 * POST /api/portal/realtor/tenants — a realtor adds a NEW tenant, linked to
 * themselves. Always creates a fresh record (never attaches to an existing
 * tenant), so it cannot be used to reach someone else's tenant.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;
  if (auth.role !== 'realtor') return jsonError('Not a realtor account', 403);

  try {
    const valid = validateTenantContact((await request.json()) as Record<string, unknown>);
    if (!valid.ok) return jsonError(valid.error, 400);
    const row = await createTenantForRealtor(env, auth.id, valid.value);
    return jsonOk({ success: true, data: serializePortalTenant(row) }, 201);
  } catch {
    return serverError();
  }
};
```

- [ ] **Step 2: Add the client method**

In `src/lib/api.ts`, inside `portalApi` (after `realtorTenant`):

```ts
  addRealtorTenant: (data: { firstName: string; lastName: string; email?: string; phone?: string }): Promise<PortalPerson> =>
    apiRequest('/portal/realtor/tenants', { method: 'POST', body: JSON.stringify(data) }),
```

- [ ] **Step 3: Add the Add-tenant form to the realtor dashboard**

In `src/pages/portal/RealtorTenants.tsx`: add an "Add tenant" button near the "My tenants" heading that toggles a small inline form (first name, last name, email, phone). On submit, call `portalApi.addRealtorTenant(form)`, then refresh the list (`portalApi.realtorTenants().then(setTenants)` or the existing loader) and clear the form. Use the existing `Button` and toast patterns. Helper copy under the form: "This adds a new person to your list. If they are already in the system, ask the office to link them instead." (no dashes). Guard against a double submit with a `submitting` flag.

- [ ] **Step 4: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: typecheck clean, build succeeds.

- [ ] **Step 5: Verify by hand (controller)**

Skip if no realtor session available; the controller verifies: a realtor POSTs a new tenant, it appears in `GET /api/portal/realtor/tenants`, and a different realtor does not see it.

- [ ] **Step 6: Commit**

```bash
git add functions/api/portal/realtor/tenants/index.ts src/pages/portal/RealtorTenants.tsx src/lib/api.ts
git commit -m "Realtor adds a tenant from the portal, auto-linked"
```

---

## Task 5: Super Admin adds a tenant for a realtor (admin)

**Files:**
- Create: `functions/api/realtors/[id]/tenants.ts`
- Modify: `src/pages/Users.tsx` (Add-tenant action on the Realtors tab)
- Modify: `src/lib/api.ts` (`realtorsApi.addTenant`)

**Interfaces:**
- Consumes: `validateTenantContact`, `createTenantForRealtor` (Task 3); `requirePermission`, `jsonOk`, `jsonError`, `serverError`; `serializeTenant`.
- Produces: `POST /api/realtors/:id/tenants`; `realtorsApi.addTenant(realtorUserId, data)`.

- [ ] **Step 1: Write the admin endpoint**

`functions/api/realtors/[id]/tenants.ts`:

```ts
import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../lib/session';
import { validateTenantContact, createTenantForRealtor } from '../../../lib/realtorTenants';
import { serializeTenant } from '../../../lib/serializers';

// POST /api/realtors/:id/tenants — staff create a tenant and link it to a realtor.
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_create');
  if (auth instanceof Response) return auth;

  try {
    const realtorId = params.id as string;
    // The target must be an active realtor-role user, or the link is meaningless.
    const realtor = await env.DB.prepare(
      `SELECT u.id FROM user u
         JOIN user_roles r ON r.user_id = u.id
        WHERE u.id = ? AND r.role = 'realtor' AND u.is_active = 1`
    ).bind(realtorId).first();
    if (!realtor) return jsonError('That realtor was not found', 404);

    const valid = validateTenantContact((await request.json()) as Record<string, unknown>);
    if (!valid.ok) return jsonError(valid.error, 400);

    const row = await createTenantForRealtor(env, realtorId, valid.value);
    return jsonOk({ success: true, data: serializeTenant(row) }, 201);
  } catch {
    return serverError();
  }
};
```

- [ ] **Step 2: Add the client method**

In `src/lib/api.ts`, add a top-level export near `tenantsApi`:

```ts
export const realtorsApi = {
  addTenant: (realtorUserId: string, data: { firstName: string; lastName: string; email?: string; phone?: string }): Promise<Tenant> =>
    apiRequest(`/realtors/${realtorUserId}/tenants`, { method: 'POST', body: JSON.stringify(data) }),
};
```

- [ ] **Step 3: Add the Add-tenant action to the Realtors tab**

In `src/pages/Users.tsx`: on the Realtors tab only, give each realtor row an "Add tenant" button (visible when `hasPermission('tenants_create')`). It opens the existing `Modal` with a small form (first name, last name, email, phone). On submit, call `realtorsApi.addTenant(user.id, form)`, show a success toast ("Tenant added for this realtor."), and close. Reuse the page's existing `Modal`, `Button`, and toast. No dashes in copy.

- [ ] **Step 4: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: typecheck clean, build succeeds.

- [ ] **Step 5: Commit**

```bash
git add functions/api/realtors/[id]/tenants.ts src/pages/Users.tsx src/lib/api.ts
git commit -m "Admin adds a tenant on a realtor's behalf"
```

---

## Task 6: Super Admin force-delete (backend)

**Files:**
- Modify: `functions/api/tenants/[id].ts` (DELETE)
- Modify: `functions/api/admin/users/[id].ts` (DELETE)

**Interfaces:**
- Consumes: `deleteUserStatements` (already imported in both files), `auth.role`.
- Produces: super-admin purge behavior on both delete endpoints; non-super behavior unchanged.

- [ ] **Step 1: Tenant delete purges payments for Super Admin**

In `functions/api/tenants/[id].ts`, replace the body of `onRequestDelete`'s `try` block with:

```ts
    const id = params.id as string;
    const tenant = await env.DB.prepare('SELECT user_id FROM tenants WHERE id = ?')
      .bind(id)
      .first<{ user_id: string | null }>();
    if (!tenant) return jsonError('Tenant not found', 404);

    // Deleting the tenant cascades lease_tenants and tenant_realtors and nulls
    // rent_payments.paid_by_tenant_id. A Super Admin additionally purges the
    // payment history recorded as paid by this person (done first, so the rows
    // are deleted rather than nulled by the cascade).
    const statements = [];
    if (auth.role === 'super_admin') {
      statements.push(env.DB.prepare('DELETE FROM rent_payments WHERE paid_by_tenant_id = ?').bind(id));
    }
    statements.push(env.DB.prepare('DELETE FROM tenants WHERE id = ?').bind(id));
    if (tenant.user_id) statements.push(...deleteUserStatements(env, tenant.user_id));
    await env.DB.batch(statements);

    return jsonOk({ success: true });
```

- [ ] **Step 2: User delete force path for Super Admin**

In `functions/api/admin/users/[id].ts`, change the owned-records guard and the delete so a Super Admin overrides it. Replace the block from the `const owned = ...` query through the `await env.DB.batch(deleteUserStatements(env, id));` line with:

```ts
    const isSuper = auth.role === 'super_admin';

    // properties/expenses/incomes reference user(id) NOT NULL. A normal admin is
    // blocked when the user owns any (deactivate instead). A Super Admin instead
    // reassigns the properties to themselves (the portfolio survives) and purges
    // the financial history (expenses, incomes), then deletes the login.
    if (!isSuper) {
      const owned = await env.DB.prepare(
        `SELECT
           (SELECT COUNT(*) FROM properties WHERE user_id = ?1) AS properties,
           (SELECT COUNT(*) FROM expenses   WHERE user_id = ?1) AS expenses,
           (SELECT COUNT(*) FROM incomes    WHERE user_id = ?1) AS incomes`
      )
        .bind(id)
        .first<{ properties: number; expenses: number; incomes: number }>();
      if (owned && (owned.properties || owned.expenses || owned.incomes)) {
        return jsonError(
          'This user owns properties, expenses, or income records, so their history cannot be deleted. Deactivate the account instead.',
          409
        );
      }
    }

    const statements = [];
    if (isSuper) {
      // Reassign the portfolio to the acting Super Admin BEFORE deleting the
      // user, so the NOT NULL FK on properties.user_id stays satisfied.
      statements.push(env.DB.prepare('UPDATE properties SET user_id = ? WHERE user_id = ?').bind(auth.id, id));
      statements.push(env.DB.prepare('DELETE FROM expenses WHERE user_id = ?').bind(id));
      statements.push(env.DB.prepare('DELETE FROM incomes WHERE user_id = ?').bind(id));
    }
    statements.push(...deleteUserStatements(env, id));
    await env.DB.batch(statements);
```

(The `if (auth.id === id)` self-delete check and the `existing` lookup above this block stay exactly as they are.)

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Verify at the database level (controller)**

The controller seeds local D1 and runs the delete statement sequences for both a super-admin tenant delete (payments gone) and a super-admin user delete (property reassigned to the actor, expenses/incomes gone, user removed), plus a non-super user delete still returning the owned-records 409. No HTTP auth needed for the SQL-level proof.

- [ ] **Step 5: Commit**

```bash
git add functions/api/tenants/[id].ts functions/api/admin/users/[id].ts
git commit -m "Super Admin force-delete: purge history, reassign portfolio"
```

---

## Task 7: Super Admin delete controls and copy (frontend)

**Files:**
- Modify: `src/pages/TenantDetail.tsx` (add a Delete-tenant control)
- Modify: `src/pages/Users.tsx` (super-admin-aware user-delete copy)

**Interfaces:**
- Consumes: `deleteTenant` from `useApp()` (already exists in `AppContext`), `hasPermission` and the current `user` from `useAuth()`, `ConfirmDialog`.

- [ ] **Step 1: Add a Delete-tenant control to TenantDetail**

In `src/pages/TenantDetail.tsx`:
- Pull `deleteTenant` from `useApp()` and the current `user` from `useAuth()`.
- Add a "Delete tenant" button (styled destructive, reuse the existing `Button` with the `Trash2` icon already imported), visible only when `hasPermission('tenants_delete')`. Place it in the page header actions area next to Edit.
- Wire it to a `ConfirmDialog` (`isOpen` state `tenantToDelete`). On confirm, call `deleteTenant(id)`, show a success toast, and navigate back to the tenants list (`useNavigate` to `/tenants`).
- Copy depends on the current user's role. When `user?.roleId === 'super_admin'`, message: "This permanently deletes this tenant and their payment history. This cannot be undone." Otherwise: "This removes this tenant. Their lease payment records are kept. This cannot be undone." Title: "Delete tenant". confirmText: "Delete". No dashes.

- [ ] **Step 2: Make the user-delete copy super-admin-aware**

In `src/pages/Users.tsx`, the existing delete `ConfirmDialog` (title "Delete Team Member"): change its `message` so that when `currentUser?.roleId === 'super_admin'` it reads "This permanently deletes this account, purges their income and expense records, and reassigns any properties they own to you. This cannot be undone." and otherwise keeps the current wording. No dashes.

- [ ] **Step 3: Typecheck and build**

Run: `npx tsc --noEmit && npm run build`
Expected: typecheck clean, build succeeds.

- [ ] **Step 4: Verify in the browser (controller)**

Controller checks: a Super Admin sees the Delete-tenant button and the purge wording; an Admin sees the button (they hold tenants_delete) with the history-kept wording; the user-delete dialog shows the purge wording for Super Admin.

- [ ] **Step 5: Commit**

```bash
git add src/pages/TenantDetail.tsx src/pages/Users.tsx
git commit -m "Delete controls: tenant delete button and super-admin-aware copy"
```

---

## Self-Review

**Spec coverage:**
- Tenant view+add only (no profile edit, no household edit/remove; endpoints removed) → Tasks 1 + 2.
- Realtor adds a new tenant, always-new, auto-linked → Tasks 3 + 4.
- Admin adds a tenant on a realtor's behalf (gated tenants_create, validates realtor) → Tasks 3 + 5.
- Super Admin force-delete: tenant payment purge, user reassign-properties + purge expenses/incomes, non-super unchanged → Task 6; delete UI + copy → Task 7.
- No schema change → confirmed (no migration task).

**Placeholder scan:** none. Backend steps carry full code (current code was read to write exact replacements). UI steps describe concrete deltas against existing components (Modal, Button, ConfirmDialog, useToast, useApp, useAuth) rather than pasting whole files, with exact copy strings and gating conditions given.

**Type consistency:** `TenantContactInput`/`validateTenantContact`/`createTenantForRealtor` defined in Task 3 and consumed identically in Tasks 4 and 5; `createTenantForRealtor` returns a `tenants` row that Task 4 serializes with `serializePortalTenant` and Task 5 with `serializeTenant`; the force-delete branch key `auth.role === 'super_admin'` matches the UI gate `roleId === 'super_admin'`; `deleteUserStatements` is already imported in both delete files.

**Note for the executor (surfaced to Belle):** Task 7 ADDS a tenant-delete button that did not exist in the UI before (the endpoint existed but nothing called it). This is required for Super Admin to delete tenants at all, and the control is gated on `tenants_delete` (Super Admin and Admin).
