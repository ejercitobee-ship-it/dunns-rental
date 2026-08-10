import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../lib/session';

/**
 * GET /api/ai/conversations/:id — load messages for a conversation.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'ai_assistant_use');
  if (auth instanceof Response) return auth;

  const id = String(params.id);

  try {
    // Verify ownership.
    const conv = await env.DB.prepare(
      'SELECT id, title, created_at FROM ai_conversations WHERE id = ? AND user_id = ?'
    ).bind(id, auth.id).first();
    if (!conv) return jsonError('Conversation not found.', 404);

    const { results } = await env.DB.prepare(
      `SELECT id, role, content, tools_used, created_at
         FROM ai_messages
        WHERE conversation_id = ?
        ORDER BY created_at ASC`
    ).bind(id).all();

    return jsonOk({
      success: true,
      data: {
        id: conv.id,
        title: conv.title || 'New conversation',
        messages: (results || []).map(r => ({
          id: r.id,
          role: r.role,
          content: r.content,
          toolsUsed: r.tools_used ? JSON.parse(r.tools_used as string) : undefined,
          createdAt: r.created_at,
        })),
      },
    });
  } catch {
    return serverError();
  }
};

/**
 * DELETE /api/ai/conversations/:id — delete a conversation and its messages.
 */
export const onRequestDelete: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'ai_assistant_use');
  if (auth instanceof Response) return auth;

  const id = String(params.id);

  try {
    // Verify ownership.
    const conv = await env.DB.prepare(
      'SELECT id FROM ai_conversations WHERE id = ? AND user_id = ?'
    ).bind(id, auth.id).first();
    if (!conv) return jsonError('Conversation not found.', 404);

    await env.DB.batch([
      env.DB.prepare('DELETE FROM ai_messages WHERE conversation_id = ?').bind(id),
      env.DB.prepare('DELETE FROM ai_conversations WHERE id = ?').bind(id),
    ]);

    return jsonOk({ success: true });
  } catch {
    return serverError();
  }
};
