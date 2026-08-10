import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DollarSign, Plus, ChevronDown, ChevronUp, AlertTriangle, Check,
  Clock, Pencil, Trash2,
} from 'lucide-react';
import { Card, CardContent } from './ui/Card';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import { Modal } from './ui/Modal';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { formatCurrency, formatDate, todayLocalDate } from '../lib/utils';
import { depositReturnsApi } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import type { DepositReturn, DeductionCategory, DepositReturnStatus } from '../types';

interface Props {
  tenantId: string;
  leaseId: string;
  propertyId?: string;
  unitId?: string;
  depositAmount: number;
  leaseStatus: string;
}

const statusBadge: Record<DepositReturnStatus, 'warning' | 'secondary' | 'success' | 'destructive'> = {
  pending: 'warning',
  processing: 'secondary',
  completed: 'success',
  forfeited: 'destructive',
};

const statusLabel: Record<DepositReturnStatus, string> = {
  pending: 'Pending',
  processing: 'Processing',
  completed: 'Completed',
  forfeited: 'Forfeited',
};

const deductionCategoryLabel: Record<DeductionCategory, string> = {
  damage: 'Damage',
  unpaid_rent: 'Unpaid Rent',
  cleaning: 'Cleaning',
  repairs: 'Repairs',
  other: 'Other',
};

