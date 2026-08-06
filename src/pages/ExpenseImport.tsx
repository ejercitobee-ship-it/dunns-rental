import { useState, useMemo, useCallback, useRef } from 'react';
import {
  Upload, FileSpreadsheet, CheckCircle2, AlertTriangle, XCircle,
  Trash2, ArrowLeft, Search, Pencil, SkipForward,
  Merge, RotateCcw, Eye, Filter, Home, DoorOpen,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { formatCurrency, formatDate, cn } from '../lib/utils';
import { expenseImportApi } from '../lib/api';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import {
  EXPENSE_TIERS, categoriesForTier,
  expenseCategoryLabel,
} from '../lib/financials';
import type {
  ExpenseImport as ImportType,
  ExpenseImportDetail,
  ExpenseImportRow,
  ImportRowStatus,
  ExpenseCategory,
} from '../types';

const STATUS_CONFIG: Record<ImportRowStatus, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  pending: { label: 'Pending', color: 'text-muted', icon: Eye },
  valid: { label: 'Ready', color: 'text-positive', icon: CheckCircle2 },
  error: { label: 'Error', color: 'text-danger', icon: XCircle },
  duplicate: { label: 'Duplicate', color: 'text-warning', icon: AlertTriangle },
  skipped: { label: 'Skipped', color: 'text-muted', icon: SkipForward },
};

