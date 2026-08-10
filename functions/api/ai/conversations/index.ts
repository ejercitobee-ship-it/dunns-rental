import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, serverError } from '../../../lib/session';

/**
 * GET /api/ai/conversations — list the current user's AI conversations.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'ai_assistant_use');
  if (auth instanceof Response) return auth;

  try {
    const { results } = await env.DB.prepare(
      `SELECT c.id, c.title, c.created_at, c.updated_at,
              (SELECT COUNT(*) FROM ai_messages WHERE conversation_id = c.id) AS message_count
         FROM ai_conversations c
        WHERE c.user_id = ?
        ORDER BY c.updated_at DESC
        LIMIT 50`
    ).bind(auth.id).all();

    return jsonOk({
      success: true,
      data: (results || []).map(r => ({
        id: r.id,
        title: r.title || 'New conversation',
        messageCount: r.message_count,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
    });
  } catch {
    return serverError();
  }
};
