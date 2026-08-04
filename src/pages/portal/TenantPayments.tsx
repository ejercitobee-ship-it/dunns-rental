import { useEffect, useMemo, useState } from 'react';
import { DollarSign, CheckCircle, Clock, AlertCircle } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { portalApi, type PortalLease, type PortalMoveInFee } from '../../lib/api';
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
  const [moveInFee, setMoveInFee] = useState<PortalMoveInFee | null>(null);
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
        setMoveInFee(res.moveInFee ?? null);
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

  // One row PER payment: a month paid in one go is a single line, but a month
  // paid in parts breaks out onto a line per payment (each with its own amount,
  // date and receipt) so it's clear, not confusing. A row for any remaining
  // balance follows, so the tenant still sees what's owed. Newest month first.
  interface Row {
    key: string;
    label: string;
    amount: number;
    method: string;
    paidOn?: string;
    status: 'paid' | 'partial' | 'unpaid';
    receiptDocId?: string;
    generatePaymentId?: string;
  }
  const rows = useMemo<Row[]>(() => {
    if (!lease) return [];
    const fullLease = toLease(lease);
    const now = new Date();
    const months = rentMonthsToShow(fullLease, payments, now.getFullYear(), now.getMonth() + 1);

    const out: Row[] = [];
    for (const { month, year } of months.reverse()) {
      const label = `${getMonthName(month)} ${year}`;
      const monthPayments = rawPayments
        .filter(p => p.status === 'paid' && p.month === month && p.year === year)
        .sort((a, b) => (a.paidDate || '').localeCompare(b.paidDate || ''));

      for (const p of monthPayments) {
        const receiptDocId = (p.id && receiptOverrides[p.id]) || p.receiptDocumentId;
        out.push({
          key: `${year}-${month}-${p.id ?? out.length}`,
          label,
          amount: p.amount,
          method: p.paymentMethod ? prettyMethod(p.paymentMethod) : '',
          paidOn: p.paidDate,
          status: 'paid',
          receiptDocId,
          generatePaymentId: !receiptDocId && p.id ? p.id : undefined,
        });
      }

      const balance = settleMonth(fullLease, payments, month, year).balance;
      if (balance > 0) {
        out.push({ key: `${year}-${month}-due`, label, amount: balance, method: '', status: 'unpaid' });
      }
    }

    // The one-time move-in fee, shown at the end of the history with its receipt.
    if (moveInFee) {
      out.push({
        key: 'move-in-fee',
        label: 'Move-in fee',
        amount: moveInFee.amount,
        method: moveInFee.method ? prettyMethod(moveInFee.method) : '',
        paidOn: moveInFee.paidDate,
        status: 'paid',
        receiptDocId: moveInFee.receiptDocumentId,
      });
    }
    return out;
  }, [lease, payments, rawPayments, receiptOverrides, moveInFee]);

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
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 animate-in fade-in duration-200">
        <DollarSign className="h-8 w-8 text-faint animate-pulse" />
        <p className="text-sm text-muted">Loading your payment history</p>
      </div>
    );
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
    <div className="space-y-5">
      <div>
        <p className="eyebrow">Rent</p>
        <h1 className="font-display text-[26px] text-ink mt-1">Payments</h1>
        <p className="text-sm text-muted mt-1">Your month-by-month rent history and receipts.</p>
      </div>

      {!lease ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted">
              You do not have a current tenancy on file, so there is no rent history to show.
            </p>
          </CardContent>
        </Card>
      ) : rows.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center">
            <DollarSign className="h-8 w-8 mx-auto text-faint mb-2" />
            <p className="text-sm text-muted">No months on record yet.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-2 sm:p-3">
            <div className="divide-y divide-line">
              {rows.map((row) => {
                const status = statusConfig[row.status];
                const StatusIcon = status.icon;
                const sub = row.status === 'unpaid'
                  ? 'Not yet paid'
                  : [row.method, row.paidOn ? formatDate(row.paidOn) : ''].filter(Boolean).join(' · ');
                return (
                  <div key={row.key} className="flex items-center gap-3 px-2.5 py-3.5">
                    <span className={`w-10 h-10 rounded-xl grid place-items-center flex-shrink-0 ${statusChip[row.status]}`}>
                      <StatusIcon className="h-5 w-5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-ink">{row.label}</p>
                        <Badge variant={status.variant}>{status.label}</Badge>
                      </div>
                      {sub && <p className="text-xs text-muted mt-0.5 truncate">{sub}</p>}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className={`tnum font-semibold ${row.status === 'unpaid' ? 'text-danger' : 'text-ink'}`}>
                        {formatCurrency(row.amount)}
                      </p>
                      {row.receiptDocId ? (
                        <a
                          href={`/api/portal/documents/${row.receiptDocId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs font-medium text-primary hover:text-primary-hover"
                        >
                          Download
                        </a>
                      ) : row.generatePaymentId ? (
                        <button
                          type="button"
                          onClick={() => handleGenerateReceipt(row.generatePaymentId!)}
                          disabled={generating === row.generatePaymentId}
                          className="text-xs font-medium text-muted hover:text-ink disabled:opacity-50"
                        >
                          {generating === row.generatePaymentId ? 'Getting...' : 'Get receipt'}
                        </button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

// Soft icon-chip background per payment status.
const statusChip = {
  paid: 'bg-primary-soft text-primary',
  partial: 'bg-warning-soft text-warning',
  unpaid: 'bg-danger-soft text-danger',
} as const;