export function ExpenseImportPage() {
  const { properties, units } = useApp();
  const { showToast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [imports, setImports] = useState<ImportType[]>([]);
  const [detail, setDetail] = useState<ExpenseImportDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [uploading, setUploading] = useState(false);

  // Filters for row list
  const [statusFilter, setStatusFilter] = useState<ImportRowStatus | 'all'>('all');
  const [search, setSearch] = useState('');

  // Editing
  const [editRow, setEditRow] = useState<ExpenseImportRow | null>(null);

  // Confirmations
  const [mergeConfirm, setMergeConfirm] = useState(false);
  const [rollbackConfirm, setRollbackConfirm] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  // ------------------------------------------------------------------
  // Load data
  // ------------------------------------------------------------------

  const loadImports = useCallback(async () => {
    setLoading(true);
    try {
      const data = await expenseImportApi.list();
      setImports(data);
      setLoaded(true);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to load imports', 'error');
    } finally { setLoading(false); }
  }, [showToast]);

  const loadDetail = useCallback(async (id: string) => {
    setLoading(true);
    try {
      const data = await expenseImportApi.get(id);
      setDetail(data);
      setStatusFilter('all');
      setSearch('');
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to load import', 'error');
    } finally { setLoading(false); }
  }, [showToast]);

  // Load list on first render
  if (!loaded && !loading) loadImports();

  // ------------------------------------------------------------------
  // Upload
  // ------------------------------------------------------------------

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      const result = await expenseImportApi.upload(file);
      showToast(`Imported ${result.totalRows} rows from ${result.fileName}. ${result.validRows} ready, ${result.errorRows} need review.`, 'success');
      await loadDetail(result.id);
      await loadImports();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Upload failed', 'error');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  // ------------------------------------------------------------------
  // Actions
  // ------------------------------------------------------------------

  const handleMerge = async () => {
    if (!detail) return;
    setMergeConfirm(false);
    setLoading(true);
    try {
      const result = await expenseImportApi.merge(detail.id);
      showToast(`Successfully merged ${result.mergedRows} expense records into the system.`, 'success');
      await loadDetail(detail.id);
      await loadImports();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Merge failed', 'error');
    } finally { setLoading(false); }
  };

  const handleRollback = async () => {
    if (!detail) return;
    setRollbackConfirm(false);
    setLoading(true);
    try {
      const result = await expenseImportApi.rollback(detail.id);
      showToast(`Rolled back ${result.removedExpenses} imported expenses.`, 'success');
      await loadDetail(detail.id);
      await loadImports();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Rollback failed', 'error');
    } finally { setLoading(false); }
  };

  const handleDelete = async (id: string) => {
    setDeleteConfirm(null);
    try {
      await expenseImportApi.delete(id);
      showToast('Import discarded.', 'success');
      if (detail?.id === id) setDetail(null);
      await loadImports();
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Delete failed', 'error');
    }
  };

  const handleSkipRow = async (rowId: string) => {
    if (!detail) return;
    try {
      await expenseImportApi.updateRows(detail.id, [{ id: rowId, status: 'skipped' }]);
      await loadDetail(detail.id);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Failed to skip row', 'error');
    }
  };

  const handleSaveRow = async () => {
    if (!detail || !editRow) return;
    try {
      await expenseImportApi.updateRows(detail.id, [{
        id: editRow.id,
        propertyId: editRow.propertyId || undefined,
        unitId: editRow.unitId || undefined,
        category: editRow.category || undefined,
        amount: editRow.amount,
        date: editRow.date || undefined,
        description: editRow.description || undefined,
        vendor: editRow.vendor || undefined,
        notes: editRow.notes || undefined,
        taxCategory: editRow.taxCategory || undefined,
        taxDeductible: editRow.taxDeductible,
      }]);
      setEditRow(null);
      showToast('Row updated and re-validated.', 'success');
      await loadDetail(detail.id);
    } catch (err) {
      showToast(err instanceof Error ? err.message : 'Save failed', 'error');
    }
  };

  // ------------------------------------------------------------------
  // Filtered rows
  // ------------------------------------------------------------------

  const filteredRows = useMemo(() => {
    if (!detail) return [];
    return detail.rows.filter(r => {
      if (statusFilter !== 'all' && r.status !== statusFilter) return false;
      if (search) {
        const s = search.toLowerCase();
        return (
          (r.description || '').toLowerCase().includes(s) ||
          (r.vendor || '').toLowerCase().includes(s) ||
          (r.propertyName || '').toLowerCase().includes(s) ||
          String(r.rowNumber).includes(s)
        );
      }
      return true;
    });
  }, [detail, statusFilter, search]);

  // ------------------------------------------------------------------
  // Render: Detail view
  // ------------------------------------------------------------------

  if (detail) {
    const statusCounts = { valid: 0, error: 0, duplicate: 0, skipped: 0, pending: 0 };
    detail.rows.forEach(r => { if (r.status in statusCounts) statusCounts[r.status as keyof typeof statusCounts]++; });

    const canMerge = detail.status !== 'merged' && detail.status !== 'rolled_back' && statusCounts.error === 0 && statusCounts.valid > 0;
    const canRollback = detail.status === 'merged';
    const isFinal = detail.status === 'merged' || detail.status === 'rolled_back';

    return (
      <div className="space-y-6">
        {/* Header */}
        <div className="flex items-center gap-3">
          <Button variant="ghost" onClick={() => setDetail(null)}><ArrowLeft className="h-4 w-4" /></Button>
          <div className="flex-1">
            <h1 className="text-[26px] sm:text-[32px] font-medium text-ink flex items-center gap-2">
              <FileSpreadsheet className="h-7 w-7" />
              {detail.fileName}
            </h1>
            <p className="text-muted text-sm mt-0.5">
              Uploaded {detail.uploadedByName ? `by ${detail.uploadedByName}` : ''} on {new Date((detail.uploadedAt as number) * 1000).toLocaleDateString()}
              {detail.mergedAt && ` · Merged ${new Date((detail.mergedAt as number) * 1000).toLocaleDateString()}`}
              {detail.rolledBackAt && ` · Rolled back ${new Date((detail.rolledBackAt as number) * 1000).toLocaleDateString()}`}
            </p>
          </div>
          <ImportStatusBadge status={detail.status} />
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          <SummaryCard label="Total Records" value={detail.totalRows} />
          <SummaryCard label="Ready" value={statusCounts.valid} color="text-positive" onClick={() => setStatusFilter('valid')} />
          <SummaryCard label="Errors" value={statusCounts.error} color="text-danger" onClick={() => setStatusFilter('error')} />
          <SummaryCard label="Duplicates" value={statusCounts.duplicate} color="text-warning" onClick={() => setStatusFilter('duplicate')} />
          <SummaryCard label="Skipped" value={statusCounts.skipped} color="text-muted" onClick={() => setStatusFilter('skipped')} />
        </div>

        {/* Action bar */}
        <div className="flex flex-wrap items-center gap-3">
          {canMerge && (
            <Button variant="default" onClick={() => setMergeConfirm(true)}>
              <Merge className="h-4 w-4 mr-1.5" />
              Merge {statusCounts.valid} Records to Production
            </Button>
          )}
          {canRollback && (
            <Button variant="outline" onClick={() => setRollbackConfirm(true)}>
              <RotateCcw className="h-4 w-4 mr-1.5" />
              Rollback Import
            </Button>
          )}
          {statusCounts.error > 0 && (
            <Button variant="outline" onClick={() => setStatusFilter('error')}>
              <Filter className="h-4 w-4 mr-1.5" />
              Show {statusCounts.error} Error{statusCounts.error !== 1 ? 's' : ''} Only
            </Button>
          )}
          {statusFilter !== 'all' && (
            <Button variant="ghost" onClick={() => setStatusFilter('all')}>Show All</Button>
          )}
        </div>

        {/* Search + filter bar */}
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
            <input
              className="w-full pl-9 pr-3 py-2 border border-line rounded-lg bg-surface text-sm"
              placeholder="Search description, vendor, property..."
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <select
            className="px-3 py-2 border border-line rounded-lg bg-surface text-sm"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value as ImportRowStatus | 'all')}
          >
            <option value="all">All statuses</option>
            <option value="valid">Ready ({statusCounts.valid})</option>
            <option value="error">Errors ({statusCounts.error})</option>
            <option value="duplicate">Duplicates ({statusCounts.duplicate})</option>
            <option value="skipped">Skipped ({statusCounts.skipped})</option>
          </select>
        </div>

        {/* Row table */}
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-canvas text-left text-xs text-muted uppercase tracking-wider">
                    <th className="py-3 px-4">#</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Date</th>
                    <th className="py-3 px-4">Property</th>
                    <th className="py-3 px-4">Category</th>
                    <th className="py-3 px-4">Description</th>
                    <th className="py-3 px-4">Vendor</th>
                    <th className="py-3 px-4 text-right">Amount</th>
                    {!isFinal && <th className="py-3 px-4 text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody>
                  {filteredRows.map(row => {
                    const cfg = STATUS_CONFIG[row.status];
                    const StatusIcon = cfg.icon;
                    const prop = row.propertyId ? properties.find(p => p.id === row.propertyId) : null;
                    const unit = row.unitId ? units.find(u => u.id === row.unitId) : null;

                    return (
                      <tr key={row.id} className={cn('border-b last:border-0 hover:bg-black/[0.02]', row.status === 'error' && 'bg-danger-soft/30')}>
                        <td className="py-3 px-4 text-muted tnum">{row.rowNumber}</td>
                        <td className="py-3 px-4">
                          <span className={cn('inline-flex items-center gap-1 text-xs font-medium', cfg.color)}>
                            <StatusIcon className="h-3.5 w-3.5" />
                            {cfg.label}
                          </span>
                          {row.errors.length > 0 && (
                            <div className="mt-1 space-y-0.5">
                              {row.errors.map((e, i) => (
                                <div key={i} className="text-[11px] text-danger">{e.message}</div>
                              ))}
                            </div>
                          )}
                        </td>
                        <td className="py-3 px-4 tnum">{row.date ? formatDate(row.date) : <span className="text-danger">Missing</span>}</td>
                        <td className="py-3 px-4">
                          <div className="space-y-0.5">
                            {prop ? (
                              <span className="flex items-center gap-1"><Home className="h-3 w-3 text-muted" />{prop.name}</span>
                            ) : row.propertyName ? (
                              <span className="text-danger flex items-center gap-1"><Home className="h-3 w-3" />{row.propertyName} <span className="text-[10px]">(not found)</span></span>
                            ) : (
                              <span className="text-danger text-xs">Missing</span>
                            )}
                            {unit && <span className="text-xs text-muted flex items-center gap-1"><DoorOpen className="h-3 w-3" />Unit {unit.unitNumber}</span>}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          {row.category ? (
                            <Badge variant="outline">{expenseCategoryLabel(row.category || '')}</Badge>
                          ) : (
                            <span className="text-danger text-xs">Missing</span>
                          )}
                        </td>
                        <td className="py-3 px-4 max-w-[200px] truncate">{row.description || <span className="text-danger text-xs">Missing</span>}</td>
                        <td className="py-3 px-4 text-muted">{row.vendor || '—'}</td>
                        <td className="py-3 px-4 text-right font-medium tnum">
                          {row.amount != null ? formatCurrency(row.amount) : <span className="text-danger">Missing</span>}
                        </td>
                        {!isFinal && (
                          <td className="py-3 px-4 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <button
                                title="Edit"
                                className="p-1.5 text-muted hover:text-ink rounded-md hover:bg-black/5"
                                onClick={() => setEditRow({ ...row })}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </button>
                              {row.status !== 'skipped' && (
                                <button
                                  title="Skip this row"
                                  className="p-1.5 text-muted hover:text-warning rounded-md hover:bg-black/5"
                                  onClick={() => handleSkipRow(row.id)}
                                >
                                  <SkipForward className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {filteredRows.length === 0 && (
                <div className="py-12 text-center text-muted">
                  {statusFilter !== 'all' ? 'No rows match this filter.' : 'No rows in this import.'}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Edit Row Modal */}
        <Modal isOpen={!!editRow} onClose={() => setEditRow(null)} title={`Edit Row ${editRow?.rowNumber}`}>
          {editRow && (
            <form
              className="space-y-4"
              onSubmit={e => { e.preventDefault(); handleSaveRow(); }}
            >
              {/* Original data reference */}
              {Object.keys(editRow.originalData).length > 0 && (
                <details className="text-xs border border-line rounded-lg p-2">
                  <summary className="cursor-pointer text-muted font-medium">Original imported data</summary>
                  <div className="mt-2 space-y-1">
                    {Object.entries(editRow.originalData).map(([k, v]) => (
                      <div key={k}><span className="text-muted">{k}:</span> {v || '(empty)'}</div>
                    ))}
                  </div>
                </details>
              )}

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-muted mb-1">Property *</label>
                  <select
                    className="w-full px-3 py-2 border border-line rounded-lg bg-surface text-sm"
                    value={editRow.propertyId || ''}
                    onChange={e => setEditRow({ ...editRow, propertyId: e.target.value || undefined })}
                  >
                    <option value="">Select property...</option>
                    {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-muted mb-1">Unit (optional)</label>
                  <select
                    className="w-full px-3 py-2 border border-line rounded-lg bg-surface text-sm"
                    value={editRow.unitId || ''}
                    onChange={e => setEditRow({ ...editRow, unitId: e.target.value || undefined })}
                  >
                    <option value="">None (property level)</option>
                    {editRow.propertyId && units.filter(u => u.propertyId === editRow.propertyId).map(u => (
                      <option key={u.id} value={u.id}>Unit {u.unitNumber}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-muted mb-1">Date *</label>
                  <input
                    type="date"
                    className="w-full px-3 py-2 border border-line rounded-lg bg-surface text-sm"
                    value={editRow.date || ''}
                    onChange={e => setEditRow({ ...editRow, date: e.target.value })}
                  />
                </div>
                <div>
                  <label className="block text-xs text-muted mb-1">Amount *</label>
                  <input
                    type="number"
                    step="0.01"
                    className="w-full px-3 py-2 border border-line rounded-lg bg-surface text-sm"
                    value={editRow.amount ?? ''}
                    onChange={e => setEditRow({ ...editRow, amount: Number(e.target.value) || undefined })}
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs text-muted mb-1">Category *</label>
                <select
                  className="w-full px-3 py-2 border border-line rounded-lg bg-surface text-sm"
                  value={editRow.category || ''}
                  onChange={e => setEditRow({ ...editRow, category: e.target.value as ExpenseCategory })}
                >
                  <option value="">Select category...</option>
                  {EXPENSE_TIERS.map(tier => (
                    <optgroup key={tier.value} label={tier.label}>
                      {categoriesForTier(tier.value).map(c => (
                        <option key={c.value} value={c.value}>{c.label}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs text-muted mb-1">Description *</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border border-line rounded-lg bg-surface text-sm"
                  value={editRow.description || ''}
                  onChange={e => setEditRow({ ...editRow, description: e.target.value })}
                />
              </div>

              <div>
                <label className="block text-xs text-muted mb-1">Vendor</label>
                <input
                  type="text"
                  className="w-full px-3 py-2 border border-line rounded-lg bg-surface text-sm"
                  value={editRow.vendor || ''}
                  onChange={e => setEditRow({ ...editRow, vendor: e.target.value })}
                />
              </div>

              <div>
                <label className="block text-xs text-muted mb-1">Notes</label>
                <textarea
                  className="w-full px-3 py-2 border border-line rounded-lg bg-surface text-sm"
                  rows={2}
                  value={editRow.notes || ''}
                  onChange={e => setEditRow({ ...editRow, notes: e.target.value })}
                />
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button type="button" variant="ghost" onClick={() => setEditRow(null)}>Cancel</Button>
                <Button type="submit" variant="default">Save &amp; Re-validate</Button>
              </div>
            </form>
          )}
        </Modal>

        {/* Merge confirm */}
        <ConfirmDialog
          isOpen={mergeConfirm}
          title="Merge to Production"
          message={`This will create ${statusCounts.valid} live expense records. The imported data will immediately appear in all reports, the Dashboard, the Tax Report, and property financials. You can roll this back later if needed.`}
          confirmText="Merge Now"
          variant="info"
          onConfirm={handleMerge}
          onClose={() => setMergeConfirm(false)}
        />

        {/* Rollback confirm */}
        <ConfirmDialog
          isOpen={rollbackConfirm}
          title="Rollback Import"
          message={`This will remove all ${detail?.mergedRows || 0} expenses created by this import. Manually entered expenses and other imports are not affected.`}
          confirmText="Rollback"
          variant="danger"
          onConfirm={handleRollback}
          onClose={() => setRollbackConfirm(false)}
        />
      </div>
    );
  }

  // ------------------------------------------------------------------
  // Render: Import list
  // ------------------------------------------------------------------

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-[26px] sm:text-[32px] font-medium text-ink">Expense Imports</h1>
          <p className="text-muted mt-1 text-sm">Upload, review, and merge historical expense data from CSV files.</p>
        </div>
        <div>
          <input ref={fileRef} type="file" accept=".csv" className="hidden" onChange={handleUpload} />
          <Button variant="default" onClick={() => fileRef.current?.click()} disabled={uploading}>
            <Upload className="h-4 w-4 mr-1.5" />
            {uploading ? 'Uploading...' : 'Upload CSV'}
          </Button>
        </div>
      </div>

      {imports.length === 0 && !loading && (
        <Card>
          <CardContent className="py-16 text-center">
            <FileSpreadsheet className="h-12 w-12 mx-auto text-muted mb-4" />
            <p className="text-lg font-medium text-ink mb-2">No imports yet</p>
            <p className="text-muted text-sm mb-6 max-w-md mx-auto">
              Upload a CSV file with your historical expenses. The data will be staged for review before it touches
              the live system. Your CSV should have columns like Date, Amount, Category, Property, Description.
            </p>
            <Button variant="outline" onClick={() => fileRef.current?.click()}>
              <Upload className="h-4 w-4 mr-1.5" />
              Upload Your First CSV
            </Button>
          </CardContent>
        </Card>
      )}

      {imports.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              Import History
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b bg-canvas text-left text-xs text-muted uppercase tracking-wider">
                    <th className="py-3 px-4">File</th>
                    <th className="py-3 px-4">Uploaded</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4 text-center">Total</th>
                    <th className="py-3 px-4 text-center">Ready</th>
                    <th className="py-3 px-4 text-center">Errors</th>
                    <th className="py-3 px-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {imports.map(imp => (
                    <tr key={imp.id} className="border-b last:border-0 hover:bg-black/[0.02] cursor-pointer" onClick={() => loadDetail(imp.id)}>
                      <td className="py-3 px-4 font-medium">{imp.fileName}</td>
                      <td className="py-3 px-4 text-muted">
                        {new Date((imp.uploadedAt as number) * 1000).toLocaleDateString()}
                        {imp.uploadedByName && <span className="block text-xs">{imp.uploadedByName}</span>}
                      </td>
                      <td className="py-3 px-4"><ImportStatusBadge status={imp.status} /></td>
                      <td className="py-3 px-4 text-center tnum">{imp.totalRows}</td>
                      <td className="py-3 px-4 text-center tnum text-positive">{imp.validRows}</td>
                      <td className="py-3 px-4 text-center tnum text-danger">{imp.errorRows}</td>
                      <td className="py-3 px-4 text-right" onClick={e => e.stopPropagation()}>
                        {imp.status !== 'merged' && (
                          <button
                            title="Discard import"
                            className="p-1.5 text-muted hover:text-danger rounded-md hover:bg-black/5"
                            onClick={() => setDeleteConfirm(imp.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Delete confirm */}
      <ConfirmDialog
        isOpen={!!deleteConfirm}
        title="Discard Import"
        message="This will permanently delete the staged import data. No live expenses are affected."
        confirmText="Discard"
        variant="danger"
        onConfirm={() => deleteConfirm && handleDelete(deleteConfirm)}
        onClose={() => setDeleteConfirm(null)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Small helper components
// ---------------------------------------------------------------------------

function ImportStatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; variant: 'default' | 'success' | 'outline' | 'destructive' }> = {
    staged: { label: 'Staged', variant: 'outline' },
    validated: { label: 'Validated', variant: 'outline' },
    merged: { label: 'Merged', variant: 'success' },
    rolled_back: { label: 'Rolled Back', variant: 'destructive' },
  };
  const cfg = map[status] || { label: status, variant: 'outline' as const };
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>;
}

function SummaryCard({ label, value, color, onClick }: { label: string; value: number; color?: string; onClick?: () => void }) {
  return (
    <div
      className={cn('rounded-xl border border-line bg-surface p-4 text-center', onClick && 'cursor-pointer hover:border-primary/30')}
      onClick={onClick}
    >
      <div className="text-xs text-muted mb-1">{label}</div>
      <div className={cn('text-2xl font-semibold tnum', color || 'text-ink')}>{value}</div>
    </div>
  );
}
