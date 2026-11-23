# REPORT 1: Executive Security Summary

**Application:** MH Dunn Property, Rental Management (`home-rental-dashboard`)
**Repository:** local working copy at `C:\Users\ejerc\dunns-rental` (git repo present)
**Audit type:** Independent, read only application security audit and static penetration review
**Audit date:** 2026-11-23
**Auditor role:** Senior Application Security Engineer / Principal Architect / Ethical Hacker (AI assisted)
**Method:** Source code review, configuration and schema inspection, git history inspection, dependency scan (`npm audit`). No live or staging environment was authorized for active testing, so all exploit paths are code verified, not runtime proven. Items that could only be proven live are marked NOT TESTED in Report 6.

---

## Overall security posture

**Strong.** This application was built with a mature, consistent security model that is well above what is typical for a solo built product. The core controls that matter most for a system holding tenant personal data, leases, and money are present and correctly implemented:

- Custom session auth with HttpOnly, `SameSite=Strict`, `Secure` cookies and a 15 minute sliding idle timeout.
- Passwords hashed with PBKDF2 (100,000 iterations, salted, constant time compare) with a transparent upgrade path off legacy hashes.
- Mandatory step up second factor on every fresh device (authenticator app TOTP, or an emailed one time code), plus IP based brute force throttling.
- Server side authorization on every management endpoint through a permission guard, never trusting the frontend.
- Tenant, realtor, and handyman isolation enforced server side through a single scope resolver that never trusts a client supplied id.
- Server side financial validation (positive amounts, allocation totals capped, duplicate guards, atomic batches, full audit logging).
- Stripe webhooks verified by signature with idempotency; autopay amounts computed server side with a double charge guard.
- Invite only access: self sign up is disabled at the server.

No CRITICAL or HIGH severity application logic vulnerability was confirmed. The issues found are real and worth fixing, but none of them hands an outsider the keys to the system.

## Overall risk level

**MEDIUM**, trending LOW once the four MEDIUM items below are remediated.

## Findings by severity

| Severity | Count |
|----------|-------|
| CRITICAL | 0 |
| HIGH | 0 |
| MEDIUM | 4 |
| LOW | 4 |
| INFORMATIONAL | 3 |

## The most serious risks

1. **Stored XSS in Announcements (F-01, MEDIUM).** Announcement bodies are stored as raw HTML and rendered to tenants and staff with `dangerouslySetInnerHTML` and no sanitization. The nearly identical Property Notes feature *does* sanitize, so this is an inconsistency, not a missing concept. A staff account with `announcements_send` (or anyone who takes over such an account) could plant script that runs in every tenant's browser.

2. **Any logged in user can fetch any Google Drive file by its id (F-02, MEDIUM).** `/api/photo/:id` (guarded only by "is logged in") and `/api/drive/:fileId` stream any Drive object without checking that the object belongs to the caller. Access rests entirely on Drive ids being unguessable. This is broken object level authorization (OWASP API1); unguessable ids leak through logs, history, and backups.

3. **No HTTP security headers (F-03, MEDIUM).** There is no `_headers` file and the middleware sets none, so the app ships without Content Security Policy, HSTS, `X-Frame-Options` / `frame-ancestors` (clickjacking), `Referrer-Policy`, or `Permissions-Policy`. This both allows the site to be framed and removes the safety net that would blunt F-01.

4. **Vulnerable dependencies (F-04, MEDIUM).** `npm audit` reports 23 advisories. The 2 critical and most high items are in the dev and build toolchain (vitest/tinypool, vite) and do not ship to the Cloudflare runtime, but they are a real local dev and CI supply chain risk. One production dependency (`react-router-dom`) carries a HIGH advisory that appears not to apply to this SPA (it is RSC mode specific), and the fix is non breaking.

## Business implications

- Tenant personal data, lease documents, and rent ledgers are protected by a sound isolation and authorization model. The audit did not find a path for one tenant to read another tenant's data, nor for a tenant to escalate to staff.
- The financial record keeping (rent, credits, allocations, late fees, autopay) is validated server side and audit logged, so numbers cannot be quietly corrupted through the API by an unprivileged user.
- The practical residual risk is concentrated in a staff level stored XSS and a defense in depth gap on file access. Both are fixable in hours, not weeks.

## Recommended immediate actions

1. Sanitize announcement HTML on render (reuse or centralize the Property Notes `sanitize`), and ideally on write as well. (F-01)
2. Add a `public/_headers` file (or set headers in `_middleware.ts`) with CSP, HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options`, and `Referrer-Policy`. (F-03)
3. Bind `/api/photo/:id` and `/api/drive/:fileId` to an ownership or reachability check rather than relying on id secrecy. (F-02)
4. Run `npm audit fix` (non breaking) and move the critical/high dev toolchain packages forward; confirm the GitHub repo is private. (F-04, F-05)

## Is the application ready to handle real tenant data in production?

**CONDITIONALLY READY.** It is already live and the core security model is production grade. Proceed, but schedule the four MEDIUM fixes promptly (Priority 0 and 1 in Report 7). None of them should block continued operation; all of them reduce real risk.

## Limitations of this audit

- **Read only, no live testing.** No staging or production environment was authorized for active probing, so IDOR, XSS execution, webhook replay, and concurrency races were verified by reading code, not by exploiting a running system. Treat "code verified" as strong but not equivalent to a runtime proof.
- **No access to the deployed Cloudflare configuration.** HSTS, WAF rules, rate limits, or headers that might be set at the Cloudflare edge (outside the repo) could not be confirmed. F-03 reflects what is in the code; verify the edge.
- **No access to production data or secret values.** Secrets were checked for presence and handling, never read. Secret rotation state was inferred from commit messages.
- D1 (SQLite) has no row level security by design; all isolation is application enforced. The review covered the enforcement code, but a single future endpoint that forgets the pattern would have no database safety net. See Report 4.
