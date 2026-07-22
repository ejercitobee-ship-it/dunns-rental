import { useEffect, useMemo, useRef, useState } from 'react';
import { Home, DoorOpen, Calendar, DollarSign, User, ShieldAlert } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { Button } from '../../components/ui/Button';
import { Avatar } from '../../components/ui/Avatar';
import { useToast } from '../../context/ToastContext';
import { portalApi, photoApi, type PortalMeResponse, type PortalLease, type HouseholdMember, type RealtorContact } from '../../lib/api';
import { resizeImage } from '../../lib/image';
import { formatCurrency, formatDate, formatMonthYear } from '../../lib/utils';
import { settleMonth, leasesOwingMonth, monthsBehind, PAST_DUE_MONTHS } from '../../lib/rent';
import { NotificationsCard } from '../../components/NotificationsCard';
import type { Lease, RentPayment, Tenant } from '../../types';

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
  const [realtors, setRealtors] = useState<RealtorContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // The tenant's realtor(s), loaded independently so a failure here never
  // blocks the rest of the dashboard.
  useEffect(() => {
    portalApi.myRealtors().then(setRealtors).catch(() => {});
  }, []);

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

  const pastDue = useMemo(() => {
    if (!me?.lease) return null;
    const now = new Date();
    const threshold = me.pastDueMonths ?? PAST_DUE_MONTHS;
    const pd = monthsBehind(toLease(me.lease), payments, now.getMonth() + 1, now.getFullYear());
    return pd.months >= threshold ? pd : null;
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

  // The exact memo the tenant should put on their Zelle payment: street, unit,
  // current month, and their name (the household who signed the lease).
  const nowD = new Date();
  const paymentMemo = [
    property?.address,
    unit ? `Unit ${unit.unitNumber}` : null,
    formatMonthYear(nowD.getMonth() + 1, nowD.getFullYear()),
    `${tenant.firstName ?? ''} ${tenant.lastName ?? ''}`.trim(),
  ].filter(Boolean).join(', ');

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Welcome</p>
        <h1 className="font-display text-2xl text-ink mt-1">
          Hello, {tenant.firstName}. Here is where things stand.
        </h1>
      </div>

      {pastDue && (
        <div className="rounded-xl border border-danger/30 bg-danger-soft p-5 flex items-start gap-3">
          <ShieldAlert className="h-5 w-5 text-danger flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-ink">Your rent is {pastDue.months} months past due</p>
            <p className="text-sm text-muted mt-1">
              You have an outstanding balance of {formatCurrency(pastDue.balance)}. Please bring your account current as soon as you can. See the payment instructions below, and reach out to us with any questions.
            </p>
          </div>
        </div>
      )}

      <NotificationsCard />

      <ProfileCard tenant={tenant} />

      {!lease ? (
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-muted">
              You do not have a current tenancy on file. If this seems wrong, contact your property manager.
            </p>
          </CardContent>
        </Card>
      ) : (
        <>
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

        <HowToPayCard instructions={me.paymentInstructions} memo={paymentMemo} />
        </>
      )}

      <HouseholdCard hasLease={!!me?.lease} />

      <RealtorCard realtors={realtors} />
    </div>
  );
}

