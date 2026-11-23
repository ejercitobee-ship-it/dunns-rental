# REPORT 2: Full Technical Audit

Audit date 2026-11-23. Read only, code verified.

## Architecture

- **Frontend:** React 19 SPA, Vite build, React Router 7, Tailwind 4. Served as static assets from Cloudflare Pages (`dist`). Rich text via `react-quill-new`. Charts via Recharts. PDFs via `pdf-lib`. Stripe via `@stripe/stripe-js`.
- **Backend:** Cloudflare Pages Functions (file based routing under `functions/api/**`), ~190 endpoint handlers, running on the Workers runtime (`nodejs_compat`). Shared logic in `functions/lib/**`.
- **Database:** Cloudflare D1 (SQLite). Binding `DB`. ~85 tables across 96 migrations (`migrations/0001..0096`).
- **Auth provider:** Custom (no third party IdP). Session token in a cookie, server side `session` table, PBKDF2 passwords, TOTP + email OTP second factor.
- **Storage:** Google Drive via OAuth (binding not R2; the `DOCS` R2 binding is intentionally unbound, endpoints 503 when storage is off). Files referenced by `drive_file_id`.
- **External integrations:** Stripe (ACH/card rent collection, webhooks), Google Drive (documents), Resend (email), Web Push (VAPID), Cloudflare Workers AI (assistant), Google Sheets (rent sheet mirror).
- **Scheduled jobs:** `functions/api/cron/*` (autopay, rent due, late fees, lease expirations, reminders, backup, activity cleanup) authenticated by a shared `CRON_SECRET` bearer token; separate Workers in `workers/` (monthly backup, rent reminder) invoke them.
- **Hosting/deploy:** Cloudflare Pages, config in `wrangler.jsonc`. Build: `tsc -b && tsc -p functions/tsconfig.json && vite build`.

## Security boundaries

1. **Unauthenticated internet** → the SPA, the auth endpoints, the token scoped public endpoints (`/api/sign/:token*`, `/api/vendor-form/:token`), and the Stripe webhook.
2. **Authenticated portal users** (role `tenant`, `realtor`, `handyman`) → `/api/portal/**` and a few shared endpoints; isolated to their own reachable set.
3. **Authenticated management users** (`viewer`, `accountant`, `manager`, `admin`, `super_admin`, or custom roles) → the management API, gated per action by permission.
4. **The owner** (`super_admin`) → a small set of owner only actions via `requireSuperAdmin`.
5. **The scheduler** → cron endpoints via `CRON_SECRET`.

The single enforcement chokepoints are `functions/lib/session.ts` (identity, guards, password/crypto), `functions/lib/permissions.ts` (role to permission map), and `functions/lib/portal.ts` (portal scope resolvers). `functions/_middleware.ts` handles same origin CORS, the sliding session cookie, and activity logging.

## Authentication (see F-05)

- Session token is a `crypto.randomUUID()` stored in `session`; lookup joins session → user → role in one query; deactivated users are treated as signed out.
- Cookie: `HttpOnly; Secure; SameSite=Strict; Max-Age=900; Path=/` (Secure dropped only for `127.0.0.1` local dev). SameSite=Strict is the primary CSRF defense and is appropriate here.
- Passwords: PBKDF2 SHA-256, 100k iterations, 16 byte salt, constant time compare; legacy unsalted SHA-256 hashes verify once then auto upgrade to PBKDF2 on login.
- Second factor: a fresh or long idle device must pass TOTP (if enrolled) or an emailed one time code; a remembered device (`td` cookie) skips it for 30 days. This is effectively mandatory step up 2FA.
- Brute force: IP keyed throttle on sign in and forgot password (`functions/lib/throttle.ts`).
- Account enumeration: forgot password always returns the same generic message and records a failure regardless of whether the email exists.
- Self sign up: disabled at the server (`/api/auth/sign-up/email` returns 403). Client `/register` and `/signup` routes redirect to `/login`.
- Password reset: one hour single use tokens in `password_reset_tokens`, deleted and reissued per request.

## Authorization (see F-07)

- Guards: `requireUser` (any session), `requirePermission(perm)` (role or per user override grants the permission; super_admin bypass), `requireSuperAdmin` (owner only).
- Role to permission map in `permissions.ts` mirrored to `src/types/auth.ts`; roles also stored in the `roles` table (live editable) with a `user_permission_overrides` additive layer.
- Every management endpoint sampled uses a permission guard appropriate to the action (e.g. `rents_record` to record a payment, `settings_edit` to change settings, `users_edit` to reset a team password). Only `me/*`, `photo/[id]`, and `payment-plans/[id]/generate-pdf` use `requireUser` alone, and all three are self scoped or ownership checked except the file BOLA gap in F-02.

