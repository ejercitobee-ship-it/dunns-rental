import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requireUser, jsonOk, jsonError, serverError } from '../../../lib/session';
import { tenantIdForUser } from '../../../lib/portal';
import { serializeMaintenance } from '../../../lib/serializers';
import { MAINTENANCE_TRADES } from '../../../lib/maintenance';
import { notifyNewRequest, type AvailabilityWindow } from '../../../lib/maintenance-notify';

/** The tenant's current lease with its unit and property, for a new request. */
async function currentPlacement(env: Env, tenantId: string) {
  const lease = await env.DB.prepare(
    `SELECT l.* FROM leases l
       JOIN lease_tenants lt ON lt.lease_id = l.id
      WHERE lt.tenant_id = ? AND l.status != 'ended' AND (l.needs_review IS NULL OR l.needs_review = 0)
      ORDER BY l.start_date DESC LIMIT 1`
  ).bind(tenantId).first<{ id: string; unit_id: string | null; property_id: string | null }>();
  const unit = lease?.unit_id
    ? await env.DB.prepare('SELECT * FROM units WHERE id = ?').bind(lease.unit_id).first<{ id: string; unit_number: string }>()
    : null;
  const property = lease?.property_id
    ? await env.DB.prepare('SELECT * FROM properties WHERE id = ?').bind(lease.property_id).first<{ id: string; name: string; address: string }>()
    : null;
  return { lease, unit, property };
}

/** Attach the handyman's name and phone to each request the tenant can see. */
function serializePortalRequest(row: Record<string, unknown>) {
  return {
    ...serializeMaintenance(row),
    handymanName: row.handyman_name ?? undefined,
    handymanPhone: row.handyman_phone ?? undefined,
  };
}

/** GET /api/portal/maintenance — the caller's own maintenance requests. */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;
  if (auth.role !== 'tenant') return jsonError('Not a tenant account', 403);

  try {
    const tenantId = await tenantIdForUser(env, auth.id);
    if (!tenantId) return jsonError('No tenant record is linked to this login', 404);

    // Scoped to this tenant's own rows only. The handyman join exposes just the
    // name and phone of whoever is coming, never anything else about them.
    const { results } = await env.DB.prepare(
      `SELECT m.*, h.name AS handyman_name, h.phone AS handyman_phone
         FROM maintenance_requests m
         LEFT JOIN handymen h ON h.id = m.assigned_handyman_id
        WHERE m.tenant_id = ?
        ORDER BY m.created_at DESC`
    ).bind(tenantId).all();

    return jsonOk({ success: true, data: (results || []).map((r) => serializePortalRequest(r as Record<string, unknown>)) });
  } catch {
    return serverError();
  }
};

/** Keep only well-formed availability windows. */
function cleanAvailability(input: unknown): AvailabilityWindow[] {
  if (!Array.isArray(input)) return [];
  const out: AvailabilityWindow[] = [];
  for (const w of input) {
    if (w && typeof w === 'object') {
      const o = w as Record<string, unknown>;
      const date = typeof o.date === 'string' ? o.date : '';
      if (!date) continue;
      out.push({
        date,
        start: typeof o.start === 'string' ? o.start : '',
        end: typeof o.end === 'string' ? o.end : '',
      });
    }
  }
  return out.slice(0, 10);
}

/**
 * POST /api/portal/maintenance — a tenant reports an issue. The unit and
 * property come from their current lease, never from the request body, so a
 * tenant can only ever file against their own home. Matching handymen and the
 * office are emailed best-effort after the row is written.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requireUser(env, request);
  if (auth instanceof Response) return auth;
  if (auth.role !== 'tenant') return jsonError('Not a tenant account', 403);

  try {
    const tenantId = await tenantIdForUser(env, auth.id);
    if (!tenantId) return jsonError('No tenant record is linked to this login', 404);

    const body = (await request.json()) as Record<string, unknown>;
    const title = typeof body.title === 'string' ? body.title.trim() : '';
    if (!title) return jsonError('Please describe the issue', 400);

    const rawCategory = typeof body.category === 'string' ? body.category : 'general';
    const category = (MAINTENANCE_TRADES as readonly string[]).includes(rawCategory) ? rawCategory : 'general';
    const description = typeof body.description === 'string' ? body.description.trim() : '';
    const availability = cleanAvailability(body.availability);

    const tenant = await env.DB.prepare('SELECT first_name, last_name, email FROM tenants WHERE id = ?')
      .bind(tenantId)
      .first<{ first_name: string; last_name: string; email: string | null }>();
    const { unit, property } = await currentPlacement(env, tenantId);

    const id = crypto.randomUUID();
    const today = new Date().toISOString().slice(0, 10);
    await env.DB.prepare(
      `INSERT INTO maintenance_requests
        (id, property_id, unit_id, tenant_id, title, description, category, priority, status, cost,
         reported_date, availability, created_by, user_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'medium', 'submitted', 0, ?, ?, 'tenant', ?)`
    )
      .bind(
        id,
        property?.id ?? null,
        unit?.id ?? null,
        tenantId,
        title,
        description || null,
        category,
        today,
        availability.length ? JSON.stringify(availability) : null,
        auth.id
      )
      .run();

    const locationLabel = [property?.address || property?.name, unit ? `Unit ${unit.unit_number}` : null]
      .filter(Boolean)
      .join(', ');
    const tenantName = tenant ? `${tenant.first_name} ${tenant.last_name}`.trim() : undefined;

    context.waitUntil(
      notifyNewRequest(env, new URL(request.url).origin, {
        id,
        title,
        category,
        description,
        tenantName,
        locationLabel,
        availability,
      }).catch((e) => console.error('notifyNewRequest failed', e))
    );

    const row = await env.DB.prepare('SELECT * FROM maintenance_requests WHERE id = ?').bind(id).first();
    return jsonOk({ success: true, data: serializeMaintenance(row as Record<string, unknown>) }, 201);
  } catch {
    return serverError();
  }
};
