import { useEffect, useRef, useState } from 'react';
import { FileText, Upload, Trash2, Pencil, FolderOpen } from 'lucide-react';
import { Card, CardContent } from './ui/Card';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import { Modal } from './ui/Modal';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { useToast } from '../context/ToastContext';
import { useAuth } from '../context/AuthContext';
import { templateApi, type DocumentTemplate } from '../lib/api';

const inputClass = 'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25';

const CATEGORIES = [
  { value: 'lease', label: 'Lease Agreement' },
  { value: 'application', label: 'Application Form' },
  { value: 'rules', label: 'Rules & Regulations' },
  { value: 'addendum', label: 'Addendum' },
  { value: 'other', label: 'Other' },
] as const;

const categoryLabel = (cat: string) => CATEGORIES.find(c => c.value === cat)?.label ?? cat;

const categoryVariant = (cat: string): 'default' | 'success' | 'warning' | 'secondary' => {
  switch (cat) {
    case 'lease': return 'default';
    case 'application': return 'warning';
    case 'rules': return 'success';
    default: return 'secondary';
  }
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentTemplatesSection() {
  const { showToast } = useToast();
  const { hasPermission } = useAuth();
  const canUpload = hasPermission('documents_upload');
  const canDelete = hasPermission('documents_delete');

  const [templates, setTemplates] = useState<DocumentTemplate[]>([]);
  const [loading, setLoading] = useState(true);

  // Upload modal state.
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploadForm, setUploadForm] = useState({ name: '', category: 'lease', description: '', file: null as File | null });

  // Edit modal state.
  const [editTarget, setEditTarget] = useState<DocumentTemplate | null>(null);
  const [editForm, setEditForm] = useState({ name: '', category: '', description: '' });
  const [editBusy, setEditBusy] = useState(false);

  // Delete confirmation state.
  const [deleteTarget, setDeleteTarget] = useState<DocumentTemplate | null>(null);

  useEffect(() => {
    templateApi.list()
      .then(setTemplates)
      .catch(err => showToast((err as Error).message || 'Could not load templates.', 'error'))
      .finally(() => setLoading(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] || null;
    setUploadForm(prev => ({
      ...prev,
      file,
      name: prev.name || (file ? file.name.replace(/\.[^.]+$/, '') : ''),
    }));
  };

  const handleUpload = async () => {
    if (!uploadForm.file || !uploadForm.name.trim()) {
      showToast('Choose a file and give it a name.', 'error');
      return;
    }
    setUploading(true);
    try {
      const tpl = await templateApi.upload(
        uploadForm.file,
        uploadForm.name.trim(),
        uploadForm.category,
        uploadForm.description.trim() || undefined,
      );
      setTemplates(prev => [...prev, tpl]);
      setUploadOpen(false);
      setUploadForm({ name: '', category: 'lease', description: '', file: null });
      if (fileRef.current) fileRef.current.value = '';
      showToast('Template uploaded.', 'success');
    } catch (err) {
      showToast((err as Error).message || 'Upload failed.', 'error');
    } finally {
      setUploading(false);
    }
  };

  const openEdit = (tpl: DocumentTemplate) => {
    setEditTarget(tpl);
    setEditForm({ name: tpl.name, category: tpl.category, description: tpl.description || '' });
  };

  const handleEdit = async () => {
    if (!editTarget || editBusy) return;
    if (!editForm.name.trim()) { showToast('Name is required.', 'error'); return; }
    setEditBusy(true);
    try {
      const updated = await templateApi.update(editTarget.id, {
        name: editForm.name.trim(),
        category: editForm.category,
        description: editForm.description.trim() || undefined,
      });
      setTemplates(prev => prev.map(t => t.id === updated.id ? updated : t));
      setEditTarget(null);
      showToast('Template updated.', 'success');
    } catch (err) {
      showToast((err as Error).message || 'Could not save.', 'error');
    } finally {
      setEditBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await templateApi.remove(deleteTarget.id);
      setTemplates(prev => prev.filter(t => t.id !== deleteTarget.id));
      setDeleteTarget(null);
      showToast('Template removed.', 'success');
    } catch (err) {
      showToast((err as Error).message || 'Could not delete.', 'error');
    }
  };

  // Group by category.
  const grouped = CATEGORIES.map(cat => ({
    ...cat,
    items: templates.filter(t => t.category === cat.value),
  })).filter(g => g.items.length > 0);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Document Templates</h2>
          <p className="text-muted">Upload your standard documents here (lease, application, rules). Send them to prospective tenants with one click.</p>
        </div>
        {canUpload && (
          <Button onClick={() => setUploadOpen(true)}>
            <Upload className="h-4 w-4 mr-2" /> Upload Template
          </Button>
        )}
      </div>

      {loading ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted animate-pulse">Loading templates...</p>
          </CardContent>
        </Card>
      ) : templates.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <FolderOpen className="h-10 w-10 text-faint mx-auto mb-3" />
            <p className="text-sm text-muted mb-1">No templates yet.</p>
            <p className="text-xs text-faint">Upload your lease agreement, application form, or any other standard documents you send to prospective tenants.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {grouped.map(group => (
            <Card key={group.value}>
              <CardContent className="p-5 space-y-3">
                <h3 className="font-semibold text-ink text-sm">{group.label}</h3>
                <div className="space-y-2">
                  {group.items.map(tpl => (
                    <div key={tpl.id} className="flex items-center gap-3 px-3 py-2.5 border border-line rounded-xl hover:bg-canvas transition-colors">
                      <span className="w-9 h-9 rounded-lg bg-primary-soft text-primary grid place-items-center flex-shrink-0">
                        <FileText className="h-[18px] w-[18px]" />
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-ink font-medium truncate">{tpl.name}</p>
                        <p className="text-xs text-muted">
                          {tpl.contentType?.split('/').pop()?.toUpperCase() || 'FILE'}
                          {tpl.size ? ` · ${formatBytes(tpl.size)}` : ''}
                          {tpl.description ? ` · ${tpl.description}` : ''}
                        </p>
                      </div>
                      <Badge variant={categoryVariant(tpl.category)}>{categoryLabel(tpl.category)}</Badge>
                      <div className="flex gap-1">
                        {canUpload && (
                          <button type="button" onClick={() => openEdit(tpl)} className="p-1.5 rounded-lg hover:bg-surface text-muted hover:text-ink transition-colors" title="Edit">
                            <Pencil className="h-4 w-4" />
                          </button>
                        )}
                        {canDelete && (
                          <button type="button" onClick={() => setDeleteTarget(tpl)} className="p-1.5 rounded-lg hover:bg-danger-soft text-muted hover:text-danger transition-colors" title="Delete">
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Upload modal */}
      <Modal isOpen={uploadOpen} onClose={() => setUploadOpen(false)} title="Upload Template" size="md">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">File *</label>
            <input ref={fileRef} type="file" className={inputClass} onChange={handleFileChange} accept=".pdf,.doc,.docx,.txt,.rtf" />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">Template name *</label>
            <input className={inputClass} value={uploadForm.name} onChange={e => setUploadForm({ ...uploadForm, name: e.target.value })} placeholder="e.g. Residential Lease Agreement" />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">Category</label>
            <select className={inputClass} value={uploadForm.category} onChange={e => setUploadForm({ ...uploadForm, category: e.target.value })}>
              {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">Description (optional)</label>
            <input className={inputClass} value={uploadForm.description} onChange={e => setUploadForm({ ...uploadForm, description: e.target.value })} placeholder="Short note about this template" />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => setUploadOpen(false)}>Cancel</Button>
            <Button onClick={handleUpload} disabled={uploading}>{uploading ? 'Uploading...' : 'Upload'}</Button>
          </div>
        </div>
      </Modal>

      {/* Edit modal */}
      <Modal isOpen={!!editTarget} onClose={() => setEditTarget(null)} title="Edit Template" size="md">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">Template name *</label>
            <input className={inputClass} value={editForm.name} onChange={e => setEditForm({ ...editForm, name: e.target.value })} />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">Category</label>
            <select className={inputClass} value={editForm.category} onChange={e => setEditForm({ ...editForm, category: e.target.value })}>
              {CATEGORIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">Description (optional)</label>
            <input className={inputClass} value={editForm.description} onChange={e => setEditForm({ ...editForm, description: e.target.value })} />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => setEditTarget(null)}>Cancel</Button>
            <Button onClick={handleEdit} disabled={editBusy}>{editBusy ? 'Saving...' : 'Save'}</Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete template"
        message={`This removes "${deleteTarget?.name}" from your template library. The file in Google Drive is kept. This cannot be undone.`}
        confirmText="Delete"
      />
    </div>
  );
}
