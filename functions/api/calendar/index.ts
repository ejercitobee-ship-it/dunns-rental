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
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'finances_view');
  if (auth instanceof Response) return auth;

  try {
    const { results } = await env.DB.prepare(
      'SELECT * FROM calendar_events ORDER BY event_date ASC'
    ).all();
    return jsonOk({ success: true, data: (results || []).map(r => serializeEvent(r as Record<string, unknown>)) });
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

    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO calendar_events (id, property_id, unit_id, title, description, category, event_date, priority, is_recurring, recurrence_rule, notes, user_id, reminder_hours)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      id,
      body.propertyId ?? null,
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

    const row = await env.DB.prepare('SELECT * FROM calendar_events WHERE id = ?').bind(id).first();
    context.waitUntil(notifyAdmins(env, 'created', row as Record<string, unknown>));
    return jsonOk({ success: true, data: serializeEvent(row as Record<string, unknown>) }, 201);
  } catch {
    return serverError();
  }
};
