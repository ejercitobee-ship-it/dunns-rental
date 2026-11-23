# REPORT 4: Role and Permission Matrix

Derived from `functions/lib/permissions.ts` (server mirror), `functions/lib/session.ts` (guards), and `functions/lib/portal.ts` (portal scope). Roles also live in the `roles` table and can be edited live; per user `user_permission_overrides` add extra grants on top of a role. `super_admin` bypasses all permission checks by design, so the owner can never be locked out.

## Actual roles present

Management roles (see the app): `super_admin`, `admin`, `manager`, `accountant`, `viewer`, plus any custom role created in the Roles page.
Portal roles: `tenant`, `realtor`, `handyman`. Portal roles are not in the management permission map; they are authorized by the portal scope resolver, not by permissions.

## Management permission matrix (default system roles)

Legend: Y granted, "." not granted. Permissions abbreviated; full list in `permissions.ts`.

| Permission group | super_admin | admin | manager | accountant | viewer |
|---|---|---|---|---|---|
| dashboard_view | Y | Y | Y | Y | Y |
| properties_view / create / edit | Y | Y | Y / Y / Y | view only | view only |
| properties_delete | Y | Y | . | . | . |
| units_view / create / edit | Y | Y | Y | view only | view only |
| units_delete | Y | Y | . | . | . |
| tenants_view / create / edit | Y | Y | Y | view only | view only |
| tenants_delete | Y | Y | . | . | . |
| rents_view | Y | Y | Y | Y | Y |
| rents_record | Y | Y | Y | Y | . |
| rents_edit | Y | Y | . | . | . |
| rents_export | Y | Y | . | Y | . |
| finances_view | Y | Y | Y | Y | Y |
| finances_expenses | Y | Y | Y | Y | . |
| finances_expenses_delete | Y | . | . | . | . |
| finances_import / merge / rollback | Y | . | . | . | . |
| finances_capital_projects (+delete) | Y | . | . | . | . |
| finances_income | Y | Y | Y | Y | . |
| finances_export | Y | Y | . | Y | . |
| finances_history | Y | . | . | . | . |
| leases_generate / renewals / history | Y | . | . | . | . |
| leases_move_in / terminate / pause | Y | . | . | . | . |
| maintenance_approve / close / history | Y | . | . | . | . |
| documents_upload / delete / drive | Y | . | . | . | . |
| reports_tax / export / edit_data | Y | . | . | . | . |
| users_view / create / edit / delete | Y | . | . | . | . |
| users_roles / users_permissions | Y | . | . | . | . |
| settings_view | Y | Y | . | . | . |
| settings_edit | Y | . | . | . | . |
| activity_view | Y | Y | Y | Y | Y |
| announcements_send | Y | . | . | . | . |
| ai_assistant_use | Y | . | . | . | . |
| tasks_view / create / edit / assign | Y | Y | Y | view only | view only |
| tasks_delete | Y | . | . | . | . |
| projects_manage | Y | Y | . | . | . |
| evictions_view / manage | Y | Y | . | . | . |

Notes:
- `admin` is broad but intentionally cannot delete financial records, import finances, manage leases/documents/users/roles, edit settings, send announcements, or use the AI assistant. Those concentrate on `super_admin`.
- `manager` is operational (create/edit properties, units, tenants; record rent; log expenses) but cannot delete or export.
- `accountant` is finance focused with export rights but no structural edits.
- `viewer` is read only.
- Custom roles can be assigned any subset; `users_roles` and `users_permissions` are effectively owner level (see F-07).

## Portal role access (scope, not permissions)

| Area | tenant | realtor | handyman |
|---|---|---|---|
| Own tenant profile / lease / rent / payments / documents | Y (self only) | . | . |
| Linked tenants' profile and placement | . | Y, linked tenants, 30 day window | . |
| Own maintenance requests + photos | create and view own | . | . |
| Available jobs matching trade / assigned jobs | . | . | Y, trade matched and owned only |
| Submit invoice / schedule / status on own jobs | . | . | Y, own jobs only |
| Messages with office | Y (own thread) | Y (own thread) | Y (own thread) |
| Announcements | Y (property or global) | . | . |
| Any other tenant's records | No (404) | No outside window (404) | No |
| Any management function | No | No | No |

## Excessive or inconsistent permissions found

- **F-07:** `users_roles` and `users_permissions` allow editing any role and granting any valid permission without a "grant only what you hold" rule. By default only `super_admin` holds them, so no live escalation, but a custom role granted either becomes full admin.
- **F-10:** `drive/[fileId]` requires `maintenance_view`, a permission that is not in the map and therefore held by no role except via super_admin bypass. Fail closed, but a drift to fix.
- No role other than `super_admin` can delete financial records, which is a good least privilege choice for financial integrity.

## Front vs back vs DB consistency

- Frontend menus/routes gate by the same permission names but are not the control; the server enforces independently (verified).
- The permission map is duplicated in `src/types/auth.ts` and `functions/lib/permissions.ts`; they must be kept in sync by hand (noted in code). A divergence would show as a UI that offers an action the server then refuses, or vice versa. Worth a shared source or a test.
- The database has no row level security; DB level enforcement is not present by design, so the application layer is the only enforcement. See Report 5.
