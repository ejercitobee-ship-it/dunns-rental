import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ReactQuill from 'react-quill-new';
import 'react-quill-new/dist/quill.snow.css';
import { Plus, Search, Copy, Pencil, Trash2, Mail } from 'lucide-react';
import { Card, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { TextInput, SelectInput } from '../components/ui/FormField';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useToast } from '../context/ToastContext';
import { emailTemplatesApi, type EmailTemplate } from '../lib/api';
import { EMAIL_VARIABLES, TEMPLATE_CATEGORIES, categoryLabel } from '../lib/emailVariables';
import { sanitizeHtml } from '../lib/sanitizeHtml';

const quillModules = {
  toolbar: [
    [{ header: [1, 2, 3, false] }],
    ['bold', 'italic', 'underline', 'strike'],
    [{ color: [] }, { background: [] }],
    [{ align: [] }],
    [{ list: 'ordered' }, { list: 'bullet' }],
    ['blockquote'],
    ['link'],
    ['clean'],
  ],
};
const quillFormats = ['header', 'bold', 'italic', 'underline', 'strike', 'color', 'background', 'align', 'list', 'blockquote', 'link'];

const EMPTY = { id: '', name: '', category: 'custom', subject: '', previewText: '', bodyHtml: '' };

export function EmailTemplates() {
  const { showToast } = useToast();
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [catFilter, setCatFilter] = useState('');

  const [editorOpen, setEditorOpen] = useState(false);
  const [form, setForm] = useState<typeof EMPTY>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [toDelete, setToDelete] = useState<EmailTemplate | null>(null);
  const quillRef = useRef<ReactQuill>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setTemplates(await emailTemplatesApi.list());
    } catch (err) {
      showToast((err as Error).message || 'Failed to load templates', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return templates.filter((t) => {
      if (catFilter && t.category !== catFilter) return false;
      if (!q) return true;
      return t.name.toLowerCase().includes(q) || t.subject.toLowerCase().includes(q);
    });
  }, [templates, search, catFilter]);

  function openNew() { setForm(EMPTY); setEditorOpen(true); }
  function openEdit(t: EmailTemplate) {
    setForm({ id: t.id, name: t.name, category: t.category, subject: t.subject, previewText: t.previewText || '', bodyHtml: t.bodyHtml });
    setEditorOpen(true);
  }

  function insertVariable(token: string) {
    const editor = quillRef.current?.getEditor();
    if (!editor) { setForm((f) => ({ ...f, bodyHtml: f.bodyHtml + ` {{${token}}} ` })); return; }
    const range = editor.getSelection(true);
    const at = range ? range.index : editor.getLength();
    editor.insertText(at, `{{${token}}}`, 'user');
    editor.setSelection(at + token.length + 4, 0);
  }

  async function handleSave() {
    if (!form.name.trim()) { showToast('A template name is required', 'error'); return; }
    setSaving(true);
    try {
      const input = { name: form.name.trim(), category: form.category, subject: form.subject.trim(), previewText: form.previewText.trim(), bodyHtml: form.bodyHtml };
      if (form.id) await emailTemplatesApi.update(form.id, input);
      else await emailTemplatesApi.create(input);
      showToast(form.id ? 'Template updated' : 'Template created', 'success');
      setEditorOpen(false);
      await load();
    } catch (err) {
      showToast((err as Error).message || 'Failed to save template', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function handleDuplicate(t: EmailTemplate) {
    try { await emailTemplatesApi.duplicate(t.id); showToast('Template duplicated', 'success'); await load(); }
    catch (err) { showToast((err as Error).message || 'Failed to duplicate', 'error'); }
  }

  async function handleDelete() {
    if (!toDelete) return;
    const t = toDelete; setToDelete(null);
    try { await emailTemplatesApi.remove(t.id); showToast('Template deleted', 'success'); await load(); }
    catch (err) { showToast((err as Error).message || 'Failed to delete', 'error'); }
  }

  return (
    <div className="max-w-5xl">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Email & Reminders</div>
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="text-3xl font-bold text-ink mb-1">Email Templates</h1>
          <p className="text-sm text-muted">Reusable email templates with personalization. They never send on their own.</p>
        </div>
        <Button onClick={openNew}><Plus className="w-4 h-4 mr-1.5" /> New Template</Button>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-faint absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-line bg-surface text-sm"
            placeholder="Search templates…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <SelectInput value={catFilter} onChange={(e) => setCatFilter(e.target.value)}>
          <option value="">All categories</option>
          {TEMPLATE_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
        </SelectInput>
      </div>

      {loading ? (
        <p className="text-sm text-muted">Loading templates…</p>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-muted">
          <Mail className="w-8 h-8 mx-auto mb-2 text-faint" />
          No templates match. Create one to get started.
        </CardContent></Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {filtered.map((t) => (
            <Card key={t.id}>
              <CardContent className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-ink truncate">{t.name}</span>
                      {t.isSystem && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-surface-2 text-muted">Starter</span>}
                    </div>
                    <div className="text-xs text-muted mt-0.5">{categoryLabel(t.category)}</div>
                    <div className="text-sm text-ink/80 mt-2 line-clamp-1">{t.subject || <span className="text-faint italic">No subject</span>}</div>
                  </div>
                </div>
                <div className="flex items-center gap-1 mt-3 pt-3 border-t border-line">
                  <Button variant="ghost" size="sm" onClick={() => openEdit(t)}><Pencil className="w-3.5 h-3.5 mr-1" /> Edit</Button>
                  <Button variant="ghost" size="sm" onClick={() => handleDuplicate(t)}><Copy className="w-3.5 h-3.5 mr-1" /> Duplicate</Button>
                  <Button variant="ghost" size="sm" onClick={() => setToDelete(t)} className="text-danger ml-auto"><Trash2 className="w-3.5 h-3.5" /></Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Modal isOpen={editorOpen} onClose={() => setEditorOpen(false)} title={form.id ? 'Edit template' : 'New template'} size="xl">
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput label="Template name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Rent Due Reminder" />
            <SelectInput label="Category" value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>
              {TEMPLATE_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
            </SelectInput>
          </div>
          <TextInput label="Email subject" value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} placeholder="Subject line" />
          <TextInput label="Preview text (optional)" value={form.previewText} onChange={(e) => setForm({ ...form, previewText: e.target.value })} placeholder="Shown in the inbox preview" />

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-sm font-medium text-ink">Message</label>
            </div>
            <div className="mb-2 flex flex-wrap gap-1">
              {EMAIL_VARIABLES.map((v) => (
                <button
                  key={v.token}
                  type="button"
                  onClick={() => insertVariable(v.token)}
                  className="text-[11px] px-2 py-0.5 rounded border border-line bg-surface text-muted hover:text-ink hover:border-accent"
                  title={`Insert {{${v.token}}}`}
                >
                  {v.label}
                </button>
              ))}
            </div>
            <ReactQuill ref={quillRef} theme="snow" value={form.bodyHtml} onChange={(html) => setForm({ ...form, bodyHtml: html })} modules={quillModules} formats={quillFormats} />
            <p className="text-xs text-muted mt-1.5">Variables like <code>{'{{first_name}}'}</code> fill in per recipient when a campaign is sent.</p>
          </div>

          {form.bodyHtml && (
            <div>
              <div className="text-xs font-semibold uppercase tracking-wide text-muted mb-1.5">Preview</div>
              <div className="rounded-lg border border-line bg-white p-4 text-sm text-ink prose prose-sm max-w-none" dangerouslySetInnerHTML={{ __html: sanitizeHtml(form.bodyHtml) }} />
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="ghost" onClick={() => setEditorOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>{saving ? 'Saving…' : form.id ? 'Save changes' : 'Create template'}</Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={!!toDelete}
        onClose={() => setToDelete(null)}
        onConfirm={handleDelete}
        title="Delete template?"
        message={`Delete "${toDelete?.name}"? This cannot be undone.`}
        confirmText="Delete"
      />
    </div>
  );
}
