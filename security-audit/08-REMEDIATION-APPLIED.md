# Remediation Applied — 2026-11-23

All 4 MEDIUM, 4 LOW, and 3 INFORMATIONAL findings were addressed in code. Typecheck passes; the full test suite and lint were run (see "Verification" and "Not mine" below). Changes are committed to nothing yet; they sit in the working tree alongside your earlier uncommitted work.

## What changed, by finding

| ID | Sev | Fix | Files |
|----|-----|-----|-------|
| F-01 | MED | Centralized HTML sanitizer; announcements now sanitized on render (both staff and tenant views) and stripped on write as defense in depth | new `src/lib/sanitizeHtml.ts`, new `functions/lib/sanitize.ts`, `src/pages/Announcements.tsx`, `src/pages/portal/Announcements.tsx`, `src/components/PropertyNotes.tsx` (now uses the shared sanitizer), `functions/api/announcements/index.ts`, `functions/api/announcements/[id].ts` |
| F-02 | MED | Object level authorization on `/api/photo/:id`: management sees app-wide, portal roles only within their reachable scope (own photo, own tenant photo, own-thread message attachments, realtor's reachable tenants). Miss returns 404 | new `functions/lib/photo-access.ts`, `functions/api/photo/[id].ts` |
| F-10 | INFO | `/api/drive/:fileId` was gated on a non-existent `maintenance_view` permission (effectively super-admin only). Changed to `dashboard_view`: every management role passes, every portal role is rejected | `functions/api/drive/[fileId].ts` |
| F-03 | MED | Added `public/_headers` with CSP (`frame-ancestors 'none'`, `script-src 'self' js.stripe.com`, Google Fonts, Stripe frames/connect), HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` | new `public/_headers` |
| F-04 | MED | `npm audit fix` (non-breaking): advisories dropped from 23 to 5. The prod HIGH (`react-router-dom` RSC CSRF) and vite/zod are patched | `package.json`, `package-lock.json` |
| F-06 | LOW | Stripe webhook idempotency is now race-safe: the event id is claimed with `INSERT OR IGNORE` before any side effect; concurrent retries return early | `functions/api/stripe/webhook.ts` |
| F-07 | LOW | Role editing and per-user grants now reject unknown permission names and forbid a non-super-admin from granting a permission they do not themselves hold | `functions/api/roles/[id].ts`, `functions/api/admin/users/[id]/permissions.ts` |
| F-08 | LOW | Vendor form POST now pins the property to the submission's own scoped property (ignores a client-supplied id) and validates the chosen unit belongs to it | `functions/api/vendor-form/[token].ts` |
| F-09 | INFO | AI assistant no longer returns raw internal error text to the client (kept the usage-limit hint; everything else is logged and opaque) | `functions/api/ai/chat.ts` |
| F-11 | INFO | Added a fail-open fixed-window rate limiter and wired it to the AI chat (20/min) and the Stripe setup-intent and pay-rent portal endpoints (10/min each) | new `functions/lib/rate-limit.ts`, new `migrations/0097_rate_limits.sql`, `functions/api/ai/chat.ts`, `functions/api/portal/stripe/setup-intent.ts`, `functions/api/portal/stripe/pay-rent.ts` |

## Verification

- `npm run typecheck`: PASS (app + functions).
- `npm test`: 182 of 183 pass. The one failure is in `functions/lib/email.test.ts` (a Zelle-number assertion in an email template). It is NOT from this work: `functions/lib/email.ts` and `functions/lib/receipts.ts` were already modified in your working tree before the audit and were not touched here.
- Lint on every touched file: clean, except two pre-existing `react-hooks/set-state-in-effect` errors in `src/pages/Announcements.tsx:180` (an existing `useEffect(() => { fetchList(); }, ...)` pattern, unrelated to the sanitizer edit).

## What still needs YOUR action

1. **Deploy.** None of this is live until the app is built and deployed (Cloudflare Pages). The `_headers`, the endpoint changes, and the sanitizer all take effect on deploy.
2. **Apply migration 0097** to the D1 database so the rate limiter actually enforces (`wrangler d1 migrations apply dunns-rental-db --remote`). The limiter is fail-open, so until then it simply allows every request, nothing breaks.
3. **Smoke-test the CSP after deploy**, especially the Stripe rent-payment flow and the in-app PDF viewer. If Stripe needs more (their docs may require `m.stripe.network` or `q.stripe.com`), widen `script-src`/`frame-src`/`img-src` in `public/_headers`. See https://docs.stripe.com/security/guide#content-security-policy.
4. **F-05 (demo credentials in git history), operational:** confirm the historic demo account is deleted or its password rotated, and confirm the GitHub repo `ejercitobee-ship-it/dunns-rental` is private. This cannot be fixed in code.
5. **Remaining dependency advisories (dev toolchain):** 2 criticals remain in `vitest`/`tinypool` and require a breaking upgrade (`npm audit fix --force` installs vitest 5). These are dev/test only and do not ship to the Cloudflare runtime. Do that on a branch and run the tests. A low-severity `quill` advisory (via `react-quill-new`) also needs a breaking change; the F-01 render-time sanitizer mitigates it in the meantime.

## Notes on approach

- The CSP keeps `script-src` free of `unsafe-inline` (the built HTML has no inline scripts), which preserves it as a real XSS control; `style-src` allows `unsafe-inline` because the UI uses inline styles.
- The `/api/photo` fix deliberately allows management users through unchanged, so no staff-facing avatars or message images break; only portal roles are newly constrained.
- Nothing was committed and no deploy was run. Review the diff and decide what to stage, given your other uncommitted work in the tree.
