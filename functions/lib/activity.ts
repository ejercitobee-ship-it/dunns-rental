import { type Env, type SessionUser } from './session';

// Human labels for the resources the API exposes. The middleware turns a
// method + path into one readable action using these.
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
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Turn a request method and path into a readable action plus the target it
 * touched. Returns null for paths we deliberately do not log (auth flows and
 * the activity log itself). Unknown resources still produce a sensible generic
 * action, so anything added later is captured without extra wiring.
 */
export function describeAction(method: string, pathname: string): ParsedAction | null {
  // Strip the /api prefix and split into segments.
  const segs = pathname.replace(/^\/+/, '').split('/').filter(Boolean);
  if (segs[0] !== 'api') return null;
  const parts = segs.slice(1);
  if (parts.length === 0) return null;

  // Never log auth flows or reads of the log itself.
  if (parts[0] === 'auth' || parts[0] === 'activity' || parts[0] === 'rent-sheet' || parts[0] === 'google' || parts[0] === 'photo') {
    return null;
  }

  // /api/admin/users/... — the real resource is the segment after "admin".
  let resource = parts[0];
  let rest = parts.slice(1);
  if (resource === 'admin' && parts[1]) {
    resource = parts[1];
    rest = parts.slice(2);
  }
  // /api/portal/... — portal actions by a tenant/realtor/handyman.
  const isPortal = resource === 'portal';
  if (isPortal && parts[1]) {
    resource = parts[1];
    rest = parts.slice(2);
  }

  const label = RESOURCE_LABEL[resource] || resource.replace(/-/g, ' ');
  const targetId = rest.find(p => UUID_RE.test(p)) || null;
  const tail = rest[rest.length - 1] || '';
  const verb = VERB[method] || method;

  // Sub-action overrides for the endpoints that are not plain CRUD.
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
    default:
      if (resource === 'payments' && method === 'POST') action = 'Recorded a rent payment';
      else if (resource === 'settings') action = 'Updated settings';
      else if (resource === 'me') action = 'Updated their own profile';
      else action = `${verb} a ${label}`;
  }

  return { action, targetType: resource, targetId };
}

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
       (id, user_id, user_name, user_role, method, path, action, target_type, target_id, status_code)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      crypto.randomUUID(),
      actor.id,
      actor.name || null,
      actor.role || null,
      method,
      pathname,
      parsed.action,
      parsed.targetType,
      parsed.targetId,
      statusCode
    )
    .run();
}
