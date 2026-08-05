import type { D1Database, D1PreparedStatement } from '@cloudflare/workers-types';
import { type Env, type SessionUser } from './session';

// ─── Module slugs ──────────────────────────────────────────────────────
export type ActivityModule =
  | 'properties' | 'tenants' | 'leases' | 'finances'
  | 'maintenance' | 'documents' | 'calendar' | 'users'
  | 'settings' | 'system';

// ─── Human labels for resources (used by the middleware auto-logger) ────
const RESOURCE_LABEL: Record<string, string> = {
  payments: 'rent payment',
  tenants: 'tenant',
  leases: 'lease',
  properties: 'property',
  units: 'unit',
  expenses: 'expense',
  incomes: 'income',
  maintenance: 'maintenance request',
  handymen: 'handyman',
  realtors: 'realtor',
  users: 'team member',
  roles: 'role',
  settings: 'settings',
  documents: 'document',
  household: 'household member',
  me: 'their own profile',
  calendar: 'calendar event',
  'capital-projects': 'capital project',
  'utility-accounts': 'utility account',
  'prospective-tenants': 'prospective tenant',
  messages: 'message',
};

// Map resource slug to module.
const RESOURCE_MODULE: Record<string, ActivityModule> = {
  payments: 'finances',
  tenants: 'tenants',
  leases: 'leases',
  properties: 'properties',
  units: 'properties',
  expenses: 'finances',
  incomes: 'finances',
  maintenance: 'maintenance',
  handymen: 'maintenance',
  realtors: 'tenants',
  users: 'users',
  roles: 'users',
  settings: 'settings',
  documents: 'documents',
  household: 'tenants',
  me: 'users',
  calendar: 'calendar',
  'capital-projects': 'finances',
  'utility-accounts': 'finances',
  'prospective-tenants': 'tenants',
  messages: 'tenants',
  'rent-sheet': 'finances',
  'expense-imports': 'finances',
  'handyman-messages': 'maintenance',
};

const VERB: Record<string, string> = {
  POST: 'Added',
  PUT: 'Updated',
  PATCH: 'Updated',
  DELETE: 'Deleted',
};