// The tenant's own profile, front and center on their Home page (folded in
// from the retired "My information" tab). Details are read-only except the
// photo, which they manage here with the same self-service photo API the
// realtor Dashboard uses.
function ProfileCard({ tenant }: { tenant: Tenant }) {
  const { showToast } = useToast();
  const [photoUrl, setPhotoUrl] = useState<string | null>(tenant.photoUrl ?? null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // The tenant can ADD an emergency contact if they have none yet; once saved
  // it overlays the (read-only) value from the server.
  const [emergencyOverride, setEmergencyOverride] = useState<Tenant['emergencyContact'] | null>(null);
  const [ecForm, setEcForm] = useState({ name: '', phone: '', relationship: '' });
  const [ecBusy, setEcBusy] = useState(false);

  const handlePhotoPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || photoBusy) return;
    setPhotoBusy(true);
    try {
      const blob = await resizeImage(file);
      const { photoUrl: newUrl } = await photoApi.uploadSelf(blob);
      setPhotoUrl(`${newUrl}?t=${Date.now()}`);
      showToast('Photo updated.', 'success');
    } catch (err) {
      showToast((err as Error).message || 'Could not update your photo.', 'error');
    } finally {
      setPhotoBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handlePhotoRemove = async () => {
    if (photoBusy) return;
    setPhotoBusy(true);
    try {
      await photoApi.removeSelf();
      setPhotoUrl(null);
      showToast('Photo removed.', 'success');
    } catch (err) {
      showToast((err as Error).message || 'Could not remove your photo.', 'error');
    } finally {
      setPhotoBusy(false);
    }
  };

  const handleAddEmergency = async () => {
    if (ecBusy || !ecForm.name.trim()) return;
    setEcBusy(true);
    try {
      const saved = await portalApi.setEmergencyContact({
        name: ecForm.name.trim(),
        phone: ecForm.phone.trim(),
        relationship: ecForm.relationship.trim(),
      });
      setEmergencyOverride(saved);
      showToast('Emergency contact added.', 'success');
    } catch (err) {
      showToast((err as Error).message || 'Could not save your emergency contact.', 'error');
    } finally {
      setEcBusy(false);
    }
  };

  const emergency = emergencyOverride ?? tenant.emergencyContact;
  const hasEmergency = !!(emergency?.name || emergency?.phone || emergency?.relationship);

  return (
    <Card>
      <CardContent className="p-5 space-y-5">
        <div className="flex items-center gap-4">
          <Avatar
            photoUrl={photoUrl}
            initials={`${tenant.firstName?.[0] ?? ''}${tenant.lastName?.[0] ?? ''}`}
            className="w-16 h-16 flex-shrink-0"
            initialsClassName="text-xl"
          />
          <div>
            <p className="text-ink font-medium">{`${tenant.firstName ?? ''} ${tenant.lastName ?? ''}`.trim() || 'Your profile'}</p>
            <div className="flex items-center gap-3 mt-1">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handlePhotoPick}
              />
              <button
                type="button"
                disabled={photoBusy}
                onClick={() => fileInputRef.current?.click()}
                className="text-sm font-medium text-primary hover:text-primary-hover disabled:opacity-50"
              >
                {photoUrl ? 'Change photo' : 'Add photo'}
              </button>
              {photoUrl && (
                <button
                  type="button"
                  disabled={photoBusy}
                  onClick={handlePhotoRemove}
                  className="text-sm font-medium text-muted hover:text-danger disabled:opacity-50"
                >
                  Remove
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-3 border-t border-line pt-4">
          <h3 className="font-semibold text-ink flex items-center gap-2">
            <User className="h-4 w-4 text-faint" /> Contact
          </h3>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <ProfileField label="Email" value={tenant.email} />
            <ProfileField label="Phone" value={tenant.phone} />
          </div>
        </div>

        <div className="space-y-3 border-t border-line pt-4">
          <h3 className="font-semibold text-ink flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-faint" /> Emergency contact
          </h3>
          {hasEmergency ? (
            <div className="grid grid-cols-2 gap-4 text-sm">
              <ProfileField label="Name" value={emergency?.name} />
              <ProfileField label="Phone" value={emergency?.phone} />
              <ProfileField label="Relationship" value={emergency?.relationship} />
            </div>
          ) : (
            <div className="space-y-2.5">
              <p className="text-sm text-muted">None on file yet — you can add one here.</p>
              <div className="grid gap-2 sm:grid-cols-3">
                <input
                  className="rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25"
                  placeholder="Name"
                  value={ecForm.name}
                  onChange={e => setEcForm({ ...ecForm, name: e.target.value })}
                />
                <input
                  className="rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25"
                  placeholder="Relationship"
                  value={ecForm.relationship}
                  onChange={e => setEcForm({ ...ecForm, relationship: e.target.value })}
                />
                <input
                  className="rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25"
                  placeholder="Phone"
                  value={ecForm.phone}
                  onChange={e => setEcForm({ ...ecForm, phone: e.target.value })}
                />
              </div>
              <Button size="sm" disabled={!ecForm.name.trim() || ecBusy} onClick={handleAddEmergency}>
                {ecBusy ? 'Saving...' : 'Add emergency contact'}
              </Button>
            </div>
          )}
        </div>

        <p className="text-xs text-muted">To change details already on file, please contact us.</p>
      </CardContent>
    </Card>
  );
}

function ProfileField({ label, value }: { label: string; value?: string }) {
  return (
    <div>
      <p className="text-sm font-medium text-ink mb-1">{label}</p>
      <p className="text-sm text-muted">{value || 'Not on file'}</p>
    </div>
  );
}

function HowToPayCard({ instructions, memo }: { instructions?: string; memo: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(memo);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard unavailable; the memo is shown to copy by hand */ }
  };
  return (
    <Card>
      <CardContent className="p-5 space-y-3">
        <h3 className="font-semibold text-ink flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-faint" /> How to pay
        </h3>
        {instructions && <p className="text-sm text-ink">{instructions}</p>}
        {memo && (
          <div className="rounded-lg border border-line bg-canvas p-3 space-y-2">
            <p className="eyebrow">Put this in the memo</p>
            <div className="flex items-center gap-2">
              <code className="text-sm text-ink flex-1 break-words">{memo}</code>
              <Button type="button" variant="outline" size="sm" onClick={copy} className="flex-shrink-0">
                {copied ? 'Copied' : 'Copy'}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function RealtorCard({ realtors }: { realtors: RealtorContact[] }) {
  if (realtors.length === 0) return null;
  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <h2 className="font-display text-lg font-medium text-ink">Your realtor</h2>
        <ul className="space-y-3">
          {realtors.map((r, i) => (
            <li key={i} className="space-y-0.5">
              <p className="text-ink font-medium">{r.name || 'Realtor'}</p>
              <p className="text-muted text-sm">{r.email}</p>
              {r.phone && <p className="text-muted text-sm">{r.phone}</p>}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function HouseholdCard({ hasLease }: { hasLease: boolean }) {
  const { showToast } = useToast();
  const [members, setMembers] = useState<HouseholdMember[]>([]);
  const [form, setForm] = useState({ name: '', phone: '', relationship: '' });
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (hasLease) portalApi.household.list().then(setMembers).catch(() => {});
  }, [hasLease]);

  const resetForm = () => { setForm({ name: '', phone: '', relationship: '' }); };

  const submit = async () => {
    if (!form.name.trim() || busy) return;
    setBusy(true);
    try {
      await portalApi.household.add(form);
      setMembers(await portalApi.household.list());
      resetForm();
      showToast('Saved.', 'success');
    } catch (err) {
      showToast((err as Error).message || 'Could not save.', 'error');
    } finally { setBusy(false); }
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
              <Button size="sm" disabled={!form.name.trim() || busy} onClick={submit}>Add person</Button>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
