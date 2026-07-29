import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser, jsonOk, jsonError, serverError } from '../../../lib/session';
import { handymanForUser } from '../../../lib/portal';
import { serializeJob, loadOwnedJob } from '../../../lib/handyman-jobs';
import { notifyOffice } from '../../../lib/maintenance-notify';

/**
 * POST /api/portal/handyman/report — a handyman logs work they did (for cases a
 * tenant never filed a request). It is created assigned to them, already
 * completed, and flagged needs_approval so it stays OUT of Finances until an
 * admin approves the cost. The handyman proposes a cost; only an admin's
 * approval sets the real number and writes the expense, so a handyman can never
 * inflate an expense on their own.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;
  if (auth.role !== 'handyman') return jsonError('Not a handyman account', 403);

  try {
    const handyman = await handymanForUser(env, auth.id);
    if (!handyman) return jsonError('No active handyman record is linked to this login', 404);

    const body = (await request.json()) as Record<string, unknown>;
    const title = String(body.title || '').trim();
    const propertyId = String(body.propertyId || '');
    const unitId = body.unitId ? String(body.unitId) : null;
    const description = body.description ? String(body.description).trim() : null;
    const category = body.category ? String(body.category) : 'general';
    const cost = Number(body.cost);
    const date = String(body.date || '').slice(0, 10) || new Date().toISOString().slice(0, 10);

    if (!title) return jsonError('A short title for the work is required', 400);
    if (!propertyId) return jsonError('Choose the property', 400);
    if (!Number.isFinite(cost) || cost < 0) return jsonError('Enter a valid cost', 400);

    // The property must exist; if a unit is given it must belong to that property
    // (so a handyman cannot attach work to a mismatched or arbitrary unit).
    const prop = await env.DB.prepare('SELECT id FROM properties WHERE id = ?').bind(propertyId).first();
    if (!prop) return jsonError('That property was not found', 404);
    if (unitId) {
      const unit = await env.DB.prepare('SELECT id FROM units WHERE id = ? AND property_id = ?')
        .bind(unitId, propertyId).first();
      if (!unit) return jsonError('That unit is not in the chosen property', 400);
    }

    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO maintenance_requests
         (id, title, description, property_id, unit_id, category, priority, status, cost, reported_cost,
          assigned_handyman_id, created_by, needs_approval, reported_date, resolved_date)
       VALUES (?, ?, ?, ?, ?, ?, 'medium', 'completed', ?, ?, ?, 'handyman', 1, ?, ?)`
    )
      .bind(id, title, description, propertyId, unitId, category, cost, cost, handyman.id, date, date)
      .run();

    const row = await loadOwnedJob(env, id, handyman.id);
    if (!row) return serverError();
    const job = serializeJob(row);
    const hName = (await env.DB.prepare('SELECT name FROM handymen WHERE id = ?').bind(handyman.id).first<{ name: string }>())?.name;

    context.waitUntil(
      notifyOffice(env, `Work logged for approval: ${job.title}`, [
        ['Handyman', hName || 'Unknown'],
        ['Location', job.locationLabel || 'Not set'],
        ['Proposed cost', `$${cost.toFixed(2)}`],
        ['Next', 'Review and approve it on the Maintenance page.'],
      ]).catch((e) => console.error('report notify failed', e))
    );

    return jsonOk({ success: true, data: job }, 201);
  } catch {
    return serverError();
  }
};
