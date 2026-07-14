import type { PagesFunction } from '@cloudflare/workers-types';
import {
  type Env,
  getSessionUser,
  hashPassword,
  jsonOk,
  jsonError,
  forbidden,
  unauthorized,
  serverError,
} from '../../lib/session';
import { roleCan } from '../../lib/permissions';

function generateTempPassword(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%';
  const random = crypto.getRandomValues(new Uint8Array(16));
  let password = '';
  for (let i = 0; i < 16; i++) {
    password += chars.charAt(random[i] % chars.length);
  }
  return password;
}

const ASSIGNABLE_ROLES = new Set(['super_admin', 'admin', 'manager', 'accountant', 'viewer']);

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { request, env } = context;

  try {
    const caller = await getSessionUser(env, request);
    if (!caller) return unauthorized();
    if (!roleCan(caller.role, 'users_create')) return forbidden();

    const body = (await request.json()) as {
      firstName?: string;
      lastName?: string;
      email?: string;
      roleId?: string;
    };

    const firstName = body.firstName?.trim();
    const lastName = body.lastName?.trim();
    const email = body.email?.trim().toLowerCase();
    const roleId = body.roleId;

    if (!firstName || !lastName || !email || !roleId) {
      return jsonError('Missing required fields', 400);
    }
    if (!ASSIGNABLE_ROLES.has(roleId)) {
      return jsonError('Invalid role', 400);
    }

    const existingUser = await env.DB.prepare('SELECT id FROM user WHERE email = ?')
      .bind(email)
      .first();

    if (existingUser) {
      return jsonError('An account with this email already exists', 409);
    }

    const tempPassword = generateTempPassword();
    const passwordHash = await hashPassword(tempPassword);
    const userId = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);
    const name = `${firstName} ${lastName}`;

    await env.DB.prepare(
      'INSERT INTO user (id, name, email, email_verified, image, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
      .bind(userId, name, email, 0, null, now, now)
      .run();

    await env.DB.prepare(
      'INSERT INTO account (id, account_id, provider_id, user_id, password, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
      .bind(crypto.randomUUID(), email, 'credential', userId, passwordHash, now, now)
      .run();

    await env.DB.prepare(
      'INSERT INTO user_roles (id, user_id, role, created_at, updated_at) VALUES (?, ?, ?, ?, ?)'
    )
      .bind(crypto.randomUUID(), userId, roleId, now, now)
      .run();

    // Require the new user to change the temporary password on first login.
    await env.DB.prepare(
      'INSERT INTO user_metadata (id, user_id, key, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
      .bind(crypto.randomUUID(), userId, 'force_password_reset', 'true', now, now)
      .run();

    return jsonOk(
      {
        success: true,
        user: { id: userId, email, name, role: roleId },
        tempPassword,
        message: 'User created. Share the temporary password with them securely.',
      },
      201
    );
  } catch {
    return serverError();
  }
};
