import { useCallback, useEffect, useState } from 'react';
import {
  Gavel, Plus, ChevronDown, ChevronUp, Pencil, Trash2, DollarSign,
  Scale, Phone, FileText,
} from 'lucide-react';
import { Card, CardContent } from './ui/Card';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import { Modal } from './ui/Modal';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { TextInput, SelectInput, TextareaInput } from './ui/FormField';
import { formatDate, formatCurrency, todayLocalDate } from '../lib/utils';
import { evictionsApi } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import type { Eviction, EvictionCost, EvictionStatus, EvictionReason, EvictionCostCategory } from '../types';

const STATUS_LABEL: Record<EvictionStatus, string> = {
  notice_served: 'Notice Served',
  filed_with_lawyer: 'Filed with Lawyer',
  court_date_set: 'Court Date Set',
  judgment: 'Judgment',
  completed: 'Completed',
  dismissed: 'Dismissed',
};

const STATUS_BADGE: Record<EvictionStatus, 'warning' | 'destructive' | 'secondary' | 'success' | 'default'> = {
  notice_served: 'warning',
  filed_with_lawyer: 'destructive',
  court_date_set: 'destructive',
  judgment: 'secondary',
  completed: 'success',
  dismissed: 'default',
};

const REASON_LABEL: Record<EvictionReason, string> = {
  nonpayment: 'Nonpayment of Rent',
  lease_violation: 'Lease Violation',
  holdover: 'Holdover (Lease Expired)',
  other: 'Other',
};

const COST_CATEGORY_LABEL: Record<EvictionCostCategory, string> = {
  lawyer_fee: 'Lawyer Fee',
  filing_fee: 'Filing Fee',
  service_fee: 'Service Fee',
  court_cost: 'Court Cost',
  other: 'Other',
};

const STATUS_ORDER: EvictionStatus[] = [
  'notice_served', 'filed_with_lawyer', 'court_date_set', 'judgment', 'completed',
];

interface Props {
  tenantId: string;
  leaseId?: string;
  propertyId?: string;
  unitId?: string;
}

