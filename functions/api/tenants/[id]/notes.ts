import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../lib/session';
import { logActivityStmt } from '../../../lib/activity';

interface NoteRow {
  id: string;
  tenant_id: string;
  body: string;
  created_by: string;
  created_at: number;
  updated_at: number | null;
  author_name: string | null;
}

function serialize(r: NoteRow) {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    body: r.body,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    authorName: r.author_name,
  };
}

/** GET /api/tenants/:id/notes */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_view');
  if (auth instanceof Response) return auth;

  try {
    const tenantId = params.id as string;
    const { results } = await env.DB.prepare(
      `SELECT n.*, u.name AS author_name
         FROM tenant_notes n
         LEFT JOIN user u ON u.id = n.created_by
        WHERE n.tenant_id = ?
        ORDER BY n.created_at DESC`
    ).bind(tenantId).all<NoteRow>();

    return jsonOk(results?.map(serialize) || []);
  } catch {
    return serverError();
  }
};

/** POST /api/tenants/:id/notes */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_edit');
  if (auth instanceof Response) return auth;

  try {
    const tenantId = params.id as string;
    const data = (await request.json()) as Record<string, unknown>;
    const body = typeof data.body === 'string' ? data.body.trim() : '';
    if (!body) return jsonError('Note body is required', 400);

    const id = crypto.randomUUID();
    const now = Math.floor(Date.now() / 1000);

    const tenant = await env.DB.prepare(
      `SELECT first_name, last_name FROM tenants WHERE id = ?`
    ).bind(tenantId).first<{ first_name: string; last_name: string }>();

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO tenant_notes (id, tenant_id, body, created_by, created_at) VALUES (?, ?, ?, ?, ?)`
      ).bind(id, tenantId, body, auth.id, now),
      logActivityStmt(env.DB, auth, {
        module: 'tenants',
        action: 'Added note',
        description: `Note added to ${tenant?.first_name ?? ''} ${tenant?.last_name ?? ''}`.trim(),
        targetType: 'tenant',
        targetId: tenantId,
        targetName: tenant ? `${tenant.first_name} ${tenant.last_name}` : undefined,
        tenantId,
        newValues: { body },
      }),
    ]);

    return jsonOk({
      id,
      tenantId,
      body,
      createdBy: auth.id,
      createdAt: now,
      updatedAt: null,
      authorName: auth.name || null,
    }, 201);
  } catch {
    return serverError();
  }
};

/** PUT /api/tenants/:id/notes — body: { noteId, body } */
export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_edit');
  if (auth instanceof Response) return auth;

  try {
    const tenantId = params.id as string;
    const data = (await request.json()) as Record<string, unknown>;
    const noteId = typeof data.noteId === 'string' ? data.noteId : '';
    const body = typeof data.body === 'string' ? data.body.trim() : '';
    if (!noteId || !body) return jsonError('noteId and body are required', 400);

    const existing = await env.DB.prepare(
      `SELECT body FROM tenant_notes WHERE id = ? AND tenant_id = ?`
    ).bind(noteId, tenantId).first<{ body: string }>();
    if (!existing) return jsonError('Note not found', 404);

    const now = Math.floor(Date.now() / 1000);
    const tenant = await env.DB.prepare(
      `SELECT first_name, last_name FROM tenants WHERE id = ?`
    ).bind(tenantId).first<{ first_name: string; last_name: string }>();

    await env.DB.batch([
      env.DB.prepare(
        `UPDATE tenant_notes SET body = ?, updated_at = ? WHERE id = ?`
      ).bind(body, now, noteId),
      logActivityStmt(env.DB, auth, {
        module: 'tenants',
        action: 'Edited note',
        description: `Note edited on ${tenant?.first_name ?? ''} ${tenant?.last_name ?? ''}`.trim(),
        targetType: 'tenant',
        targetId: tenantId,
        targetName: tenant ? `${tenant.first_name} ${tenant.last_name}` : undefined,
        tenantId,
        previousValues: { body: existing.body },
        newValues: { body },
      }),
    ]);

    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};

/** DELETE /api/tenants/:id/notes — body: { noteId } */
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_edit');
  if (auth instanceof Response) return auth;

  try {
    const tenantId = params.id as string;
    const data = (await request.json()) as Record<string, unknown>;
    const noteId = typeof data.noteId === 'string' ? data.noteId : '';
    if (!noteId) return jsonError('noteId is required', 400);

    const existing = await env.DB.prepare(
      `SELECT body FROM tenant_notes WHERE id = ? AND tenant_id = ?`
    ).bind(noteId, tenantId).first<{ body: string }>();
    if (!existing) return jsonError('Note not found', 404);

    const tenant = await env.DB.prepare(
      `SELECT first_name, last_name FROM tenants WHERE id = ?`
    ).bind(tenantId).first<{ first_name: string; last_name: string }>();

    await env.DB.batch([
      env.DB.prepare(`DELETE FROM tenant_notes WHERE id = ?`).bind(noteId),
      logActivityStmt(env.DB, auth, {
        module: 'tenants',
        action: 'Deleted note',
        description: `Note deleted from ${tenant?.first_name ?? ''} ${tenant?.last_name ?? ''}`.trim(),
        targetType: 'tenant',
        targetId: tenantId,
        targetName: tenant ? `${tenant.first_name} ${tenant.last_name}` : undefined,
        tenantId,
        previousValues: { body: existing.body },
      }),
    ]);

    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
