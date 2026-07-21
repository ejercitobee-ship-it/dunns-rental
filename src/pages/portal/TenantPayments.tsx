import { useEffect, useMemo, useState } from 'react';
import { DollarSign, CheckCircle, Clock, AlertCircle } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { portalApi, type PortalLease } from '../../lib/api';
import { useToast } from '../../context/ToastContext';
import { formatCurrency, getMonthName, formatDate } from '../../lib/utils';
import { settleMonth, rentMonthsToShow } from '../../lib/rent';
import type { Lease, RentPayment, PortalPayment } from '../../types';

// This app has had a React #310 white screen from a useMemo called after an
// early return, so every hook below runs unconditionally before the
// loading/error/empty branches at the bottom of the component.

const statusConfig = {
  paid: { label: 'Paid', variant: 'success', icon: CheckCircle },
  partial: { label: 'Partial', variant: 'warning', icon: Clock },
  unpaid: { label: 'Unpaid', variant: 'destructive', icon: AlertCircle },
} as const;

// The rent-math functions expect a full Lease. The portal serializer carries
// pauses (so paused months read correctly) but not tenantIds, which the math
// does not use, so an empty default is safe.
function toLease(pl: PortalLease): Lease {
  return { ...pl, tenantIds: [] };
}

// The payments endpoint returns raw rows with no id and no leaseId (a tenant
// never sees who paid, and there is exactly one lease in play here), so both
// are filled in locally: settleMonth's paymentsForMonth filters by leaseId,
// and RentPayment requires an id even though nothing here reads it.
function toRentPayments(leaseId: string, payments: PortalPayment[]): RentPayment[] {
  return payments.map((p, i) => ({
    id: `${leaseId}-${i}`,
    leaseId,
    amount: p.amount,
    dueDate: p.dueDate,
    paidDate: p.paidDate,
    status: p.status,
    month: p.month,
    year: p.year,
    paymentMethod: p.paymentMethod,
  }));
}

