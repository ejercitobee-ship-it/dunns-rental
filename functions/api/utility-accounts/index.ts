import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { serializeUtilityAccount } from '../../lib/serializers';

const TYPES = ['water', 'gas', 'electric'];

export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'properties_view');
  if (auth instanceof Response) return auth;
  try {
    const { results } = await env.DB.prepare(
      'SELECT * FROM utility_accounts ORDER BY created_at DESC'
    ).all();
    return jsonOk({ success: true, data: (results || []).map(serializeUtilityAccount) });
  } catch {
    return serverError();
  }
};

export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'properties_edit');
  if (auth instanceof Response) return auth;
  try {
    const body = (await request.json()) as Record<string, unknown>;
    if (!body.propertyId || !TYPES.includes(String(body.type))) {
      return jsonError('A property and a valid utility type are required', 400);
    }
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO utility_accounts (id, property_id, unit_id, type, provider, account_number, login_url, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
      .bind(
        id,
        body.propertyId,
        body.unitId ?? null,
        body.type,
        body.provider ?? null,
        body.accountNumber ?? null,
        body.loginUrl ?? null,
        body.notes ?? null
      )
      .run();
    const row = await env.DB.prepare('SELECT * FROM utility_accounts WHERE id = ?').bind(id).first();
    return jsonOk({ success: true, data: serializeUtilityAccount(row as Record<string, unknown>) }, 201);
  } catch {
    return serverError();
  }
};
