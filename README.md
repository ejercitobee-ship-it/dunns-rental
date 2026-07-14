# Dunn's Rental

A property management dashboard for tracking properties, units, tenants, rent
payments, expenses, income, and tax reports. It is a shared workspace: everyone
on the team sees the same data, and what each person can change is controlled by
their role.

## Stack

- **Frontend:** React 19 + TypeScript + Vite + Tailwind CSS, React Router,
  Recharts.
- **Backend:** Cloudflare Pages Functions (the `functions/` directory).
- **Database:** Cloudflare D1 (SQLite), bound as `DB`.
- **Auth:** Custom session-cookie auth. Passwords are hashed with PBKDF2
  (salted, 100k iterations) via the Web Crypto API.

## Local development

```bash
npm install

# Create the local D1 database and apply migrations (first time only)
npx wrangler d1 execute dunns-rental-db --local --file=migrations/0001_initial.sql
npx wrangler d1 execute dunns-rental-db --local --file=migrations/0002_password_reset.sql

# Build the app, then run the Pages dev server (frontend + functions + D1)
npm run build
npx wrangler pages dev dist --port 8788
```

Open http://127.0.0.1:8788. The **first account you register becomes the super
admin**; everyone after that starts as a read-only viewer until an admin
changes their role.

For fast frontend-only iteration you can also run `npm run dev`, but the `/api`
routes are only served by `wrangler pages dev`.

## Scripts

- `npm run dev` — Vite dev server (frontend only).
- `npm run build` — typecheck the app **and** the Pages Functions, then build.
- `npm run typecheck` — typecheck only (app + functions).
- `npm run lint` — ESLint.
- `npm run preview` — preview the production build.

## Deployment (Cloudflare Pages)

1. Apply migrations to the **remote** D1 database (drop `--local`):
   ```bash
   npx wrangler d1 execute dunns-rental-db --file=migrations/0001_initial.sql
   npx wrangler d1 execute dunns-rental-db --file=migrations/0002_password_reset.sql
   ```
2. Push to the branch connected to your Pages project, or run
   `npx wrangler pages deploy dist` after `npm run build`.

The D1 binding and database id are configured in `wrangler.jsonc`.

## Authentication & roles

- Sessions are stored in the `session` table and referenced by an `HttpOnly`,
  `Secure`, `SameSite=Strict` cookie. Sign-in and sign-up set this cookie.
- Every `/api/*` data endpoint requires a valid session. Read endpoints require
  the matching `*_view` permission; write endpoints require the create/edit/
  delete permission for that resource.
- System roles (`super_admin`, `admin`, `manager`, `accountant`, `viewer`) and
  their permissions are defined in `src/types/auth.ts`. The server enforces the
  same map in `functions/lib/permissions.ts` — **update both** if you change a
  role.

### Password reset email (not yet wired)

`POST /api/auth/forgot-password` stores a reset token but does **not** email it
(no email provider is configured). To finish the flow, deliver the token from
that endpoint to the user's email, then have a reset page submit
`{ token, newPassword }` to `POST /api/auth/reset-password`.

## Project layout

```
functions/
  _middleware.ts        Same-origin CORS handling
  lib/
    session.ts          Session lookup, password hashing, response helpers, guards
    permissions.ts      Server-side role -> permission map
    serializers.ts      D1 row (snake_case) -> API shape (camelCase)
  api/                  REST endpoints (auth, properties, units, tenants,
                        payments, expenses, incomes, admin/users)
migrations/             D1 schema
src/                    React app (pages, components, contexts, types)
```