## Tenant / portal isolation (see F-02)

- `functions/lib/portal.ts` is the one place that decides which tenants a portal caller may reach: a tenant reaches only themselves (`tenantIdForUser`), a realtor reaches linked tenants inside a 30 day window (`realtorTenantIds`), a handyman is scoped to jobs assigned to them or available jobs matching their trades. Endpoints filter within this resolved set and never fetch by a raw client id.
- Verified on `portal/documents/[id]` (checks `reachableTenantIds`, returns 404 not 403), `portal/payments/[id]/receipt` (payment must be on a lease the caller is on), `portal/realtor/tenants/[id]` (realtor window), `portal/handyman/jobs/[id]/claim` and `/status` (trade match + guarded update scoped to `assigned_handyman_id`).
- The weak spot is file streaming by raw Drive id (F-02), which bypasses this model.

## Database

- D1/SQLite: no row level security exists in the engine, so isolation is entirely application enforced. This is the correct pattern for D1, reviewed above.
- No SQL injection found. Every query uses bound parameters. The dynamic SQL fragments are safe: IN clauses built as `?,?,?` placeholder lists; `UPDATE table SET <col>` fragments where table and column come from a hardcoded role switch (`portal/photo.ts`) or a fixed list (`cron/backup.ts`); dynamic `SET` clauses that interpolate only column names, never values.
- Backups (`cron/backup.ts`) strip sensitive columns (`account.password`, `session.token`, `login_throttle.ip`) before export and are `CRON_SECRET` gated.
- Financial writes are atomic (`env.DB.batch`) and audit logged (`activity_log` via `logActivityStmt`).

## API and server side security

- ~190 handlers. Guard coverage: every endpoint has an appropriate guard; the only unguarded handlers are the intentionally public ones (auth, `/sign/:token*`, `/vendor-form/:token`, `/stripe/webhook`), each gated by a token or a signature.
- Input validation present on the sensitive writes (amounts, months/years, allocation totals, permission names). Responses use `serialize*` helpers; errors are opaque (`serverError()`) except F-09.
- CORS: same origin only; the middleware echoes `Access-Control-Allow-Origin` only when the request Origin equals the app origin, so no third party site can make credentialed requests.

## Frontend

- Protected routes are a convenience; the server enforces authorization independently (confirmed by the guard review). 
- XSS sinks: three `dangerouslySetInnerHTML` uses. Property Notes sanitizes; the two Announcements views do not (F-01).
- Session token is an HttpOnly cookie, not in `localStorage`, so it is not script readable.

## Storage (see F-02)

- Documents and attachments live in Google Drive, referenced by `drive_file_id`. Streaming endpoints set `Cache-Control: private, no-store`, force non images to download, and set `nosniff` (good anti XSS on downloads). The gap is object level authorization on the stream endpoints.

## Payment integration

- Stripe webhook verifies the signature (`constructEventAsync`) and dedups on `processed_stripe_events` (idempotency, minor race in F-06). It never trusts a client amount: it only transitions existing `rent_payments` rows by payment intent id.
- Autopay (`cron/autopay.ts`) computes the amount server side from `lease.monthly_rent` plus a computed fee, guards against double charge for the same lease/month/year, and is dual authenticated (`CRON_SECRET` or a `settings_edit`/super_admin session).
- Manual payment recording validates a positive finite amount, requires month and year, caps allocation totals at the payment amount, and runs everything in one atomic batch.

## Business logic

- Rent, credits, allocations, late fees, carry forward, lease pauses, prorations, and renewals are modeled with explicit rules (summarized in the AI system prompt and implemented in `functions/lib/*` and the rent endpoints). Credits settle rent but are excluded from income. Duplicate manual payments are guarded by a 60 second window and by the autopay existing payment check.

## Infrastructure, configuration, secrets (see F-03, F-04, F-05)

- Secrets are environment bound (`Env` in `session.ts`): Stripe keys, webhook secret, Google OAuth, VAPID, Resend, CRON_SECRET, Anthropic. None are hardcoded in the current tree. `.env` and `.dev.vars` are gitignored and were never committed.
- Missing response security headers (F-03). Dependency advisories (F-04). Demo credentials in history (F-05).

## Reliability and performance

- Background work uses `waitUntil` so logging, email, push, and sheet sync never block or fail a request.
- `GET /api/payments` reads all `rent_payments` with no pagination; acceptable at this portfolio size, worth paginating as data grows (INFO, see Report 6).
- Concurrency: the claim and autopay paths use guarded updates and existence checks to avoid double actions. The webhook has the minor race in F-06.