export function EvictionSection({ tenantId, leaseId, propertyId, unitId }: Props) {
  const { hasPermission } = useAuth();
  const { showToast } = useToast();
  const canManage = hasPermission('evictions_manage');
  const canView = hasPermission('evictions_view');

  const [evictions, setEvictions] = useState<Eviction[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  // Create/edit form
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [formStatus, setFormStatus] = useState<EvictionStatus>('notice_served');
  const [formReason, setFormReason] = useState<EvictionReason>('nonpayment');
  const [formReasonNotes, setFormReasonNotes] = useState('');
  const [formNoticeDate, setFormNoticeDate] = useState(todayLocalDate());
  const [formFiledDate, setFormFiledDate] = useState('');
  const [formCourtDate, setFormCourtDate] = useState('');
  const [formJudgmentDate, setFormJudgmentDate] = useState('');
  const [formVacateBy, setFormVacateBy] = useState('');
  const [formLawyer, setFormLawyer] = useState('');
  const [formLawyerPhone, setFormLawyerPhone] = useState('');
  const [formCaseNumber, setFormCaseNumber] = useState('');
  const [formCourtName, setFormCourtName] = useState('');
  const [formNotes, setFormNotes] = useState('');
  const [saving, setSaving] = useState(false);

  // Cost form
  const [costFormOpen, setCostFormOpen] = useState(false);
  const [costEvictionId, setCostEvictionId] = useState<string | null>(null);
  const [costDesc, setCostDesc] = useState('');
  const [costAmount, setCostAmount] = useState('');
  const [costDate, setCostDate] = useState(todayLocalDate());
  const [costCategory, setCostCategory] = useState<EvictionCostCategory>('lawyer_fee');
  const [costNotes, setCostNotes] = useState('');
  const [savingCost, setSavingCost] = useState(false);

  // Costs loaded per eviction
  const [costs, setCosts] = useState<Record<string, EvictionCost[]>>({});

  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [deleteCostTarget, setDeleteCostTarget] = useState<{ evictionId: string; costId: string } | null>(null);

  const load = useCallback(async () => {
    if (!canView) return;
    try {
      const data = await evictionsApi.getAll({ tenantId });
      setEvictions(data);
    } catch { /* ignore */ }
    setLoading(false);
  }, [tenantId, canView]);

  useEffect(() => { load(); }, [load]);

  const loadCosts = useCallback(async (evictionId: string) => {
    try {
      const data = await evictionsApi.getCosts(evictionId);
      setCosts(prev => ({ ...prev, [evictionId]: data }));
    } catch { /* ignore */ }
  }, []);

  const toggleExpand = (id: string) => {
    const next = expanded === id ? null : id;
    setExpanded(next);
    if (next && !costs[next]) loadCosts(next);
  };

  const resetForm = () => {
    setEditingId(null);
    setFormStatus('notice_served');
    setFormReason('nonpayment');
    setFormReasonNotes('');
    setFormNoticeDate(todayLocalDate());
    setFormFiledDate('');
    setFormCourtDate('');
    setFormJudgmentDate('');
    setFormVacateBy('');
    setFormLawyer('');
    setFormLawyerPhone('');
    setFormCaseNumber('');
    setFormCourtName('');
    setFormNotes('');
  };

  const openEdit = (ev: Eviction) => {
    setEditingId(ev.id);
    setFormStatus(ev.status);
    setFormReason(ev.reason);
    setFormReasonNotes(ev.reasonNotes || '');
    setFormNoticeDate(ev.noticeServedDate || '');
    setFormFiledDate(ev.filedDate || '');
    setFormCourtDate(ev.courtDate || '');
    setFormJudgmentDate(ev.judgmentDate || '');
    setFormVacateBy(ev.vacateByDate || '');
    setFormLawyer(ev.lawyerName || '');
    setFormLawyerPhone(ev.lawyerPhone || '');
    setFormCaseNumber(ev.caseNumber || '');
    setFormCourtName(ev.courtName || '');
    setFormNotes(ev.notes || '');
    setFormOpen(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (editingId) {
        await evictionsApi.update(editingId, {
          status: formStatus,
          reason: formReason,
          reasonNotes: formReasonNotes || undefined,
          noticeServedDate: formNoticeDate || undefined,
          filedDate: formFiledDate || undefined,
          courtDate: formCourtDate || undefined,
          judgmentDate: formJudgmentDate || undefined,
          vacateByDate: formVacateBy || undefined,
          lawyerName: formLawyer || undefined,
          lawyerPhone: formLawyerPhone || undefined,
          caseNumber: formCaseNumber || undefined,
          courtName: formCourtName || undefined,
          notes: formNotes || undefined,
        });
        showToast('Eviction updated', 'success');
      } else {
        await evictionsApi.create({
          tenantId,
          leaseId,
          propertyId,
          unitId,
          status: formStatus,
          reason: formReason,
          reasonNotes: formReasonNotes || undefined,
          noticeServedDate: formNoticeDate || undefined,
          filedDate: formFiledDate || undefined,
          courtDate: formCourtDate || undefined,
          lawyerName: formLawyer || undefined,
          lawyerPhone: formLawyerPhone || undefined,
          caseNumber: formCaseNumber || undefined,
          courtName: formCourtName || undefined,
          notes: formNotes || undefined,
        });
        showToast('Eviction case created', 'success');
      }
      setFormOpen(false);
      resetForm();
      load();
    } catch (err) {
      showToast((err as Error).message || 'Could not save eviction', 'error');
    }
    setSaving(false);
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await evictionsApi.delete(deleteTarget);
      showToast('Eviction case deleted', 'success');
      setDeleteTarget(null);
      load();
    } catch (err) {
      showToast((err as Error).message || 'Could not delete', 'error');
    }
  };

  const openCostForm = (evictionId: string) => {
    setCostEvictionId(evictionId);
    setCostDesc('');
    setCostAmount('');
    setCostDate(todayLocalDate());
    setCostCategory('lawyer_fee');
    setCostNotes('');
    setCostFormOpen(true);
  };

  const handleSaveCost = async () => {
    if (!costEvictionId) return;
    setSavingCost(true);
    try {
      await evictionsApi.addCost(costEvictionId, {
        description: costDesc,
        amount: Number(costAmount),
        costDate: costDate,
        category: costCategory,
        notes: costNotes || undefined,
      });
      showToast('Cost added', 'success');
      setCostFormOpen(false);
      loadCosts(costEvictionId);
      load();
    } catch (err) {
      showToast((err as Error).message || 'Could not save cost', 'error');
    }
    setSavingCost(false);
  };

  const handleDeleteCost = async () => {
    if (!deleteCostTarget) return;
    try {
      await evictionsApi.deleteCost(deleteCostTarget.evictionId, deleteCostTarget.costId);
      showToast('Cost removed', 'success');
      setDeleteCostTarget(null);
      loadCosts(deleteCostTarget.evictionId);
      load();
    } catch (err) {
      showToast((err as Error).message || 'Could not delete cost', 'error');
    }
  };

  if (!canView) return null;

  return (
    <>
      <Card>
        <CardContent className="p-4 sm:p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-ink flex items-center gap-2">
              <Gavel className="h-4 w-4 text-faint" /> Eviction Cases
            </h3>
            {canManage && (
              <Button size="sm" onClick={() => { resetForm(); setFormOpen(true); }}>
                <Plus className="h-3.5 w-3.5 mr-1" /> New Case
              </Button>
            )}
          </div>

          {loading ? (
            <p className="text-sm text-muted">Loading...</p>
          ) : evictions.length === 0 ? (
            <p className="text-sm text-muted">No eviction cases for this tenant.</p>
          ) : (
            <div className="space-y-2">
              {evictions.map(ev => {
                const isExpanded = expanded === ev.id;
                const evCosts = costs[ev.id] || [];
                return (
                  <div key={ev.id} className="border border-line rounded-lg overflow-hidden">
                    <button
                      className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-canvas/50 transition-colors"
                      onClick={() => toggleExpand(ev.id)}
                    >
                      <Badge variant={STATUS_BADGE[ev.status]}>
                        {STATUS_LABEL[ev.status]}
                      </Badge>
                      <span className="text-sm font-medium text-ink flex-1">
                        {REASON_LABEL[ev.reason]}
                      </span>
                      {ev.totalCosts != null && ev.totalCosts > 0 && (
                        <span className="text-xs text-muted">{formatCurrency(ev.totalCosts)} spent</span>
                      )}
                      {ev.courtDate && (
                        <span className="text-xs text-muted hidden sm:inline">Court: {formatDate(ev.courtDate)}</span>
                      )}
                      {isExpanded ? <ChevronUp className="h-4 w-4 text-faint" /> : <ChevronDown className="h-4 w-4 text-faint" />}
                    </button>

                    {isExpanded && (
                      <div className="px-4 pb-4 pt-1 border-t border-line space-y-4">
                        {/* Status timeline */}
                        <div className="flex items-center gap-1 overflow-x-auto pb-1">
                          {STATUS_ORDER.map((s, i) => {
                            const reached = STATUS_ORDER.indexOf(ev.status) >= i;
                            const isCurrent = ev.status === s;
                            return (
                              <div key={s} className="flex items-center gap-1 shrink-0">
                                {i > 0 && <div className={`w-4 h-0.5 ${reached ? 'bg-primary' : 'bg-line'}`} />}
                                <div className={`px-2 py-0.5 rounded-full text-[11px] font-medium whitespace-nowrap ${
                                  isCurrent ? 'bg-primary text-white' : reached ? 'bg-primary/10 text-primary' : 'bg-canvas text-muted'
                                }`}>
                                  {STATUS_LABEL[s]}
                                </div>
                              </div>
                            );
                          })}
                          {ev.status === 'dismissed' && (
                            <div className="flex items-center gap-1 shrink-0">
                              <div className="w-4 h-0.5 bg-line" />
                              <div className="px-2 py-0.5 rounded-full text-[11px] font-medium bg-canvas text-muted">Dismissed</div>
                            </div>
                          )}
                        </div>

                        {/* Key dates */}
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                          {ev.noticeServedDate && (
                            <div>
                              <p className="text-muted text-xs">Notice Served</p>
                              <p className="text-ink">{formatDate(ev.noticeServedDate)}</p>
                            </div>
                          )}
                          {ev.filedDate && (
                            <div>
                              <p className="text-muted text-xs">Filed with Lawyer</p>
                              <p className="text-ink">{formatDate(ev.filedDate)}</p>
                            </div>
                          )}
                          {ev.courtDate && (
                            <div>
                              <p className="text-muted text-xs">Court Date</p>
                              <p className="text-ink font-medium">{formatDate(ev.courtDate)}</p>
                            </div>
                          )}
                          {ev.judgmentDate && (
                            <div>
                              <p className="text-muted text-xs">Judgment Date</p>
                              <p className="text-ink">{formatDate(ev.judgmentDate)}</p>
                            </div>
                          )}
                          {ev.vacateByDate && (
                            <div>
                              <p className="text-muted text-xs">Vacate By</p>
                              <p className="text-ink font-medium">{formatDate(ev.vacateByDate)}</p>
                            </div>
                          )}
                        </div>

                        {/* Lawyer / case info */}
                        {(ev.lawyerName || ev.caseNumber || ev.courtName) && (
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                            {ev.lawyerName && (
                              <div className="flex items-start gap-1.5">
                                <Scale className="h-3.5 w-3.5 text-faint mt-0.5 shrink-0" />
                                <div>
                                  <p className="text-muted text-xs">Lawyer</p>
                                  <p className="text-ink">{ev.lawyerName}</p>
                                </div>
                              </div>
                            )}
                            {ev.lawyerPhone && (
                              <div className="flex items-start gap-1.5">
                                <Phone className="h-3.5 w-3.5 text-faint mt-0.5 shrink-0" />
                                <div>
                                  <p className="text-muted text-xs">Phone</p>
                                  <p className="text-ink">{ev.lawyerPhone}</p>
                                </div>
                              </div>
                            )}
                            {ev.caseNumber && (
                              <div className="flex items-start gap-1.5">
                                <FileText className="h-3.5 w-3.5 text-faint mt-0.5 shrink-0" />
                                <div>
                                  <p className="text-muted text-xs">Case #</p>
                                  <p className="text-ink">{ev.caseNumber}</p>
                                </div>
                              </div>
                            )}
                            {ev.courtName && (
                              <div>
                                <p className="text-muted text-xs">Court</p>
                                <p className="text-ink">{ev.courtName}</p>
                              </div>
                            )}
                          </div>
                        )}

                        {ev.notes && (
                          <div className="text-sm">
                            <p className="text-muted text-xs mb-0.5">Notes</p>
                            <p className="text-ink whitespace-pre-wrap">{ev.notes}</p>
                          </div>
                        )}

                        {/* Costs */}
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <p className="text-sm font-medium text-ink flex items-center gap-1.5">
                              <DollarSign className="h-3.5 w-3.5 text-faint" /> Costs
                              {ev.totalCosts != null && ev.totalCosts > 0 && (
                                <span className="text-muted font-normal">({formatCurrency(ev.totalCosts)} total)</span>
                              )}
                            </p>
                            {canManage && (
                              <Button size="sm" variant="outline" onClick={() => openCostForm(ev.id)}>
                                <Plus className="h-3 w-3 mr-1" /> Add
                              </Button>
                            )}
                          </div>
                          {evCosts.length === 0 ? (
                            <p className="text-xs text-muted">No costs recorded yet.</p>
                          ) : (
                            <div className="space-y-1">
                              {evCosts.map(c => (
                                <div key={c.id} className="flex items-center justify-between py-1.5 px-2 rounded bg-canvas text-sm">
                                  <div className="flex-1 min-w-0">
                                    <span className="text-ink">{c.description}</span>
                                    <span className="text-muted ml-2 text-xs">{COST_CATEGORY_LABEL[c.category]}</span>
                                    {c.notes && <span className="text-muted ml-2 text-xs">({c.notes})</span>}
                                  </div>
                                  <div className="flex items-center gap-2 shrink-0 ml-2">
                                    <span className="text-xs text-muted">{formatDate(c.costDate)}</span>
                                    <span className="font-medium text-ink">{formatCurrency(c.amount)}</span>
                                    {canManage && (
                                      <button
                                        className="text-faint hover:text-danger transition-colors"
                                        onClick={() => setDeleteCostTarget({ evictionId: ev.id, costId: c.id })}
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </button>
                                    )}
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>

                        {/* Actions */}
                        {canManage && (
                          <div className="flex gap-2 pt-1">
                            <Button size="sm" variant="outline" onClick={() => openEdit(ev)}>
                              <Pencil className="h-3.5 w-3.5 mr-1" /> Edit
                            </Button>
                            <Button size="sm" variant="destructive" onClick={() => setDeleteTarget(ev.id)}>
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

      {/* Create / Edit eviction modal */}
      <Modal isOpen={formOpen} onClose={() => { setFormOpen(false); resetForm(); }}
        title={editingId ? 'Edit Eviction Case' : 'New Eviction Case'} size="lg">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <SelectInput label="Status" name="evStatus"
              value={formStatus} onChange={e => setFormStatus(e.target.value as EvictionStatus)}>
              {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </SelectInput>
            <SelectInput label="Reason" name="evReason"
              value={formReason} onChange={e => setFormReason(e.target.value as EvictionReason)}>
              {Object.entries(REASON_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </SelectInput>
          </div>

          <TextareaInput label="Reason Details" name="evReasonNotes"
            value={formReasonNotes} onChange={e => setFormReasonNotes(e.target.value)}
            placeholder="Specific details about why..." className="min-h-[60px]" />

          <p className="text-xs font-medium text-muted tracking-wide uppercase">Key Dates</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <TextInput label="Notice Served" name="evNoticeDate" type="date"
              value={formNoticeDate} onChange={e => setFormNoticeDate(e.target.value)} />
            <TextInput label="Filed with Lawyer" name="evFiledDate" type="date"
              value={formFiledDate} onChange={e => setFormFiledDate(e.target.value)} />
            <TextInput label="Court Date" name="evCourtDate" type="date"
              value={formCourtDate} onChange={e => setFormCourtDate(e.target.value)} />
            <TextInput label="Judgment Date" name="evJudgmentDate" type="date"
              value={formJudgmentDate} onChange={e => setFormJudgmentDate(e.target.value)} />
            <TextInput label="Vacate By" name="evVacateBy" type="date"
              value={formVacateBy} onChange={e => setFormVacateBy(e.target.value)} />
          </div>

          <p className="text-xs font-medium text-muted tracking-wide uppercase">Lawyer / Court</p>
          <div className="grid grid-cols-2 gap-3">
            <TextInput label="Lawyer Name" name="evLawyer"
              value={formLawyer} onChange={e => setFormLawyer(e.target.value)} />
            <TextInput label="Lawyer Phone" name="evLawyerPhone"
              value={formLawyerPhone} onChange={e => setFormLawyerPhone(e.target.value)} />
            <TextInput label="Case Number" name="evCaseNumber"
              value={formCaseNumber} onChange={e => setFormCaseNumber(e.target.value)} />
            <TextInput label="Court Name" name="evCourtName"
              value={formCourtName} onChange={e => setFormCourtName(e.target.value)} />
          </div>

          <TextareaInput label="Notes" name="evNotes"
            value={formNotes} onChange={e => setFormNotes(e.target.value)}
            placeholder="Any additional notes..." className="min-h-[60px]" />

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => { setFormOpen(false); resetForm(); }}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : editingId ? 'Save Changes' : 'Create Case'}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Add cost modal */}
      <Modal isOpen={costFormOpen} onClose={() => setCostFormOpen(false)} title="Add Eviction Cost" size="md">
        <div className="space-y-4">
          <TextInput label="Description" name="costDesc" required
            value={costDesc} onChange={e => setCostDesc(e.target.value)}
            placeholder="e.g. Attorney retainer, court filing" />
          <div className="grid grid-cols-2 gap-3">
            <TextInput label="Amount" name="costAmount" type="number" step="0.01" required
              value={costAmount} onChange={e => setCostAmount(e.target.value)} />
            <TextInput label="Date" name="costDate" type="date" required
              value={costDate} onChange={e => setCostDate(e.target.value)} />
          </div>
          <SelectInput label="Category" name="costCategory"
            value={costCategory} onChange={e => setCostCategory(e.target.value as EvictionCostCategory)}>
            {Object.entries(COST_CATEGORY_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </SelectInput>
          <TextInput label="Notes (optional)" name="costNotes"
            value={costNotes} onChange={e => setCostNotes(e.target.value)} />
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setCostFormOpen(false)}>Cancel</Button>
            <Button onClick={handleSaveCost} disabled={savingCost || !costDesc || !costAmount}>
              {savingCost ? 'Saving...' : 'Add Cost'}
            </Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        onConfirm={handleDelete}
        title="Delete Eviction Case"
        message="This will permanently delete this eviction case and all its costs. This cannot be undone."
      />

      <ConfirmDialog
        isOpen={!!deleteCostTarget}
        onClose={() => setDeleteCostTarget(null)}
        onConfirm={handleDeleteCost}
        title="Delete Cost Entry"
        message="This will permanently delete this cost entry."
      />
    </>
  );
}

export function EvictionBadge({ tenantId }: { tenantId: string }) {
  const { hasPermission } = useAuth();
  const [eviction, setEviction] = useState<Eviction | null>(null);

  useEffect(() => {
    if (!hasPermission('evictions_view')) return;
    evictionsApi.getAll({ tenantId }).then(data => {
      const active = data.find(e => !['completed', 'dismissed'].includes(e.status));
      setEviction(active || null);
    }).catch(() => {});
  }, [tenantId, hasPermission]);

  if (!eviction) return null;

  return (
    <Badge variant={STATUS_BADGE[eviction.status]} className="flex items-center gap-1">
      <Gavel className="h-3 w-3" /> {STATUS_LABEL[eviction.status]}
    </Badge>
  );
}