export interface ParsedAction {
  action: string;
  targetType: string | null;
  targetId: string | null;
  module: ActivityModule | null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Turn a request method + path into a readable action plus the target it
 * touched. Returns null for paths we deliberately do not log.
 */
export function describeAction(method: string, pathname: string): ParsedAction | null {
  const segs = pathname.replace(/^\/+/, '').split('/').filter(Boolean);
  if (segs[0] !== 'api') return null;
  const parts = segs.slice(1);
  if (parts.length === 0) return null;

  // Never log auth flows or reads of the log itself.
  if (parts[0] === 'auth' || parts[0] === 'activity' || parts[0] === 'google' || parts[0] === 'photo') {
    return null;
  }

  let resource = parts[0];
  let rest = parts.slice(1);
  if (resource === 'admin' && parts[1]) {
    resource = parts[1];
    rest = parts.slice(2);
  }
  const isPortal = resource === 'portal';
  if (isPortal && parts[1]) {
    resource = parts[1];
    rest = parts.slice(2);
  }

  const label = RESOURCE_LABEL[resource] || resource.replace(/-/g, ' ');
  const targetId = rest.find(p => UUID_RE.test(p)) || null;
  const tail = rest[rest.length - 1] || '';
  const verb = VERB[method] || method;
  const module = RESOURCE_MODULE[resource] || null;

  let action: string;
  switch (tail) {
    case 'invite':
      action = `Sent an invite to a ${label}`;
      break;
    case 'photo':
      action = method === 'DELETE' ? `Removed a ${label} photo` : `Updated a ${label} photo`;
      break;
    case 'pay':
      action = `Recorded payment for a ${label}`;
      break;
    case 'assign':
      action = `Assigned a ${label}`;
      break;
    case 'claim':
      action = `Claimed a ${label}`;
      break;
    case 'schedule':
      action = `Scheduled a ${label}`;
      break;
    case 'status':
      action = `Updated the status of a ${label}`;
      break;
    case 'receipt':
      action = `Generated a receipt`;
      break;
    case 'reset-password':
      action = `Reset a ${label} password`;
      break;
    case 'approve':
      action = `Approved a ${label}`;
      break;
    case 'invoice':
      action = `Submitted an invoice for a ${label}`;
      break;
    case 'invoice-review':
      action = `Reviewed an invoice for a ${label}`;
      break;
    case 'approve-renewal':
      action = `Approved a lease renewal`;
      break;
    case 'generate-renewal':
      action = `Generated a lease renewal`;
      break;
    case 'generate-pdf':
      action = `Generated a lease PDF`;
      break;
    case 'move-in-fee':
      action = `Updated a move-in fee`;
      break;
    case 'convert':
      action = `Converted a ${label} to active tenant`;
      break;
    case 'permissions':
      action = `Updated user permissions`;
      break;
    case 'merge':
      action = `Merged an expense import`;
      break;
    case 'rollback':
      action = `Rolled back an expense import`;
      break;
    case 'sync':
      action = `Synced the rent spreadsheet`;
      break;
    default:
      if (resource === 'payments' && method === 'POST') action = 'Recorded a rent payment';
      else if (resource === 'settings') action = 'Updated settings';
      else if (resource === 'me') action = 'Updated their own profile';
      else action = `${verb} a ${label}`;
  }

  return { action, targetType: resource, targetId, module };
}

// ─── Rich activity logging ─────────────────────────────────────────────

export interface ActivityContext {
  module: ActivityModule;
  action: string;
  targetType?: string;
  targetId?: string;
  targetName?: string;
  description?: string;
  propertyId?: string | null;
  unitId?: string | null;
  tenantId?: string | null;
  previousValues?: Record<string, unknown> | null;
  newValues?: Record<string, unknown> | null;
}

/**
 * Return a prepared statement that inserts one activity row. Designed to be
 * included in a `db.batch()` call alongside the actual write, so the log
 * row is written atomically. For fire-and-forget logging (e.g. the
 * middleware), call `.run()` on the returned statement.
 */
export function logActivityStmt(
  db: D1Database,
  actor: { id: string; name?: string | null; role?: string | null },
  ctx: ActivityContext
): D1PreparedStatement {
  return db.prepare(
    `INSERT INTO activity_log
       (id, user_id, user_name, user_role, method, path, action, module, description,
        target_type, target_id, target_name,
        property_id, unit_id, tenant_id,
        previous_values, new_values, status_code)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?,
             ?, ?, ?,
             ?, ?, ?,
             ?, ?, ?)`
  ).bind(
    crypto.randomUUID(),
    actor.id,
    actor.name || null,
    actor.role || null,
    'API',       // method: not an HTTP verb for explicit calls
    '',          // path: not applicable for explicit calls
    ctx.action,
    ctx.module,
    ctx.description || null,
    ctx.targetType || null,
    ctx.targetId || null,
    ctx.targetName || null,
    ctx.propertyId ?? null,
    ctx.unitId ?? null,
    ctx.tenantId ?? null,
    ctx.previousValues ? JSON.stringify(ctx.previousValues) : null,
    ctx.newValues ? JSON.stringify(ctx.newValues) : null,
    200
  );
}

/**
 * Fire-and-forget version: runs the statement immediately. Use inside
 * `context.waitUntil()` when you cannot batch.
 */
export async function logActivityAsync(
  env: Env,
  actor: { id: string; name?: string | null; role?: string | null },
  ctx: ActivityContext
): Promise<void> {
  await logActivityStmt(env.DB, actor, ctx).run();
}

// ─── Middleware-compatible logger (keeps the old signature) ─────────────

/** Insert one activity-log row. Best-effort: callers run it in waitUntil. */
export async function logActivity(
  env: Env,
  actor: SessionUser,
  method: string,
  pathname: string,
  parsed: ParsedAction,
  statusCode: number
): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO activity_log
       (id, user_id, user_name, user_role, method, path, action, module,
        target_type, target_id, status_code)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?,
             ?, ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      actor.id,
      actor.name || null,
      actor.role || null,
      method,
      pathname,
      parsed.action,
      parsed.module || null,
      parsed.targetType,
      parsed.targetId,
      statusCode
    )
    .run();
}
