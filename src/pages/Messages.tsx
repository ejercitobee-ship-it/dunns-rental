import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { MessageSquare, ArrowLeft, ExternalLink, Inbox, PenSquare, Search, X } from 'lucide-react';
import { Card, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { messagesApi, vendorMessagesApi, realtorMessagesApi, tenantsApi, placeLabel, type Message, type MessageThread, type VendorMessage, type VendorThread, type RealtorMessage, type RealtorThread } from '../lib/api';
import { useToast } from '../context/ToastContext';
import { cn } from '../lib/utils';
import { MessageThread as ThreadView, type ChatItem } from '../components/MessageThread';
import type { Tenant } from '../types';

type Channel = 'tenant' | 'vendor' | 'realtor';
type AnyMessage = Message | VendorMessage | RealtorMessage;

/** One inbox row, normalized so the list renders the same for both channels. */
interface InboxRow {
  id: string;
  title: string;
  subtitle?: string;
  unread: number;
  lastBody: string | null;
  lastSender: 'office' | 'tenant' | 'handyman' | 'realtor' | null;
}

export function Messages() {
  const { showToast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [channel, setChannel] = useState<Channel>('tenant');
  const [tenantThreads, setTenantThreads] = useState<MessageThread[]>([]);
  const [vendorThreads, setVendorThreads] = useState<VendorThread[]>([]);
  const [realtorThreads, setRealtorThreads] = useState<RealtorThread[]>([]);
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

  const [showPicker, setShowPicker] = useState(false);
  const [allTenants, setAllTenants] = useState<Tenant[]>([]);
  const [pickerSearch, setPickerSearch] = useState('');
  const pickerRef = useRef<HTMLDivElement>(null);

  const rows: InboxRow[] = channel === 'tenant'
    ? tenantThreads.map((t) => ({
        id: t.tenantId,
        title: `${t.firstName} ${t.lastName}`.trim(),
        subtitle: placeLabel(t) || undefined,
        unread: t.unread,
        lastBody: t.lastBody,
        lastSender: t.lastSender,
      }))
    : channel === 'vendor'
    ? vendorThreads.map((v) => ({
        id: v.handymanId,
        title: v.name,
        subtitle: v.phone || undefined,
        unread: v.unread,
        lastBody: v.lastBody,
        lastSender: v.lastSender,
      }))
    : realtorThreads.map((r) => ({
        id: r.realtorUserId,
        title: r.name,
        subtitle: r.companyName || r.phone || undefined,
        unread: r.unread,
        lastBody: r.lastBody,
        lastSender: r.lastSender,
      }));

  const openNewMessage = async () => {
    setShowPicker(true);
    setPickerSearch('');
    if (allTenants.length === 0) {
      try {
        const tenants = await tenantsApi.getAll();
        setAllTenants(tenants);
      } catch { /* ignore */ }
    }
  };

  const pickTenant = (t: Tenant) => {
    setShowPicker(false);
    setChannel('tenant');
    openThread(t.id);
  };

  useEffect(() => {
    if (!showPicker) return;
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setShowPicker(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showPicker]);

  const refreshThreads = useCallback(async () => {
    if (threadsPollRef.current) return;
    threadsPollRef.current = true;
    try {
      const [t, v, r] = await Promise.all([messagesApi.threads(), vendorMessagesApi.threads(), realtorMessagesApi.threads()]);
      setTenantThreads(t.threads);
      setVendorThreads(v.threads);
      setRealtorThreads(r.threads);
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
      const res = ch === 'tenant' ? await messagesApi.thread(id) : ch === 'vendor' ? await vendorMessagesApi.thread(id) : await realtorMessagesApi.thread(id);
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
    Promise.all([messagesApi.threads(), vendorMessagesApi.threads(), realtorMessagesApi.threads()])
      .then(([t, v, r]) => { setTenantThreads(t.threads); setVendorThreads(v.threads); setRealtorThreads(r.threads); })
      .catch((err) => setError((err as Error).message || 'Could not load messages.'))
      .finally(() => setLoading(false));
  }, []);

  // Deep-link: ?tenant=<id> auto-opens that tenant's conversation.
  const deepLinkHandled = useRef(false);
  useEffect(() => {
    if (loading || deepLinkHandled.current) return;
    const tid = searchParams.get('tenant');
    if (tid) {
      deepLinkHandled.current = true;
      setChannel('tenant');
      openThread(tid);
      // Remove the query param so a browser refresh doesn't re-trigger.
      setSearchParams({}, { replace: true });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

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
      } else if (channel === 'vendor') {
        const res = await vendorMessagesApi.thread(id);
        setOpenName(res.handymanName);
        setOpenPlace('');
        setMessages(res.messages);
        setVendorThreads((prev) => prev.map((v) => (v.handymanId === id ? { ...v, unread: 0 } : v)));
      } else {
        const res = await realtorMessagesApi.thread(id);
        setOpenName(res.realtorName);
        setOpenPlace('');
        setMessages(res.messages);
        setRealtorThreads((prev) => prev.map((r) => (r.realtorUserId === id ? { ...r, unread: 0 } : r)));
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
        : channel === 'vendor'
        ? await vendorMessagesApi.reply(openId, body, file)
        : await realtorMessagesApi.reply(openId, body, file);
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
    { key: 'realtor', label: 'Realtors', count: realtorThreads.reduce((s, r) => s + r.unread, 0) },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <p className="eyebrow">Inbox</p>
          <h1 className="font-display text-[28px] sm:text-[34px] text-ink mt-1">Messages</h1>
        </div>
        <div className="relative" ref={pickerRef}>
          <Button variant="outline" onClick={openNewMessage}>
            <PenSquare className="h-4 w-4 mr-2" />
            New Message
          </Button>
          {showPicker && (
            <div className="absolute right-0 top-full mt-2 w-72 bg-surface border border-line rounded-xl shadow-lg z-50 overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-line">
                <Search className="h-4 w-4 text-faint flex-shrink-0" />
                <input
                  type="text"
                  value={pickerSearch}
                  onChange={(e) => setPickerSearch(e.target.value)}
                  placeholder="Search tenants..."
                  className="flex-1 bg-transparent text-sm text-ink placeholder:text-faint outline-none"
                  autoFocus
                />
                {pickerSearch && (
                  <button type="button" onClick={() => setPickerSearch('')} className="text-faint hover:text-ink">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <div className="max-h-60 overflow-y-auto">
                {allTenants.length === 0 ? (
                  <p className="text-sm text-muted p-4 text-center">Loading tenants...</p>
                ) : (() => {
                  const q = pickerSearch.toLowerCase();
                  const filtered = allTenants.filter(t =>
                    `${t.firstName} ${t.lastName}`.toLowerCase().includes(q)
                    || (t.tenantNumber || '').toLowerCase().includes(q)
                    || (t.email || '').toLowerCase().includes(q)
                  );
                  return filtered.length === 0 ? (
                    <p className="text-sm text-muted p-4 text-center">No tenants found.</p>
                  ) : (
                    filtered.map(t => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => pickTenant(t)}
                        className="w-full text-left px-4 py-2.5 hover:bg-canvas transition-colors flex items-center gap-3"
                      >
                        <div className="w-8 h-8 rounded-full bg-primary/10 text-primary grid place-items-center text-xs font-medium flex-shrink-0">
                          {t.firstName?.[0]}{t.lastName?.[0]}
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-ink truncate">{t.firstName} {t.lastName}</p>
                          {t.email && <p className="text-xs text-muted truncate">{t.email}</p>}
                        </div>
                      </button>
                    ))
                  );
                })()}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Channel tabs */}
      <div className="rounded-xl border border-line bg-surface p-1 inline-flex -mt-2">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => switchChannel(t.key)}
            className={cn(
              'px-4 py-2 rounded-lg text-sm font-medium transition-all inline-flex items-center gap-2',
              channel === t.key ? 'bg-primary text-white shadow-sm' : 'text-muted hover:text-ink'
            )}
          >
            {t.label}
            {t.count > 0 && (
              <span className={cn(
                'min-w-5 h-5 px-1.5 rounded-full text-xs font-semibold grid place-items-center',
                channel === t.key ? 'bg-white/20 text-white' : 'bg-primary text-white'
              )}>{t.count}</span>
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
                {channel === 'tenant' ? 'No tenant messages yet.' : channel === 'vendor' ? 'No active vendors to message.' : 'No realtors to message yet.'}
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
