import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../../lib/session';

interface NoteRow {
  id: string;
  property_id: string;
  title: string;
  content: string;
  category: string;
  is_pinned: number;
  created_by: string | null;
  created_by_name: string | null;
  created_at: number;
  updated_at: number;
  updated_by: string | null;
  updated_by_name: string | null;
}

interface AttachmentRow {
  id: string;
  note_id: string;
  name: string;
  drive_file_id: string;
  content_type: string | null;
  size: number;
  uploaded_by: string | null;
  uploaded_by_name: string | null;
  uploaded_at: number;
}

function serializeNote(r: NoteRow, attachments: AttachmentRow[] = []) {
  return {
    id: r.id,
    propertyId: r.property_id,
    title: r.title,
    content: r.content,
    category: r.category,
    isPinned: !!r.is_pinned,
    createdBy: r.created_by,
    createdByName: r.created_by_name,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    updatedBy: r.updated_by,
    updatedByName: r.updated_by_name,
    attachments: attachments.map(a => ({
      id: a.id,
      name: a.name,
      driveFileId: a.drive_file_id,
      contentType: a.content_type,
      size: a.size,
      uploadedBy: a.uploaded_by,
      uploadedByName: a.uploaded_by_name,
      uploadedAt: a.uploaded_at,
    })),
  };
}

const VALID_CATEGORIES = [
  'general', 'property_management', 'tenant_communication', 'maintenance',
  'financial', 'inspection', 'legal', 'compliance', 'other',
] as const;

/**
 * GET /api/properties/:id/notes — list all notes for a property.
 * Supports ?category= filter and ?search= text search.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'properties_view');
  if (auth instanceof Response) return auth;

  try {
    const propertyId = params.id as string;
    const url = new URL(request.url);
    const category = url.searchParams.get('category');
    const search = url.searchParams.get('search');

    let sql = 'SELECT * FROM property_notes WHERE property_id = ?';
    const binds: unknown[] = [propertyId];

    if (category && VALID_CATEGORIES.includes(category as typeof VALID_CATEGORIES[number])) {
      sql += ' AND category = ?';
      binds.push(category);
    }
    if (search) {
      sql += ' AND (title LIKE ? OR content LIKE ?)';
      const pattern = `%${search}%`;
      binds.push(pattern, pattern);
    }

    // Pinned first, then most recently updated
    sql += ' ORDER BY is_pinned DESC, updated_at DESC';

    const { results: notes } = await env.DB.prepare(sql).bind(...binds)
      .all<NoteRow>();

    // Fetch attachments for all returned notes in one query
    let attachments: AttachmentRow[] = [];
    if (notes?.length) {
      const noteIds = notes.map(n => n.id);
      const placeholders = noteIds.map(() => '?').join(', ');
      const { results: attRows } = await env.DB.prepare(
        `SELECT * FROM property_note_attachments WHERE note_id IN (${placeholders}) ORDER BY uploaded_at`
      ).bind(...noteIds).all<AttachmentRow>();
      attachments = attRows || [];
    }

    const attachmentsByNote = new Map<string, AttachmentRow[]>();
    for (const a of attachments) {
      const list = attachmentsByNote.get(a.note_id) || [];
      list.push(a);
      attachmentsByNote.set(a.note_id, list);
    }

    return jsonOk({
      success: true,
      data: (notes || []).map(n => serializeNote(n, attachmentsByNote.get(n.id) || [])),
    });
  } catch {
    return serverError();
  }
};

/**
 * POST /api/properties/:id/notes — create a new note.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'properties_edit');
  if (auth instanceof Response) return auth;

  try {
    const propertyId = params.id as string;
    const body = (await request.json()) as {
      title?: string;
      content?: string;
      category?: string;
      isPinned?: boolean;
    };

    if (!body.title?.trim()) return jsonError('Title is required', 400);
    const category = body.category || 'general';
    if (!VALID_CATEGORIES.includes(category as typeof VALID_CATEGORIES[number])) {
      return jsonError('Invalid category', 400);
    }

    // Only super_admin / admin can pin
    const isPinned = body.isPinned && (auth.role === 'super_admin' || auth.role === 'admin') ? 1 : 0;

    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO property_notes
       (id, property_id, title, content, category, is_pinned, created_by, created_by_name)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(id, propertyId, body.title.trim(), body.content || '', category, isPinned, auth.id, auth.name).run();

    const row = await env.DB.prepare('SELECT * FROM property_notes WHERE id = ?')
      .bind(id).first<NoteRow>();
    if (!row) return serverError();

    return jsonOk({ success: true, data: serializeNote(row) }, 201);
  } catch {
    return serverError();
  }
};
