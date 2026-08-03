import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { sendEmail, calendarEventEmail } from '../../lib/email';

function serializeEvent(r: Record<string, unknown>) {
  return {
    id: r.id,
    propertyId: r.property_id ?? undefined,
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

async function notifyAdmins(env: Env, type: 'created' | 'updated' | 'cancelled', eventRow: Record<string, unknown>) {
  const admins = await env.DB.prepare(
    `SELECT email FROM user WHERE role IN ('super_admin', 'admin') AND email IS NOT NULL`
  ).all();
  const emails = (admins.results || []).map(r => r.email as string).filter(Boolean);
  if (emails.length === 0) return;

  const propertyName = eventRow.property_id
    ? ((await env.DB.prepare('SELECT name, address FROM properties WHERE id = ?').bind(eventRow.property_id).first()) as { name?: string; address?: string } | null)
    : null;
  const unitRow = eventRow.unit_id
    ? ((await env.DB.prepare('SELECT unit_number FROM units WHERE id = ?').bind(eventRow.unit_id).first()) as { unit_number?: string } | null)
    : null;

  const email = calendarEventEmail({
    type,
    title: eventRow.title as string,
    eventDate: eventRow.event_date as string,
    propertyName: propertyName?.name || propertyName?.address || undefined,
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
    const row = await env.DB.prepare('SELECT * FROM calendar_events WHERE id = ?')
      .bind(params.id as string).first();
    if (!row) return jsonError('Event not found', 404);
    return jsonOk({ success: true, data: serializeEvent(row as Record<string, unknown>) });
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
    await env.DB.prepare(
      `UPDATE calendar_events SET
        property_id = ?, unit_id = ?, title = ?, description = ?,
        category = ?, event_date = ?, priority = ?,
        is_recurring = ?, recurrence_rule = ?,
        completed = ?, completed_at = ?, notes = ?,
        reminder_hours = ?,
        updated_at = unixepoch()
       WHERE id = ?`
    ).bind(
      body.propertyId ?? null,
      body.unitId ?? null,
      body.title ?? null,
      body.description ?? null,
      body.category ?? null,
      body.eventDate ?? null,
      body.priority ?? 'medium',
      body.isRecurring ? 1 : 0,
      body.recurrenceRule ?? null,
      body.completed ? 1 : 0,
      body.completed ? Math.floor(Date.now() / 1000) : null,
      body.notes ?? null,
      body.reminderHours ?? null,
      id,
    ).run();

    const row = await env.DB.prepare('SELECT * FROM calendar_events WHERE id = ?').bind(id).first();
    context.waitUntil(notifyAdmins(env, 'updated', row as Record<string, unknown>));
    return jsonOk({ success: true, data: serializeEvent(row as Record<string, unknown>) });
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

    await env.DB.prepare('DELETE FROM calendar_events WHERE id = ?').bind(id).run();
    context.waitUntil(notifyAdmins(env, 'cancelled', existing as Record<string, unknown>));
    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
