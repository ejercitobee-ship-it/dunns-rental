import type { Env } from './session';
import { hashPassword, generateTempPassword } from './session';

/**
 * Reset a login's password to a fresh temporary one, force a change at next
 * sign-in, and drop existing sessions. Returns the temporary password so the
 * caller can share it out of band. Shared by the admin "reset user password"
 * and the tenant-profile "reset password" so the two cannot drift apart.
 */
export async function resetUserPassword(env: Env, userId: string, email: string): Promise<string> {
  const tempPassword = generateTempPassword();
  const hash = await hashPassword(tempPassword);
  const now = Math.floor(Date.now() / 1000);

  const updated = await env.DB.prepare(
    'UPDATE account SET password = ?, updated_at = ? WHERE user_id = ? AND provider_id = ?'
  )
    .bind(hash, now, userId, 'credential')
    .run();

  // If the user somehow has no credential row, create one so they can sign in.
  if (!updated.meta.changes) {
    await env.DB.prepare(
      'INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
      .bind(crypto.randomUUID(), email, 'credential', userId, hash, now, now)
      .run();
  }

  await env.DB.prepare(
    `INSERT INTO user_metadata (id, user_id, key, value, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(user_id, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
  )
    .bind(crypto.randomUUID(), userId, 'force_password_reset', 'true', now, now)
    .run();

  await env.DB.prepare('DELETE FROM session WHERE user_id = ?').bind(userId).run();

  return tempPassword;
}

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
