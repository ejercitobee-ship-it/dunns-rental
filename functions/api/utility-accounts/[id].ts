import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { serializeUtilityAccount } from '../../lib/serializers';

const TYPES = ['water', 'gas', 'electric'];

export const onRequestPut: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'properties_edit');
  if (auth instanceof Response) return auth;
  try {
    const id = params.id as string;
    const body = (await request.json()) as Record<string, unknown>;
    if (!body.propertyId || !TYPES.includes(String(body.type))) {
      return jsonError('A property and a valid utility type are required', 400);
    }
    await env.DB.prepare(
      `UPDATE utility_accounts SET
        property_id = ?, unit_id = ?, type = ?, provider = ?, account_number = ?, login_url = ?, notes = ?,
        updated_at = unixepoch()
       WHERE id = ?`
    )
      .bind(
        body.propertyId,
        body.unitId ?? null,
        body.type,
        body.provider ?? null,
        body.accountNumber ?? null,
        body.loginUrl ?? null,
        body.notes ?? null,
        id
      )
      .run();
    const row = await env.DB.prepare('SELECT * FROM utility_accounts WHERE id = ?').bind(id).first();
    if (!row) return jsonError('Utility account not found', 404);
    return jsonOk({ success: true, data: serializeUtilityAccount(row as Record<string, unknown>) });
  } catch {
    return serverError();
  }
};

export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'properties_edit');
  if (auth instanceof Response) return auth;
  try {
    await env.DB.prepare('DELETE FROM utility_accounts WHERE id = ?').bind(params.id as string).run();
    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
