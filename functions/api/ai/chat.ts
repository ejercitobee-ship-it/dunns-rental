import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../lib/session';
import { AI_TOOLS, executeTool } from '../../lib/ai-tools';

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-20250514';
const MAX_TOKENS = 4096;
const MAX_TOOL_ROUNDS = 8; // safety limit on tool-use loops

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

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: string | AnthropicContentBlock[];
}

interface AnthropicContentBlock {
  type: 'text' | 'tool_use' | 'tool_result';
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
}

interface AnthropicResponse {
  id: string;
  content: AnthropicContentBlock[];
  stop_reason: string;
  usage: { input_tokens: number; output_tokens: number };
}

/**
 * POST /api/ai/chat — send a message to the AI assistant.
 *
 * Body: { conversationId?: string, message: string }
 * Returns: { conversationId, response, toolsUsed }
 */
export const onRequestPost: PagesFunction<Env> = async (context) => {
  const { env, request } = context;
  const auth = await requirePermission(env, request, 'ai_assistant_use');
  if (auth instanceof Response) return auth;

  if (!env.ANTHROPIC_API_KEY) {
    return jsonError('AI Assistant is not configured. An Anthropic API key is required.', 503);
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

    // Load conversation history (last 20 messages for context window).
    const { results: history } = await env.DB.prepare(
      `SELECT role, content FROM ai_messages
        WHERE conversation_id = ? AND id != ?
        ORDER BY created_at ASC`
    ).bind(conversationId, userMsgId).all();

    // Build messages array for Claude.
    const messages: AnthropicMessage[] = [];
    for (const row of history || []) {
      messages.push({ role: row.role as 'user' | 'assistant', content: row.content as string });
    }
    // Keep last 20 messages to control token usage.
    if (messages.length > 20) messages.splice(0, messages.length - 20);
    messages.push({ role: 'user', content: userMessage });

    // Run the tool-use loop.
    let finalText = '';
    const toolsUsed: string[] = [];
    let rounds = 0;

    while (rounds < MAX_TOOL_ROUNDS) {
      rounds++;

      const apiResponse = await fetch(ANTHROPIC_API_URL, {
        method: 'POST',
        headers: {
          'x-api-key': env.ANTHROPIC_API_KEY,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: MODEL,
          max_tokens: MAX_TOKENS,
          system: SYSTEM_PROMPT,
          tools: AI_TOOLS,
          messages,
        }),
      });

      if (!apiResponse.ok) {
        const errText = await apiResponse.text();
        console.error('Anthropic API error:', apiResponse.status, errText);
        return jsonError('AI service temporarily unavailable. Please try again.', 502);
      }

      const result = (await apiResponse.json()) as AnthropicResponse;

      // Check if Claude wants to use tools.
      const toolUseBlocks = result.content.filter(b => b.type === 'tool_use');
      const textBlocks = result.content.filter(b => b.type === 'text');

      if (toolUseBlocks.length === 0) {
        // No tool calls: extract the final text response.
        finalText = textBlocks.map(b => b.text || '').join('\n').trim();
        break;
      }

      // Claude wants tools: execute them and loop.
      // Add the assistant's response to messages.
      messages.push({ role: 'assistant', content: result.content });

      // Execute each tool and collect results.
      const toolResults: AnthropicContentBlock[] = [];
      for (const block of toolUseBlocks) {
        const toolName = block.name!;
        const toolInput = block.input || {};
        if (!toolsUsed.includes(toolName)) toolsUsed.push(toolName);

        const toolOutput = await executeTool(env.DB, toolName, toolInput);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id!,
          content: toolOutput,
        });
      }

      // Send tool results back to Claude.
      messages.push({ role: 'user', content: toolResults });
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
      // Use the first ~60 chars of the user's message as the title.
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
