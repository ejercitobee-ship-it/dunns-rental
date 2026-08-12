import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Bot,
  Send,
  Plus,
  Clock,
  Trash2,
  ChevronDown,
  Sparkles,
  Loader2,
  MessageSquare,
  Wrench,
  User,
} from 'lucide-react';
import { Card, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { useToast } from '../context/ToastContext';
import { aiApi, type AIMessage, type AIConversation } from '../lib/api';

/** Render markdown-like text with basic formatting. */
function formatResponse(text: string) {
  // Split into paragraphs on double newlines; within paragraphs, render
  // **bold** and single newlines as <br>.
  return text.split(/\n{2,}/).map((para, i) => {
    // Detect bullet lists
    const lines = para.split('\n');
    const isList = lines.every(l => /^[-•*]\s/.test(l.trim()) || l.trim() === '');
    if (isList) {
      const items = lines.filter(l => l.trim()).map(l => l.replace(/^[-•*]\s/, ''));
      return (
        <ul key={i} className="list-disc list-inside space-y-1 my-2">
          {items.map((item, j) => (
            <li key={j}>{renderInline(item)}</li>
          ))}
        </ul>
      );
    }
    return <p key={i} className="my-1.5">{renderInline(para)}</p>;
  });
}

function renderInline(text: string) {
  // Handle **bold** and line breaks.
  const parts = text.split(/(\*\*.*?\*\*)/g);
  return parts.map((part, i) => {
    if (part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    // Convert single newlines to <br>
    const lines = part.split('\n');
    return lines.map((line, j) => (
      <span key={`${i}-${j}`}>
        {j > 0 && <br />}
        {line}
      </span>
    ));
  });
}

function relativeTime(unixSeconds: number): string {
  const diff = Date.now() / 1000 - unixSeconds;
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

const SUGGESTIONS = [
  'Who are my tenants with overdue rent?',
  'Give me a summary of all my properties',
  'What maintenance requests are currently open?',
  'How much rent did we collect this month?',
];

export function AIAssistant() {
  const { showToast } = useToast();

  // Conversation state
  const [conversations, setConversations] = useState<AIConversation[]>([]);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AIMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when messages change.
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Auto-resize textarea.
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 150)}px`;
    }
  }, [input]);

  // Close history dropdown on outside click.
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (historyRef.current && !historyRef.current.contains(e.target as Node)) {
        setHistoryOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Load conversation list.
  const loadConversations = useCallback(async () => {
    try {
      const data = await aiApi.conversations();
      setConversations(data);
    } catch {
      // Silently ignore on initial load.
    }
  }, []);

  useEffect(() => { loadConversations(); }, [loadConversations]);

  // Start a new conversation.
  const newConversation = () => {
    setConversationId(null);
    setMessages([]);
    setInput('');
    setHistoryOpen(false);
    inputRef.current?.focus();
  };

  // Load an existing conversation.
  const loadConversation = async (id: string) => {
    setHistoryOpen(false);
    try {
      const data = await aiApi.conversation(id);
      setConversationId(data.id);
      setMessages(data.messages);
    } catch {
      showToast('Could not load conversation.', 'error');
    }
  };

  // Delete a conversation.
  const deleteConversation = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await aiApi.deleteConversation(id);
      setConversations(prev => prev.filter(c => c.id !== id));
      if (conversationId === id) newConversation();
      showToast('Conversation deleted.', 'success');
    } catch {
      showToast('Could not delete conversation.', 'error');
    }
  };

  // Send a message.
  const sendMessage = async (text?: string) => {
    const msg = (text || input).trim();
    if (!msg || loading) return;

    // Optimistically add user message.
    const tempUserMsg: AIMessage = {
      id: `temp-${Date.now()}`,
      role: 'user',
      content: msg,
    };
    setMessages(prev => [...prev, tempUserMsg]);
    setInput('');
    setLoading(true);

    try {
      const result = await aiApi.chat({
        conversationId: conversationId || undefined,
        message: msg,
      });

      // Set conversation ID if this is a new conversation.
      if (!conversationId) {
        setConversationId(result.conversationId);
        loadConversations(); // Refresh the list.
      }

      // Add the assistant response.
      setMessages(prev => [...prev, result.message]);
    } catch (err) {
      showToast((err as Error).message || 'Could not get a response. Please try again.', 'error');
      // Remove the optimistic user message on error.
      setMessages(prev => prev.filter(m => m.id !== tempUserMsg.id));
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const isNewChat = messages.length === 0;

  return (
    <div className="flex flex-col" style={{ height: 'calc(100vh - 8rem)' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-primary-soft flex items-center justify-center">
            <Bot className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="eyebrow !text-[10px]">Intelligence</p>
            <h1 className="font-display text-xl leading-tight text-ink">AI Assistant</h1>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* History dropdown */}
          <div className="relative" ref={historyRef}>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setHistoryOpen(o => !o)}
              className="gap-1.5"
            >
              <Clock className="h-3.5 w-3.5" />
              History
              <ChevronDown className={`h-3 w-3 transition-transform ${historyOpen ? 'rotate-180' : ''}`} />
            </Button>

            {historyOpen && (
              <div className="absolute right-0 mt-2 w-80 bg-surface rounded-xl border border-line shadow-lg z-30 overflow-hidden">
                <div className="px-3 py-2 border-b border-line">
                  <p className="text-xs font-medium text-muted">Recent Conversations</p>
                </div>
                <div className="max-h-64 overflow-y-auto">
                  {conversations.length === 0 ? (
                    <p className="px-3 py-4 text-sm text-muted text-center">No conversations yet.</p>
                  ) : (
                    conversations.map(c => (
                      <button
                        key={c.id}
                        onClick={() => loadConversation(c.id)}
                        className={`w-full flex items-center gap-2.5 px-3 py-2.5 text-left text-sm hover:bg-canvas transition-colors group ${
                          conversationId === c.id ? 'bg-primary-soft' : ''
                        }`}
                      >
                        <MessageSquare className="h-3.5 w-3.5 text-muted flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <p className="truncate font-medium text-ink">{c.title}</p>
                          <p className="text-xs text-faint">{relativeTime(c.updatedAt)} · {c.messageCount} messages</p>
                        </div>
                        <button
                          onClick={(e) => deleteConversation(c.id, e)}
                          className="opacity-0 group-hover:opacity-100 p-1 text-faint hover:text-danger transition-all"
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </button>
                    ))
                  )}
                </div>
              </div>
            )}
          </div>

          <Button variant="outline" size="sm" onClick={newConversation} className="gap-1.5">
            <Plus className="h-3.5 w-3.5" />
            New Chat
          </Button>
        </div>
      </div>

      {/* Messages area */}
      <Card className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <CardContent className="flex-1 overflow-y-auto p-4 space-y-4">
          {isNewChat ? (
            /* Welcome / empty state */
            <div className="flex flex-col items-center justify-center h-full text-center px-4">
              <div className="w-16 h-16 rounded-2xl bg-primary-soft flex items-center justify-center mb-4">
                <Sparkles className="h-8 w-8 text-primary" />
              </div>
              <h2 className="text-lg font-semibold mb-1">What can I help you with?</h2>
              <p className="text-sm text-muted mb-6 max-w-md">
                I can look up tenant details, check rent status, review maintenance requests,
                summarize your properties, and answer financial questions.
              </p>

              {/* Quick suggestions */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 w-full max-w-lg">
                {SUGGESTIONS.map(s => (
                  <button
                    key={s}
                    onClick={() => sendMessage(s)}
                    className="text-left px-3 py-2.5 rounded-lg border border-line hover:border-primary-line hover:bg-primary-soft/50 text-sm text-muted hover:text-ink transition-all"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            /* Conversation messages */
            <>
              {messages.map(msg => (
                <div
                  key={msg.id}
                  className={`flex gap-3 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  {msg.role === 'assistant' && (
                    <div className="w-7 h-7 rounded-lg bg-primary-soft flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Bot className="h-4 w-4 text-primary" />
                    </div>
                  )}

                  <div
                    className={`max-w-[80%] rounded-xl px-4 py-2.5 text-sm leading-relaxed ${
                      msg.role === 'user'
                        ? 'bg-primary text-white rounded-br-sm'
                        : 'bg-canvas border border-line rounded-bl-sm'
                    }`}
                  >
                    {msg.role === 'assistant' ? (
                      <div className="prose-sm">{formatResponse(msg.content)}</div>
                    ) : (
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    )}

                    {/* Tool usage indicator */}
                    {msg.toolsUsed && msg.toolsUsed.length > 0 && (
                      <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-line/50">
                        <Wrench className="h-3 w-3 text-faint" />
                        <span className="text-[10px] text-faint">
                          Looked up: {msg.toolsUsed.map(t =>
                            t.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase()).trim()
                          ).join(', ')}
                        </span>
                      </div>
                    )}
                  </div>

                  {msg.role === 'user' && (
                    <div className="w-7 h-7 rounded-lg bg-canvas border border-line flex items-center justify-center flex-shrink-0 mt-0.5">
                      <User className="h-4 w-4 text-muted" />
                    </div>
                  )}
                </div>
              ))}

              {/* Thinking indicator */}
              {loading && (
                <div className="flex gap-3 justify-start">
                  <div className="w-7 h-7 rounded-lg bg-primary-soft flex items-center justify-center flex-shrink-0 mt-0.5">
                    <Bot className="h-4 w-4 text-primary" />
                  </div>
                  <div className="bg-canvas border border-line rounded-xl rounded-bl-sm px-4 py-3">
                    <div className="flex items-center gap-2 text-sm text-muted">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Looking into that...</span>
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </>
          )}
        </CardContent>

        {/* Input area */}
        <div className="border-t border-line p-3 flex-shrink-0">
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your properties, tenants, rent, maintenance..."
              rows={1}
              disabled={loading}
              className="flex-1 resize-none rounded-lg border border-line bg-canvas px-3 py-2.5 text-sm placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-primary focus:border-primary disabled:opacity-50 transition-colors"
              style={{ maxHeight: '150px' }}
            />
            <Button
              onClick={() => sendMessage()}
              disabled={loading || !input.trim()}
              className="h-10 w-10 p-0 flex-shrink-0"
              title="Send message"
            >
              <Send className="h-4 w-4" />
            </Button>
          </div>
          <p className="text-[10px] text-faint mt-1.5 text-center">
            AI responses are generated from your live data. Always verify important details.
          </p>
        </div>
      </Card>
    </div>
  );
}
