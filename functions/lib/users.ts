import type { Env } from './session';

/**
 * The statements that remove a login and everything that references it, in a
 * foreign-key-safe order, ready to run in one `env.DB.batch([...])`.
 *
 * Several tables reference `user(id)` with NO `ON DELETE` rule, so SQLite (and
 * D1) refuse `DELETE FROM user` while any of them still point at the row. The
 * nullable ones (`tenants.user_id` — a tenant's portal login; `leases.user_id`
 * and `maintenance_requests.user_id` — who created the record) are set to NULL;
 * the non-nullable children (`session`, `account`) are deleted. `user_roles`,
 * `user_metadata` and `password_reset_tokens` cascade on their own, but the
 * first two are deleted explicitly as well so the intent is obvious and the
 * order stays correct if a cascade is ever dropped.
 *
 * Callers that hard-delete a STAFF user must first check they own no
 * `properties`, `expenses`, or `incomes`: those columns are NOT NULL references
 * and cannot be nulled, so ownership must be resolved before deletion. Tenant
 * logins never own any of those, so this batch fully removes them.
 */
export function deleteUserStatements(env: Env, userId: string) {
  return [
    env.DB.prepare('UPDATE tenants SET user_id = NULL WHERE user_id = ?').bind(userId),
    env.DB.prepare('UPDATE leases SET user_id = NULL WHERE user_id = ?').bind(userId),
    env.DB.prepare('UPDATE maintenance_requests SET user_id = NULL WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM session WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM account WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM user_roles WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM user_metadata WHERE user_id = ?').bind(userId),
    env.DB.prepare('DELETE FROM user WHERE id = ?').bind(userId),
  ];
}
