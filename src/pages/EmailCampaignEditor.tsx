import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import { ArrowLeft, Send, Users, RefreshCw } from 'lucide-react';
import { Card, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { TextInput, SelectInput, TextareaInput } from '../components/ui/FormField';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useToast } from '../context/ToastContext';
import {
  emailCampaignsApi, emailTemplatesApi, propertiesApi,
  type EmailTemplate, type RecipientFilter, type ResolvedRecipient,
} from '../lib/api';
import type { Property } from '../types';
import { EMAIL_VARIABLES, TEMPLATE_CATEGORIES } from '../lib/emailVariables';
import { sanitizeHtml } from '../lib/sanitizeHtml';

const quillModules = {
  toolbar: [
    [{ header: [1, 2, 3, false] }],
    ['bold', 'italic', 'underline', 'strike'],
    [{ color: [] }, { background: [] }],
    [{ align: [] }],
    [{ list: 'ordered' }, { list: 'bullet' }],
    ['blockquote'], ['link'], ['clean'],
  ],
};
const quillFormats = ['header', 'bold', 'italic', 'underline', 'strike', 'color', 'background', 'align', 'list', 'blockquote', 'link'];

const LEASE_OPTIONS: { value: NonNullable<RecipientFilter['lease']>; label: string }[] = [
  { value: 'any', label: 'Any lease' },
  { value: 'expiring_30', label: 'Lease expiring ≤ 30 days' },
  { value: 'expiring_60', label: 'Lease expiring ≤ 60 days' },
  { value: 'expiring_90', label: 'Lease expiring ≤ 90 days' },
  { value: 'month_to_month', label: 'Month-to-month' },
];

