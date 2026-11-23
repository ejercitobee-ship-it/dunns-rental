import { useEffect, useState } from 'react';
import { FileText, Download, CheckCircle, XCircle, Clock, AlertCircle, ChevronDown, ChevronRight } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { portalApi, type PaymentPlan, type PaymentPlanInstallment } from '../../lib/api';
import { useToast } from '../../context/ToastContext';
import { formatCurrency, formatDate } from '../../lib/utils';

const statusConfig: Record<string, { label: string; color: 'success' | 'warning' | 'destructive' | 'default'; icon: typeof CheckCircle }> = {
  active: { label: 'Active', color: 'default', icon: Clock },
  completed: { label: 'Completed', color: 'success', icon: CheckCircle },
  defaulted: { label: 'Defaulted', color: 'destructive', icon: XCircle },
  cancelled: { label: 'Cancelled', color: 'warning', icon: AlertCircle },
};

const instStatusConfig: Record<string, { label: string; color: 'success' | 'warning' | 'destructive' }> = {
  paid: { label: 'Paid', color: 'success' },
  pending: { label: 'Pending', color: 'warning' },
  missed: { label: 'Missed', color: 'destructive' },
};

export function TenantPaymentPlans() {
  const { showToast } = useToast();
  const [plans, setPlans] = useState<PaymentPlan[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);

  useEffect(() => {
    portalApi.paymentPlans()
      .then(setPlans)
      .catch((err: any) => showToast(err.message || 'Failed to load payment plans', 'error'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  if (plans.length === 0) {
    return (
      <div className="text-center py-12 text-muted-foreground">
        <FileText className="h-12 w-12 mx-auto mb-3 opacity-40" />
        <p className="text-lg font-medium">No payment plans</p>
        <p className="text-sm mt-1">You do not have any payment plans on your account.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 mb-2">
        <FileText className="h-5 w-5 text-primary" />
        <h2 className="text-lg font-semibold">Payment Plans</h2>
      </div>

      {plans.map(plan => {
        const cfg = statusConfig[plan.status] || statusConfig.active;
        const StatusIcon = cfg.icon;
        const isExpanded = expanded === plan.id;
        const installments: PaymentPlanInstallment[] = (plan as any).installments || [];
        const paidCount = installments.filter(i => i.status === 'paid').length;
        const paidAmount = installments.filter(i => i.status === 'paid').reduce((s, i) => s + (i.paid_amount || i.amount), 0);
        const remaining = plan.total_amount - paidAmount;
        const progress = installments.length > 0 ? (paidCount / installments.length) * 100 : 0;

        return (
          <Card key={plan.id}>
            <CardContent className="p-4">
              <button
                onClick={() => setExpanded(isExpanded ? null : plan.id)}
                className="w-full flex items-start justify-between text-left"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <StatusIcon className="h-4 w-4 flex-shrink-0" />
                    <span className="font-semibold text-base">{formatCurrency(plan.total_amount)}</span>
                    <Badge variant={cfg.color} className="text-xs">{cfg.label}</Badge>
                  </div>
                  {plan.reason && (
                    <p className="text-sm text-muted-foreground mb-1">{plan.reason}</p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {plan.num_installments} installments starting {formatDate(plan.start_date)}
                  </p>

                  <div className="mt-2">
                    <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
                      <span>{paidCount} of {installments.length} paid</span>
                      <span>{formatCurrency(remaining)} remaining</span>
                    </div>
                    <div className="w-full bg-muted rounded-full h-2">
                      <div
                        className="bg-primary rounded-full h-2 transition-all"
                        style={{ width: `${progress}%` }}
                      />
                    </div>
                  </div>
                </div>
                <div className="ml-3 mt-1 flex-shrink-0">
                  {isExpanded ? <ChevronDown className="h-5 w-5" /> : <ChevronRight className="h-5 w-5" />}
                </div>
              </button>

              {isExpanded && (
                <div className="mt-4 border-t pt-4 space-y-3">
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => window.open(portalApi.paymentPlanPdfUrl(plan.id), '_blank')}
                    >
                      <Download className="h-4 w-4 mr-1" />
                      Download Agreement
                    </Button>
                  </div>

                  <div className="space-y-2">
                    <p className="text-sm font-medium">Installment Schedule</p>
                    {installments.map(inst => {
                      const ic = instStatusConfig[inst.status] || instStatusConfig.pending;
                      return (
                        <div
                          key={inst.id}
                          className="flex items-center justify-between py-2 px-3 rounded-lg bg-muted/30 text-sm"
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <span className="text-muted-foreground">#{inst.installment_number}</span>
                            <span>{formatDate(inst.due_date)}</span>
                          </div>
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{formatCurrency(inst.amount)}</span>
                            <Badge variant={ic.color} className="text-xs">{ic.label}</Badge>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {plan.tenant_signature_date && (
                    <p className="text-xs text-muted-foreground">
                      Signed {formatDate(plan.tenant_signature_date)}
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
