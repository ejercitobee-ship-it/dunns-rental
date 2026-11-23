import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../lib/session';
import { logActivityStmt } from '../../../lib/activity';

/**
 * PUT /api/leases/:id/late-fee-toggle — toggle late_fee_enabled on a lease.
 * Body: { enabled: boolean }
 */
export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'tenants_edit');
  if (auth instanceof Response) return auth;

  try {
    const id = params.id as string;
    const body = (await request.json()) as { enabled?: boolean };
    const enabled = !!body.enabled;

    const existing = await env.DB.prepare('SELECT late_fee_enabled FROM leases WHERE id = ?')
      .bind(id).first<{ late_fee_enabled: number }>();
    if (!existing) return jsonError('Lease not found', 404);

    await env.DB.batch([
      env.DB.prepare('UPDATE leases SET late_fee_enabled = ?, updated_at = unixepoch() WHERE id = ?')
        .bind(enabled ? 1 : 0, id),
      logActivityStmt(env.DB, auth, {
        module: 'leases',
        action: enabled ? 'Enabled late fees on a lease' : 'Disabled late fees on a lease',
        targetType: 'leases',
        targetId: id,
        previousValues: { lateFeeEnabled: !!existing.late_fee_enabled },
        newValues: { lateFeeEnabled: enabled },
      }),
    ]);

    return jsonOk({ success: true, lateFeeEnabled: enabled });
  } catch {
    return serverError();
  }
};
