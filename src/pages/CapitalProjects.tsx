import { useState, useMemo, useCallback, useRef } from 'react';
import {
  Plus, ArrowLeft, Search, Pencil, CheckCircle2,
  Clock, XCircle, Home, DoorOpen, Receipt, Upload,
  ChevronDown, Link2, Unlink, FileSpreadsheet, FolderOpen,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { formatCurrency, formatDate, cn } from '../lib/utils';
import { capitalProjectsApi } from '../lib/api';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import type {
  CapitalProject,
  CapitalProjectDetail,
  CapitalProjectStatus,
} from '../types';

const STATUS_CONFIG: Record<CapitalProjectStatus, { label: string; color: string; icon: typeof Clock; badge: 'default' | 'success' | 'destructive' }> = {
  in_progress: { label: 'In Progress', color: 'text-primary', icon: Clock, badge: 'default' },
  completed: { label: 'Completed', color: 'text-positive', icon: CheckCircle2, badge: 'success' },
  cancelled: { label: 'Cancelled', color: 'text-danger', icon: XCircle, badge: 'destructive' },
};

export function CapitalProjects() {
  const { properties, units, expenses, refreshData } = useApp();
  const { showToast } = useToast();

  const [projects, setProjects] = useState<CapitalProject[]>([]);
  const [detail, setDetail] = useState<CapitalProjectDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // Forms
  const [showCreate, setShowCreate] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [form, setForm] = useState({ name: '', propertyId: '', unitId: '', description: '', status: 'in_progress' as CapitalProjectStatus, startDate: '', completionDate: '', budget: '' });

  // Link expenses modal
  const [showLink, setShowLink] = useState(false);
  const [linkSearch, setLinkSearch] = useState('');
  const [selectedExpenses, setSelectedExpenses] = useState<Set<string>>(new Set());

  // Confirmations
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [unlinkConfirm, setUnlinkConfirm] = useState<string | null>(null);

  // Collapsible receipts
  const [expanded, setExpanded] = useState(true);

  const receiptRef = useRef<HTMLInputElement>(null);

  // ------------------------------------------------------------------
  // Data loading
  // ------------------------------------------------------------------

  const loadProjects = useCallback(async () => {
    setLoading(true);
    try {
      const data = await capitalProjectsApi.list();
      setProjects(data);
      setLoaded(true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to load projects', 'error');
    } finally { setLoading(false); }
  }, [showToast]);

  const loadDetail = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const data = await capitalProjectsApi.get(id);
      setDetail(data);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to load project', 'error');
    } finally { setLoading(false); }
  }, [showToast]);

  if (!loaded && !loading) loadProjects();

  // ------------------------------------------------------------------
  // Linkable expenses: expenses for the same property that aren't
  // already in this project (or any project, optionally).
  // ------------------------------------------------------------------

  const linkableExpenses = useMemo(() => {
    if (!detail) return [];
    const linkedIds = new Set(detail.expenses.map(e => e.id));
    return expenses
      .filter(e =>
        e.propertyId === detail.propertyId &&
        !linkedIds.has(e.id) &&
        !e.capitalProjectId
      )
      .sort((a, b) => b.date.localeCompare(a.date));
  }, [detail, expenses]);

  const filteredLinkable = useMemo(() => {
    if (!linkSearch) return linkableExpenses;
    const s = linkSearch.toLowerCase();
    return linkableExpenses.filter(e =>
      (e.description || '').toLowerCase().includes(s) ||
      (e.vendor || '').toLowerCase().includes(s) ||
      (e.category || '').toLowerCase().includes(s)
    );
  }, [linkableExpenses, linkSearch]);

  // ------------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------------

  const handleCreate = async () => {
    if (!form.name.trim() || !form.propertyId) {
      showToast('Name and property are required.', 'error');
      return;
    }
    try {
      await capitalProjectsApi.create({
        name: form.name.trim(),
        propertyId: form.propertyId,
        unitId: form.unitId || undefined,
        description: form.description || undefined,
        status: form.status,
        startDate: form.startDate || undefined,
        completionDate: form.completionDate || undefined,
        budget: form.budget ? Number(form.budget) : undefined,
      });
      showToast('Capital project created.', 'success');
      setShowCreate(false);
      resetForm();
      await loadProjects();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Create failed', 'error');
    }
  };

  const handleUpdate = async () => {
    if (!detail) return;
    try {
      await capitalProjectsApi.update(detail.id, {
        name: form.name.trim(),
        propertyId: form.propertyId,
        unitId: form.unitId || undefined,
        description: form.description || undefined,
        status: form.status,
        startDate: form.startDate || undefined,
        completionDate: form.completionDate || undefined,
        budget: form.budget ? Number(form.budget) : undefined,
      });
      showToast('Project updated.', 'success');
      setShowEdit(false);
      await loadDetail(detail.id);
      await loadProjects();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Update failed', 'error');
    }
  };

  const handleDelete = async (id: string) => {
    setDeleteConfirm(null);
    try {
      await capitalProjectsApi.delete(id);
      showToast('Project deleted. Linked expenses were preserved.', 'success');
      if (detail?.id === id) setDetail(null);
      await loadProjects();
      refreshData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Delete failed', 'error');
    }
  };

  const handleLinkExpenses = async () => {
    if (!detail || selectedExpenses.size === 0) return;
    try {
      const result = await capitalProjectsApi.linkExpenses(detail.id, Array.from(selectedExpenses));
      showToast(`Linked ${result.linked} expense(s) to ${detail.name}.`, 'success');
      setShowLink(false);
      setSelectedExpenses(new Set());
      await loadDetail(detail.id);
      await loadProjects();
      refreshData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Link failed', 'error');
    }
  };

  const handleUnlinkExpense = async (expenseId: string) => {
    if (!detail) return;
    setUnlinkConfirm(null);
    try {
      await capitalProjectsApi.unlinkExpenses(detail.id, [expenseId]);
      showToast('Expense removed from project.', 'success');
      await loadDetail(detail.id);
      await loadProjects();
      refreshData();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Unlink failed', 'error');
    }
  };

  const handleReceiptUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!detail) return;
    const file = e.target.files?.[0];
    if (!file) return;
    if (receiptRef.current) receiptRef.current.value = '';
    showToast(`Uploading ${file.name}...`, 'success');
    capitalProjectsApi.uploadReceipt(detail.id, file)
      .then(() => showToast(`${file.name} uploaded to Drive.`, 'success'))
      .catch(err => showToast(err instanceof Error ? err.message : 'Upload failed', 'error'));
  };

  const resetForm = () => setForm({ name: '', propertyId: '', unitId: '', description: '', status: 'in_progress', startDate: '', completionDate: '', budget: '' });

  const openEdit = () => {
    if (!detail) return;
    setForm({
      name: detail.name,
      propertyId: detail.propertyId,
      unitId: detail.unitId || '',
      description: detail.description || '',
      status: detail.status,
      startDate: detail.startDate || '',
      completionDate: detail.completionDate || '',
      budget: detail.budget != null ? String(detail.budget) : '',
    });
    setShowEdit(true);
  };

  const toggleExpense = (id: string) => {
    setSelectedExpenses(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // ------------------------------------------------------------------
  // Render: Detail view
  // ------------------------------------------------------------------

  if (detail) {
    const prop = properties.find(p => p.id === detail.propertyId);
    const unit = detail.unitId ? units.find(u => u.id === detail.unitId) : null;
    const cfg = STATUS_CONFIG[detail.status];

    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" onClick={() => setDetail(null)}><ArrowLeft className="h-4 w-4" /></Button>
          <div className="flex-1">
            <h1 className="text-[26px] sm:text-[32px] font-medium text-ink">{detail.name}</h1>
            <div className="flex flex-wrap items-center gap-3 text-sm text-muted mt-1">
              {prop && <span className="flex items-center gap-1"><Home className="h-3.5 w-3.5" />{prop.name}</span>}
              {unit && <span className="flex items-center gap-1"><DoorOpen className="h-3.5 w-3.5" />Unit {unit.unitNumber}</span>}
              <Badge variant={cfg.badge}>{cfg.label}</Badge>
            </div>
          </div>
          <Button variant="outline" onClick={openEdit}><Pencil className="h-4 w-4 mr-1.5" />Edit</Button>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <SummaryCard label="Total Cost" value={formatCurrency(detail.totalCost)} />
          <SummaryCard label="Receipts" value={String(detail.expenseCount)} />
          <SummaryCard label="Budget" value={detail.budget != null ? formatCurrency(detail.budget) : 'Not set'} />
          <SummaryCard
            label="Variance"
            value={detail.budget != null ? formatCurrency(detail.budget - detail.totalCost) : 'N/A'}
            color={detail.budget != null ? (detail.totalCost > detail.budget ? 'text-danger' : 'text-positive') : undefined}
          />
        </div>

        {detail.description && (
          <Card>
            <CardContent className="py-4">
              <p className="text-sm text-muted">{detail.description}</p>
              <div className="flex flex-wrap gap-4 mt-2 text-xs text-muted">
                {detail.startDate && <span>Started: {formatDate(detail.startDate)}</span>}
                {detail.completionDate && <span>Completed: {formatDate(detail.completionDate)}</span>}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Action bar */}
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="default" onClick={() => { setShowLink(true); setLinkSearch(''); setSelectedExpenses(new Set()); }}>
            <Link2 className="h-4 w-4 mr-1.5" />
            Add Existing Expenses
          </Button>
          <input ref={receiptRef} type="file" accept="image/*,.pdf" className="hidden" onChange={handleReceiptUpload} />
          <Button variant="outline" onClick={() => receiptRef.current?.click()}>
            <Upload className="h-4 w-4 mr-1.5" />
            Upload to Drive
          </Button>
        </div>

        {/* Expense list (receipts) */}
        <Card>
          <CardHeader
            className="cursor-pointer select-none"
            onClick={() => setExpanded(!expanded)}
          >
            <CardTitle className="flex items-center gap-2">
              <ChevronDown className={cn('h-4 w-4 text-muted transition-transform', !expanded && '-rotate-90')} />
              <Receipt className="h-5 w-5" />
              Project Expenses ({detail.expenses.length})
              <span className="ml-auto text-lg font-semibold tnum">{formatCurrency(detail.totalCost)}</span>
            </CardTitle>
          </CardHeader>
          {expanded && (
            <CardContent className="p-0">
              {detail.expenses.length === 0 ? (
                <div className="py-8 text-center text-muted text-sm">
                  No expenses linked yet. Use "Add Existing Expenses" to attach receipts.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b bg-canvas text-left text-xs text-muted uppercase tracking-wider">
                        <th className="py-3 px-4">Date</th>
                        <th className="py-3 px-4">Vendor</th>
                        <th className="py-3 px-4">Description</th>
                        <th className="py-3 px-4">Category</th>
                        <th className="py-3 px-4 text-right">Amount</th>
                        <th className="py-3 px-4">Receipt</th>
                        <th className="py-3 px-4 text-right">Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.expenses.map(exp => (
                        <tr key={exp.id} className="border-b last:border-0 hover:bg-black/[0.02]">
                          <td className="py-3 px-4 tnum">{formatDate(exp.date)}</td>
                          <td className="py-3 px-4">{exp.vendor || '—'}</td>
                          <td className="py-3 px-4 max-w-[200px] truncate">{exp.description}</td>
                          <td className="py-3 px-4">
                            <Badge variant="outline">{(exp.category || '').replace(/_/g, ' ')}</Badge>
                          </td>
                          <td className="py-3 px-4 text-right font-medium tnum">{formatCurrency(exp.amount)}</td>
                          <td className="py-3 px-4">
                            {exp.receiptUrl ? (
                              <a href={exp.receiptUrl} target="_blank" rel="noreferrer" className="text-primary hover:underline text-xs flex items-center gap-1">
                                <FolderOpen className="h-3 w-3" />View
                              </a>
                            ) : '—'}
                          </td>
                          <td className="py-3 px-4 text-right">
                            <button
                              title="Remove from project"
                              className="p-1.5 text-muted hover:text-danger rounded-md hover:bg-black/5"
                              onClick={() => setUnlinkConfirm(exp.id)}
                            >
                              <Unlink className="h-3.5 w-3.5" />
                            </button>
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-canvas font-semibold">
                        <td colSpan={4} className="py-3 px-4 text-right">Project Total</td>
                        <td className="py-3 px-4 text-right tnum">{formatCurrency(detail.totalCost)}</td>
                        <td colSpan={2} />
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          )}
        </Card>

        {/* Link Expenses Modal */}
        <Modal isOpen={showLink} onClose={() => setShowLink(false)} title="Add Expenses to Project" size="lg">
          <div className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
              <input
                className="w-full pl-9 pr-3 py-2 border border-line rounded-lg bg-surface text-sm"
                placeholder="Search by description, vendor, category..."
                value={linkSearch}
                onChange={e => setLinkSearch(e.target.value)}
              />
            </div>
            {filteredLinkable.length === 0 ? (
              <p className="text-center text-muted text-sm py-6">No unlinked expenses found for this property.</p>
            ) : (
              <div className="max-h-[400px] overflow-y-auto border border-line rounded-lg">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-canvas">
                    <tr className="border-b text-left text-xs text-muted uppercase tracking-wider">
                      <th className="py-2 px-3 w-8" />
                      <th className="py-2 px-3">Date</th>
                      <th className="py-2 px-3">Description</th>
                      <th className="py-2 px-3">Vendor</th>
                      <th className="py-2 px-3 text-right">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredLinkable.map(exp => (
                      <tr
                        key={exp.id}
                        className={cn('border-b last:border-0 cursor-pointer hover:bg-black/[0.02]', selectedExpenses.has(exp.id) && 'bg-primary/5')}
                        onClick={() => toggleExpense(exp.id)}
                      >
                        <td className="py-2 px-3">
                          <input type="checkbox" checked={selectedExpenses.has(exp.id)} readOnly className="rounded" />
                        </td>
                        <td className="py-2 px-3 tnum">{formatDate(exp.date)}</td>
                        <td className="py-2 px-3">{exp.description}</td>
                        <td className="py-2 px-3 text-muted">{exp.vendor || '—'}</td>
                        <td className="py-2 px-3 text-right font-medium tnum">{formatCurrency(exp.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {selectedExpenses.size > 0 && (
              <div className="flex items-center justify-between pt-2">
                <span className="text-sm text-muted">{selectedExpenses.size} selected</span>
                <Button variant="default" onClick={handleLinkExpenses}>
                  <Link2 className="h-4 w-4 mr-1.5" />
                  Link {selectedExpenses.size} Expense{selectedExpenses.size !== 1 ? 's' : ''}
                </Button>
              </div>
            )}
          </div>
        </Modal>

        {/* Edit modal */}
        <Modal isOpen={showEdit} onClose={() => setShowEdit(false)} title="Edit Project">
          <ProjectForm
            form={form}
            setForm={setForm}
            properties={properties}
            units={units}
            onSubmit={handleUpdate}
            onCancel={() => setShowEdit(false)}
            submitLabel="Save Changes"
          />
        </Modal>

        {/* Unlink confirm */}
        <ConfirmDialog
          isOpen={!!unlinkConfirm}
          title="Remove Expense from Project"
          message="This removes the expense from this capital project. The expense itself is not deleted."
          confirmText="Remove"
          variant="warning"
          onConfirm={() => unlinkConfirm && handleUnlinkExpense(unlinkConfirm)}
          onClose={() => setUnlinkConfirm(null)}
        />
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Render: Project list
  // ------------------------------------------------------------------

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[26px] sm:text-[32px] font-medium text-ink">Capital Projects</h1>
          <p className="text-muted mt-1 text-sm">Track capital improvement projects with multiple receipts and invoices.</p>
        </div>
        <Button variant="default" onClick={() => { resetForm(); setShowCreate(true); }}>
          <Plus className="h-4 w-4 mr-1.5" />
          New Project
        </Button>
      </div>

      {projects.length === 0 && !loading && (
        <Card>
          <CardContent className="py-16 text-center">
            <FileSpreadsheet className="h-12 w-12 mx-auto text-muted mb-4" />
            <p className="text-lg font-medium text-ink mb-2">No capital projects yet</p>
            <p className="text-muted text-sm mb-6 max-w-md mx-auto">
              Create a capital improvement project to group multiple expenses (receipts, invoices) into one trackable improvement.
              Each receipt stays as an individual expense for tax purposes.
            </p>
            <Button variant="outline" onClick={() => { resetForm(); setShowCreate(true); }}>
              <Plus className="h-4 w-4 mr-1.5" />
              Create Your First Project
            </Button>
          </CardContent>
        </Card>
      )}

      {projects.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map(proj => {
            const prop = properties.find(p => p.id === proj.propertyId);
            const cfg = STATUS_CONFIG[proj.status];
            return (
              <Card
                key={proj.id}
                className="cursor-pointer hover:border-primary/30 transition-colors"
                onClick={() => loadDetail(proj.id)}
              >
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <h3 className="font-medium text-ink text-base leading-snug">{proj.name}</h3>
                    <Badge variant={cfg.badge}>{cfg.label}</Badge>
                  </div>
                  {prop && (
                    <p className="text-xs text-muted flex items-center gap-1 mb-3">
                      <Home className="h-3 w-3" />{prop.name}
                    </p>
                  )}
                  <div className="flex items-end justify-between">
                    <div>
                      <p className="text-2xl font-semibold tnum text-ink">{formatCurrency(proj.totalCost)}</p>
                      <p className="text-xs text-muted">{proj.expenseCount} receipt{proj.expenseCount !== 1 ? 's' : ''}</p>
                    </div>
                    {proj.budget != null && (
                      <div className="text-right">
                        <p className="text-xs text-muted">Budget</p>
                        <p className="text-sm font-medium tnum">{formatCurrency(proj.budget)}</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create Modal */}
      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="New Capital Project">
        <ProjectForm
          form={form}
          setForm={setForm}
          properties={properties}
          units={units}
          onSubmit={handleCreate}
          onCancel={() => setShowCreate(false)}
          submitLabel="Create Project"
        />
      </Modal>

      {/* Delete confirm */}
      <ConfirmDialog
        isOpen={!!deleteConfirm}
        title="Delete Project"
        message="This deletes the project. Linked expenses are preserved as regular expenses."
        confirmText="Delete"
        variant="danger"
        onConfirm={() => deleteConfirm && handleDelete(deleteConfirm)}
        onClose={() => setDeleteConfirm(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ProjectForm({
  form, setForm, properties, units, onSubmit, onCancel, submitLabel,
}: {
  form: { name: string; propertyId: string; unitId: string; description: string; status: CapitalProjectStatus; startDate: string; completionDate: string; budget: string };
  setForm: (f: typeof form) => void;
  properties: { id: string; name: string }[];
  units: { id: string; propertyId: string; unitNumber: string }[];
  onSubmit: () => void;
  onCancel: () => void;
  submitLabel: string;
}) {
  return (
    <form className="space-y-4" onSubmit={e => { e.preventDefault(); onSubmit(); }}>
      <div>
        <label className="block text-xs text-muted mb-1">Project Name *</label>
        <input
          type="text"
          className="w-full px-3 py-2 border border-line rounded-lg bg-surface text-sm"
          placeholder="e.g. Kitchen Remodel"
          value={form.name}
          onChange={e => setForm({ ...form, name: e.target.value })}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-xs text-muted mb-1">Property *</label>
          <select
            className="w-full px-3 py-2 border border-line rounded-lg bg-surface text-sm"
            value={form.propertyId}
            onChange={e => setForm({ ...form, propertyId: e.target.value, unitId: '' })}
          >
            <option value="">Select property...</option>
            {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs text-muted mb-1">Unit (optional)</label>
          <select
            className="w-full px-3 py-2 border border-line rounded-lg bg-surface text-sm"
            value={form.unitId}
            onChange={e => setForm({ ...form, unitId: e.target.value })}
          >
            <option value="">Whole property</option>
            {form.propertyId && units.filter(u => u.propertyId === form.propertyId).map(u => (
              <option key={u.id} value={u.id}>Unit {u.unitNumber}</option>
            ))}
          </select>
        </div>
      </div>

      <div>
        <label className="block text-xs text-muted mb-1">Description</label>
        <textarea
          className="w-full px-3 py-2 border border-line rounded-lg bg-surface text-sm"
          rows={2}
          placeholder="Scope of work, contractor details, etc."
          value={form.description}
          onChange={e => setForm({ ...form, description: e.target.value })}
        />
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-xs text-muted mb-1">Status</label>
          <select
            className="w-full px-3 py-2 border border-line rounded-lg bg-surface text-sm"
            value={form.status}
            onChange={e => setForm({ ...form, status: e.target.value as CapitalProjectStatus })}
          >
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
        <div>
          <label className="block text-xs text-muted mb-1">Start Date</label>
          <input
            type="date"
            className="w-full px-3 py-2 border border-line rounded-lg bg-surface text-sm"
            value={form.startDate}
            onChange={e => setForm({ ...form, startDate: e.target.value })}
          />
        </div>
        <div>
          <label className="block text-xs text-muted mb-1">Completion Date</label>
          <input
            type="date"
            className="w-full px-3 py-2 border border-line rounded-lg bg-surface text-sm"
            value={form.completionDate}
            onChange={e => setForm({ ...form, completionDate: e.target.value })}
          />
        </div>
      </div>

      <div>
        <label className="block text-xs text-muted mb-1">Budget</label>
        <input
          type="number"
          step="0.01"
          className="w-full px-3 py-2 border border-line rounded-lg bg-surface text-sm"
          placeholder="Optional budget for this project"
          value={form.budget}
          onChange={e => setForm({ ...form, budget: e.target.value })}
        />
      </div>

      <div className="flex justify-end gap-2 pt-2">
        <Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button>
        <Button type="submit" variant="default">{submitLabel}</Button>
      </div>
    </form>
  );
}

function SummaryCard({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-4 text-center">
      <div className="text-xs text-muted mb-1">{label}</div>
      <div className={cn('text-xl font-semibold', color || 'text-ink')}>{value}</div>
    </div>
  );
}
