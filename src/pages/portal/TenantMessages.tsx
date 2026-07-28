import { useCallback, useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { portalApi, type Message } from '../../lib/api';
import { useToast } from '../../context/ToastContext';

/** A real instant (unix seconds), so toLocaleString is correct here. */
function formatWhen(createdAt: number): string {
  return new Date(createdAt * 1000).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function TenantMessages() {
  const { showToast } = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const pollingRef = useRef(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  // A poll-safe refresh: swaps the list only when it actually changed (so the
  // view does not flicker or re-scroll when nothing is new), ignores transient
  // errors, and never overlaps itself.
  const refresh = useCallback(async () => {
    if (pollingRef.current) return;
    pollingRef.current = true;
    try {
      const res = await portalApi.messages();
      setMessages((prev) => {
        const next = res.messages;
        const same =
          next.length === prev.length && next[next.length - 1]?.id === prev[prev.length - 1]?.id;
        return same ? prev : next;
      });
    } catch {
      // Ignore poll errors; the initial load below surfaces real failures.
    } finally {
      pollingRef.current = false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    portalApi.messages()
      .then((res) => {
        if (!cancelled) setMessages(res.messages);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message || 'Could not load your messages.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Live updates: check for new messages every 5s while the tab is visible, and
  // immediately when the window regains focus.
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    const id = window.setInterval(tick, 5000);
    window.addEventListener('focus', refresh);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', refresh);
    };
  }, [refresh]);

  // Keep the newest message in view as the thread grows.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [messages]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    try {
      const sent = await portalApi.sendMessage(body);
      setMessages((prev) => [...prev, sent]);
      setDraft('');
    } catch (err) {
      showToast((err as Error).message || 'Could not send your message.', 'error');
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-muted">Loading your messages.</p>;
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
        <p className="eyebrow">Get in touch</p>
        <h1 className="font-display text-[26px] text-ink mt-1">Messages</h1>
        <p className="text-sm text-muted mt-1">
          Send us a message and we will reply here. You will get a notification when we do.
        </p>
      </div>

      <Card>
        <CardContent className="p-5">
          <div className="space-y-3 max-h-[55vh] overflow-y-auto pr-1">
            {messages.length === 0 ? (
              <p className="text-sm text-muted py-6 text-center">
                No messages yet. Start the conversation below.
              </p>
            ) : (
              messages.map((m) => {
                const mine = m.senderRole === 'tenant';
                return (
                  <div key={m.id} className={mine ? 'flex justify-end' : 'flex justify-start'}>
                    <div className={`max-w-[80%] ${mine ? 'items-end' : 'items-start'} flex flex-col`}>
                      <div
                        className={`rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap break-words ${
                          mine ? 'bg-primary text-white rounded-br-sm' : 'bg-canvas border border-line text-ink rounded-bl-sm'
                        }`}
                      >
                        {m.body}
                      </div>
                      <span className="text-[11px] text-faint mt-1 px-1">
                        {mine ? 'You' : 'MH Dunn Property'} · {formatWhen(m.createdAt)}
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
              placeholder="Type your message..."
              className="flex-1 resize-none rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
            <Button type="submit" disabled={sending || !draft.trim()}>
              <Send className="h-4 w-4 mr-2" />
              {sending ? 'Sending...' : 'Send'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
