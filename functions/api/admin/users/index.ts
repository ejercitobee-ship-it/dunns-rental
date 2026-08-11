import type { PagesFunction } from '@cloudflare/workers-types';
import {
  type Env,
  getSessionUser,
  requirePermission,
  hashPassword,
  jsonOk,
  jsonError,
  forbidden,
  unauthorized,
  serverError,
} from '../../../lib/session';
import { roleCan } from '../../../lib/permissions';
import { sendInviteLink } from '../../../lib/invite';

interface UserRow {
  id: string;
  name: string | null;
  email: string;
  is_active: number | null;
  phone: string | null;
  department: string | null;
  birthdate: string | null;
  created_at: number | null;
  role: string | null;
  image: string | null;
}

export function serializeUser(r: UserRow) {
  const name = r.name || '';
  const parts = name.split(' ');
  return {
    id: r.id,
    firstName: parts[0] || '',
    lastName: parts.slice(1).join(' ') || '',
    email: r.email,
    phone: r.phone ?? undefined,
    department: r.department ?? undefined,
    birthdate: r.birthdate ?? undefined,
    roleId: r.role || 'viewer',
    isActive: r.is_active !== 0,
    createdAt: r.created_at ? new Date(r.created_at * 1000).toISOString() : new Date().toISOString(),
    photoUrl: r.image ? `/api/photo/${r.image}` : null,
  };
}

function generateTempPassword(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%';
  const random = crypto.getRandomValues(new Uint8Array(16));
  let password = '';
  for (let i = 0; i < 16; i++) password += chars.charAt(random[i] % chars.length);
  return password;
}

const ASSIGNABLE_ROLES = new Set(['super_admin', 'admin', 'manager', 'accountant', 'viewer']);
// Portal roles never belong to an internal team member; they are created through
// their own flows and would strand a login with no matching portal record here.
const PORTAL_ROLES = new Set(['tenant', 'realtor', 'handyman']);

// GET /api/admin/users - list team members.
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'users_view');
  if (auth instanceof Response) return auth;

  try {
    const { results } = await env.DB.prepare(
      `SELECT u.id, u.name, u.email, u.is_active, u.phone, u.department, u.birthdate, u.created_at, u.image, r.role AS role
         FROM user u
         LEFT JOIN user_roles r ON r.user_id = u.id
        ORDER BY u.created_at DESC`
    ).all<UserRow>();
    return jsonOk({ success: true, data: (results || []).map(serializeUser) });
  } catch {
    return serverError();
  }
};

// POST /api/admin/users - create a team member with a temporary password.
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;

  const caller = await getSessionUser(env, request);
  if (!caller) return unauthorized();
  const allowed = caller.permissions
    ? caller.permissions.includes('users_create')
    : roleCan(caller.role, 'users_create');
  if (!allowed) return forbidden();

  try {
    const body = (await request.json()) as {
      firstName?: string;
      lastName?: string;
      email?: string;
      roleId?: string;
      phone?: string;
      department?: string;
      birthdate?: string;
    };

    const firstName = body.firstName?.trim();
    const lastName = body.lastName?.trim();
    const email = body.email?.trim().toLowerCase();
    const roleId = body.roleId;

    if (!firstName || !lastName || !email || !roleId) {
      return jsonError('Missing required fields', 400);
    }
    // Portal roles are created in their own areas (tenants on the Tenants page,
    // handymen on the Maintenance page), never as internal team members here.
    if (PORTAL_ROLES.has(roleId)) {
      return jsonError('That role is managed elsewhere, not on the Users page', 400);
    }
    if (!ASSIGNABLE_ROLES.has(roleId)) {
      // Allow custom roles that exist in the roles table.
      const role = await env.DB.prepare('SELECT id FROM roles WHERE id = ?').bind(roleId).first();
      if (!role) return jsonError('Invalid role', 400);
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
      'INSERT INTO user (id, name, email, email_verified, image, is_active, phone, department, birthdate, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?)'
    )
      .bind(userId, name, email, 0, null, body.phone ?? null, body.department ?? null, body.birthdate ?? null, now, now)
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

    await env.DB.prepare(
      'INSERT INTO user_metadata (id, user_id, key, value, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
      .bind(crypto.randomUUID(), userId, 'force_password_reset', 'true', now, now)
      .run();

    // Email the new team member a branded invite with a set-password link, the
    // same experience tenants get. If the email cannot be sent (Resend not
    // configured, or the address bounced), fall back to returning the temporary
    // password so the admin can still hand over access manually. Either way the
    // forced-reset flag stands, so a shared temp password must be changed on
    // first sign-in, and setting a password through the invite link clears it.
    const invite = await sendInviteLink(env, userId, firstName, email, false, { kind: 'account' });

    return jsonOk(
      {
        success: true,
        user: { id: userId, email, name, role: roleId },
        emailed: invite.sent,
        ...(invite.sent ? {} : { tempPassword }),
        message: invite.sent
          ? `Invite email sent to ${email}.`
          : 'Could not email the invite. Share this temporary password with them securely instead.',
      },
      201
    );
  } catch {
    return serverError();
  }
};
