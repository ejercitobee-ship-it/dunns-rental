import { useEffect, useState } from 'react';
import { FileText, Download, CheckCircle, XCircle, Clock, AlertCircle, DollarSign } from 'lucide-react';
import { Card, CardContent } from './ui/Card';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { ConfirmDialog } from './ui/ConfirmDialog';
import { paymentPlansApi, type PaymentPlan, type PaymentPlanInstallment } from '../lib/api';
import { useToast } from '../context/ToastContext';
import { formatCurrency, formatDate } from '../lib/utils';

const statusConfig: Record<string, { label: string; color: 'success' | 'warning' | 'destructive' | 'default'; icon: typeof CheckCircle }> = {
  active: { label: 'Active', color: 'default', icon: Clock },
  completed: { label: 'Completed', color: 'success', icon: CheckCircle },
  defaulted: { label: 'Defaulted', color: 'destructive', icon: XCircle },
  cancelled: { label: 'Cancelled', color: 'warning', icon: AlertCircle },
};

const instStatusBadge: Record<string, { label: string; color: 'success' | 'warning' | 'destructive' }> = {
  paid: { label: 'Paid', color: 'success' },
  pending: { label: 'Pending', color: 'warning' },
  missed: { label: 'Missed', color: 'destructive' },
};

interface Props {
  tenantId: string;
}

export function PaymentPlansSection({ tenantId }: Props) {
  const { showToast } = useToast();
  const [plans, setPlans] = useState<PaymentPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [payingInst, setPayingInst] = useState<{ planId: string; inst: PaymentPlanInstallment } | null>(null);
  const [payingLoading, setPayingLoading] = useState(false);

  const reload = () => {
    paymentPlansApi.list({ tenantId })
      .then(setPlans)
      .catch((err: any) => showToast(err.message || 'Failed to load payment plans', 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => { reload(); }, [tenantId]);

  const handleRecordPayment = async () => {
    if (!payingInst) return;
    setPayingLoading(true);
    try {
      const today = new Date().toISOString().slice(0, 10);
      await paymentPlansApi.updateInstallment(payingInst.planId, payingInst.inst.id, {
        status: 'paid',
        paidDate: today,
        paidAmount: payingInst.inst.amount,
      });
      showToast(`Installment #${payingInst.inst.installment_number} marked as paid`, 'success');
      setPayingInst(null);
      reload();
    } catch (err: any) {
      showToast(err.message || 'Failed to record payment', 'error');
    } finally {
      setPayingLoading(false);
    }
  };

  if (loading) return null;
  if (plans.length === 0) return null;

  return (
    <Card>
      <CardContent className="p-5">
        <h3 className="font-semibold text-ink flex items-center gap-2 mb-4">
          <FileText className="h-4 w-4 text-faint" /> Payment Plans
        </h3>

        <div className="space-y-4">
          {plans.map(plan => {
            const cfg = statusConfig[plan.status] || statusConfig.active;
            const installments: PaymentPlanInstallment[] = plan.installments || [];
            const paidCount = installments.filter(i => i.status === 'paid').length;
            const paidAmount = installments.filter(i => i.status === 'paid').reduce((s, i) => s + (i.paid_amount || i.amount), 0);
            const remaining = plan.total_amount - paidAmount;
            const progress = installments.length > 0 ? (paidCount / installments.length) * 100 : 0;

            return (
              <div key={plan.id} className="border border-line rounded-lg p-4">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <div className="flex items-center gap-2 mb-1">
                      <span className="font-semibold">{formatCurrency(plan.total_amount)}</span>
                      <Badge variant={cfg.color}>{cfg.label}</Badge>
                    </div>
                    {plan.reason && (
                      <p className="text-sm text-muted">{plan.reason}</p>
                    )}
                    <p className="text-xs text-muted mt-1">
                      {plan.num_installments} installments starting {formatDate(plan.start_date)}
                      {plan.created_by_name && <> &middot; Created by {plan.created_by_name}</>}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => window.open(paymentPlansApi.pdfUrl(plan.id), '_blank')}
                  >
                    <Download className="h-3.5 w-3.5 mr-1" /> PDF
                  </Button>
                </div>

                <div className="mb-3">
                  <div className="flex items-center justify-between text-xs text-muted mb-1">
                    <span>{paidCount} of {installments.length} paid</span>
                    <span>{formatCurrency(remaining)} remaining</span>
                  </div>
                  <div className="w-full bg-muted/20 rounded-full h-1.5">
                    <div
                      className="bg-primary rounded-full h-1.5 transition-all"
                      style={{ width: `${progress}%` }}
                    />
                  </div>
                </div>

                {installments.length > 0 && (
                  <div className="border-t border-line pt-2">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-xs text-muted">
                          <th className="text-left font-medium py-1">#</th>
                          <th className="text-left font-medium py-1">Due Date</th>
                          <th className="text-right font-medium py-1">Amount</th>
                          <th className="text-right font-medium py-1">Status</th>
                          {plan.status === 'active' && <th className="text-right font-medium py-1 w-24"></th>}
                        </tr>
                      </thead>
                      <tbody>
                        {installments.map(inst => {
                          const ic = instStatusBadge[inst.status] || instStatusBadge.pending;
                          return (
                            <tr key={inst.id} className="border-t border-line/50">
                              <td className="py-1.5 text-muted">{inst.installment_number}</td>
                              <td className="py-1.5">{formatDate(inst.due_date)}</td>
                              <td className="py-1.5 text-right">{formatCurrency(inst.amount)}</td>
                              <td className="py-1.5 text-right">
                                <Badge variant={ic.color} className="text-xs">{ic.label}</Badge>
                              </td>
                              {plan.status === 'active' && (
                                <td className="py-1.5 text-right">
                                  {inst.status === 'pending' && (
                                    <Button
                                      variant="outline"
                                      size="sm"
                                      className="text-xs h-6 px-2"
                                      onClick={() => setPayingInst({ planId: plan.id, inst })}
                                    >
                                      <DollarSign className="h-3 w-3 mr-0.5" /> Pay
                                    </Button>
                                  )}
                                </td>
                              )}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>

      {payingInst && (
        <ConfirmDialog
          isOpen
          title="Record Installment Payment"
          message={`Mark installment #${payingInst.inst.installment_number} as paid (${formatCurrency(payingInst.inst.amount)}, due ${formatDate(payingInst.inst.due_date)})?`}
          confirmText="Record Payment"
          variant="info"
          loading={payingLoading}
          onConfirm={handleRecordPayment}
          onClose={() => setPayingInst(null)}
        />
      )}
    </Card>
  );
}
