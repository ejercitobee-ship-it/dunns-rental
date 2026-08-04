import { useCallback, useEffect, useRef, useState } from 'react';
import { MessageSquare } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/Card';
import { portalApi, type VendorMessage } from '../../lib/api';
import { useToast } from '../../context/ToastContext';
import { MessageThread, type ChatItem } from '../../components/MessageThread';

/** A handyman's own thread with the office (vendor messaging, with attachments). */
export function HandymanMessages() {
  const { showToast } = useToast();
  const [messages, setMessages] = useState<VendorMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const pollingRef = useRef(false);

  const refresh = useCallback(async () => {
    if (pollingRef.current) return;
    pollingRef.current = true;
    try {
      const res = await portalApi.vendorMessages();
      setMessages((prev) => {
        const next = res.messages;
        const same = next.length === prev.length && next[next.length - 1]?.id === prev[prev.length - 1]?.id;
        return same ? prev : next;
      });
    } catch {
      /* ignore poll errors */
    } finally {
      pollingRef.current = false;
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    portalApi.vendorMessages()
      .then((res) => { if (!cancelled) setMessages(res.messages); })
      .catch((err) => { if (!cancelled) setError((err as Error).message || 'Could not load your messages.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') refresh(); };
    const id = window.setInterval(tick, 5000);
    window.addEventListener('focus', refresh);
    return () => { window.clearInterval(id); window.removeEventListener('focus', refresh); };
  }, [refresh]);

  const handleSend = async (body: string, file: File | null) => {
    if (sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    try {
      const sent = await portalApi.sendVendorMessage(body, file);
      setMessages((prev) => [...prev, sent]);
    } catch (err) {
      showToast((err as Error).message || 'Could not send your message.', 'error');
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-20 gap-3 animate-in fade-in duration-200">
      <MessageSquare className="h-8 w-8 text-faint animate-pulse" />
      <p className="text-sm text-muted">Loading your messages</p>
    </div>
  );
  if (error) return <Card><CardContent className="p-6"><p className="text-sm text-danger">{error}</p></CardContent></Card>;

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Get in touch</p>
        <h1 className="font-display text-[26px] text-ink mt-1">Messages</h1>
        <p className="text-sm text-muted mt-1">Message the office about jobs, quotes, or paperwork. You can attach a file.</p>
      </div>

      <Card>
        <CardContent className="p-5">
          <MessageThread
            items={messages.map<ChatItem>((m) => ({
              id: m.id,
              body: m.body,
              createdAt: m.createdAt,
              mine: m.senderRole === 'handyman',
              senderLabel: m.senderRole === 'handyman' ? 'You' : 'MH Dunn Property',
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
