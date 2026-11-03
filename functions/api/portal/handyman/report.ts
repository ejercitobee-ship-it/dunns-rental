import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser, jsonOk, jsonError, serverError } from '../../../lib/session';
import { handymanForUser } from '../../../lib/portal';
import { serializeJob, loadOwnedJob } from '../../../lib/handyman-jobs';
import { notifyOffice } from '../../../lib/maintenance-notify';
import { generateAndSaveWorkReport } from '../../../lib/work-report';

interface ReportItem {
  propertyId: string;
  unitId: string | null;
  title: string;
  cost: number;
}

/**
 * POST /api/portal/handyman/report — a handyman logs work they did. Accepts
 * either the legacy single-item body or a multi-item body with an `items`
 * array so a handyman can report work across multiple properties/units in one
 * submission. Each item becomes its own maintenance_request, all sharing the
 * same category, date and notes.
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
    const description = body.description ? String(body.description).trim() : null;
    const category = body.category ? String(body.category) : 'general';
    const date = String(body.date || '').slice(0, 10) || new Date().toISOString().slice(0, 10);

    let items: ReportItem[];
    if (Array.isArray(body.items) && body.items.length > 0) {
      items = (body.items as Record<string, unknown>[]).map((it, i) => {
        const title = String(it.title || '').trim();
        const propertyId = String(it.propertyId || '');
        const unitId = it.unitId ? String(it.unitId) : null;
        const cost = Number(it.cost);
        if (!title) throw new Error(`Item ${i + 1}: a short title is required`);
        if (!propertyId) throw new Error(`Item ${i + 1}: choose the property`);
        if (!Number.isFinite(cost) || cost < 0) throw new Error(`Item ${i + 1}: enter a valid cost`);
        return { propertyId, unitId, title, cost };
      });
    } else {
      const title = String(body.title || '').trim();
      const propertyId = String(body.propertyId || '');
      const unitId = body.unitId ? String(body.unitId) : null;
      const cost = Number(body.cost);
      if (!title) return jsonError('A short title for the work is required', 400);
      if (!propertyId) return jsonError('Choose the property', 400);
      if (!Number.isFinite(cost) || cost < 0) return jsonError('Enter a valid cost', 400);
      items = [{ propertyId, unitId, title, cost }];
    }

    if (items.length > 20) return jsonError('Too many items in one report', 400);

    for (const it of items) {
      const prop = await env.DB.prepare('SELECT id FROM properties WHERE id = ?').bind(it.propertyId).first();
      if (!prop) return jsonError(`Property not found for "${it.title}"`, 404);
      if (it.unitId) {
        const unit = await env.DB.prepare('SELECT id FROM units WHERE id = ? AND property_id = ?')
          .bind(it.unitId, it.propertyId).first();
        if (!unit) return jsonError(`Unit not in the chosen property for "${it.title}"`, 400);
      }
    }

    const hName = (await env.DB.prepare('SELECT name FROM handymen WHERE id = ?').bind(handyman.id).first<{ name: string }>())?.name;
    const created: Array<{ id: string; item: ReportItem }> = [];

    for (const it of items) {
      const id = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO maintenance_requests
           (id, title, description, property_id, unit_id, category, priority, status, cost, reported_cost,
            assigned_handyman_id, created_by, needs_approval, reported_date, resolved_date)
         VALUES (?, ?, ?, ?, ?, ?, 'medium', 'completed', ?, ?, ?, 'handyman', 1, ?, ?)`
      )
        .bind(id, it.title, description, it.propertyId, it.unitId, category, it.cost, it.cost, handyman.id, date, date)
        .run();
      created.push({ id, item: it });
    }

    const jobs = [];
    for (const c of created) {
      const row = await loadOwnedJob(env, c.id, handyman.id);
      if (row) jobs.push(serializeJob(row));
    }

    context.waitUntil(
      (async () => {
        for (const c of created) {
          const job = jobs.find(j => j.id === c.id);
          await notifyOffice(env, `Work logged for approval: ${c.item.title}`, [
            ['Handyman', hName || 'Unknown'],
            ['Location', job?.locationLabel || 'Not set'],
            ['Proposed cost', `$${c.item.cost.toFixed(2)}`],
            ['Next', 'Review and approve it on the Maintenance page.'],
          ]);
          const fullRow = await env.DB.prepare(
            `SELECT m.*, p.name AS property_name, p.address AS property_address, u.unit_number
             FROM maintenance_requests m
             LEFT JOIN properties p ON p.id = m.property_id
             LEFT JOIN units u ON u.id = m.unit_id
             WHERE m.id = ?`
          ).bind(c.id).first();
          if (fullRow) await generateAndSaveWorkReport(env, fullRow as Record<string, unknown>, hName || 'Unknown');
        }
      })().catch((e) => console.error('report notify failed', e))
    );

    return jsonOk({ success: true, data: jobs.length === 1 ? jobs[0] : jobs }, 201);
  } catch (err) {
    if (err instanceof Error && err.message.startsWith('Item ')) return jsonError(err.message, 400);
    return serverError();
  }
};
