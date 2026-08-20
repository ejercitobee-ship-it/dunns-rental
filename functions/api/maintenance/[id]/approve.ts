import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../lib/session';
import { serializeMaintenance } from '../../../lib/serializers';
import { logStatusChange } from '../../../lib/maintenance';
import { notifyHandyman } from '../../../lib/maintenance-notify';
import { sendPushToUser } from '../../../lib/push';
import { SITE_URL } from '../../../lib/site';

/**
 * POST /api/maintenance/:id/approve — admin approves a completed (or handyman-
 * reported) job.
 *
 * Two paths depending on whether the job has an assigned handyman:
 *
 * 1. **With assigned handyman (invoice flow):** sets the approved cost, moves
 *    the status to `approved_for_invoicing`, and emails + pushes the handyman
 *    so they can upload their invoice. The expense is NOT written yet; that
 *    happens when the admin later approves the submitted invoice.
 *
 * 2. **Without an assigned handyman (direct flow):** same as the legacy
 *    behaviour: clears needs_approval, writes the expense right away.
 *
 * An explicit `{ skipInvoice: true }` in the body forces path 2 even when a
 * handyman is assigned (for small jobs where an invoice is overkill).
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'maintenance_approve');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const body = (await request.json()) as Record<string, unknown>;
    const cost = Number(body.cost);
    if (!Number.isFinite(cost) || cost < 0) return jsonError('Enter a valid amount', 400);
    const skipInvoice = !!body.skipInvoice;

    const req = await env.DB.prepare(
      'SELECT status, title, property_id, unit_id, assigned_handyman_id FROM maintenance_requests WHERE id = ?'
    )
      .bind(id)
      .first<{ status: string; title: string; property_id: string | null; unit_id: string | null; assigned_handyman_id: string | null }>();
    if (!req) return jsonError('Request not found', 404);
    if (req.status === 'cancelled') return jsonError('This request was cancelled', 400);

    const today = new Date().toISOString().slice(0, 10);
    const useInvoiceFlow = !!req.assigned_handyman_id && !skipInvoice;

    if (useInvoiceFlow) {
      // --- Invoice flow: approve work, notify handyman to upload invoice. ---
      const stmts = [
        env.DB.prepare(
          `UPDATE maintenance_requests
              SET cost = ?, needs_approval = 0, approved_at = ?, status = 'approved_for_invoicing',
                  resolved_date = COALESCE(resolved_date, ?), updated_at = unixepoch()
            WHERE id = ?`
        ).bind(cost, today, today, id),
        logStatusChange(env.DB, id, req.status, 'approved_for_invoicing', auth.id, auth.name, `Approved cost: $${cost.toFixed(2)}`),
      ];
      await env.DB.batch(stmts);

      // Look up property + unit for the notification email.
      const prop = req.property_id
        ? await env.DB.prepare('SELECT name, address FROM properties WHERE id = ?').bind(req.property_id).first<{ name: string; address: string }>()
        : null;
      const unit = req.unit_id
        ? await env.DB.prepare('SELECT unit_number FROM units WHERE id = ?').bind(req.unit_id).first<{ unit_number: string }>()
        : null;
      const location = [prop?.address, unit ? `Unit ${unit.unit_number}` : null].filter(Boolean).join(', ');

      // Notify the handyman (email + push) — best-effort.
      context.waitUntil(
        (async () => {
          const portalUrl = `${SITE_URL}/portal/jobs`;
          await notifyHandyman(env, req.assigned_handyman_id!, 'Your work is approved. Please submit your invoice.', [
            ['Job', req.title],
            ['Location', location || 'Not set'],
            ['Approved cost', `$${cost.toFixed(2)}`],
            ['Next step', 'Upload your invoice in the portal.'],
          ], { url: portalUrl, label: 'Upload invoice' });
          // Push via the handyman's user_id.
          const h = await env.DB.prepare('SELECT user_id FROM handymen WHERE id = ?')
            .bind(req.assigned_handyman_id)
            .first<{ user_id: string | null }>();
          await sendPushToUser(env, h?.user_id, {
            title: 'Invoice requested',
            body: `${req.title}: your work is approved. Upload your invoice.`,
            url: '/portal/jobs',
          });
        })().catch(e => console.error('approve-for-invoicing notify failed', e))
      );
    } else {
      // --- Direct flow: approve the work but do NOT write an expense yet. ---
      // The expense is created only when the admin explicitly clicks "Mark paid"
      // (the pay endpoint). This keeps financials on a cash basis: an expense
      // appears when money actually leaves the business, not at approval time.
      const stmts = [
        env.DB.prepare(
          `UPDATE maintenance_requests
              SET cost = ?, needs_approval = 0, approved_at = ?,
                  resolved_date = COALESCE(resolved_date, ?), updated_at = unixepoch()
            WHERE id = ?`
        ).bind(cost, today, today, id),
        logStatusChange(env.DB, id, req.status, req.status, auth.id, auth.name, `Approved (direct): $${cost.toFixed(2)}`),
      ];
      await env.DB.batch(stmts);
    }

    const row = await env.DB.prepare('SELECT * FROM maintenance_requests WHERE id = ?').bind(id).first();
    return jsonOk({ success: true, data: serializeMaintenance(row as Record<string, unknown>) });
  } catch {
    return serverError();
  }
};
