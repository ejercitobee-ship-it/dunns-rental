# Maintenance Portal Implementation Plan

**Goal:** Tenants report maintenance from their portal with availability windows; a roster of handymen (new portal role) get trade-matched jobs they can claim (or admin assigns), confirm a time, mark in-progress and done; admin records the cost as a paid expense into Finances. Admin pays the handyman, never the tenant.

**Architecture:** New `handyman` portal role (empty permissions, like tenant/realtor). Extends existing `maintenance_requests` table. Three surfaces: tenant portal Maintenance tab, new handyman portal, admin Maintenance page. Email at each transition via existing Resend `sendEmail`. Paid cost flows into Finances/Expenses. No real money moves — admin records it.

## Global Constraints
- NO dashes (em/en/hyphen-as-break) in any user-facing copy. Use commas/periods/colons.
- Copy voice: MH Dunn Property, plain and professional (match receipts/invite emails).
- Dates are local calendar days `YYYY-MM-DD`; never `new Date(dateOnly)`. Use parseLocalDate/formatDate/todayLocalDate.
- Portal roles carry EMPTY permissions and reach ONLY portal endpoints scoped to the caller. A handyman must never reach a management endpoint or see rent/finances.
- `npm run build` = tsc app + `tsc -p functions/tsconfig.json` + vite build. Functions typecheck separately.
- `react-hooks/set-state-in-effect` is a lint error: set state in promise callbacks, not effects.
- Money math: paid maintenance is an EXPENSE; it never touches a tenant's rent ledger.

## Status lifecycle
`submitted -> assigned -> scheduled -> in_progress -> completed -> paid` (+ `cancelled` anytime).
- `scheduled_for` (nullable local datetime) is data, set when a handyman confirms a time. Status moves to `scheduled` when set from `assigned`.
- Handyman buttons: Claim (submitted->assigned, sets assigned_handyman_id), Confirm time (->scheduled), Start (->in_progress), Complete (->completed).
- Admin: Assign (submitted/any->assigned to a handyman), Mark paid (completed->paid, records cost + paid_at).

## Trades (categories)
plumbing, electrical, hvac, appliance, carpentry, general, other (align to existing maintenance categories).

## Data model (migration 0015_maintenance_portal.sql)
- Seed role: `('handyman','Handyman','Portal only. Sees jobs matching their trades.', '[]', 1)`.
- `handymen` table: id PK, user_id (unique, -> user.id), name, phone, email, trades TEXT (JSON array), is_active INT default 1, created_at, updated_at. Unique index on user_id.
- ALTER `maintenance_requests` ADD: `assigned_handyman_id TEXT` (-> handymen.id), `scheduled_for TEXT`, `availability TEXT` (JSON array of {date,start,end}), `paid_at TEXT`, `created_by TEXT` ('tenant'|'admin').
- Remap existing status values: open->submitted, resolved->paid, in_progress stays, cancelled stays. (Likely 0 rows in prod.)

## Build slices (each: build, `npm run build`, `npx vitest run`, lint touched files, commit)
- [ ] **Slice 1 — Data model + migration.** Write 0015, apply --local, verify. serializers: serializeMaintenance, serializeHandyman. Types in src/lib/api.ts.
- [ ] **Slice 2 — Handyman roster (admin) + role plumbing.** functions/api/handymen (GET list, POST create=user+user_roles+handymen row+invite, PUT trades/active, DELETE/deactivate). Portal auth accepts 'handyman'. Admin Handymen section on Maintenance page.
- [ ] **Slice 3 — Tenant request submission.** functions/api/portal/maintenance (POST create w/ availability, GET own list). Tenant portal Maintenance tab + form + list. Email: matching handymen + admin.
- [ ] **Slice 4 — Handyman portal.** GET available (trade-matched, unassigned), GET my jobs, POST claim/confirm-time/start/complete. HANDYMAN_TABS + pages + routes. Emails to tenant on transitions.
- [ ] **Slice 5 — Admin assign + pay + Finances.** PUT assign, PUT mark-paid. Maintenance page: new badges/filters, assign dropdown (trade-filtered), mark-paid w/ cost. Ensure paid cost counts in Finances expenses.
- [ ] **Slice 6 — Polish + full test + deploy.** End-to-end sanity, unit tests for matching + lifecycle guards, merge, deploy, poll bundle.

## Progress ledger
(append one line per slice as it lands: `Slice N: complete (commit <sha7>)`)
