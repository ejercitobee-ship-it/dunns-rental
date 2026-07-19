# Master Rent Spreadsheet — Design

**Date:** 2026-07-19
**Status:** Approved for planning
**Author:** Belle + Claude

## Goal

Maintain one master Google Sheet in Belle's Drive that always mirrors the app's tenants and rent payments, so Belle can open, sort, filter, and share her rent records without going into the app.

## Decisions (locked with Belle)

- **Live mirror:** the sheet always matches the app. Any change (payment or tenant added, edited, or deleted; lease change that alters a tenant's unit or rent) rewrites the sheet from the database, so edits and deletions are reflected. No fragile row-tracking.
- **Location:** the sheet lives in the existing "MH Dunn Property Documents" Drive folder (the app root).
- **Two tabs:** Payments and Tenants (columns below).
- **Non-blocking + best-effort:** the rebuild runs after the change is saved (via `context.waitUntil`), so recording a payment stays instant. The database is the source of truth; a failed sheet write never blocks or loses a payment, and the next change or a manual sync reconciles.
- **Controls:** an "Open rent spreadsheet" link and a "Sync now" button in Settings (the Document Storage card).

## Verified feasibility (no open risk)

Confirmed live against production on 2026-07-19: after enabling the Sheets API in the GCP project, an app-created spreadsheet accepts Sheets API `values.update` writes with the existing Drive access token (drive.file scope). **No new OAuth scope, no Drive reconnect.** The one prerequisite (enable the Sheets API) is already done.

## Non-goals

- No new tenant/realtor-facing screen (this is Belle's admin tool).
- No database schema change (the sheet id is stored in `app_settings`).
- No formulas, charts, or formatting beyond a header row; it is a data mirror.

---

## Tabs and columns

**Payments** (one row per `rent_payments` row, newest first):
Paid date, Tenant, Unit, Property, Amount, Method, Month, Year, Status.
- Tenant = the payer (`paid_by_tenant_id` -> name), blank if unattributed.
- Unit/Property = from the payment's lease (`lease_id` -> unit/property).

**Tenants** (one row per `tenants` row):
Name, Email, Phone, Unit, Property, Lease start, Monthly rent, Status.
- Unit/Property/Lease start/Monthly rent/Status = from the tenant's most recent lease (blank if none). Draft (`needs_review`) leases are excluded (a placement not yet finalized is not a live tenancy for this ledger).

---

## Storage

The spreadsheet id is stored in `app_settings` under key `google_rent_sheet_id` (like the folder ids). No schema change.

---

## Google Sheets integration

New `functions/lib/sheets.ts` (kept separate from `google.ts`, which stays Drive-only, but reusing `getAccessToken` and the root-folder helper):

- `ensureRentSheet(env)` -> spreadsheet id. Reuse the stored id unless it is definitely gone (same "reuse unless gone, never fork on a transient error" rule as the Drive folders). On first creation: create the spreadsheet via the Drive API (mimeType `application/vnd.google-apps.spreadsheet`, name "Rent Records", parent = the app root folder), then set up the two tabs via the Sheets API `batchUpdate` (rename the default sheet to "Payments", add a "Tenants" sheet). Store the id.
- `rebuildRentSheet(env)` -> reads all tenants and all payments from D1 (with the joins above) and overwrites both tabs: for each tab, Sheets API `values:clear` on the tab range, then `values:update` (RAW) with the header plus all rows.
- `rentSheetUrl(spreadsheetId)` -> `https://docs.google.com/spreadsheets/d/{id}/edit` for the "Open" link.
- Throws the existing `DriveNotConnected` when Drive is not connected, so callers degrade the same way.

## Sync triggers (live mirror)

A tiny helper `syncRentSheet(context)` calls `context.waitUntil(rebuildRentSheet(env).catch(() => {}))` so the rebuild runs after the response, best-effort. It is invoked after a successful mutation in:
- Payments: `POST /api/payments`, `PUT /api/payments/:id`, `DELETE /api/payments/:id`.
- Tenants: `POST /api/tenants`, `PUT /api/tenants/:id`, `DELETE /api/tenants/:id`.
- Leases: `POST /api/leases`, `PUT /api/leases/:id`, `DELETE /api/leases/:id` (a lease change alters a tenant's unit/rent on the Tenants tab).

The first time any of these fires (or the first manual sync), `ensureRentSheet` creates and backfills the sheet from all existing data.

## Endpoints (Belle's controls)

- `GET /api/rent-sheet` (gated `finances_view`) -> `{ url, connected }`: the sheet's URL (creating it if needed) so the Settings link can open it, and whether Drive is connected.
- `POST /api/rent-sheet/sync` (gated `finances_view`) -> forces `ensureRentSheet` + `rebuildRentSheet` synchronously and returns `{ url }`. This is the "Sync now" button and the explicit backfill. (Gated on `finances_view` like the GET: the sheet only ever mirrors rent data the caller can already see; it never changes app data.)

## UI

In `src/pages/Settings.tsx`, the Document Storage / Drive card gains a "Rent spreadsheet" row: an "Open rent spreadsheet" link (from `GET /api/rent-sheet`) and a "Sync now" button (`POST /api/rent-sheet/sync`) with a success toast. Shown only when Drive is connected. Client methods in `src/lib/api.ts` (`rentSheetApi.get`, `rentSheetApi.sync`).

## Error handling

- Auto-sync is best-effort (`waitUntil` + swallowed error): a Drive/Sheets hiccup never affects the user's action; the sheet catches up on the next change or a manual sync.
- The manual `POST /api/rent-sheet/sync` surfaces failures (503 for `DriveNotConnected`, else 500) so Belle knows if a forced sync did not work.

## Testing

- No pure logic worth a heavy unit test (the row-mapping is a straightforward projection; consider a small pure `rentPaymentRow(...)`/`tenantRow(...)` mapper extracted and tested).
- **Live / DB-level verification:** a manual sync creates the sheet in the root folder with both tabs and backfills existing tenants/payments; recording a payment updates the Payments tab; editing/deleting a payment or tenant is reflected after the change; a tenant with no lease shows blank unit/rent; a draft (needs_review) lease is excluded from the Tenants tab.

## Files touched

**New:** `functions/lib/sheets.ts`; `functions/api/rent-sheet/index.ts` (GET) and `functions/api/rent-sheet/sync.ts` (POST).
**Modified (add the `syncRentSheet` call):** `functions/api/payments/index.ts`, `functions/api/payments/[id].ts`, `functions/api/tenants/index.ts`, `functions/api/tenants/[id].ts`, `functions/api/leases/index.ts`, `functions/api/leases/[id].ts`.
**Client/UI:** `src/lib/api.ts` (`rentSheetApi`), `src/pages/Settings.tsx`.
