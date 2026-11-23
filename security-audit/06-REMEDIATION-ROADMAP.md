# REPORT 7: Remediation Roadmap

Prioritized by risk and sequenced so dependencies are respected. No code was changed during this audit; these are recommendations for a follow up change session.

## Priority 0 — Critical / immediate exposure

None. No CRITICAL finding was confirmed.

## Priority 1 — High risk (do first)

There are no HIGH application findings. The four MEDIUM items are the real "do soon" list; they are grouped here as Priority 1 because they carry the most residual risk.

### R1 — F-01 Sanitize announcement HTML
- **Fix:** Render announcement bodies through a hardened sanitizer in `src/pages/Announcements.tsx:670` and `src/pages/portal/Announcements.tsx:136`. Centralize the sanitizer (lift the one in `PropertyNotes.tsx:466` into a shared util, or adopt a vetted allowlist library matching the Quill formats). Also sanitize or strip HTML on write in `functions/api/announcements/index.ts`.
- **Dependencies:** none. Pairs well with R3 (CSP as a second layer).
- **Validation:** post an `onerror` payload via the API; confirm it renders inert.

### R2 — F-02 Enforce object level authorization on file streaming
- **Fix:** In `functions/api/photo/[id].ts`, resolve the Drive id to an owning row and verify it is the caller's own photo or a person the caller may view. In `functions/api/drive/[fileId].ts`, look the id up in its owning table (maintenance invoice, note attachment, expense receipt) and check the caller's permission for that object; also resolve the `maintenance_view` permission drift (R7/F-10).
- **Dependencies:** R7 (permission name) touches the same file.
- **Validation:** request a foreign Drive id as a tenant; expect 404.

### R3 — F-03 Add HTTP security headers
- **Fix:** Add `public/_headers` (Cloudflare Pages) with CSP (`default-src 'self'`, `frame-ancestors 'none'`, tight script/style), `Strict-Transport-Security`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, minimal `Permissions-Policy`. Confirm whether the Cloudflare edge already sets HSTS.
- **Dependencies:** build the CSP against the actual Vite output; test the app still loads.
- **Validation:** `curl -I` the deployed site; attempt to frame it.

### R4 — F-04 Patch dependencies
- **Fix:** `npm audit fix` for non breaking items (covers the prod `react-router-dom` advisory). Plan the `vitest`/`vite` majors (`npm audit fix --force` installs vitest 5, breaking) on a branch, run the test suite, re pin.
- **Dependencies:** run tests after.
- **Validation:** `npm audit` reports 0 critical/high.

## Priority 2 — Medium risk

(These are the LOW findings; "Priority 2" per the brief's scale.)

### R5 — F-05 Confirm demo account and repo visibility
- Verify the historic demo account is deleted or its password rotated; confirm `ejercitobee-ship-it/dunns-rental` is private. Optionally sweep history with Gitleaks.

### R6 — F-06 Make webhook dedup atomic
- Insert into `processed_stripe_events` first with `ON CONFLICT DO NOTHING` (add a unique constraint on `event_id`), proceed only if the row was created.

### R7 — F-07 Harden privilege management
- Validate role permission names against `ALL_PERMISSIONS` in `roles/[id].ts`; add a "cannot grant a permission you do not hold" rule (super_admin exempt); document `users_roles`/`users_permissions` as owner level.

### R8 — F-08 Constrain vendor form propertyId
- On `vendor-form/[token]` POST, ignore or validate the client `propertyId` against the submission's own `property_id`; validate `unitId` belongs to it.

## Priority 3 — Low risk

### R9 — F-10 Resolve the `maintenance_view` permission drift (do with R2).
### R10 — F-11 Add rate limits to expensive endpoints (AI chat, PDF, Stripe setup) or confirm Cloudflare edge rate limiting.

## Priority 4 — Hardening and improvement

- Single source the permission map (today duplicated in `src/types/auth.ts` and `functions/lib/permissions.ts`); add a test that they match.
- F-09: make the AI chat error opaque (use `serverError()`), log detail server side.
- Paginate `GET /api/payments` as the ledger grows.
- Add a regression test per fixed finding (IDOR 404, XSS inert, header presence).
- Consider a staging environment so future audits can run the Report 6 live tests (Playwright IDOR/XSS, ZAP baseline).

## Suggested implementation order

R1 and R3 together (XSS plus its CSP net) → R2 with R7/R9 (file auth plus permission drift) → R4 (deps) → R5, R6, R8 → R10 → Priority 4 hardening.

Each item is small and self contained. A single focused change session can reasonably clear Priority 1 and 2.
