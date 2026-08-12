import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { AI_TOOLS, executeTool, type ToolDefinition } from '../../lib/ai-tools';

// Cloudflare Workers AI model (free tier: 10,000 neurons/day).
const WORKERS_AI_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const MAX_TOKENS = 2048;
const MAX_TOOL_ROUNDS = 6; // safety limit on tool-use loops

const SYSTEM_PROMPT = `You are the MH Dunn Property Assistant, an AI operations assistant built into the MH Dunn Property management application. You help the office team answer questions about tenants, properties, leases, rent payments, maintenance, expenses, and day to day operations.

Rules you must always follow:
1. Always use the available tools to look up real data before answering. Never make up tenant names, amounts, dates, or any factual information.
2. If the data is incomplete or unavailable, say so clearly. Do not fill in gaps with assumptions.
3. Cite your sources naturally: mention which records you found (e.g., "Based on the lease record for Unit 2..." or "Looking at the July rent payments...").
4. Keep responses concise, professional, and conversational. Use bullet points or short paragraphs, not walls of text.
5. Format dollar amounts with two decimal places (e.g., $1,200.00). Format dates in a readable way (e.g., July 15, 2026).
6. When a question is ambiguous, search first and then ask clarifying questions if needed (e.g., "I found two tenants named Smith. Did you mean John Smith at 5116 N Kolmar or Jane Smith at...?").
7. If asked about something outside property management, politely redirect: "I can help with property, tenant, lease, rent, maintenance, and financial questions. What would you like to know?"
8. Never reveal internal IDs, database column names, or technical implementation details to the user.
9. When discussing money, always be precise. If a tenant owes $1,200 and paid $800, say exactly that. Do not round or approximate.`;

interface ChatRequest {
  conversationId?: string;
  message: string;
}

interface WorkersAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  name?: string;
  tool_call_id?: string;
}

interface WorkersAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

interface WorkersAIResponse {
  response?: string;
  tool_calls?: WorkersAIToolCall[];
}

/** Convert our tool definitions to the OpenAI-compatible format Workers AI expects. */
function toWorkersAITools(tools: ToolDefinition[]) {
  return tools.map(t => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

/**
 * POST /api/ai/chat — send a message to the AI assistant.
 *
 * Uses Cloudflare Workers AI (free tier) by default.
 * Body: { conversationId?: string, message: string }
 * Returns: { conversationId, response, toolsUsed }
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'ai_assistant_use');
  if (auth instanceof Response) return auth;

  if (!env.AI) {
    return jsonError('AI Assistant is not configured. The Workers AI binding is required.', 503);
  }

  try {
    const body = (await request.json()) as ChatRequest;
    const userMessage = typeof body.message === 'string' ? body.message.trim() : '';
    if (!userMessage) return jsonError('Message is required.', 400);
    if (userMessage.length > 4000) return jsonError('Message is too long (max 4000 characters).', 400);

    // Resolve or create conversation.
    let conversationId = body.conversationId || null;
    if (conversationId) {
      const existing = await env.DB.prepare(
        'SELECT id FROM ai_conversations WHERE id = ? AND user_id = ?'
      ).bind(conversationId, auth.id).first();
      if (!existing) return jsonError('Conversation not found.', 404);
    } else {
      conversationId = crypto.randomUUID();
      await env.DB.prepare(
        'INSERT INTO ai_conversations (id, user_id) VALUES (?, ?)'
      ).bind(conversationId, auth.id).run();
    }

    // Save the user's message.
    const userMsgId = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO ai_messages (id, conversation_id, role, content) VALUES (?, ?, ?, ?)'
    ).bind(userMsgId, conversationId, 'user', userMessage).run();

    // Load conversation history (last 10 messages for context window — smaller model).
    const { results: history } = await env.DB.prepare(
      `SELECT role, content FROM ai_messages
        WHERE conversation_id = ? AND id != ?
        ORDER BY created_at ASC`
    ).bind(conversationId, userMsgId).all();

    // Build messages array.
    const messages: WorkersAIMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
    ];
    const historySlice = (history || []).slice(-10);
    for (const row of historySlice) {
      messages.push({
        role: row.role as 'user' | 'assistant',
        content: row.content as string,
      });
    }
    messages.push({ role: 'user', content: userMessage });

    // Run the tool-use loop.
    let finalText = '';
    const toolsUsed: string[] = [];
    let rounds = 0;
    const workersTools = toWorkersAITools(AI_TOOLS);

    while (rounds < MAX_TOOL_ROUNDS) {
      rounds++;

      const result = await env.AI.run(WORKERS_AI_MODEL, {
        messages,
        tools: workersTools,
        max_tokens: MAX_TOKENS,
      }) as WorkersAIResponse;

      // Check if the model wants to use tools.
      if (result.tool_calls && result.tool_calls.length > 0) {
        // Add assistant message with tool calls to history.
        messages.push({
          role: 'assistant',
          content: result.response || '',
        });

        // Execute each tool and feed results back.
        for (const tc of result.tool_calls) {
          const toolName = tc.function.name;
          let toolInput: Record<string, unknown> = {};
          try {
            toolInput = JSON.parse(tc.function.arguments);
          } catch {
            // If the model returns malformed JSON, pass empty input.
          }
          if (!toolsUsed.includes(toolName)) toolsUsed.push(toolName);

          const toolOutput = await executeTool(env.DB, toolName, toolInput);
          messages.push({
            role: 'tool',
            content: toolOutput,
            tool_call_id: tc.id,
            name: toolName,
          });
        }
        // Continue the loop so the model can process tool results.
        continue;
      }

      // No tool calls: this is the final response.
      finalText = (result.response || '').trim();
      break;
    }

    if (!finalText && rounds >= MAX_TOOL_ROUNDS) {
      finalText = 'I ran into an issue processing your request. Could you try rephrasing your question?';
    }

    // Save the assistant response.
    const assistantMsgId = crypto.randomUUID();
    await env.DB.prepare(
      'INSERT INTO ai_messages (id, conversation_id, role, content, tools_used) VALUES (?, ?, ?, ?, ?)'
    ).bind(
      assistantMsgId,
      conversationId,
      'assistant',
      finalText,
      toolsUsed.length > 0 ? JSON.stringify(toolsUsed) : null
    ).run();

    // Auto-title the conversation from the first message.
    const existingTitle = await env.DB.prepare(
      'SELECT title FROM ai_conversations WHERE id = ?'
    ).bind(conversationId).first<{ title: string | null }>();

    if (!existingTitle?.title) {
      const autoTitle = userMessage.length > 60
        ? userMessage.slice(0, 57) + '...'
        : userMessage;
      await env.DB.prepare(
        'UPDATE ai_conversations SET title = ?, updated_at = unixepoch() WHERE id = ?'
      ).bind(autoTitle, conversationId).run();
    } else {
      await env.DB.prepare(
        'UPDATE ai_conversations SET updated_at = unixepoch() WHERE id = ?'
      ).bind(conversationId).run();
    }

    return jsonOk({
      success: true,
      data: {
        conversationId,
        message: {
          id: assistantMsgId,
          role: 'assistant',
          content: finalText,
          toolsUsed: toolsUsed.length > 0 ? toolsUsed : undefined,
        },
      },
    });
  } catch (err) {
    console.error('AI chat error:', err);
    return serverError();
  }
};
