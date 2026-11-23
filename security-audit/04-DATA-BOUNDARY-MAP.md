# REPORT 5: Data and Security Boundary Map

## Sensitive data held

- **Tenant PII:** names, emails, phones, addresses, emergency contacts, tenant numbers.
- **Financial:** rent ledgers (`rent_payments`), allocations, credits (`tenant_credits`), late fees, deposits, move in fees, expenses, incomes, capital projects, Stripe customer and payment method ids, autopay consent (IP, user agent).
- **Legal/documents:** leases, renewals, rental applications, notices, eviction records, signed documents (in Google Drive).
- **Operational:** maintenance requests and photos, vendor invoices, internal property notes, messages, announcements.
- **Auth secrets:** password hashes (`account.password`), session tokens (`session.token`), TOTP secrets and backup codes, password reset tokens, trusted device tokens.
- **Platform secrets (env):** Stripe secret and webhook secret, Google OAuth client secret, VAPID private key, Resend key, CRON_SECRET, Anthropic key.

## Trust boundaries and what crosses them

```
[ Internet / unauthenticated ]
      |  (TLS, Cloudflare edge)
      v
[ Cloudflare Pages: static SPA ]   <-- F-03: no CSP/HSTS/X-Frame-Options in repo
      |
      |  fetch, same-origin cookie (HttpOnly, SameSite=Strict)
      v
[ _middleware.ts ]  same-origin CORS, sliding session cookie, activity log
      |
      +--> [ Public endpoints ]  auth/*, sign/:token*, vendor-form/:token, stripe/webhook
      |         token or signature gated; no session required
      |
      +--> [ requireUser ]      any authenticated user  --> me/*, photo/:id (F-02), portal/*
      |
      +--> [ portal scope resolver (portal.ts) ]  tenant=self, realtor=window, handyman=owned
      |
      +--> [ requirePermission(perm) ]  management actions, per action
      |
      +--> [ requireSuperAdmin ]  owner only actions
      |
      v
[ D1 (SQLite) ]  no row-level security; isolation = application code only
      |
      +--> [ Google Drive ]   files by drive_file_id  (F-02: streamed with weak object auth)
      +--> [ Stripe ]         server-side amounts, signed webhooks, idempotency (F-06)
      +--> [ Resend / Web Push / Workers AI / Google Sheets ]  outbound, best-effort
      |
      v
[ Scheduler ]  cron/* gated by CRON_SECRET (constant-time bearer)
```

## Data flows worth noting

- **Rent payment (manual):** staff with `rents_record` → validated, deduped, atomic batch into `rent_payments` + `payment_allocations` + late fee status + credit ledger → audit log → best effort receipt, sheet sync, notification.
- **Rent payment (autopay):** scheduler (CRON_SECRET) → server computed amount from `lease.monthly_rent` → Stripe PaymentIntent → `rent_payments` row as `processing` → webhook confirms `paid`.
- **Document view (tenant):** portal → `portal/documents/:id` → ownership checked against `reachableTenantIds` → Drive stream, `private, no-store`.
- **Document view (by raw Drive id):** `photo/:id` / `drive/:fileId` → Drive stream with no per object ownership check (F-02).
- **Signing (public):** applicant with unguessable token → `sign/:token*` → only that applicant's documents, foreign docs 404.

## Attack surface summary

| Surface | Exposure | Primary control | Residual |
|---|---|---|---|
| Auth endpoints | Public | PBKDF2, throttle, step up 2FA, generic errors | Demo creds in history (F-05) |
| Token signing / vendor form | Public, token gated | Unguessable UUID, per token scope | propertyId not constrained on write (F-08) |
| Stripe webhook | Public | Signature verify + idempotency | Dedup race (F-06) |
| Management API | Authn + per permission | `requirePermission` | god perms hardening (F-07) |
| Portal API | Authn + scope resolver | `portal.ts` reachable set | solid; no cross tenant path found |
| File streaming | Authn (any user) | unguessable Drive id | object auth gap (F-02) |
| App shell responses | Public | none in repo | no security headers (F-03) |
| Rich text rendering | Authn | sanitize (notes only) | announcements unsanitized (F-01) |
| Dependencies / build | CI + dev | lockfile | 2 critical dev, 1 high prod advisory (F-04) |

## Isolation assessment

No path was found for one tenant to read or modify another tenant's lease, ledger, payments, documents, maintenance, or messages through the API, nor for a tenant/realtor/handyman to reach management functions. The isolation model is sound and consistently applied. The one caveat is file streaming by raw Drive id (F-02), which is an object level authorization gap mitigated by id secrecy, and the general reminder that D1 has no database safety net, so discipline on every future endpoint is what keeps isolation intact.
