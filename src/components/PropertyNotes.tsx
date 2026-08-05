import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Plus, Search, Pin, PinOff, Edit2, Trash2, Paperclip,
  X, FileText, Clock, User, ChevronDown, ChevronRight,
} from 'lucide-react';
import { Card, CardContent } from './ui/Card';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { propertyNotesApi } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import type { PropertyNote, NoteCategory, NoteAttachment } from '../types';

const CATEGORIES: { value: NoteCategory; label: string }[] = [
  { value: 'general', label: 'General' },
  { value: 'property_management', label: 'Property Management' },
  { value: 'tenant_communication', label: 'Tenant Communication' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'financial', label: 'Financial' },
  { value: 'inspection', label: 'Inspection' },
  { value: 'legal', label: 'Legal' },
  { value: 'compliance', label: 'Compliance' },
  { value: 'other', label: 'Other' },
];

const categoryLabel = (cat: string) =>
  CATEGORIES.find(c => c.value === cat)?.label || cat;

const categoryColor: Record<string, string> = {
  general: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  property_management: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  tenant_communication: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  maintenance: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-300',
  financial: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300',
  inspection: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300',
  legal: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  compliance: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300',
  other: 'bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-300',
};

function formatRelativeTime(unix: number): string {
  const now = Math.floor(Date.now() / 1000);
  const diff = now - unix;
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(unix * 1000).toLocaleDateString();
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

interface Props {
  propertyId: string;
}

export function PropertyNotes({ propertyId }: Props) {
  const { user, hasPermission } = useAuth();
  const { showToast } = useToast();
  const [notes, setNotes] = useState<PropertyNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterCategory, setFilterCategory] = useState<string>('');
  const [searchQuery, setSearchQuery] = useState('');
  const [searchDebounced, setSearchDebounced] = useState('');

  // Create/Edit modal
  const [modalOpen, setModalOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<PropertyNote | null>(null);
  const [form, setForm] = useState({ title: '', content: '', category: 'general' as string, isPinned: false });
  const [saving, setSaving] = useState(false);

  // Delete confirm
  const [deleteNote, setDeleteNote] = useState<PropertyNote | null>(null);

  // Expanded notes
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  // Attachment upload
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingFor, setUploadingFor] = useState<string | null>(null);

  const canPin = hasPermission('properties_history');
  const canEdit = hasPermission('properties_edit');

  // Debounce search
  useEffect(() => {
    const timer = setTimeout(() => setSearchDebounced(searchQuery), 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const loadNotes = useCallback(async () => {
    try {
      const data = await propertyNotesApi.list(propertyId, {
        category: filterCategory || undefined,
        search: searchDebounced || undefined,
      });
      setNotes(data);
    } catch {
      showToast('Could not load notes.', 'error');
    } finally {
      setLoading(false);
    }
  }, [propertyId, filterCategory, searchDebounced, showToast]);

  useEffect(() => { loadNotes(); }, [loadNotes]);

  const openCreate = () => {
    setEditingNote(null);
    setForm({ title: '', content: '', category: 'general', isPinned: false });
    setModalOpen(true);
  };

  const openEdit = (note: PropertyNote) => {
    setEditingNote(note);
    setForm({ title: note.title, content: note.content, category: note.category, isPinned: note.isPinned });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) { showToast('Title is required.', 'error'); return; }
    setSaving(true);
    try {
      if (editingNote) {
        const updated = await propertyNotesApi.update(propertyId, editingNote.id, form);
        setNotes(prev => prev.map(n => n.id === updated.id ? updated : n));
        showToast('Note updated.', 'success');
      } else {
        const created = await propertyNotesApi.create(propertyId, form);
        setNotes(prev => [created, ...prev]);
        showToast('Note created.', 'success');
      }
      setModalOpen(false);
    } catch (err) {
      showToast((err as Error).message || 'Could not save note.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteNote) return;
    try {
      await propertyNotesApi.delete(propertyId, deleteNote.id);
      setNotes(prev => prev.filter(n => n.id !== deleteNote.id));
      showToast('Note deleted.', 'success');
    } catch (err) {
      showToast((err as Error).message || 'Could not delete note.', 'error');
    }
    setDeleteNote(null);
  };

  const handleTogglePin = async (note: PropertyNote) => {
    try {
      const result = await propertyNotesApi.togglePin(propertyId, note.id);
      setNotes(prev => prev.map(n => n.id === note.id ? { ...n, isPinned: result.isPinned } : n)
        .sort((a, b) => {
          if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
          return b.updatedAt - a.updatedAt;
        }));
      showToast(result.isPinned ? 'Note pinned.' : 'Note unpinned.', 'success');
    } catch (err) {
      showToast((err as Error).message || 'Could not toggle pin.', 'error');
    }
  };

  const handleAttachmentUpload = async (noteId: string, file: File) => {
    setUploadingFor(noteId);
    try {
      const attachment = await propertyNotesApi.uploadAttachment(propertyId, noteId, file);
      setNotes(prev => prev.map(n => n.id === noteId
        ? { ...n, attachments: [...n.attachments, attachment] }
        : n
      ));
      showToast('File attached.', 'success');
    } catch (err) {
      showToast((err as Error).message || 'Upload failed.', 'error');
    } finally {
      setUploadingFor(null);
    }
  };

  const handleAttachmentDelete = async (noteId: string, attachment: NoteAttachment) => {
    try {
      await propertyNotesApi.deleteAttachment(propertyId, noteId, attachment.id);
      setNotes(prev => prev.map(n => n.id === noteId
        ? { ...n, attachments: n.attachments.filter(a => a.id !== attachment.id) }
        : n
      ));
      showToast('Attachment removed.', 'success');
    } catch (err) {
      showToast((err as Error).message || 'Could not remove attachment.', 'error');
    }
  };

  const toggleExpand = (noteId: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(noteId)) next.delete(noteId);
      else next.add(noteId);
      return next;
    });
  };

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <div className="relative flex-1 w-full sm:max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-faint" />
          <input
            type="text"
            placeholder="Search notes..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full pl-9 pr-3 py-2 text-sm rounded-lg border border-line bg-surface text-ink placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <select
          value={filterCategory}
          onChange={e => setFilterCategory(e.target.value)}
          className="px-3 py-2 text-sm rounded-lg border border-line bg-surface text-ink"
        >
          <option value="">All Categories</option>
          {CATEGORIES.map(c => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
        {canEdit && (
          <Button onClick={openCreate} size="sm">
            <Plus className="h-4 w-4 mr-1" /> New Note
          </Button>
        )}
      </div>

      {/* Notes list */}
      {loading ? (
        <div className="text-sm text-muted py-8 text-center">Loading notes...</div>
      ) : notes.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <FileText className="h-10 w-10 text-faint mx-auto mb-3" />
            <p className="text-muted text-sm">
              {searchQuery || filterCategory ? 'No notes match your filters.' : 'No notes yet. Create the first one.'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {notes.map(note => {
            const isExpanded = expanded.has(note.id);
            return (
              <Card key={note.id} className={`transition-shadow ${note.isPinned ? 'ring-1 ring-primary/30' : ''}`}>
                <CardContent className="p-4">
                  {/* Header */}
                  <div className="flex items-start gap-3">
                    <button
                      onClick={() => toggleExpand(note.id)}
                      className="mt-0.5 text-faint hover:text-ink flex-shrink-0"
                    >
                      {isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        {note.isPinned && <Pin className="h-3.5 w-3.5 text-primary flex-shrink-0" />}
                        <button
                          onClick={() => toggleExpand(note.id)}
                          className="font-semibold text-ink text-sm text-left hover:text-primary truncate"
                        >
                          {note.title}
                        </button>
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${categoryColor[note.category] || categoryColor.other}`}>
                          {categoryLabel(note.category)}
                        </span>
                      </div>
                      <div className="flex items-center gap-3 mt-1 text-xs text-faint">
                        <span className="flex items-center gap-1">
                          <User className="h-3 w-3" /> {note.createdByName || 'Unknown'}
                        </span>
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" /> {formatRelativeTime(note.updatedAt)}
                        </span>
                        {note.attachments.length > 0 && (
                          <span className="flex items-center gap-1">
                            <Paperclip className="h-3 w-3" /> {note.attachments.length}
                          </span>
                        )}
                      </div>
                    </div>
                    {/* Actions */}
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {canPin && (
                        <button
                          onClick={() => handleTogglePin(note)}
                          className="p-1.5 rounded-md hover:bg-canvas text-faint hover:text-primary"
                          title={note.isPinned ? 'Unpin' : 'Pin'}
                        >
                          {note.isPinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
                        </button>
                      )}
                      {canEdit && (
                        <button
                          onClick={() => openEdit(note)}
                          className="p-1.5 rounded-md hover:bg-canvas text-faint hover:text-ink"
                          title="Edit"
                        >
                          <Edit2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {(hasPermission('properties_history') || note.createdBy === user?.id) && (
                        <button
                          onClick={() => setDeleteNote(note)}
                          className="p-1.5 rounded-md hover:bg-canvas text-faint hover:text-destructive"
                          title="Delete"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Expanded content */}
                  {isExpanded && (
                    <div className="mt-3 ml-7 space-y-3">
                      {note.content ? (
                        <div
                          className="text-sm text-ink prose prose-sm max-w-none dark:prose-invert"
                          dangerouslySetInnerHTML={{ __html: sanitize(note.content) }}
                        />
                      ) : (
                        <p className="text-sm text-faint italic">No content.</p>
                      )}

                      {/* Attachments */}
                      {note.attachments.length > 0 && (
                        <div className="space-y-1">
                          <p className="text-xs font-medium text-muted uppercase tracking-wide">Attachments</p>
                          {note.attachments.map(att => (
                            <div key={att.id} className="flex items-center gap-2 text-sm group">
                              <Paperclip className="h-3.5 w-3.5 text-faint flex-shrink-0" />
                              <a
                                href={`/api/documents/download/${att.driveFileId}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-primary hover:underline truncate"
                              >
                                {att.name}
                              </a>
                              <span className="text-xs text-faint">{formatFileSize(att.size)}</span>
                              {canEdit && (
                                <button
                                  onClick={() => handleAttachmentDelete(note.id, att)}
                                  className="opacity-0 group-hover:opacity-100 p-0.5 text-faint hover:text-destructive"
                                  title="Remove attachment"
                                >
                                  <X className="h-3 w-3" />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Add attachment */}
                      {canEdit && (
                        <div>
                          <input
                            ref={fileInputRef}
                            type="file"
                            className="hidden"
                            onChange={e => {
                              const file = e.target.files?.[0];
                              if (file) handleAttachmentUpload(note.id, file);
                              e.target.value = '';
                            }}
                          />
                          <button
                            onClick={() => {
                              setUploadingFor(note.id);
                              fileInputRef.current?.click();
                            }}
                            disabled={uploadingFor === note.id}
                            className="text-xs text-primary hover:underline flex items-center gap-1"
                          >
                            <Paperclip className="h-3 w-3" />
                            {uploadingFor === note.id ? 'Uploading...' : 'Attach file'}
                          </button>
                        </div>
                      )}

                      {/* Updated info */}
                      {note.updatedBy && note.updatedByName && note.updatedAt !== note.createdAt && (
                        <p className="text-xs text-faint">
                          Last updated by {note.updatedByName}, {formatRelativeTime(note.updatedAt)}
                        </p>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create/Edit modal */}
      <Modal isOpen={modalOpen} onClose={() => !saving && setModalOpen(false)} title={editingNote ? 'Edit Note' : 'New Note'} size="lg">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Title</label>
            <input
              type="text"
              value={form.title}
              onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
              placeholder="Note title"
              className="w-full px-3 py-2 text-sm rounded-lg border border-line bg-surface text-ink placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Category</label>
            <select
              value={form.category}
              onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
              className="w-full px-3 py-2 text-sm rounded-lg border border-line bg-surface text-ink"
            >
              {CATEGORIES.map(c => (
                <option key={c.value} value={c.value}>{c.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Content</label>
            <textarea
              value={form.content}
              onChange={e => setForm(f => ({ ...f, content: e.target.value }))}
              rows={8}
              placeholder="Write your note here..."
              className="w-full px-3 py-2 text-sm rounded-lg border border-line bg-surface text-ink placeholder:text-faint focus:outline-none focus:ring-2 focus:ring-primary/30 resize-y"
            />
          </div>
          {canPin && (
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={form.isPinned}
                onChange={e => setForm(f => ({ ...f, isPinned: e.target.checked }))}
                className="rounded border-line"
              />
              Pin this note (stays at the top)
            </label>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setModalOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : editingNote ? 'Update Note' : 'Create Note'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete confirm */}
      <ConfirmDialog
        isOpen={!!deleteNote}
        onClose={() => setDeleteNote(null)}
        onConfirm={handleDelete}
        title="Delete note"
        message={`Delete "${deleteNote?.title}"? This removes the note and all its attachments. This cannot be undone.`}
        confirmText="Delete"
      />
    </div>
  );
}

/**
 * Very minimal HTML sanitizer: strips <script>, on* attributes, and
 * javascript: URLs. For a property management note, the content is written
 * by the same admin team, so the risk surface is small, but we still clean
 * it defensively.
 */
function sanitize(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/href\s*=\s*["']?\s*javascript:/gi, 'href="')
    .replace(/<iframe[\s\S]*?<\/iframe>/gi, '');
}
