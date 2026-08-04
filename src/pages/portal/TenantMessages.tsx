import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/Card';
import { portalApi, type Message } from '../../lib/api';
import { useToast } from '../../context/ToastContext';
import { MessageThread, type ChatItem } from '../../components/MessageThread';

export function TenantMessages() {
  const { showToast } = useToast();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const pollingRef = useRef(false);

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

  const handleSend = async (body: string, file: File | null) => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    try {
      const sent = await portalApi.sendMessage(body, file);
      setMessages((prev) => [...prev, sent]);
    } catch (err) {
      showToast((err as Error).message || 'Could not send your message.', 'error');
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 animate-in fade-in duration-200">
        <MessageSquare className="h-8 w-8 text-faint animate-pulse" />
        <p className="text-sm text-muted">Loading your messages</p>
      </div>
    );
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
          <MessageThread
            items={messages.map<ChatItem>((m) => ({
              id: m.id,
              body: m.body,
              createdAt: m.createdAt,
              mine: m.senderRole === 'tenant',
              senderLabel: m.senderRole === 'tenant' ? 'You' : 'MH Dunn Property',
              attachmentUrl: m.attachmentUrl,
              attachmentName: m.attachmentName,
              attachmentType: m.attachmentType,
            }))}
            onSend={handleSend}
            sending={sending}
            emptyText="No messages yet. Start the conversation below."
          />
        </CardContent>
      </Card>
    </div>
  );
}