function daysUntil(dateStr: string): number {
  const today = new Date(todayLocalDate() + 'T00:00:00');
  const target = new Date(dateStr + 'T00:00:00');
  return Math.ceil((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

export function DepositReturnSection({ tenantId, leaseId, propertyId, unitId, depositAmount, leaseStatus }: Props) {
  const { hasPermission } = useAuth();
  const { showToast } = useToast();
  const canEdit = hasPermission('finances_income');

  const [returns, setReturns] = useState<DepositReturn[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Modal states
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingReturn, setEditingReturn] = useState<DepositReturn | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [moveOutDate, setMoveOutDate] = useState(todayLocalDate());
  const [deposit, setDeposit] = useState(depositAmount);
  const [notes, setNotes] = useState('');
  const [status, setStatus] = useState<DepositReturnStatus>('pending');
  const [refundDate, setRefundDate] = useState('');
  const [refundMethod, setRefundMethod] = useState('');
  const [deductions, setDeductions] = useState<Array<{ category: DeductionCategory; description: string; amount: string }>>([]);

  const load = useCallback(async () => {
    try {
      const data = await depositReturnsApi.getAll({ leaseId });
      setReturns(data);
    } catch {
      // Silently fail; the table just won't be empty if the migration hasn't run yet
    } finally {
      setLoading(false);
    }
  }, [leaseId]);

  useEffect(() => { load(); }, [load]);

  const activeReturn = returns.find(r => r.status === 'pending' || r.status === 'processing');

  const resetForm = useCallback(() => {
    setMoveOutDate(todayLocalDate());
    setDeposit(depositAmount);
    setNotes('');
    setStatus('pending');
    setRefundDate('');
    setRefundMethod('');
    setDeductions([]);
  }, [depositAmount]);

  const openCreate = useCallback(() => {
    resetForm();
    setIsCreateOpen(true);
  }, [resetForm]);

  const openEdit = useCallback(async (dr: DepositReturn) => {
    // Load full record with deductions
    try {
      const full = await depositReturnsApi.getById(dr.id);
      setEditingReturn(full);
      setMoveOutDate(full.moveOutDate);
      setDeposit(full.depositAmount);
      setNotes(full.notes || '');
      setStatus(full.status);
      setRefundDate(full.refundDate || '');
      setRefundMethod(full.refundMethod || '');
      setDeductions(
        (full.deductions || []).map(d => ({
          category: d.category as DeductionCategory,
          description: d.description,
          amount: String(d.amount),
        }))
      );
    } catch {
      showToast('Failed to load deposit return details', 'error');
    }
  }, [showToast]);

  const addDeduction = useCallback(() => {
    setDeductions(prev => [...prev, { category: 'damage', description: '', amount: '' }]);
  }, []);

  const removeDeduction = useCallback((idx: number) => {
    setDeductions(prev => prev.filter((_, i) => i !== idx));
  }, []);

  const updateDeduction = useCallback((idx: number, field: string, value: string) => {
    setDeductions(prev => prev.map((d, i) => i === idx ? { ...d, [field]: value } : d));
  }, []);

  const totalDeductions = useMemo(
    () => deductions.reduce((sum, d) => sum + (Number(d.amount) || 0), 0),
    [deductions]
  );
  const refundAmount = Math.max(0, deposit - totalDeductions);

  const handleCreate = useCallback(async () => {
    setSaving(true);
    try {
      await depositReturnsApi.create({
        leaseId,
        tenantId,
        propertyId,
        unitId,
        depositAmount: deposit,
        moveOutDate,
        notes: notes || undefined,
      });
      showToast('Deposit return created', 'success');
      setIsCreateOpen(false);
      load();
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  }, [leaseId, tenantId, propertyId, unitId, deposit, moveOutDate, notes, showToast, load]);

  const handleUpdate = useCallback(async () => {
    if (!editingReturn) return;
    setSaving(true);
    try {
      await depositReturnsApi.update(editingReturn.id, {
        status,
        moveOutDate,
        depositAmount: deposit,
        refundDate: refundDate || undefined,
        refundMethod: refundMethod || undefined,
        notes: notes || undefined,
        deductions: deductions
          .filter(d => d.description && Number(d.amount) > 0)
          .map(d => ({ category: d.category, description: d.description, amount: Number(d.amount) })),
      });
      showToast('Deposit return updated', 'success');
      setEditingReturn(null);
      load();
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      setSaving(false);
    }
  }, [editingReturn, status, moveOutDate, deposit, refundDate, refundMethod, notes, deductions, showToast, load]);

  const handleDelete = useCallback(async () => {
    if (!deleteTarget) return;
    try {
      await depositReturnsApi.delete(deleteTarget);
      showToast('Deposit return deleted', 'success');
      setDeleteTarget(null);
      load();
    } catch (err) {
      showToast((err as Error).message, 'error');
    }
  }, [deleteTarget, showToast, load]);

  if (loading) return null;
  // Only show this section if there are existing deposit returns or the lease has ended
  if (returns.length === 0 && leaseStatus !== 'ended') return null;

  return (
    <>
      <Card>
        <CardContent className="p-5 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-ink flex items-center gap-2">
              <DollarSign className="h-4 w-4 text-faint" />
              Security Deposit Return
            </h3>
            {canEdit && !activeReturn && (
              <Button size="sm" onClick={openCreate}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Start Return
              </Button>
            )}
          </div>

          {returns.length === 0 ? (
            <p className="text-sm text-muted">
              No deposit return has been initiated yet.
              {canEdit && leaseStatus === 'ended' && ' Click "Start Return" to begin the process.'}
            </p>
          ) : (
            <div className="space-y-3">
              {returns.map(dr => {
                const isExpanded = expanded === dr.id;
                const daysLeft = daysUntil(dr.deadlineDate);
                const overdue = daysLeft < 0 && dr.status !== 'completed' && dr.status !== 'forfeited';
                const urgent = daysLeft >= 0 && daysLeft <= 7 && dr.status !== 'completed' && dr.status !== 'forfeited';

                return (
                  <div key={dr.id} className="border border-line rounded-lg overflow-hidden">
                    <button
                      className="w-full flex items-center justify-between p-3 text-left hover:bg-canvas/60 transition-colors"
                      onClick={() => setExpanded(isExpanded ? null : dr.id)}
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <Badge variant={statusBadge[dr.status]}>{statusLabel[dr.status]}</Badge>
                        <span className="text-sm text-ink font-medium">
                          {formatCurrency(dr.depositAmount)} deposit
                        </span>
                        {overdue && (
                          <span className="flex items-center gap-1 text-xs text-danger font-medium">
                            <AlertTriangle className="h-3.5 w-3.5" /> Overdue by {Math.abs(daysLeft)} days
                          </span>
                        )}
                        {urgent && (
                          <span className="flex items-center gap-1 text-xs text-warning font-medium">
                            <Clock className="h-3.5 w-3.5" /> {daysLeft} days left
                          </span>
                        )}
                        {dr.status === 'completed' && (
                          <span className="flex items-center gap-1 text-xs text-positive font-medium">
                            <Check className="h-3.5 w-3.5" /> Returned {formatCurrency(dr.refundAmount)}
                          </span>
                        )}
                      </div>
                      {isExpanded ? <ChevronUp className="h-4 w-4 text-faint" /> : <ChevronDown className="h-4 w-4 text-faint" />}
                    </button>

                    {isExpanded && (
                      <div className="border-t border-line p-4 space-y-4 bg-canvas/30">
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                          <div>
                            <p className="eyebrow">Move Out</p>
                            <p className="text-ink">{formatDate(dr.moveOutDate)}</p>
                          </div>
                          <div>
                            <p className="eyebrow">Deadline</p>
                            <p className={overdue ? 'text-danger font-medium' : 'text-ink'}>{formatDate(dr.deadlineDate)}</p>
                          </div>
                          <div>
                            <p className="eyebrow">Deductions</p>
                            <p className="text-ink">{formatCurrency(dr.totalDeductions)}</p>
                          </div>
                          <div>
                            <p className="eyebrow">Refund</p>
                            <p className="text-ink font-medium">{formatCurrency(dr.refundAmount)}</p>
                          </div>
                        </div>

                        {dr.refundDate && (
                          <div className="text-sm text-muted">
                            Refunded on {formatDate(dr.refundDate)}
                            {dr.refundMethod ? ` via ${dr.refundMethod}` : ''}
                          </div>
                        )}

                        {dr.notes && (
                          <div className="text-sm text-muted border-t border-line pt-3">
                            <p className="eyebrow mb-1">Notes</p>
                            <p>{dr.notes}</p>
                          </div>
                        )}

                        {/* Deduction details are shown when editing */}

                        {canEdit && dr.status !== 'completed' && dr.status !== 'forfeited' && (
                          <div className="flex gap-2 pt-2 border-t border-line">
                            <Button size="sm" variant="outline" onClick={() => openEdit(dr)}>
                              <Pencil className="h-3.5 w-3.5 mr-1" /> Edit / Add Deductions
                            </Button>
                            <Button size="sm" variant="destructive" onClick={() => setDeleteTarget(dr.id)}>
                              <Trash2 className="h-3.5 w-3.5 mr-1" /> Delete
                            </Button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Create modal */}
      <Modal isOpen={isCreateOpen} onClose={() => !saving && setIsCreateOpen(false)} title="Start Deposit Return" size="md">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">Move Out Date</label>
            <input
              type="date"
              className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink"
              value={moveOutDate}
              onChange={e => setMoveOutDate(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">Deposit Amount</label>
            <input
              type="number"
              className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink"
              value={deposit}
              onChange={e => setDeposit(Number(e.target.value))}
              min={0}
              step={0.01}
            />
            <p className="text-xs text-muted mt-1">
              Illinois requires return within 30 days. The deadline will be calculated automatically.
            </p>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">Notes (optional)</label>
            <textarea
              className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink min-h-[60px]"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Move out condition, forwarding address, etc."
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setIsCreateOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={handleCreate} disabled={saving || !moveOutDate}>
              {saving ? 'Creating...' : 'Start Return'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Edit modal (with deductions) */}
      <Modal isOpen={!!editingReturn} onClose={() => !saving && setEditingReturn(null)} title="Deposit Return Details" size="lg">
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">Status</label>
              <select
                className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink"
                value={status}
                onChange={e => setStatus(e.target.value as DepositReturnStatus)}
              >
                <option value="pending">Pending</option>
                <option value="processing">Processing</option>
                <option value="completed">Completed</option>
                <option value="forfeited">Forfeited</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">Move Out Date</label>
              <input
                type="date"
                className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink"
                value={moveOutDate}
                onChange={e => setMoveOutDate(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">Deposit Amount</label>
              <input
                type="number"
                className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink"
                value={deposit}
                onChange={e => setDeposit(Number(e.target.value))}
                min={0}
                step={0.01}
              />
            </div>
            {(status === 'completed' || refundDate) && (
              <div>
                <label className="block text-sm font-medium text-ink mb-1.5">Refund Date</label>
                <input
                  type="date"
                  className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink"
                  value={refundDate}
                  onChange={e => setRefundDate(e.target.value)}
                />
              </div>
            )}
          </div>

          {(status === 'completed' || refundMethod) && (
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">Refund Method</label>
              <select
                className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink"
                value={refundMethod}
                onChange={e => setRefundMethod(e.target.value)}
              >
                <option value="">Select method</option>
                <option value="check">Check</option>
                <option value="cash">Cash</option>
                <option value="ach">ACH / Bank Transfer</option>
                <option value="other">Other</option>
              </select>
            </div>
          )}

          {/* Deductions */}
          <div className="border-t border-line pt-4">
            <div className="flex items-center justify-between mb-3">
              <h4 className="text-sm font-semibold text-ink">Itemized Deductions</h4>
              <Button size="sm" variant="outline" onClick={addDeduction}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add Deduction
              </Button>
            </div>

            {deductions.length === 0 ? (
              <p className="text-sm text-muted">No deductions. The full deposit will be returned.</p>
            ) : (
              <div className="space-y-3">
                {deductions.map((d, idx) => (
                  <div key={idx} className="flex gap-2 items-start">
                    <select
                      className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink w-32 shrink-0"
                      value={d.category}
                      onChange={e => updateDeduction(idx, 'category', e.target.value)}
                    >
                      {(Object.entries(deductionCategoryLabel) as [DeductionCategory, string][]).map(([val, label]) => (
                        <option key={val} value={val}>{label}</option>
                      ))}
                    </select>
                    <input
                      type="text"
                      className="flex-1 rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                      value={d.description}
                      onChange={e => updateDeduction(idx, 'description', e.target.value)}
                      placeholder="Description"
                    />
                    <input
                      type="number"
                      className="w-24 rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink"
                      value={d.amount}
                      onChange={e => updateDeduction(idx, 'amount', e.target.value)}
                      min={0}
                      step={0.01}
                      placeholder="0.00"
                    />
                    <button
                      onClick={() => removeDeduction(idx)}
                      className="p-1.5 text-faint hover:text-danger rounded transition-colors shrink-0"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Summary */}
            <div className="mt-4 pt-3 border-t border-line space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted">Deposit held</span>
                <span className="text-ink">{formatCurrency(deposit)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted">Total deductions</span>
                <span className="text-ink text-danger">{formatCurrency(totalDeductions)}</span>
              </div>
              <div className="flex justify-between font-semibold">
                <span className="text-ink">Refund amount</span>
                <span className="text-positive">{formatCurrency(refundAmount)}</span>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">Notes</label>
            <textarea
              className="w-full rounded-md border border-line bg-surface px-3 py-2 text-sm text-ink min-h-[60px]"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Move out condition, forwarding address, etc."
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setEditingReturn(null)} disabled={saving}>Cancel</Button>
            <Button onClick={handleUpdate} disabled={saving}>
              {saving ? 'Saving...' : 'Save Changes'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete confirmation */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        title="Delete Deposit Return"
        message="This will permanently delete this deposit return record and all its deductions. This cannot be undone."
        confirmText="Delete"
        variant="danger"
        onConfirm={handleDelete}
        onClose={() => setDeleteTarget(null)}
      />
    </>
  );
}
