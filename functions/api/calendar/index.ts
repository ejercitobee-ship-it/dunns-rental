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
    priority: r.priority ?? 'medium',
    isRecurring: !!r.is_recurring,
    recurrenceRule: r.recurrence_rule ?? undefined,
    completed: !!r.completed,
    completedAt: r.completed_at ?? undefined,
    notes: r.notes ?? undefined,
    reminderHours: r.reminder_hours != null ? Number(r.reminder_hours) : undefined,
    createdAt: r.created_at,
  };
}

async function getPropertyIdsForEvents(env: Env, eventIds: string[]): Promise<Map<string, string[]>> {
  if (eventIds.length === 0) return new Map();
  const { results } = await env.DB.prepare(
    `SELECT event_id, property_id FROM calendar_event_properties WHERE event_id IN (${eventIds.map(() => '?').join(',')})`,
  ).bind(...eventIds).all();
  const map = new Map<string, string[]>();
  for (const r of (results || [])) {
    const eid = r.event_id as string;
    if (!map.has(eid)) map.set(eid, []);
    map.get(eid)!.push(r.property_id as string);
  }
  return map;
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
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'finances_view');
  if (auth instanceof Response) return auth;

  try {
    const { results } = await env.DB.prepare(
      'SELECT * FROM calendar_events ORDER BY event_date ASC'
    ).all();
    const rows = (results || []) as Record<string, unknown>[];
    const eventIds = rows.map(r => r.id as string);
    const propMap = await getPropertyIdsForEvents(env, eventIds);
    return jsonOk({ success: true, data: rows.map(r => serializeEvent(r, propMap.get(r.id as string) || [])) });
  } catch {
    return serverError();
  }
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'finances_expenses');
  if (auth instanceof Response) return auth;

  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (!body.title || !body.category || !body.eventDate) {
      return jsonError('Title, category, and event date are required', 400);
    }

    const propertyIds = Array.isArray(body.propertyIds) ? (body.propertyIds as string[]).filter(Boolean) : [];
    const primaryPropertyId = propertyIds[0] ?? (body.propertyId as string) ?? null;

    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO calendar_events (id, property_id, unit_id, title, description, category, event_date, priority, is_recurring, recurrence_rule, notes, user_id, reminder_hours)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      primaryPropertyId,
      body.unitId ?? null,
      body.title,
      body.description ?? null,
      body.category,
      body.eventDate,
      body.priority ?? 'medium',
      body.isRecurring ? 1 : 0,
      body.recurrenceRule ?? null,
      body.notes ?? null,
      auth.id,
      body.reminderHours ?? null,
    ).run();

    if (propertyIds.length > 0) {
      await syncEventProperties(env, id, propertyIds);
    } else if (primaryPropertyId) {
      await syncEventProperties(env, id, [primaryPropertyId]);
    }

    const row = await env.DB.prepare('SELECT * FROM calendar_events WHERE id = ?').bind(id).first();
    const pids = propertyIds.length > 0 ? propertyIds : (primaryPropertyId ? [primaryPropertyId] : []);
    context.waitUntil(notifyAdmins(env, 'created', row as Record<string, unknown>, pids));
    return jsonOk({ success: true, data: serializeEvent(row as Record<string, unknown>, pids) }, 201);
  } catch {
    return serverError();
  }
};
