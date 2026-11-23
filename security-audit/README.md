# MH Dunn Property — Security Audit (2026-11-23)

Read only, independent application security audit and static penetration review of the Rental Management app in this repository. No application code, config, data, or deployment was modified. These files are new audit documentation only.

## Read in this order

1. [00-EXECUTIVE-SUMMARY.md](00-EXECUTIVE-SUMMARY.md) — posture, risk, counts, top risks, readiness. Start here.
2. [02-VULNERABILITY-REGISTER.md](02-VULNERABILITY-REGISTER.md) — every finding (F-01 to F-11) with evidence, impact, and fix.
3. [06-REMEDIATION-ROADMAP.md](06-REMEDIATION-ROADMAP.md) — prioritized fix plan (R1 to R10).
4. [07-PRODUCTION-READINESS.md](07-PRODUCTION-READINESS.md) — the go/no-go call.
5. [01-TECHNICAL-AUDIT.md](01-TECHNICAL-AUDIT.md) — architecture and per domain detail.
6. [03-ROLE-PERMISSION-MATRIX.md](03-ROLE-PERMISSION-MATRIX.md) — who can do what.
7. [04-DATA-BOUNDARY-MAP.md](04-DATA-BOUNDARY-MAP.md) — data, trust boundaries, attack surface.
8. [05-PENTEST-RESULTS.md](05-PENTEST-RESULTS.md) — the 36 test scenarios, code verified or NOT TESTED.

## Headline

Posture is strong. 0 critical, 0 high, 4 medium, 4 low, 3 informational. Verdict: CONDITIONALLY READY. Fix the four mediums (XSS sanitize, file object authorization, security headers, dependency patch) and it is in good shape.

## Findings at a glance

| ID | Severity | Title |
|----|----------|-------|
| F-01 | MEDIUM | Stored XSS in Announcements (unsanitized rich text) |
| F-02 | MEDIUM | Broken object level authorization on Drive file streaming |
| F-03 | MEDIUM | Missing HTTP security headers |
| F-04 | MEDIUM | Vulnerable dependencies (2 critical dev toolchain, 1 high prod) |
| F-05 | LOW | Demo credentials in git history |
| F-06 | LOW | Stripe webhook idempotency race |
| F-07 | LOW | Privilege management lacks "grant only what you hold" |
| F-08 | LOW | Vendor form accepts an unconstrained propertyId |
| F-09 | INFO | AI assistant error handler leaks raw error text |
| F-10 | INFO | `drive/[fileId]` gated on a non existent permission |
| F-11 | INFO | No rate limiting beyond auth endpoints |

## Coverage log (what was inspected)

- Architecture, stack, routing, config (`wrangler.jsonc`, `package.json`, `.gitignore`): done.
- Auth: `_middleware.ts`, `lib/session.ts`, sign in, sign up (disabled), forgot/reset password, 2FA paths, throttle: done.
- Authorization: `lib/permissions.ts`, guards, `roles/[id]`, `admin/users/[id]/permissions`, reset password endpoints: done.
- Tenant/portal isolation: `lib/portal.ts`, portal documents/payments/handyman/realtor endpoints, guard coverage scan of all ~190 handlers: done.
- Database: migrations overview, SQL injection scan (parameterization), dynamic SQL review, backup redaction, D1 no-RLS architecture: done.
- Financial/business logic: payment recording + allocations + credits, autopay cron, webhook, late fee status: done.
- Files/storage: `documents/[id]`, `portal/documents/[id]`, `drive/[fileId]`, `photo/[id]`, sign token streaming, upload validation: done.
- Frontend: `dangerouslySetInnerHTML` sinks, token storage, route protection: done.
- Infra/secrets/deps: env handling, git history for secrets, `npm audit` (prod and dev): done.

## Limitations

Read only, code verified. No live or staging environment was authorized, so runtime proofs of F-01, F-02, F-06, edge headers, and rate/load behavior are listed as NOT TESTED in Report 6 with the recommended procedure. No secret values were read or printed; any sensitive strings are redacted.
