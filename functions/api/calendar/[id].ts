import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { sendEmail, calendarEventEmail } from '../../lib/email';

function serializeEvent(r: Record<string, unknown>, propertyIds?: string[]) {
  return {
    id: r.id,
    propertyId: r.property_id ?? undefined,
    propertyIds: propertyIds ?? (r.property_id ? [r.property_id as string] : []),
    unitId: r.unit_id ?? undefined,
    title: r.title,
    description: r.description ?? undefined,
    category: r.category,
    eventDate: r.event_date,
    endDate: r.end_date ?? undefined,
    eventTime: r.event_time ?? undefined,
    priority: r.priority ?? 'medium',
    isRecurring: !!r.is_recurring,
    recurrenceRule: r.recurrence_rule ?? undefined,
    completed: !!r.completed,
    completedAt: r.completed_at ?? undefined,
    notes: r.notes ?? undefined,
    reminderHours: r.reminder_hours != null ? Number(r.reminder_hours) : undefined,
    createdAt: r.created_at,
    isAuto: !!r.is_auto,
  };
}

async function getEventPropertyIds(env: Env, eventId: string): Promise<string[]> {
  const { results } = await env.DB.prepare(
    'SELECT property_id FROM calendar_event_properties WHERE event_id = ?'
  ).bind(eventId).all();
  return (results || []).map(r => r.property_id as string);
}

async function syncEventProperties(env: Env, eventId: string, propertyIds: string[]) {
  await env.DB.prepare('DELETE FROM calendar_event_properties WHERE event_id = ?').bind(eventId).run();
  if (propertyIds.length > 0) {
    const values = propertyIds.map(() => '(?, ?)').join(', ');
    const binds: string[] = [];
    for (const pid of propertyIds) { binds.push(eventId, pid); }
    await env.DB.prepare(
      `INSERT OR IGNORE INTO calendar_event_properties (event_id, property_id) VALUES ${values}`
    ).bind(...binds).run();
  }
}

async function notifyAdmins(env: Env, type: 'created' | 'updated' | 'cancelled', eventRow: Record<string, unknown>, propertyIds?: string[]) {
  const admins = await env.DB.prepare(
    `SELECT email FROM user WHERE role IN ('super_admin', 'admin') AND email IS NOT NULL`
  ).all();
  const emails = (admins.results || []).map(r => r.email as string).filter(Boolean);
  if (emails.length === 0) return;

  let propertyName: string | undefined;
  const pids = propertyIds ?? (eventRow.property_id ? [eventRow.property_id as string] : []);
  if (pids.length > 0) {
    const placeholders = pids.map(() => '?').join(',');
    const { results } = await env.DB.prepare(
      `SELECT name, address FROM properties WHERE id IN (${placeholders})`
    ).bind(...pids).all();
    propertyName = (results || []).map(r => (r.name || r.address) as string).filter(Boolean).join(', ');
  }

  const unitRow = eventRow.unit_id
    ? ((await env.DB.prepare('SELECT unit_number FROM units WHERE id = ?').bind(eventRow.unit_id).first()) as { unit_number?: string } | null)
    : null;

  const email = calendarEventEmail({
    type,
    title: eventRow.title as string,
    eventDate: eventRow.event_date as string,
    propertyName: propertyName || undefined,
    unitLabel: unitRow?.unit_number ? `Unit ${unitRow.unit_number}` : undefined,
    description: (eventRow.description as string) || undefined,
    category: (eventRow.category as string) || undefined,
    priority: (eventRow.priority as string) || undefined,
  });

  for (const to of emails) {
    await sendEmail(env, { to, ...email });
  }
}

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'finances_view');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const row = await env.DB.prepare('SELECT * FROM calendar_events WHERE id = ?').bind(id).first();
    if (!row) return jsonError('Event not found', 404);
    const pids = await getEventPropertyIds(env, id);
    return jsonOk({ success: true, data: serializeEvent(row as Record<string, unknown>, pids) });
  } catch {
    return serverError();
  }
};

export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'finances_expenses');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const existing = await env.DB.prepare('SELECT id FROM calendar_events WHERE id = ?').bind(id).first();
    if (!existing) return jsonError('Event not found', 404);

    const body = (await request.json()) as Record<string, unknown>;
    const propertyIds = Array.isArray(body.propertyIds) ? (body.propertyIds as string[]).filter(Boolean) : undefined;
    const primaryPropertyId = propertyIds?.[0] ?? (body.propertyId as string) ?? null;

    await env.DB.prepare(
      `UPDATE calendar_events SET
        property_id = ?, unit_id = ?, title = ?, description = ?,
        category = ?, event_date = ?, end_date = ?, event_time = ?, priority = ?,
        is_recurring = ?, recurrence_rule = ?,
        completed = ?, completed_at = ?, notes = ?,
        reminder_hours = ?,
        updated_at = unixepoch()
       WHERE id = ?`
    ).bind(
      primaryPropertyId,
      body.unitId ?? null,
      body.title ?? null,
      body.description ?? null,
      body.category ?? null,
      body.eventDate ?? null,
      body.endDate ?? null,
      body.eventTime ?? null,
      body.priority ?? 'medium',
      body.isRecurring ? 1 : 0,
      body.recurrenceRule ?? null,
      body.completed ? 1 : 0,
      body.completed ? Math.floor(Date.now() / 1000) : null,
      body.notes ?? null,
      body.reminderHours ?? null,
      id,
    ).run();

    if (propertyIds !== undefined) {
      await syncEventProperties(env, id, propertyIds);
    }

    const row = await env.DB.prepare('SELECT * FROM calendar_events WHERE id = ?').bind(id).first();
    const pids = propertyIds ?? await getEventPropertyIds(env, id);
    context.waitUntil(notifyAdmins(env, 'updated', row as Record<string, unknown>, pids));
    return jsonOk({ success: true, data: serializeEvent(row as Record<string, unknown>, pids) });
  } catch {
    return serverError();
  }
};

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'finances_expenses');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const existing = await env.DB.prepare('SELECT * FROM calendar_events WHERE id = ?').bind(id).first();
    if (!existing) return jsonError('Event not found', 404);
    const pids = await getEventPropertyIds(env, id);

    // Junction rows cascade-delete with the event.
    await env.DB.prepare('DELETE FROM calendar_events WHERE id = ?').bind(id).run();
    context.waitUntil(notifyAdmins(env, 'cancelled', existing as Record<string, unknown>, pids));
    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