// Turn a stored method value (cash, bank_transfer) into a readable label.
function prettyMethod(method: string): string {
  return method
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export function TenantPayments() {
  const { showToast } = useToast();
  const [lease, setLease] = useState<PortalLease | null>(null);
  const [payments, setPayments] = useState<RentPayment[]>([]);
  // The raw rows (with real id + receiptDocumentId) kept alongside, so a month
  // can offer its receipt; `payments` above stays the id-less shape settleMonth uses.
  const [rawPayments, setRawPayments] = useState<PortalPayment[]>([]);
  const [receiptOverrides, setReceiptOverrides] = useState<Record<string, string>>({});
  const [generating, setGenerating] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    portalApi
      .payments()
      .then((res) => {
        if (cancelled) return;
        setLease(res.lease);
        setPayments(res.lease ? toRentPayments(res.lease.id, res.payments) : []);
        setRawPayments(res.lease ? res.payments : []);
      })
      .catch((err) => {
        if (cancelled) return;
        setError((err as Error).message || 'Could not load your payment history.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // One row per month the lease owed rent (from its start through now, plus any
  // month paid ahead), newest first — the clean monthly settlement view. Each
  // month carries a receipt entry PER payment, so a month paid in parts still
  // exposes every receipt (not just the first).
  interface ReceiptEntry { key: string; paymentId?: string; amount: number; docId?: string }
  interface Row {
    month: number;
    year: number;
    settlement: ReturnType<typeof settleMonth>;
    methods: string[];
    receivedOn?: string;
    receipts: ReceiptEntry[];
  }
  const rows = useMemo<Row[]>(() => {
    if (!lease) return [];
    const fullLease = toLease(lease);
    const now = new Date();
    const months = rentMonthsToShow(fullLease, payments, now.getFullYear(), now.getMonth() + 1);

    return months.reverse().map(({ month, year }) => {
      const monthPayments = rawPayments
        .filter(p => p.status === 'paid' && p.month === month && p.year === year)
        .sort((a, b) => (a.paidDate || '').localeCompare(b.paidDate || ''));
      return {
        month,
        year,
        settlement: settleMonth(fullLease, payments, month, year),
        methods: Array.from(new Set(monthPayments.map(p => p.paymentMethod).filter(Boolean) as string[])),
        // When the most recent payment for this month was received.
        receivedOn: monthPayments.length ? monthPayments[monthPayments.length - 1].paidDate : undefined,
        receipts: monthPayments.map((p, i) => ({
          key: `${p.id ?? i}`,
          paymentId: p.id,
          amount: p.amount,
          docId: (p.id && receiptOverrides[p.id]) || p.receiptDocumentId,
        })),
      };
    });
  }, [lease, payments, rawPayments, receiptOverrides]);

  const handleGenerateReceipt = async (paymentId: string) => {
    if (generating) return;
    setGenerating(paymentId);
    try {
      const { receiptDocumentId } = await portalApi.generateReceipt(paymentId);
      setReceiptOverrides(prev => ({ ...prev, [paymentId]: receiptDocumentId }));
      showToast('Receipt ready.', 'success');
    } catch (err) {
      showToast((err as Error).message || 'Could not get the receipt', 'error');
    } finally {
      setGenerating(null);
    }
  };

  if (loading) {
    return <p className="text-sm text-muted">Loading your payment history.</p>;
  }

  if (error) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-sm text-danger">{error}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Rent</p>
        <h1 className="font-display text-2xl text-ink mt-1">Payment history</h1>
      </div>

      {!lease ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted">
              You do not have a current tenancy on file, so there is no rent history to show.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px]">
                <thead>
                  <tr className="border-b border-line bg-canvas">
                    <th className="text-left py-3 px-5 font-semibold text-ink text-sm">Month</th>
                    <th className="text-right py-3 px-5 font-semibold text-ink text-sm">Due</th>
                    <th className="text-right py-3 px-5 font-semibold text-ink text-sm">Paid</th>
                    <th className="text-right py-3 px-5 font-semibold text-ink text-sm">Balance</th>
                    <th className="text-center py-3 px-5 font-semibold text-ink text-sm">Status</th>
                    <th className="text-left py-3 px-5 font-semibold text-ink text-sm">Method</th>
                    <th className="text-left py-3 px-5 font-semibold text-ink text-sm">Paid on</th>
                    <th className="text-left py-3 px-5 font-semibold text-ink text-sm">Receipt</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const status = statusConfig[row.settlement.status];
                    const StatusIcon = status.icon;
                    const multiple = row.receipts.length > 1;
                    return (
                      <tr key={`${row.year}-${row.month}`} className="border-b border-line last:border-0">
                        <td className="py-3 px-5 text-sm text-ink">{getMonthName(row.month)} {row.year}</td>
                        <td className="py-3 px-5 text-sm text-ink text-right tnum">{formatCurrency(row.settlement.due)}</td>
                        <td className="py-3 px-5 text-sm text-ink text-right tnum">{formatCurrency(row.settlement.paid)}</td>
                        <td className={`py-3 px-5 text-right font-semibold tnum ${row.settlement.balance > 0 ? 'text-danger' : 'text-ink'}`}>
                          {formatCurrency(row.settlement.balance)}
                        </td>
                        <td className="py-3 px-5 text-center">
                          <Badge variant={status.variant} className="flex items-center gap-1 w-fit mx-auto">
                            <StatusIcon className="h-3 w-3" />
                            {status.label}
                          </Badge>
                        </td>
                        <td className="py-3 px-5 text-sm text-muted">
                          {row.methods.map(prettyMethod).join(', ') || '—'}
                        </td>
                        <td className="py-3 px-5 text-sm text-muted whitespace-nowrap">
                          {row.receivedOn ? formatDate(row.receivedOn) : '—'}
                        </td>
                        <td className="py-3 px-5 text-sm">
                          {row.receipts.length === 0 ? (
                            <span className="text-faint">—</span>
                          ) : (
                            // One entry per payment, so a split month exposes every receipt.
                            // Label each with its amount only when there's more than one.
                            <div className="flex flex-col gap-1">
                              {row.receipts.map((r) => (
                                r.docId ? (
                                  <a
                                    key={r.key}
                                    href={`/api/portal/documents/${r.docId}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="font-medium text-primary hover:text-primary-hover whitespace-nowrap"
                                  >
                                    {multiple ? `Download (${formatCurrency(r.amount)})` : 'Download'}
                                  </a>
                                ) : r.paymentId ? (
                                  <button
                                    key={r.key}
                                    type="button"
                                    onClick={() => handleGenerateReceipt(r.paymentId!)}
                                    disabled={generating === r.paymentId}
                                    className="text-left font-medium text-muted hover:text-ink disabled:opacity-50 whitespace-nowrap"
                                  >
                                    {generating === r.paymentId
                                      ? 'Getting...'
                                      : multiple ? `Get receipt (${formatCurrency(r.amount)})` : 'Get receipt'}
                                  </button>
                                ) : null
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {rows.length === 0 && (
              <div className="text-center py-12">
                <DollarSign className="h-8 w-8 mx-auto text-faint mb-2" />
                <p className="text-sm text-muted">No months on record yet.</p>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
