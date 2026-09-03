import { useCallback, useEffect, useRef, useState } from 'react';
import { Send, Paperclip, X, FileText } from 'lucide-react';
import { Button } from './ui/Button';

/** A single message, normalized for display regardless of which thread it came from. */
export interface ChatItem {
  id: string;
  body: string;
  createdAt: number;
  mine: boolean;
  senderLabel: string;
  attachmentUrl?: string;
  attachmentName?: string;
  attachmentType?: string;
}

/** A real instant (unix seconds) → short local date/time. */
function formatWhen(createdAt: number): string {
  return new Date(createdAt * 1000).toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function Attachment({ url, name, type, mine }: { url: string; name?: string; type?: string; mine: boolean }) {
  const isImage = (type || '').startsWith('image/');
  if (isImage) {
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className="block mt-1.5">
        <img src={url} alt={name || 'attachment'} className="max-h-44 rounded-lg border border-line object-cover" />
      </a>
    );
  }
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      className={`mt-1.5 inline-flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-xs ${
        mine ? 'border-white/40 text-white hover:bg-white/10' : 'border-line text-ink hover:bg-black/[0.03]'
      }`}
    >
      <FileText className="h-3.5 w-3.5 flex-shrink-0" />
      <span className="truncate max-w-[180px]">{name || 'Attachment'}</span>
    </a>
  );
}

/**
 * A chat thread: a scrolling bubble list plus a composer that can send text and
 * one optional file attachment. Reused by the tenant, handyman, and office
 * messaging surfaces so they look and behave the same. `onSend` does the actual
 * API call; this component owns only the draft, the picked file, and scrolling.
 */
export function MessageThread({
  items,
  onSend,
  sending,
  emptyText,
  placeholder = 'Type your message...',
  heightClass = 'max-h-[55vh]',
}: {
  items: ChatItem[];
  onSend: (body: string, file: File | null) => Promise<void>;
  sending: boolean;
  emptyText: string;
  placeholder?: string;
  heightClass?: string;
}) {
  const [draft, setDraft] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  /** Auto-grow the textarea to fit its content, up to ~40% of the viewport. */
  const autoResize = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    const maxH = Math.min(window.innerHeight * 0.4, 300);
    ta.style.height = `${Math.min(ta.scrollHeight, maxH)}px`;
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' });
  }, [items]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const body = draft.trim();
    if ((!body && !file) || sending) return;
    await onSend(body, file);
    setDraft('');
    setFile(null);
    if (fileRef.current) fileRef.current.value = '';
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
  };

  return (
    <div>
      <div className={`space-y-3 ${heightClass} overflow-y-auto pr-1`}>
        {items.length === 0 ? (
          <p className="text-sm text-muted py-6 text-center">{emptyText}</p>
        ) : (
          items.map((m) => (
            <div key={m.id} className={m.mine ? 'flex justify-end' : 'flex justify-start'}>
              <div className={`max-w-[80%] ${m.mine ? 'items-end' : 'items-start'} flex flex-col`}>
                {(m.body || !m.attachmentUrl) && (
                  <div
                    className={`rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap break-words ${
                      m.mine ? 'bg-primary text-white rounded-br-sm' : 'bg-canvas border border-line text-ink rounded-bl-sm'
                    }`}
                  >
                    {m.body || <span className="italic opacity-80">Attachment</span>}
                  </div>
                )}
                {m.attachmentUrl && (
                  <Attachment url={m.attachmentUrl} name={m.attachmentName} type={m.attachmentType} mine={m.mine} />
                )}
                <span className="text-[11px] text-faint mt-1 px-1">
                  {m.senderLabel} · {formatWhen(m.createdAt)}
                </span>
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={submit} className="mt-4 border-t border-line pt-4 space-y-2">
        {file && (
          <div className="flex items-center gap-2 text-xs text-muted bg-canvas rounded-lg px-2.5 py-1.5">
            <Paperclip className="h-3.5 w-3.5 flex-shrink-0" />
            <span className="truncate flex-1">{file.name}</span>
            <button type="button" onClick={() => { setFile(null); if (fileRef.current) fileRef.current.value = ''; }} className="p-0.5 hover:text-danger">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
        <div className="flex items-end gap-2">
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            title="Attach a file"
            className="flex-shrink-0 h-10 w-10 grid place-items-center rounded-lg border border-line text-muted hover:text-primary hover:border-primary/40 transition-colors"
          >
            <Paperclip className="h-4 w-4" />
          </button>
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => { setDraft(e.target.value); autoResize(); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(e); }
            }}
            rows={2}
            maxLength={4000}
            placeholder={placeholder}
            className="flex-1 resize-y rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary/30"
            style={{ minHeight: '2.75rem', maxHeight: '40vh' }}
          />
          <Button type="submit" disabled={sending || (!draft.trim() && !file)}>
            <Send className="h-4 w-4 mr-2" />
            {sending ? 'Sending...' : 'Send'}
          </Button>
        </div>
      </form>
    </div>
  );
}