export function EmailCampaignEditor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const isEdit = !!id && id !== 'new';

  const [name, setName] = useState('');
  const [category, setCategory] = useState('custom');
  const [subject, setSubject] = useState('');
  const [previewText, setPreviewText] = useState('');
  const [bodyHtml, setBodyHtml] = useState('');
  const [templateId, setTemplateId] = useState<string | null>(null);

  const [scope, setScope] = useState<'all_active' | 'by_property'>('all_active');
  const [propertyIds, setPropertyIds] = useState<string[]>([]);
  const [lease, setLease] = useState<NonNullable<RecipientFilter['lease']>>('any');
  const [manualEmails, setManualEmails] = useState('');

  const [properties, setProperties] = useState<Property[]>([]);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [preview, setPreview] = useState<{ count: number; recipients: ResolvedRecipient[] } | null>(null);
  const [resolving, setResolving] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [sending, setSending] = useState(false);
  const [confirmSendOpen, setConfirmSendOpen] = useState(false);
  const quillRef = useRef<ReactQuill>(null);

  const buildFilter = useCallback((): RecipientFilter => ({
    scope,
    propertyIds: scope === 'by_property' ? propertyIds : undefined,
    lease,
    manualEmails: manualEmails.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean),
  }), [scope, propertyIds, lease, manualEmails]);

  useEffect(() => {
    (async () => {
      try {
        const [props, tmpls] = await Promise.all([propertiesApi.getAll(), emailTemplatesApi.list()]);
        setProperties(props);
        setTemplates(tmpls);
      } catch { /* non-fatal */ }
      if (isEdit && id) {
        try {
          const c = await emailCampaignsApi.get(id);
          setName(c.name); setCategory(c.category); setSubject(c.subject);
          setPreviewText(c.previewText || ''); setBodyHtml(c.bodyHtml); setTemplateId(c.templateId || null);
          const f = c.recipientFilter || {};
          setScope(f.scope === 'by_property' ? 'by_property' : 'all_active');
          setPropertyIds(f.propertyIds || []);
          setLease((f.lease as NonNullable<RecipientFilter['lease']>) || 'any');
          setManualEmails((f.manualEmails || []).join('\n'));
        } catch (err) { showToast((err as Error).message || 'Failed to load campaign', 'error'); }
      }
    })();
  }, [id, isEdit, showToast]);

  function insertVariable(token: string) {
    const editor = quillRef.current?.getEditor();
    if (!editor) { setBodyHtml((b) => b + ` {{${token}}} `); return; }
    const range = editor.getSelection(true);
    const at = range ? range.index : editor.getLength();
    editor.insertText(at, `{{${token}}}`, 'user');
    editor.setSelection(at + token.length + 4, 0);
  }

  function toggleProperty(pid: string) {
    setPropertyIds((cur) => cur.includes(pid) ? cur.filter((p) => p !== pid) : [...cur, pid]);
    setPreview(null);
  }

  function applyTemplate(tid: string) {
    const t = templates.find((x) => x.id === tid);
    if (!t) return;
    setTemplateId(t.id);
    if (!subject) setSubject(t.subject);
    if (!previewText && t.previewText) setPreviewText(t.previewText);
    setBodyHtml(t.bodyHtml);
    if (category === 'custom') setCategory(t.category);
  }

  async function resolvePreview() {
    setResolving(true);
    try { setPreview(await emailCampaignsApi.resolve(buildFilter())); }
    catch (err) { showToast((err as Error).message || 'Failed to resolve recipients', 'error'); }
    finally { setResolving(false); }
  }

  async function persist(): Promise<string> {
    const input = {
      name: name.trim(), category, subject: subject.trim(), previewText: previewText.trim(),
      bodyHtml, templateId, recipientFilter: buildFilter(), recipientCount: preview?.count ?? 0,
    };
    if (isEdit && id) { await emailCampaignsApi.update(id, input); return id; }
    const created = await emailCampaignsApi.create(input);
    return created.id;
  }

  async function save(goBack: boolean) {
    if (!name.trim()) { showToast('A campaign name is required', 'error'); return; }
    setSaving(true);
    try {
      await persist();
      showToast('Campaign saved as draft', 'success');
      if (goBack) navigate('/email/campaigns');
    } catch (err) { showToast((err as Error).message || 'Failed to save campaign', 'error'); }
    finally { setSaving(false); }
  }

  async function openSendConfirm() {
    if (!name.trim()) { showToast('Give the campaign a name first', 'error'); return; }
    if (!preview) await resolvePreview();
    setConfirmSendOpen(true);
  }

  async function doSend() {
    setConfirmSendOpen(false);
    setSending(true);
    try {
      const cid = await persist();
      const res = await emailCampaignsApi.send(cid);
      showToast(`Sending to ${res.recipientCount} recipient${res.recipientCount === 1 ? '' : 's'}…`, 'success');
      navigate('/email/campaigns');
    } catch (err) { showToast((err as Error).message || 'Failed to send campaign', 'error'); }
    finally { setSending(false); }
  }

  async function sendTest() {
    setTesting(true);
    try {
      const res = await emailCampaignsApi.sendTest({ subject: subject.trim(), bodyHtml, to: testTo.trim() || undefined });
      showToast(`Test email sent to ${res.sentTo}`, 'success');
    } catch (err) { showToast((err as Error).message || 'Failed to send test', 'error'); }
    finally { setTesting(false); }
  }

  return (
    <div className="max-w-3xl pb-24">
      <button onClick={() => navigate('/email/campaigns')} className="flex items-center gap-1 text-sm text-muted hover:text-ink mb-3">
        <ArrowLeft className="w-4 h-4" /> Campaigns
      </button>
      <h1 className="text-3xl font-bold text-ink mb-5">{isEdit ? 'Edit campaign' : 'New campaign'}</h1>

      {/* Step 1: Info */}
      <Card className="mb-4"><CardContent className="p-5 space-y-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted">1 · Campaign details</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput label="Campaign name (internal)" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. November rent reminder" />
          <SelectInput label="Category" value={category} onChange={(e) => setCategory(e.target.value)}>
            {TEMPLATE_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </SelectInput>
        </div>
        <TextInput label="Email subject" value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject line (variables allowed)" />
        <TextInput label="Preview text (optional)" value={previewText} onChange={(e) => setPreviewText(e.target.value)} placeholder="Shown in the inbox preview" />
      </CardContent></Card>

      {/* Step 2: Recipients */}
      <Card className="mb-4"><CardContent className="p-5 space-y-4">
        <div className="text-xs font-semibold uppercase tracking-wide text-muted">2 · Recipients</div>
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectInput label="Who" value={scope} onChange={(e) => { setScope(e.target.value as 'all_active' | 'by_property'); setPreview(null); }}>
            <option value="all_active">All active tenants</option>
            <option value="by_property">Selected properties</option>
          </SelectInput>
          <SelectInput label="Lease filter" value={lease} onChange={(e) => { setLease(e.target.value as NonNullable<RecipientFilter['lease']>); setPreview(null); }}>
            {LEASE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </SelectInput>
        </div>
        {scope === 'by_property' && (
          <div className="flex flex-wrap gap-1.5">
            {properties.map((p) => (
              <button key={p.id} type="button" onClick={() => toggleProperty(p.id)}
                className={`text-xs px-2.5 py-1 rounded-full border ${propertyIds.includes(p.id) ? 'bg-accent/15 border-accent text-ink' : 'bg-surface border-line text-muted hover:text-ink'}`}>
                {p.name}
              </button>
            ))}
          </div>
        )}
        <TextareaInput label="Also email (optional)" value={manualEmails} onChange={(e) => { setManualEmails(e.target.value); setPreview(null); }} rows={2} placeholder="Extra addresses, one per line or comma-separated" />
        <div className="flex items-center gap-3 pt-1">
          <Button variant="outline" size="sm" onClick={resolvePreview} disabled={resolving}>
            {resolving ? <RefreshCw className="w-4 h-4 mr-1.5 animate-spin" /> : <Users className="w-4 h-4 mr-1.5" />}
            Preview recipients
          </Button>
          {preview && (
            <span className="text-sm text-ink"><strong>{preview.count}</strong> recipient{preview.count === 1 ? '' : 's'}</span>
          )}
        </div>
        {preview && preview.count > 0 && (
          <div className="text-xs text-muted max-h-28 overflow-auto rounded-lg border border-line bg-surface p-2">
            {preview.recipients.slice(0, 50).map((r, i) => <div key={i}>{r.name} &middot; {r.email}</div>)}
            {preview.count > 50 && <div className="text-faint mt-1">…and {preview.count - 50} more</div>}
          </div>
        )}
        <p className="text-[11px] text-faint">Financial (balance / overdue) and maintenance segments are coming next and will use your real rent-status data.</p>
      </CardContent></Card>

      {/* Step 3: Content */}
      <Card className="mb-4"><CardContent className="p-5 space-y-3">
        <div className="flex items-center justify-between">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">3 · Content</div>
          <select className="text-xs rounded border border-line bg-surface px-2 py-1 text-muted" value="" onChange={(e) => e.target.value && applyTemplate(e.target.value)}>
            <option value="">Load from template…</option>
            {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </div>
        <div className="flex flex-wrap gap-1">
          {EMAIL_VARIABLES.map((v) => (
            <button key={v.token} type="button" onClick={() => insertVariable(v.token)} title={`Insert {{${v.token}}}`}
              className="text-[11px] px-2 py-0.5 rounded border border-line bg-surface text-muted hover:text-ink hover:border-accent">
              {v.label}
            </button>
          ))}
        </div>
        <ReactQuill ref={quillRef} theme="snow" value={bodyHtml} onChange={setBodyHtml} modules={quillModules} formats={quillFormats} />
        {bodyHtml && (
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-muted mt-2 mb-1.5">Preview</div>
            <div className="rounded-lg border border-line bg-white p-4 text-sm text-ink prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: sanitizeHtml(bodyHtml) }} />
          </div>
        )}
      </CardContent></Card>

      {/* Sticky footer: test + save */}
      <div className="fixed bottom-0 left-0 right-0 border-t border-line bg-surface/95 backdrop-blur px-4 py-3">
        <div className="max-w-3xl mx-auto flex flex-wrap items-center gap-3">
          <input className="flex-1 min-w-[180px] px-3 py-2 rounded-lg border border-line bg-surface text-sm" placeholder="Test email (defaults to you)" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
          <Button variant="outline" onClick={sendTest} disabled={testing}><Send className="w-4 h-4 mr-1.5" />{testing ? 'Sending…' : 'Send test'}</Button>
          <Button variant="outline" onClick={() => save(true)} disabled={saving}>{saving ? 'Saving…' : 'Save draft'}</Button>
          <Button onClick={openSendConfirm} disabled={sending || saving}><Send className="w-4 h-4 mr-1.5" />{sending ? 'Sending…' : 'Send now'}</Button>
        </div>
      </div>

      <ConfirmDialog
        isOpen={confirmSendOpen}
        onClose={() => setConfirmSendOpen(false)}
        onConfirm={doSend}
        title="Send this campaign?"
        message={`This emails ${preview ? preview.count : 'all matching'} tenant recipient${preview && preview.count === 1 ? '' : 's'} right now. This cannot be undone.`}
        confirmText="Send now"
      />
    </div>
  );
}
