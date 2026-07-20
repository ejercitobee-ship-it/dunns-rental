# Automatic Rent Receipts — Design

**Date:** 2026-07-19
**Status:** Approved for planning
**Author:** Belle + Claude

## Goal

When a rent payment is marked **paid** in the Record Payment form, automatically generate a PDF receipt, file it in the tenant's Google Drive folder, surface it in the tenant's portal Documents, make it downloadable from the payment in the tenant's profile, and (best-effort) email it to the tenant.

## Decisions (locked with Belle)

- **Trigger:** a payment created via Record Payment with `status = 'paid'`. **Bulk CSV imports do not create receipts** (they pass `?deferSheetSync=1`; the same flag suppresses receipts).
- **Artifact:** a PDF receipt with the company header (name, address, phone from Settings), a receipt number, tenant name, property · unit, period (e.g. "July 2026"), amount, payment method, date paid, and a PAID mark.
- **Destinations (all):** filed in the tenant's Drive folder; a `documents` row so it appears in the tenant portal Documents (and admin Documents); a per-payment "Receipt" download link in the tenant's profile; a best-effort email to the tenant.
- **Best-effort + non-blocking:** generation runs after the payment is saved (`context.waitUntil`), so a Drive/PDF/email hiccup never blocks or fails recording the payment. If Drive is not connected, it skips silently.
- **Manual fallback:** a "Generate receipt" action to create/refresh a receipt for any payment missing one.
- **Email caveat:** the sending domain is not verified yet, so the email likely won't reach tenants until it is; the receipt is in Drive and the app regardless.

## Non-goals

- No receipts for bulk-imported or non-paid payments.
- No custom receipt templating/branding beyond the company header + standard fields (v1).
- No change to how payments, leases, or settlements work.

## Data model

One migration, `migrations/0014_payment_receipts.sql`:

```sql
ALTER TABLE rent_payments ADD COLUMN receipt_document_id TEXT;
```

Nullable, no FK (matches `documents.tenant_id`, which is also FK-less). It points at the `documents` row for the receipt, so the UI knows a receipt exists and can link to it. If the document is ever deleted, the id simply dangles and the download 404s (acceptable; the app treats a missing receipt as "none").

## Receipt generation

New `functions/lib/receipts.ts`:

- `buildReceiptPdf(data): Promise<Uint8Array>` — uses `pdf-lib` (new dependency; pure JS, Workers-safe with `StandardFonts.Helvetica`, no fontkit) to lay out the receipt on a Letter page. No network, no I/O.
- `generateReceipt(env, paymentId): Promise<string | null>` — the orchestrator:
  1. Load the payment joined to its lease → unit → property.
  2. Pick the tenant: `paid_by_tenant_id` if set, else the lease's first occupant (via `lease_tenants`). If there is no tenant or no lease, return `null` (skip — nothing to file).
  3. Read company settings from `app_settings` key `company` (JSON), falling back to the same defaults the Settings endpoint uses.
  4. Build the PDF (`buildReceiptPdf`).
  5. `ensureTenantFolder(env, tenantId)` → upload via `uploadToDrive(env, folderId, name, 'application/pdf', blob)`; name like `Rent receipt - July 2026.pdf`.
  6. Insert a `documents` row (`id, name, drive_file_id, content_type='application/pdf', size, tenant_id, uploaded_by`), and `UPDATE rent_payments SET receipt_document_id = ? WHERE id = ?`.
  7. Best-effort: if the tenant has an email, `sendEmail` a short "your rent receipt" note (links to the portal). Swallow failure.
  - Throws are contained by callers; a `DriveNotConnected` (or any failure) means no receipt this time.

Idempotency: `generateReceipt` overwrites `receipt_document_id` with the newest document. Re-running (manual button) creates a fresh receipt document; the old one is left in Drive/Documents (acceptable for v1; a dedupe/cleanup is a later nicety).

## Wiring

- **Auto (Record Payment):** in `functions/api/payments/index.ts` `onRequestPost`, after the insert and the existing `syncRentSheet`, when `status === 'paid'` and it is not a bulk import (`?deferSheetSync !== '1'`), call `context.waitUntil(generateReceipt(env, id).catch(() => {}))`.
- **Manual:** new `POST /api/payments/:id/receipt` (gated `rents_record`) → `generateReceipt` → `{ receiptDocumentId }` (or a 400/409 if it could not be generated, e.g. Drive not connected or no tenant, so the button can show why).
- **Serializer:** `serializePayment` returns `receiptDocumentId` (from `receipt_document_id`).

## Client / UI

- `src/lib/api.ts`: `RentPayment` gains `receiptDocumentId?: string`; `paymentsApi.generateReceipt(id): Promise<{ receiptDocumentId: string }>`.
- `src/pages/TenantDetail.tsx` payment history: when a row has `receiptDocumentId`, show a **Receipt** download link (opens `/api/documents/:id`); otherwise a small **Generate** action (super admin / `rents_record`) that calls `generateReceipt` and refreshes.
- The tenant portal shows the receipt automatically via the existing portal Documents list (the `documents` row is filed under the tenant). No portal change required for v1.

## Testing

- **Pure unit test:** `buildReceiptPdf` returns a non-empty PDF (bytes start with `%PDF`) for representative data, and a helper that formats the receipt number / period is unit-tested.
- **Local D1 + manual:** record a paid payment → a `documents` row is created, `receipt_document_id` is set, the file downloads as a valid PDF, and it appears in the tenant's Documents. Bulk import creates none. Drive-disconnected records the payment with no receipt and no error.

## Rollout

Branch `feature/rent-receipts` off `main`. Migration 0014 applied to prod at deploy (local first). Deploy = merge to `main` + push. Verify on a real recorded payment after deploy.
