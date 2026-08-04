import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { MessageSquare, ArrowLeft, ExternalLink, Inbox } from 'lucide-react';
import { Card, CardContent } from '../components/ui/Card';
import { messagesApi, vendorMessagesApi, placeLabel, type Message, type MessageThread, type VendorMessage, type VendorThread } from '../lib/api';
import { useToast } from '../context/ToastContext';
import { cn } from '../lib/utils';
import { MessageThread as ThreadView, type ChatItem } from '../components/MessageThread';

type Channel = 'tenant' | 'vendor';
type AnyMessage = Message | VendorMessage;

/** One inbox row, normalized so the list renders the same for both channels. */
interface InboxRow {
  id: string;
  title: string;
  subtitle?: string;
  unread: number;
  lastBody: string | null;
  lastSender: 'office' | 'tenant' | 'handyman' | null;
}

export function Messages() {
  const { showToast } = useToast();
  const [channel, setChannel] = useState<Channel>('tenant');
  const [tenantThreads, setTenantThreads] = useState<MessageThread[]>([]);
  const [vendorThreads, setVendorThreads] = useState<VendorThread[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [openId, setOpenId] = useState<string | null>(null);
  const [openName, setOpenName] = useState('');
  const [openPlace, setOpenPlace] = useState('');
  const [messages, setMessages] = useState<AnyMessage[]>([]);
  const [threadLoading, setThreadLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const sendingRef = useRef(false);
  const threadsPollRef = useRef(false);
  const openPollRef = useRef(false);

  const rows: InboxRow[] = channel === 'tenant'
    ? tenantThreads.map((t) => ({
        id: t.tenantId,
        title: `${t.firstName} ${t.lastName}`.trim(),
        subtitle: placeLabel(t) || undefined,
        unread: t.unread,
        lastBody: t.lastBody,
        lastSender: t.lastSender,
      }))
    : vendorThreads.map((v) => ({
        id: v.handymanId,
        title: v.name,
        subtitle: v.phone || undefined,
        unread: v.unread,
        lastBody: v.lastBody,
        lastSender: v.lastSender,
      }));

  const refreshThreads = useCallback(async () => {
    if (threadsPollRef.current) return;
    threadsPollRef.current = true;
    try {
      const [t, v] = await Promise.all([messagesApi.threads(), vendorMessagesApi.threads()]);
      setTenantThreads(t.threads);
      setVendorThreads(v.threads);
    } catch {
      /* ignore during polling */
    } finally {
      threadsPollRef.current = false;
    }
  }, []);

  const refreshOpenThread = useCallback(async (id: string, ch: Channel) => {
    if (openPollRef.current) return;
    openPollRef.current = true;
    try {
      const res = ch === 'tenant' ? await messagesApi.thread(id) : await vendorMessagesApi.thread(id);
      setMessages((prev) => {
        const next = res.messages as AnyMessage[];
        const same = next.length === prev.length && next[next.length - 1]?.id === prev[prev.length - 1]?.id;
        return same ? prev : next;
      });
    } catch {
      /* ignore during polling */
    } finally {
      openPollRef.current = false;
    }
  }, []);

  useEffect(() => {
    Promise.all([messagesApi.threads(), vendorMessagesApi.threads()])
      .then(([t, v]) => { setTenantThreads(t.threads); setVendorThreads(v.threads); })
      .catch((err) => setError((err as Error).message || 'Could not load messages.'))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const tick = () => { if (document.visibilityState === 'visible') refreshThreads(); };
    const id = window.setInterval(tick, 5000);
    window.addEventListener('focus', refreshThreads);
    return () => { window.clearInterval(id); window.removeEventListener('focus', refreshThreads); };
  }, [refreshThreads]);

  useEffect(() => {
    if (!openId) return;
    const tick = () => { if (document.visibilityState === 'visible') refreshOpenThread(openId, channel); };
    const id = window.setInterval(tick, 5000);
    const onFocus = () => refreshOpenThread(openId, channel);
    window.addEventListener('focus', onFocus);
    return () => { window.clearInterval(id); window.removeEventListener('focus', onFocus); };
  }, [openId, channel, refreshOpenThread]);

  const switchChannel = (ch: Channel) => {
    setChannel(ch);
    setOpenId(null);
    setMessages([]);
  };

  const openThread = async (id: string) => {
    setOpenId(id);
    setThreadLoading(true);
    setMessages([]);
    try {
      if (channel === 'tenant') {
        const res = await messagesApi.thread(id);
        setOpenName(res.tenantName);
        setOpenPlace(placeLabel(res));
        setMessages(res.messages);
        setTenantThreads((prev) => prev.map((t) => (t.tenantId === id ? { ...t, unread: 0 } : t)));
      } else {
        const res = await vendorMessagesApi.thread(id);
        setOpenName(res.handymanName);
        setOpenPlace('');
        setMessages(res.messages);
        setVendorThreads((prev) => prev.map((v) => (v.handymanId === id ? { ...v, unread: 0 } : v)));
      }
    } catch (err) {
      showToast((err as Error).message || 'Could not open that conversation.', 'error');
      setOpenId(null);
    } finally {
      setThreadLoading(false);
    }
  };

  const handleSend = async (body: string, file: File | null) => {
    if (!openId || sendingRef.current) return;
    sendingRef.current = true;
    setSending(true);
    try {
      const sent = channel === 'tenant'
        ? await messagesApi.reply(openId, body, file)
        : await vendorMessagesApi.reply(openId, body, file);
      setMessages((prev) => [...prev, sent]);
      refreshThreads();
    } catch (err) {
      showToast((err as Error).message || 'Could not send your reply.', 'error');
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-20 gap-3 animate-in fade-in duration-200">
      <Inbox className="h-8 w-8 text-faint animate-pulse" />
      <p className="text-sm text-muted">Loading messages</p>
    </div>
  );
  if (error) return <Card><CardContent className="p-6"><p className="text-sm text-danger">{error}</p></CardContent></Card>;

  const TABS: { key: Channel; label: string; count: number }[] = [
    { key: 'tenant', label: 'Tenants', count: tenantThreads.reduce((s, t) => s + t.unread, 0) },
    { key: 'vendor', label: 'Vendors', count: vendorThreads.reduce((s, v) => s + v.unread, 0) },
  ];

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Inbox</p>
        <h1 className="font-display text-2xl text-ink mt-1">Messages</h1>
        <p className="text-sm text-muted mt-1">Conversations with tenants and with your vendors.</p>
      </div>

      {/* Channel tabs */}
      <div className="flex gap-1 border-b border-line -mt-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => switchChannel(t.key)}
            className={cn(
              'px-4 py-2.5 text-sm border-b-2 -mb-px transition-colors inline-flex items-center gap-2',
              channel === t.key ? 'border-primary text-ink font-medium' : 'border-transparent text-muted hover:text-ink'
            )}
          >
            {t.label}
            {t.count > 0 && (
              <span className="min-w-5 h-5 px-1.5 rounded-full bg-primary text-white text-xs font-semibold grid place-items-center">{t.count}</span>
            )}
          </button>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        {/* Thread list. Hidden on mobile once a conversation is open. */}
        <Card className={cn(openId && 'hidden lg:block')}>
          <CardContent className="p-0">
            {rows.length === 0 ? (
              <p className="text-sm text-muted p-6 text-center">
                {channel === 'tenant' ? 'No tenant messages yet.' : 'No active vendors to message.'}
              </p>
            ) : (
              <div className="divide-y divide-line">
                {rows.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => openThread(r.id)}
                    className={cn('w-full text-left px-4 py-3 hover:bg-canvas transition-colors', openId === r.id && 'bg-canvas')}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-ink truncate">
                        {r.title}
                        {r.subtitle && <span className="font-normal text-muted"> · {r.subtitle}</span>}
                      </span>
                      {r.unread > 0 && (
                        <span className="flex-shrink-0 min-w-5 h-5 px-1.5 rounded-full bg-primary text-white text-xs font-semibold flex items-center justify-center">
                          {r.unread}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted truncate mt-0.5">
                      {r.lastSender === 'office' ? 'You: ' : ''}
                      {r.lastBody || (r.lastBody === '' ? 'Attachment' : 'No messages yet')}
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
                  <button onClick={() => setOpenId(null)} className="lg:hidden p-1 text-faint hover:text-ink" aria-label="Back to inbox">
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                  <h3 className="font-semibold text-ink">
                    {openName}
                    {openPlace && <span className="font-normal text-muted"> · {openPlace}</span>}
                  </h3>
                  {channel === 'tenant' && (
                    <Link to={`/tenants/${openId}`} className="ml-auto inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary-hover whitespace-nowrap">
                      View profile
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Link>
                  )}
                </div>

                {threadLoading ? (
                  <p className="text-sm text-muted py-6 text-center">Loading conversation.</p>
                ) : (
                  <ThreadView
                    items={messages.map<ChatItem>((m) => ({
                      id: m.id,
                      body: m.body,
                      createdAt: m.createdAt,
                      mine: m.senderRole === 'office',
                      senderLabel: m.senderRole === 'office' ? 'You' : openName,
                      attachmentUrl: m.attachmentUrl,
                      attachmentName: m.attachmentName,
                      attachmentType: m.attachmentType,
                    }))}
                    onSend={handleSend}
                    sending={sending}
                    emptyText="No messages in this thread."
                    placeholder="Type your reply..."
                    heightClass="max-h-[52vh]"
                  />
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
