import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';

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
    createdAt: r.created_at,
  };
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
      `INSERT INTO calendar_events (id, property_id, unit_id, title, description, category, event_date, priority, is_recurring, recurrence_rule, notes, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
    ).run();

    const row = await env.DB.prepare('SELECT * FROM calendar_events WHERE id = ?').bind(id).first();
    return jsonOk({ success: true, data: serializeEvent(row as Record<string, unknown>) }, 201);
  } catch {
    return serverError();
  }
};
