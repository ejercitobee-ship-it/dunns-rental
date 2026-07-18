import { useEffect, useMemo, useState } from 'react';
import { Home, DoorOpen, Calendar, DollarSign } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { useToast } from '../../context/ToastContext';
import { portalApi, type PortalMeResponse, type PortalLease, type HouseholdMember } from '../../lib/api';
import { formatCurrency, formatDate } from '../../lib/utils';
import { settleMonth, leasesOwingMonth } from '../../lib/rent';
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

// The rent-math functions expect a full Lease. The portal serializer carries
// pauses (so paused months read correctly) but not tenantIds, which the math
// does not use, so an empty default is safe.
function toLease(pl: PortalLease): Lease {
  return { ...pl, tenantIds: [] };
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

  // This month's settlement, gated by leasesOwingMonth so it matches the
  // owner's Rent Management exactly: a lease starting next month owes nothing
  // yet, and a month the owner paused is not owed either. Showing "Not yet
  // paid" for a month that was never billed would alarm the tenant over rent
  // they do not owe.
  const thisMonth = useMemo(() => {
    if (!me?.lease) return null;
    const lease = toLease(me.lease);
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    if (leasesOwingMonth([lease], month, year).length === 0) return null;
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

      <HouseholdCard hasLease={!!me?.lease} />
    </div>
  );
}

function HouseholdCard({ hasLease }: { hasLease: boolean }) {
  const { showToast } = useToast();
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [form, setForm] = useState({ name: '', phone: '', relationship: '' });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [toRemove, setToRemove] = useState<HouseholdMember | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (hasLease) portalApi.household.list().then(setMembers).catch(() => {});
  }, [hasLease]);

  const resetForm = () => { setForm({ name: '', phone: '', relationship: '' }); setEditingId(null); };

  const submit = async () => {
    if (!form.name.trim() || busy) return;
    setBusy(true);
    try {
      if (editingId) await portalApi.household.update(editingId, form);
      else await portalApi.household.add(form);
      setMembers(await portalApi.household.list());
      resetForm();
      showToast('Saved.', 'success');
    } catch (err) {
      showToast((err as Error).message || 'Could not save.', 'error');
    } finally { setBusy(false); }
  };

  const confirmRemove = async () => {
    if (!toRemove) return;
    try {
      await portalApi.household.remove(toRemove.id);
      setMembers(members.filter(m => m.id !== toRemove.id));
      if (editingId === toRemove.id) resetForm();
      showToast('Removed.', 'success');
    } catch (err) {
      showToast((err as Error).message || 'Could not remove.', 'error');
    } finally { setToRemove(null); }
  };

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <h2 className="font-display text-lg font-medium text-ink">Who lives here</h2>
        {!hasLease ? (
          <p className="text-muted text-sm">Once your lease is active you can add the people living with you.</p>
        ) : (
          <>
            <ul className="space-y-2">
              {members.map(m => (
                <li key={m.id} className="flex items-center justify-between gap-3 border-b border-line pb-2">
                  <div>
                    <p className="text-ink font-medium">{m.name}</p>
                    <p className="text-muted text-sm">
                      {[m.relationship, m.phone].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => { setEditingId(m.id); setForm({ name: m.name, phone: m.phone ?? '', relationship: m.relationship ?? '' }); }}>Edit</Button>
                    <Button variant="outline" size="sm" onClick={() => setToRemove(m)}>Remove</Button>
                  </div>
                </li>
              ))}
              {members.length === 0 && <li className="text-muted text-sm">No one added yet.</li>}
            </ul>
            <div className="grid gap-2 sm:grid-cols-3">
              <input className="rounded-lg border border-line px-3 py-2 text-sm" placeholder="Name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
              <input className="rounded-lg border border-line px-3 py-2 text-sm" placeholder="Relationship" value={form.relationship} onChange={e => setForm({ ...form, relationship: e.target.value })} />
              <input className="rounded-lg border border-line px-3 py-2 text-sm" placeholder="Phone" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div className="flex gap-2">
              <Button size="sm" disabled={!form.name.trim() || busy} onClick={submit}>{editingId ? 'Save changes' : 'Add person'}</Button>
              {editingId && <Button variant="outline" size="sm" onClick={resetForm}>Cancel</Button>}
            </div>
          </>
        )}
      </CardContent>
      <ConfirmDialog
        isOpen={!!toRemove}
        onClose={() => setToRemove(null)}
        onConfirm={confirmRemove}
        title="Remove household member"
        message={`Remove ${toRemove?.name} from the people who live here?`}
        confirmText="Remove"
      />
    </Card>
  );
}
