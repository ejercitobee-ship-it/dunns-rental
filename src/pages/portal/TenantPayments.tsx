import { useEffect, useMemo, useState } from 'react';
import { DollarSign, CheckCircle, Clock, AlertCircle } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { portalApi, type PortalLease } from '../../lib/api';
import { formatCurrency, getMonthName, yearOf, monthOf } from '../../lib/utils';
import { settleMonth, leasesOwingMonth } from '../../lib/rent';
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
  }));
}

export function TenantPayments() {
  const [lease, setLease] = useState<PortalLease | null>(null);
  const [payments, setPayments] = useState<RentPayment[]>([]);
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

  // One row per month the lease actually OWED rent, from its start through the
  // current month, newest first. Gated by leasesOwingMonth so a month the owner
  // paused shows no row at all, matching the owner's Rent Management. Figures
  // come from settleMonth alone; no rent arithmetic is re-derived here.
  const rows = useMemo(() => {
    if (!lease) return [];
    const fullLease = toLease(lease);
    const now = new Date();
    const nowMonth = now.getMonth() + 1;
    const nowYear = now.getFullYear();
    const startYear = lease.startDate ? yearOf(lease.startDate) : nowYear;
    const startMonth = lease.startDate ? monthOf(lease.startDate) : nowMonth;

    const months: { month: number; year: number }[] = [];
    let y = startYear;
    let m = startMonth;
    while (y < nowYear || (y === nowYear && m <= nowMonth)) {
      if (leasesOwingMonth([fullLease], m, y).length > 0) months.push({ month: m, year: y });
      m += 1;
      if (m > 12) {
        m = 1;
        y += 1;
      }
    }

    return months.reverse().map(({ month, year }) => ({
      month,
      year,
      settlement: settleMonth(fullLease, payments, month, year),
    }));
  }, [lease, payments]);

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
              <table className="w-full min-w-[520px]">
                <thead>
                  <tr className="border-b border-line bg-canvas">
                    <th className="text-left py-3 px-5 font-semibold text-ink text-sm">Month</th>
                    <th className="text-right py-3 px-5 font-semibold text-ink text-sm">Due</th>
                    <th className="text-right py-3 px-5 font-semibold text-ink text-sm">Paid</th>
                    <th className="text-right py-3 px-5 font-semibold text-ink text-sm">Balance</th>
                    <th className="text-center py-3 px-5 font-semibold text-ink text-sm">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const status = statusConfig[row.settlement.status];
                    const StatusIcon = status.icon;
                    return (
                      <tr key={`${row.year}-${row.month}`} className="border-b border-line last:border-0">
                        <td className="py-3 px-5 text-sm text-ink">
                          {getMonthName(row.month)} {row.year}
                        </td>
                        <td className="py-3 px-5 text-sm text-ink text-right tnum">
                          {formatCurrency(row.settlement.due)}
                        </td>
                        <td className="py-3 px-5 text-sm text-ink text-right tnum">
                          {formatCurrency(row.settlement.paid)}
                        </td>
                        <td
                          className={`py-3 px-5 text-right font-semibold tnum ${row.settlement.balance > 0 ? 'text-danger' : 'text-ink'}`}
                        >
                          {formatCurrency(row.settlement.balance)}
                        </td>
                        <td className="py-3 px-5 text-center">
                          <Badge variant={status.variant} className="flex items-center gap-1 w-fit mx-auto">
                            <StatusIcon className="h-3 w-3" />
                            {status.label}
                          </Badge>
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
