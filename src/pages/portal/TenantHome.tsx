import { useEffect, useMemo, useState } from 'react';
import { Home, DoorOpen, Calendar, DollarSign } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { portalApi, type PortalMeResponse, type PortalLease } from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/utils';
import { settleMonth, leaseCoversMonth } from '../../lib/rent';
import type { Lease, RentPayment } from '../../types';

const settlementBadge = {
  paid: 'success',
  partial: 'warning',
  unpaid: 'destructive',
} as const;

const settlementLabel = {
  paid: 'Paid',
  partial: 'Partially paid',
  unpaid: 'Not yet paid',
} as const;

// settleMonth and leaseCoversMonth both expect a full Lease, but the portal
// serializer omits `pauses` and `tenantIds` (see PortalLease in lib/api.ts).
// Neither function reads those two fields, so empty defaults are safe.
function toLease(pl: PortalLease): Lease {
  return { ...pl, pauses: [], tenantIds: [] };
}

export function TenantHome() {
  const [me, setMe] = useState<PortalMeResponse | null>(null);
  const [payments, setPayments] = useState<RentPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([portalApi.me(), portalApi.payments()])
      .then(([meRes, paymentsRes]) => {
        if (cancelled) return;
        setMe(meRes);
        const leaseId = paymentsRes.lease?.id;
        // The payments endpoint scopes its rows to the caller's own current
        // lease already, so stamping that lease's id onto each row here is
        // safe: it lets settleMonth's paymentsForMonth filter match them.
        setPayments(
          leaseId
            ? paymentsRes.payments.map((p, i) => ({ id: `${leaseId}-${i}`, leaseId, ...p }))
            : []
        );
      })
      .catch((err) => {
        if (cancelled) return;
        setError((err as Error).message || 'Could not load your account.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // This month's settlement, gated by leaseCoversMonth: a lease signed to
  // start next month owes nothing yet, and showing "Not yet paid" for a
  // month that isn't due would invent a balance the owner never billed.
  const thisMonth = useMemo(() => {
    if (!me?.lease) return null;
    const lease = toLease(me.lease);
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    if (!leaseCoversMonth(lease, month, year)) return null;
    return settleMonth(lease, payments, month, year);
  }, [me, payments]);

  if (loading) {
    return <p className="text-sm text-muted">Loading your account.</p>;
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

  if (!me) return null;

  const { tenant, lease, unit, property } = me;

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Welcome</p>
        <h1 className="font-display text-2xl text-ink mt-1">
          Hello, {tenant.firstName}. Here is where things stand.
        </h1>
      </div>

      {!lease ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted">
              You do not have a current tenancy on file. If this seems wrong, contact your property manager.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-6 sm:grid-cols-2">
          <Card>
            <CardContent className="p-5 space-y-3">
              <h3 className="font-semibold text-ink flex items-center gap-2">
                <Home className="h-4 w-4 text-faint" /> Your home
              </h3>
              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2 text-ink">
                  <Home className="h-3.5 w-3.5 text-faint" />
                  <span>{property?.name || 'Property not on file'}</span>
                </div>
                <div className="flex items-center gap-2 text-muted">
                  <DoorOpen className="h-3.5 w-3.5 text-faint" />
                  <span>{unit ? `Unit ${unit.unitNumber}` : 'Unit not on file'}</span>
                </div>
                <div className="flex items-center gap-2 text-muted">
                  <Calendar className="h-3.5 w-3.5 text-faint" />
                  <span>
                    {lease.startDate ? formatDate(lease.startDate) : 'Start date unknown'}
                    {lease.endDate ? ` to ${formatDate(lease.endDate)}` : ', ongoing'}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardContent className="p-5 space-y-3">
              <h3 className="font-semibold text-ink flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-faint" /> Rent
              </h3>
              <div className="flex items-baseline gap-1.5">
                <span className="font-display text-2xl text-ink tnum">{formatCurrency(lease.monthlyRent)}</span>
                <span className="text-sm text-muted">per month</span>
              </div>
              {thisMonth ? (
                <div className="pt-2 border-t border-line flex items-center justify-between">
                  <span className="eyebrow">This month</span>
                  <Badge variant={settlementBadge[thisMonth.status]}>{settlementLabel[thisMonth.status]}</Badge>
                </div>
              ) : (
                <p className="text-sm text-faint pt-2 border-t border-line">Nothing due this month yet.</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
