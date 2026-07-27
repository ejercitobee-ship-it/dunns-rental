import { useCallback, useEffect, useRef, useState } from 'react';
import { Send, MessageSquare, ArrowLeft } from 'lucide-react';
import { Card, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { messagesApi, placeLabel, type Message, type MessageThread } from '../lib/api';
import { useToast } from '../context/ToastContext';
import { cn } from '../lib/utils';

/** A real instant (unix seconds), so toLocaleString is correct here. */
function formatWhen(createdAt: number): string {
  return new Date(createdAt * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function Messages() {
  const { showToast } = useToast();
  const [threads, setThreads] = useState<MessageThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [openId, setOpenId] = useState<string | null>(null);
  const [openName, setOpenName] = useState('');
  const [openPlace, setOpenPlace] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const threadsPollRef = useRef(false);
  const openPollRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Poll-safe inbox refresh: ignores transient errors and never overlaps, so it
  // is safe to call on a timer. The initial load below owns the error state.
  const refreshThreads = useCallback(async () => {
    if (threadsPollRef.current) return;
    threadsPollRef.current = true;
    try {
      const res = await messagesApi.threads();
      setThreads(res.threads);
    } catch {
      // Ignore during polling.
    } finally {
      threadsPollRef.current = false;
    }
  }, []);

  // Poll-safe refresh of the open conversation: swaps the list only when it
  // actually changed, so the panel does not flicker or re-scroll on every tick.
  const refreshOpenThread = useCallback(async (tenantId: string) => {
    if (openPollRef.current) return;
    openPollRef.current = true;
    try {
      const res = await messagesApi.thread(tenantId);
      setMessages((prev) => {
        const next = res.messages;
        const same =
          next.length === prev.length && next[next.length - 1]?.id === prev[prev.length - 1]?.id;
        return same ? prev : next;
      });
    } catch {
      // Ignore during polling.
    } finally {
      openPollRef.current = false;
    }
  }, []);

  useEffect(() => {
    messagesApi.threads()
      .then((res) => setThreads(res.threads))
      .catch((err) => setError((err as Error).message || 'Could not load messages.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  // Live inbox: refresh the thread list every 5s while the tab is visible.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') refreshThreads();
    };
    const id = window.setInterval(tick, 5000);
    window.addEventListener('focus', refreshThreads);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', refreshThreads);
    };
  }, [refreshThreads]);

  // Live conversation: refresh the open thread every 5s while the tab is visible.
  useEffect(() => {
    if (!openId) return;
    const tick = () => {
      if (document.visibilityState === 'visible') refreshOpenThread(openId);
    };
    const id = window.setInterval(tick, 5000);
    const onFocus = () => refreshOpenThread(openId);
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, [openId, refreshOpenThread]);

  const openThread = async (tenantId: string) => {
    setOpenId(tenantId);
    setThreadLoading(true);
    setMessages([]);
    try {
      const res = await messagesApi.thread(tenantId);
      setOpenName(res.tenantName);
      setOpenPlace(placeLabel(res));
      setMessages(res.messages);
      // Opening cleared the unread flag server-side; reflect it in the list.
      setThreads((prev) => prev.map((t) => (t.tenantId === tenantId ? { ...t, unread: 0 } : t)));
    } catch (err) {
      showToast((err as Error).message || 'Could not open that conversation.', 'error');
      setOpenId(null);
    } finally {
      setThreadLoading(false);
    }
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body || !openId || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    try {
      const sent = await messagesApi.reply(openId, body);
      setMessages((prev) => [...prev, sent]);
      setDraft('');
      refreshThreads();
    } catch (err) {
      showToast((err as Error).message || 'Could not send your reply.', 'error');
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-muted">Loading messages.</p>;
  }

  if (error) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-sm text-danger">{error}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Tenant inbox</p>
        <h1 className="font-display text-2xl text-ink mt-1">Messages</h1>
        <p className="text-sm text-muted mt-1">Conversations tenants have started from their portal.</p>
      </div>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        {/* Thread list. Hidden on mobile once a conversation is open. */}
        <Card className={cn(openId && 'hidden lg:block')}>
          <CardContent className="p-0">
            {threads.length === 0 ? (
              <p className="text-sm text-muted p-6 text-center">No tenant messages yet.</p>
            ) : (
              <div className="divide-y divide-line">
                {threads.map((t) => (
                  <button
                    key={t.tenantId}
                    onClick={() => openThread(t.tenantId)}
                    className={cn(
                      'w-full text-left px-4 py-3 hover:bg-canvas transition-colors',
                      openId === t.tenantId && 'bg-canvas'
                    )}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-ink truncate">
                        {t.firstName} {t.lastName}
                        {placeLabel(t) && (
                          <span className="font-normal text-muted"> · {placeLabel(t)}</span>
                        )}
                      </span>
                      {t.unread > 0 && (
                        <span className="flex-shrink-0 min-w-5 h-5 px-1.5 rounded-full bg-primary text-white text-xs font-semibold flex items-center justify-center">
                          {t.unread}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted truncate mt-0.5">
                      {t.lastSender === 'office' ? 'You: ' : ''}
                      {t.lastBody || ''}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Conversation panel. */}
        <Card className={cn(!openId && 'hidden lg:block')}>
          <CardContent className="p-5">
            {!openId ? (
              <div className="flex flex-col items-center justify-center text-center py-16 text-muted">
                <MessageSquare className="h-8 w-8 mb-2 text-faint" />
                <p className="text-sm">Select a conversation to read and reply.</p>
              </div>
            ) : (
              <>
                <div className="flex items-center gap-2 border-b border-line pb-3 mb-3">
                  <button
                    onClick={() => setOpenId(null)}
                    className="lg:hidden p-1 text-faint hover:text-ink"
                    aria-label="Back to inbox"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                  <h3 className="font-semibold text-ink">
                    {openName}
                    {openPlace && <span className="font-normal text-muted"> · {openPlace}</span>}
                  </h3>
                </div>

                <div className="space-y-3 max-h-[52vh] overflow-y-auto pr-1">
                  {threadLoading ? (
                    <p className="text-sm text-muted py-6 text-center">Loading conversation.</p>
                  ) : messages.length === 0 ? (
                    <p className="text-sm text-muted py-6 text-center">No messages in this thread.</p>
                  ) : (
                    messages.map((m) => {
                      const office = m.senderRole === 'office';
                      return (
                        <div key={m.id} className={office ? 'flex justify-end' : 'flex justify-start'}>
                          <div className={`max-w-[80%] ${office ? 'items-end' : 'items-start'} flex flex-col`}>
                            <div
                              className={`rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap break-words ${
                                office
                                  ? 'bg-primary text-white rounded-br-sm'
                                  : 'bg-canvas border border-line text-ink rounded-bl-sm'
                              }`}
                            >
                              {m.body}
                            </div>
                            <span className="text-[11px] text-faint mt-1 px-1">
                              {office ? 'You' : openName} · {formatWhen(m.createdAt)}
                            </span>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={bottomRef} />
                </div>

                <form onSubmit={handleSend} className="mt-4 flex items-end gap-2 border-t border-line pt-4">
                  <textarea
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        handleSend(e);
                      }
                    }}
                    rows={2}
                    maxLength={4000}
                    placeholder="Type your reply..."
                    className="flex-1 resize-none rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  <Button type="submit" disabled={sending || !draft.trim()}>
                    <Send className="h-4 w-4 mr-2" />
                    {sending ? 'Sending...' : 'Send'}
                  </Button>
                </form>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
