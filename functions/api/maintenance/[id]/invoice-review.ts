import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../lib/session';
import { serializeMaintenance } from '../../../lib/serializers';
import { logStatusChange } from '../../../lib/maintenance';
import { notifyHandyman } from '../../../lib/maintenance-notify';
import { sendPushToUser } from '../../../lib/push';
import { SITE_URL } from '../../../lib/site';

/**
 * POST /api/maintenance/:id/invoice-review — admin reviews a submitted invoice.
 *
 * Body: { action: 'approve' | 'reject' | 'revision', reason?: string }
 *
 * • **approve** — sets invoice_approved_at, writes the expense (idempotent
 *   `maint-<id>` row), moves status to `invoice_approved`.
 *
 * • **reject** — records the reason, moves status back to
 *   `approved_for_invoicing` so the handyman can re-submit.
 *
 * • **revision** — same as reject but the label signals "fix and re-upload"
 *   rather than "start over". Functionally identical.
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'maintenance_approve');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const body = (await request.json()) as Record<string, unknown>;
    const action = body.action as string;
    if (!['approve', 'reject', 'revision'].includes(action)) {
      return jsonError('Action must be approve, reject, or revision.', 400);
    }

    const req = await env.DB.prepare(
      `SELECT status, title, property_id, unit_id, assigned_handyman_id, cost,
              invoice_total_amount, invoice_number
         FROM maintenance_requests WHERE id = ?`
    )
      .bind(id)
      .first<{
        status: string; title: string; property_id: string | null; unit_id: string | null;
        assigned_handyman_id: string | null; cost: number | null;
        invoice_total_amount: number | null; invoice_number: string | null;
      }>();
    if (!req) return jsonError('Request not found', 404);
    if (req.status !== 'invoice_submitted') {
      return jsonError('This request does not have a submitted invoice to review.', 400);
    }

    const today = new Date().toISOString().slice(0, 10);

    if (action === 'approve') {
      // Use the invoice total as the expense amount (it may differ from the
      // admin's earlier approved cost if the handyman itemized differently).
      const expenseAmount = req.invoice_total_amount ?? req.cost ?? 0;

      // Approve the invoice but do NOT write an expense yet. The expense is
      // created only when the admin clicks "Mark paid" — keeping financials
      // on a cash basis so numbers match when money actually leaves.
      const stmts = [
        env.DB.prepare(
          `UPDATE maintenance_requests
              SET status = 'invoice_approved', invoice_approved_at = ?, invoice_approved_by = ?,
                  cost = ?, updated_at = unixepoch()
            WHERE id = ?`
        ).bind(today, auth.id, expenseAmount, id),
        logStatusChange(env.DB, id, 'invoice_submitted', 'invoice_approved', auth.id, auth.name, `Invoice #${req.invoice_number} approved, $${expenseAmount.toFixed(2)}`),
      ];
      await env.DB.batch(stmts);

      // Notify the handyman.
      if (req.assigned_handyman_id) {
        context.waitUntil(
          (async () => {
            await notifyHandyman(env, req.assigned_handyman_id!, `Invoice #${req.invoice_number || ''} approved`, [
              ['Job', req.title],
              ['Amount', `$${expenseAmount.toFixed(2)}`],
              ['Status', 'Your invoice has been approved. Payment will follow.'],
            ]);
            const h = await env.DB.prepare('SELECT user_id FROM handymen WHERE id = ?')
              .bind(req.assigned_handyman_id)
              .first<{ user_id: string | null }>();
            await sendPushToUser(env, h?.user_id, {
              title: 'Invoice approved',
              body: `${req.title}: your invoice has been approved.`,
              url: '/portal/jobs',
            });
          })().catch(e => console.error('invoice-approve notify failed', e))
        );
      }
    } else {
      // reject or revision — both send the job back to approved_for_invoicing.
      const reason = String(body.reason || '').trim();
      if (!reason) return jsonError('Provide a reason for the rejection or revision request.', 400);

      const label = action === 'revision' ? 'Revision requested' : 'Rejected';

      const stmts = [
        env.DB.prepare(
          `UPDATE maintenance_requests
              SET status = 'approved_for_invoicing', invoice_rejection_reason = ?,
                  invoice_submitted_at = NULL, updated_at = unixepoch()
            WHERE id = ?`
        ).bind(reason, id),
        logStatusChange(env.DB, id, 'invoice_submitted', 'approved_for_invoicing', auth.id, auth.name, `${label}: ${reason}`),
      ];
      await env.DB.batch(stmts);

      // Notify the handyman.
      if (req.assigned_handyman_id) {
        const portalUrl = `${SITE_URL}/portal/jobs`;
        context.waitUntil(
          (async () => {
            await notifyHandyman(env, req.assigned_handyman_id!, `${label}: ${req.title}`, [
              ['Job', req.title],
              ['Reason', reason],
              ['Next step', 'Please update and re-upload your invoice.'],
            ], { url: portalUrl, label: 'Re-upload invoice' });
            const h = await env.DB.prepare('SELECT user_id FROM handymen WHERE id = ?')
              .bind(req.assigned_handyman_id)
              .first<{ user_id: string | null }>();
            await sendPushToUser(env, h?.user_id, {
              title: label,
              body: `${req.title}: ${reason}`,
              url: '/portal/jobs',
            });
          })().catch(e => console.error('invoice-reject notify failed', e))
        );
      }
    }

    const row = await env.DB.prepare('SELECT * FROM maintenance_requests WHERE id = ?').bind(id).first();
    return jsonOk({ success: true, data: serializeMaintenance(row as Record<string, unknown>) });
  } catch {
    return serverError();
  }
};
