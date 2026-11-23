import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Plus, FileText, Download, CheckCircle, XCircle, Clock, AlertCircle,
  Trash2, ChevronDown, ChevronRight, ArrowLeft, CalendarDays, Search,
} from 'lucide-react';
import { Card, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { PageHeader } from '../components/ui/PageHeader';
import { Modal } from '../components/ui/Modal';
import { TextInput } from '../components/ui/FormField';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { formatCurrency, formatDate, todayLocalDate } from '../lib/utils';
import { paymentPlansApi, type PaymentPlan, type PaymentPlanInstallment } from '../lib/api';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import type { Tenant, Property, Unit } from '../types';

const statusConfig: Record<PaymentPlan['status'], { label: string; color: 'success' | 'warning' | 'destructive' | 'default'; icon: typeof CheckCircle }> = {
  active: { label: 'Active', color: 'default', icon: Clock },
  completed: { label: 'Completed', color: 'success', icon: CheckCircle },
  defaulted: { label: 'Defaulted', color: 'destructive', icon: XCircle },
  cancelled: { label: 'Cancelled', color: 'warning', icon: AlertCircle },
};

const instStatusConfig: Record<PaymentPlanInstallment['status'], { label: string; color: 'success' | 'warning' | 'destructive' }> = {
  paid: { label: 'Paid', color: 'success' },
  pending: { label: 'Pending', color: 'warning' },
  missed: { label: 'Missed', color: 'destructive' },
};

export function PaymentPlans() {
  const { leases, tenants, properties, units } = useApp();
  useAuth();
  const { showToast } = useToast();

  const [plans, setPlans] = useState<PaymentPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [expandedPlan, setExpandedPlan] = useState<string | null>(null);

  // Create modal
  const [showCreate, setShowCreate] = useState(false);
  const [createLeaseId, setCreateLeaseId] = useState('');
  const [createAmount, setCreateAmount] = useState('');
  const [createReason, setCreateReason] = useState('');
  const [createNotes, setCreateNotes] = useState('');
  const [createInstCount, setCreateInstCount] = useState('3');
  const [createStartDate, setCreateStartDate] = useState(todayLocalDate());
  const [creating, setCreating] = useState(false);

  // Installment action
  const [instAction, setInstAction] = useState<{ planId: string; inst: PaymentPlanInstallment; action: 'paid' | 'missed' } | null>(null);
  const [instPaidDate, setInstPaidDate] = useState(todayLocalDate());
  const [instPaidAmount, setInstPaidAmount] = useState('');

  // Delete / cancel
  const [confirmDelete, setConfirmDelete] = useState<PaymentPlan | null>(null);
  const [confirmCancel, setConfirmCancel] = useState<PaymentPlan | null>(null);

  const activeLeases = useMemo(() =>
    leases.filter((l: { status: string }) => l.status === 'active' || l.status === 'pending'),
    [leases]
  );

  const tenantMap = useMemo(() => {
    const m = new Map<string, Tenant>();
    for (const t of tenants) m.set(t.id, t);
    return m;
  }, [tenants]);

  const propertyMap = useMemo(() => {
    const m = new Map<string, Property>();
    for (const p of properties) m.set(p.id, p);
    return m;
  }, [properties]);

  const unitMap = useMemo(() => {
    const m = new Map<string, Unit>();
    for (const u of units) m.set(u.id, u);
    return m;
  }, [units]);

  const leaseTenantsMap = useMemo(() => {
    const m = new Map<string, Tenant[]>();
    for (const lease of leases) {
      const leaseTenants: Tenant[] = [];
      for (const tid of lease.tenantIds ?? []) {
        const t = tenantMap.get(tid);
        if (t) leaseTenants.push(t);
      }
      m.set(lease.id, leaseTenants);
    }
    return m;
  }, [leases, tenantMap]);

  async function loadPlans() {
    try {
      const filters: { status?: string } = {};
      if (statusFilter !== 'all') filters.status = statusFilter;
      const data = await paymentPlansApi.list(filters);
      setPlans(data);
    } catch (err: any) {
      showToast(err.message || 'Failed to load payment plans', 'error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadPlans(); }, [statusFilter]);

  const filteredPlans = useMemo(() => {
    if (!search.trim()) return plans;
    const q = search.toLowerCase();
    return plans.filter(p => {
      const name = [p.first_name, p.last_name].filter(Boolean).join(' ').toLowerCase();
      return name.includes(q) || p.reason?.toLowerCase().includes(q);
    });
  }, [plans, search]);

  function resetCreateForm() {
    setCreateLeaseId('');
    setCreateAmount('');
    setCreateReason('');
    setCreateNotes('');
    setCreateInstCount('3');
    setCreateStartDate(todayLocalDate());
  }

  async function handleCreate() {
    if (!createLeaseId || !createAmount || !createInstCount) {
      showToast('Please fill in all required fields', 'error');
      return;
    }
    const total = parseFloat(createAmount);
    const count = parseInt(createInstCount, 10);
    if (isNaN(total) || total <= 0 || isNaN(count) || count < 1 || count > 24) {
      showToast('Invalid amount or installment count', 'error');
      return;
    }

    const lease = leases.find((l: { id: string }) => l.id === createLeaseId);
    if (!lease) { showToast('Lease not found', 'error'); return; }

    const tenants = leaseTenantsMap.get(lease.id) || [];
    const tenantId = tenants[0]?.id;
    if (!tenantId) { showToast('No tenant found on this lease', 'error'); return; }

    const perInst = Math.floor(total * 100 / count) / 100;
    const remainder = Math.round((total - perInst * count) * 100) / 100;
    const installments: { dueDate: string; amount: number }[] = [];

    const startParts = createStartDate.split('-').map(Number);
    let curYear = startParts[0];
    let curMonth = startParts[1] - 1;
    const startDay = startParts[2];

    for (let i = 0; i < count; i++) {
      const m = curMonth + i;
      const y = curYear + Math.floor(m / 12);
      const mo = (m % 12) + 1;
      const day = Math.min(startDay, new Date(y, mo, 0).getDate());
      const dueDate = `${y}-${String(mo).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      installments.push({ dueDate, amount: i === count - 1 ? perInst + remainder : perInst });
    }

    setCreating(true);
    try {
      await paymentPlansApi.create({
        leaseId: createLeaseId,
        tenantId,
        totalAmount: total,
        reason: createReason || undefined,
        notes: createNotes || undefined,
        installments,
      });
      showToast('Payment plan created', 'success');
      setShowCreate(false);
      resetCreateForm();
      loadPlans();
    } catch (err: any) {
      showToast(err.message || 'Failed to create payment plan', 'error');
    } finally {
      setCreating(false);
    }
  }

  async function handleInstallmentAction() {
    if (!instAction) return;
    const { planId, inst, action } = instAction;
    try {
      await paymentPlansApi.updateInstallment(planId, inst.id, {
        status: action,
        paidDate: action === 'paid' ? instPaidDate : undefined,
        paidAmount: action === 'paid' && instPaidAmount ? parseFloat(instPaidAmount) : undefined,
      });
      showToast(`Installment marked as ${action}`, 'success');
      setInstAction(null);
      loadPlans();
    } catch (err: any) {
      showToast(err.message || 'Failed to update installment', 'error');
    }
  }

  async function handleDelete() {
    if (!confirmDelete) return;
    try {
      await paymentPlansApi.delete(confirmDelete.id);
      showToast('Payment plan deleted', 'success');
      setConfirmDelete(null);
      loadPlans();
    } catch (err: any) {
      showToast(err.message || 'Failed to delete payment plan', 'error');
    }
  }

  async function handleCancel() {
    if (!confirmCancel) return;
    try {
      await paymentPlansApi.update(confirmCancel.id, { status: 'cancelled' });
      showToast('Payment plan cancelled', 'success');
      setConfirmCancel(null);
      loadPlans();
    } catch (err: any) {
      showToast(err.message || 'Failed to cancel payment plan', 'error');
    }
  }

  async function handleDefault(plan: PaymentPlan) {
    try {
      await paymentPlansApi.update(plan.id, { status: 'defaulted' });
      showToast('Payment plan marked as defaulted', 'success');
      loadPlans();
    } catch (err: any) {
      showToast(err.message || 'Failed to update payment plan', 'error');
    }
  }

  function downloadPdf(planId: string) {
    window.open(paymentPlansApi.pdfUrl(planId), '_blank');
  }

  const paidCount = (p: PaymentPlan) => p.installments.filter(i => i.status === 'paid').length;
  const totalInsts = (p: PaymentPlan) => p.installments.length;

  if (loading) {
    return (
      <div className="p-6">
        <PageHeader title="Payment Plans" />
        <div className="mt-8 text-center text-muted-foreground">Loading...</div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center gap-3">
        <Link to="/rents" className="text-muted-foreground hover:text-foreground">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <PageHeader title="Payment Plans" />
      </div>

      {/* Controls row */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            type="text"
            placeholder="Search by tenant name..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2 rounded-lg border bg-background text-sm"
          />
        </div>
        <select
          value={statusFilter}
          onChange={e => setStatusFilter(e.target.value)}
          className="px-3 py-2 rounded-lg border bg-background text-sm"
        >
          <option value="all">All Statuses</option>
          <option value="active">Active</option>
          <option value="completed">Completed</option>
          <option value="defaulted">Defaulted</option>
          <option value="cancelled">Cancelled</option>
        </select>
        <Button onClick={() => { resetCreateForm(); setShowCreate(true); }}>
          <Plus className="w-4 h-4 mr-1" /> New Plan
        </Button>
      </div>

      {/* Plans list */}
      {filteredPlans.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            <FileText className="w-10 h-10 mx-auto mb-3 opacity-40" />
            <p>{plans.length === 0 ? 'No payment plans yet.' : 'No plans match your search.'}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {filteredPlans.map(plan => {
            const sc = statusConfig[plan.status];
            const isExpanded = expandedPlan === plan.id;
            const paid = paidCount(plan);
            const total = totalInsts(plan);
            const tenantName = [plan.first_name, plan.last_name].filter(Boolean).join(' ') || 'Unknown';
            const loc = [plan.property_address || plan.property_name, plan.unit_number ? `Unit ${plan.unit_number}` : ''].filter(Boolean).join(', ');

            return (
              <Card key={plan.id}>
                <CardContent className="p-0">
                  {/* Summary row */}
                  <button
                    className="w-full flex items-center gap-4 px-5 py-4 text-left hover:bg-muted/30 transition-colors"
                    onClick={() => setExpandedPlan(isExpanded ? null : plan.id)}
                  >
                    {isExpanded
                      ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
                      : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
                    }
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{tenantName}</span>
                        <Badge variant={sc.color}>{sc.label}</Badge>
                      </div>
                      {loc && <p className="text-sm text-muted-foreground mt-0.5">{loc}</p>}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-semibold">{formatCurrency(plan.total_amount)}</div>
                      <div className="text-xs text-muted-foreground">
                        {paid}/{total} paid
                      </div>
                    </div>
                  </button>

                  {/* Expanded details */}
                  {isExpanded && (
                    <div className="border-t px-5 py-4 space-y-4">
                      {/* Meta info */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                        <div>
                          <span className="text-muted-foreground">Start Date</span>
                          <div className="font-medium">{formatDate(plan.start_date)}</div>
                        </div>
                        <div>
                          <span className="text-muted-foreground">Installments</span>
                          <div className="font-medium">{plan.num_installments}</div>
                        </div>
                        {plan.reason && (
                          <div className="col-span-2">
                            <span className="text-muted-foreground">Reason</span>
                            <div className="font-medium">{plan.reason}</div>
                          </div>
                        )}
                        {plan.tenant_signature_date && (
                          <div>
                            <span className="text-muted-foreground">Signed</span>
                            <div className="font-medium">{formatDate(plan.tenant_signature_date)}</div>
                          </div>
                        )}
                      </div>

                      {/* Progress bar */}
                      <div>
                        <div className="flex justify-between text-xs text-muted-foreground mb-1">
                          <span>Progress</span>
                          <span>{Math.round(paid / total * 100)}%</span>
                        </div>
                        <div className="h-2 bg-muted rounded-full overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full transition-all"
                            style={{ width: `${(paid / total) * 100}%` }}
                          />
                        </div>
                      </div>

                      {/* Installments table */}
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b text-left text-muted-foreground">
                              <th className="pb-2 font-medium">#</th>
                              <th className="pb-2 font-medium">Due Date</th>
                              <th className="pb-2 font-medium">Amount</th>
                              <th className="pb-2 font-medium">Status</th>
                              <th className="pb-2 font-medium">Paid Date</th>
                              <th className="pb-2 font-medium text-right">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {plan.installments.map(inst => {
                              const isc = instStatusConfig[inst.status];
                              return (
                                <tr key={inst.id} className="border-b last:border-0">
                                  <td className="py-2">{inst.installment_number}</td>
                                  <td className="py-2">{formatDate(inst.due_date)}</td>
                                  <td className="py-2">{formatCurrency(inst.amount)}</td>
                                  <td className="py-2"><Badge variant={isc.color}>{isc.label}</Badge></td>
                                  <td className="py-2 text-muted-foreground">
                                    {inst.paid_date ? formatDate(inst.paid_date) : '—'}
                                  </td>
                                  <td className="py-2 text-right">
                                    {plan.status === 'active' && inst.status === 'pending' && (
                                      <div className="flex gap-1 justify-end">
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          onClick={() => {
                                            setInstAction({ planId: plan.id, inst, action: 'paid' });
                                            setInstPaidDate(todayLocalDate());
                                            setInstPaidAmount(String(inst.amount));
                                          }}
                                        >
                                          <CheckCircle className="w-3.5 h-3.5 mr-1" /> Paid
                                        </Button>
                                        <Button
                                          size="sm"
                                          variant="ghost"
                                          onClick={() => setInstAction({ planId: plan.id, inst, action: 'missed' })}
                                        >
                                          <XCircle className="w-3.5 h-3.5 mr-1" /> Missed
                                        </Button>
                                      </div>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      {/* Action buttons */}
                      <div className="flex flex-wrap gap-2 pt-2">
                        <Button size="sm" variant="outline" onClick={() => downloadPdf(plan.id)}>
                          <Download className="w-3.5 h-3.5 mr-1" /> Download PDF
                        </Button>
                        {plan.status === 'active' && !plan.tenant_signature_date && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={async () => {
                              try {
                                await paymentPlansApi.update(plan.id, { tenantSignatureDate: todayLocalDate() });
                                showToast('Marked as signed', 'success');
                                loadPlans();
                              } catch (err: any) { showToast(err.message, 'error'); }
                            }}
                          >
                            <CalendarDays className="w-3.5 h-3.5 mr-1" /> Mark Signed
                          </Button>
                        )}
                        {plan.status === 'active' && (
                          <>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-destructive"
                              onClick={() => setConfirmCancel(plan)}
                            >
                              Cancel Plan
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              className="text-destructive"
                              onClick={() => handleDefault(plan)}
                            >
                              Mark Defaulted
                            </Button>
                          </>
                        )}
                        {(plan.status === 'cancelled' || plan.status === 'defaulted') && (
                          <Button
                            size="sm"
                            variant="outline"
                            className="text-destructive"
                            onClick={() => setConfirmDelete(plan)}
                          >
                            <Trash2 className="w-3.5 h-3.5 mr-1" /> Delete
                          </Button>
                        )}
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Create Payment Plan Modal */}
      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="New Payment Plan" size="lg">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Lease *</label>
            <select
              value={createLeaseId}
              onChange={e => setCreateLeaseId(e.target.value)}
              className="w-full px-3 py-2 rounded-lg border bg-background text-sm"
            >
              <option value="">Select a lease...</option>
              {activeLeases.map(lease => {
                const tenants = leaseTenantsMap.get(lease.id) || [];
                const name = tenants.map(t => `${t.firstName} ${t.lastName}`).join(', ') || 'No tenant';
                const prop = lease.propertyId ? propertyMap.get(lease.propertyId) : null;
                const unit = lease.unitId ? unitMap.get(lease.unitId) : null;
                const loc = [prop?.name || prop?.address, unit ? `Unit ${unit.unitNumber}` : ''].filter(Boolean).join(', ');
                return (
                  <option key={lease.id} value={lease.id}>
                    {name} — {loc} ({formatCurrency(lease.monthlyRent)}/mo)
                  </option>
                );
              })}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <TextInput
              label="Total Amount *"
              type="number"
              step="0.01"
              min="0"
              value={createAmount}
              onChange={e => setCreateAmount(e.target.value)}
              placeholder="e.g. 3000.00"
            />
            <TextInput
              label="Number of Installments *"
              type="number"
              min="1"
              max="24"
              value={createInstCount}
              onChange={e => setCreateInstCount(e.target.value)}
            />
          </div>

          <TextInput
            label="Start Date *"
            type="date"
            value={createStartDate}
            onChange={e => setCreateStartDate(e.target.value)}
          />

          <TextInput
            label="Reason"
            value={createReason}
            onChange={e => setCreateReason(e.target.value)}
            placeholder="e.g. Past due rent from Sept and Oct 2026"
          />

          <TextInput
            label="Notes"
            value={createNotes}
            onChange={e => setCreateNotes(e.target.value)}
            placeholder="Internal notes (not shown on PDF)"
          />

          {createAmount && createInstCount && parseInt(createInstCount, 10) > 0 && (
            <div className="bg-muted/30 rounded-lg p-3 text-sm">
              <p className="font-medium mb-1">Preview: {createInstCount} installments of approximately {formatCurrency(parseFloat(createAmount) / parseInt(createInstCount, 10))} each</p>
              <p className="text-muted-foreground">Starting {createStartDate}, one payment per month</p>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-2 mt-6">
          <Button variant="outline" onClick={() => setShowCreate(false)}>Cancel</Button>
          <Button onClick={handleCreate} disabled={creating}>
            {creating ? 'Creating...' : 'Create Plan'}
          </Button>
        </div>
      </Modal>

      {/* Mark installment modal */}
      <Modal
        isOpen={!!instAction}
        onClose={() => setInstAction(null)}
        title={instAction?.action === 'paid' ? 'Mark Installment Paid' : 'Mark Installment Missed'}
        size="sm"
      >
        {instAction && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">
              Installment #{instAction.inst.installment_number}: {formatCurrency(instAction.inst.amount)} due {formatDate(instAction.inst.due_date)}
            </p>
            {instAction.action === 'paid' && (
              <>
                <TextInput
                  label="Paid Date"
                  type="date"
                  value={instPaidDate}
                  onChange={e => setInstPaidDate(e.target.value)}
                />
                <TextInput
                  label="Amount Paid"
                  type="number"
                  step="0.01"
                  value={instPaidAmount}
                  onChange={e => setInstPaidAmount(e.target.value)}
                />
              </>
            )}
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setInstAction(null)}>Cancel</Button>
              <Button onClick={handleInstallmentAction}>
                {instAction.action === 'paid' ? 'Confirm Paid' : 'Confirm Missed'}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Delete confirmation */}
      <ConfirmDialog
        isOpen={!!confirmDelete}
        title="Delete Payment Plan"
        message="This will permanently delete the payment plan and all its installments. This cannot be undone."
        confirmText="Delete"
        variant="danger"
        onConfirm={handleDelete}
        onClose={() => setConfirmDelete(null)}
      />

      {/* Cancel confirmation */}
      <ConfirmDialog
        isOpen={!!confirmCancel}
        title="Cancel Payment Plan"
        message="This will cancel the payment plan. Any remaining unpaid installments will stay as is. Continue?"
        confirmText="Cancel Plan"
        variant="danger"
        onConfirm={handleCancel}
        onClose={() => setConfirmCancel(null)}
      />
    </div>
  );
}
