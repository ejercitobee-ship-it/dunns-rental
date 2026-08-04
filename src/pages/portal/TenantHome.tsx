import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Calendar, DollarSign, User, ShieldAlert, CalendarClock, Wrench, MessageSquare, FileText, Clock } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Avatar } from '../../components/ui/Avatar';
import { Skeleton } from '../../components/ui/Skeleton';
import { useToast } from '../../context/ToastContext';
import { portalApi, type PortalMeResponse, type PortalLease, type HouseholdMember, type RealtorContact } from '../../lib/api';
import { formatCurrency, formatDate, formatMonthYear } from '../../lib/utils';
import { settleMonth, leasesOwingMonth, monthsBehind, PAST_DUE_MONTHS } from '../../lib/rent';
import { NotificationsCard } from '../../components/NotificationsCard';
import type { Lease, RentPayment, Tenant } from '../../types';

// Time-of-day greeting for the home header.
function greetingFor(d = new Date()): string {
  const h = d.getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

// "1st", "2nd", "3rd", "21st"... for the rent due day.
function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

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

  // Nudge the tenant when their lease is within a month of expiring (or has
  // expired), so they know to reach out about renewing.
  const leaseExpiry = useMemo(() => {
    const end = me?.lease?.endDate;
    if (!end) return null;
    const [y, m, d] = end.split('-').map(Number);
    if (!y || !m || !d) return null;
    const endMs = new Date(y, m - 1, d).getTime();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const days = Math.round((endMs - today.getTime()) / 86400000);
    if (days > 90) return null;
    const urgency: 'expired' | 'critical' | 'soon' | 'upcoming' =
      days < 0 ? 'expired' : days <= 30 ? 'critical' : days <= 60 ? 'soon' : 'upcoming';
    return { end, days, urgency };
  }, [me]);

  if (loading) {
    return <TenantHomeSkeleton />;
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

  // Whole days until this month's rent due date (negative once it has passed),
  // for the hero card's "due in N days" line.
  const dueDay = me.rentDueDay ?? 1;
  const startOfDay = (dt: Date) => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
  const daysToDue = Math.round(
    (startOfDay(new Date(nowD.getFullYear(), nowD.getMonth(), dueDay)) - startOfDay(nowD)) / 86400000
  );

  return (
    <div className="space-y-5">
      {/* Premium hero: the tenant's identity fused with their rent in one frame. */}
      {lease ? (
        <RentHero
          monthLabel={formatMonthYear(nowD.getMonth() + 1, nowD.getFullYear())}
          amount={lease.monthlyRent}
          status={thisMonth?.status ?? null}
          balance={thisMonth?.balance ?? 0}
          dueDay={dueDay}
          daysToDue={daysToDue}
          greeting={greetingFor()}
          firstName={tenant.firstName || 'Welcome'}
          initials={`${tenant.firstName?.[0] ?? ''}${tenant.lastName?.[0] ?? ''}`}
          photoUrl={tenant.photoUrl}
        />
      ) : (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-sm text-muted">{greetingFor()},</p>
            <h1 className="font-display text-[26px] leading-tight text-ink truncate">
              {tenant.firstName || 'Welcome'}
            </h1>
          </div>
          <Avatar
            photoUrl={tenant.photoUrl}
            initials={`${tenant.firstName?.[0] ?? ''}${tenant.lastName?.[0] ?? ''}`}
            className="w-11 h-11 flex-shrink-0"
          />
        </div>
      )}

      {/* Contact + emergency details, right under the hero. */}
      <ProfileCard tenant={tenant} />

      {pastDue && (
        <div className="rounded-2xl border border-danger/30 bg-danger-soft p-5 flex items-start gap-3">
          <ShieldAlert className="h-5 w-5 text-danger flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-ink">Your rent is {pastDue.months} months past due</p>
            <p className="text-sm text-muted mt-1">
              You have an outstanding balance of {formatCurrency(pastDue.balance)}. Please bring your account current as soon as you can. See the payment instructions below, and reach out to us with any questions.
            </p>
          </div>
        </div>
      )}

      {leaseExpiry && (() => {
        const isDanger = leaseExpiry.urgency === 'expired' || leaseExpiry.urgency === 'critical';
        const borderColor = isDanger ? 'border-danger/30' : 'border-warning/30';
        const bgColor = isDanger ? 'bg-danger-soft' : 'bg-warning-soft';
        const iconColor = isDanger ? 'text-danger' : 'text-warning';
        const headline =
          leaseExpiry.days < 0 ? 'Your lease has expired'
          : leaseExpiry.days === 0 ? 'Your lease expires today'
          : leaseExpiry.days === 1 ? 'Your lease expires tomorrow'
          : `Your lease expires in ${leaseExpiry.days} days`;
        const message =
          leaseExpiry.urgency === 'expired'
            ? `Your lease ended on ${formatDate(leaseExpiry.end)}. Please contact us right away to renew and avoid any disruption to your tenancy.`
          : leaseExpiry.urgency === 'critical'
            ? `Your current lease runs through ${formatDate(leaseExpiry.end)}. Please reach out soon to renew so there is no gap in your tenancy.`
          : leaseExpiry.urgency === 'soon'
            ? `Your lease is set to end on ${formatDate(leaseExpiry.end)}. Now is a good time to start the renewal conversation.`
            : `Heads up: your lease ends on ${formatDate(leaseExpiry.end)}. No rush, but keep it on your radar.`;
        return (
          <div className={`rounded-2xl border ${borderColor} ${bgColor} p-5 flex items-start gap-3`}>
            <CalendarClock className={`h-5 w-5 ${iconColor} flex-shrink-0 mt-0.5`} />
            <div className="flex-1">
              <p className="font-semibold text-ink">{headline}</p>
              <p className="text-sm text-muted mt-1">{message}</p>
              <Link
                to="/portal/messages"
                className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
              >
                <MessageSquare className="h-4 w-4" />
                Message us to renew
              </Link>
            </div>
          </div>
        );
      })()}

      <QuickActions />

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
          <HomeCard property={property} unit={unit} lease={lease} />
          <HowToPayCard instructions={me.paymentInstructions} memo={paymentMemo} />
        </>
      )}

      <NotificationsCard />

      <HouseholdCard hasLease={!!me?.lease} />

      <RealtorCard realtors={realtors} />
    </div>
  );
}

// The signature surface of the tenant app: this month's rent, its status, and
// how close the due date is, on a rich evergreen card.
function RentHero({
  monthLabel, amount, status, balance, dueDay, daysToDue, greeting, firstName, initials, photoUrl,
}: {
  monthLabel: string;
  amount: number;
  status: 'paid' | 'partial' | 'unpaid' | null;
  balance: number;
  dueDay: number;
  daysToDue: number;
  greeting: string;
  firstName: string;
  initials: string;
  photoUrl?: string | null;
}) {
  const scrollToPay = () => {
    document.getElementById('how-to-pay')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  const dueText =
    daysToDue > 0 ? `in ${daysToDue} ${daysToDue === 1 ? 'day' : 'days'}`
    : daysToDue === 0 ? 'today'
    : `${-daysToDue} ${-daysToDue === 1 ? 'day' : 'days'} ago`;

  return (
    <div
      className="relative overflow-hidden rounded-3xl p-6 text-white shadow-[0_14px_30px_-14px_rgba(20,45,34,0.7)]"
      style={{ background: 'radial-gradient(120% 140% at 100% 0%, #2f6350 0%, transparent 55%), linear-gradient(158deg, #24503f 0%, #16332a 100%)' }}
    >
      <div className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(60% 40% at 12% 8%, rgba(255,255,255,0.14), transparent 60%)' }} />
      <div className="relative">
        {/* Identity header, fused onto the rent card so they read as one frame. */}
        <div className="flex items-center gap-3">
          {photoUrl ? (
            <img src={photoUrl} alt="" className="w-11 h-11 rounded-full object-cover ring-1 ring-white/30" />
          ) : (
            <span className="w-11 h-11 rounded-full bg-white/15 ring-1 ring-white/25 grid place-items-center text-white font-medium">{initials}</span>
          )}
          <div className="min-w-0">
            <p className="text-[13px] text-white/60 leading-tight">{greeting},</p>
            <p className="font-display text-[20px] leading-tight text-white truncate">{firstName}</p>
          </div>
        </div>

        <div className="my-5 h-px bg-white/12" />

        <p className="text-[11px] uppercase tracking-[0.18em] font-semibold text-white/65">{monthLabel} rent</p>
        <p className="text-[42px] leading-none font-semibold mt-2 tnum">{formatCurrency(amount)}</p>

        <div className="mt-3 flex items-center gap-2 flex-wrap">
          {status === null && (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-white/12 text-white/85 border border-white/15">
              Nothing due yet
            </span>
          )}
          {status === 'paid' && (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full bg-white/15 text-white border border-white/20">
              <span className="w-1.5 h-1.5 rounded-full bg-[#a9e0c3]" /> Paid, you are all set
            </span>
          )}
          {status === 'partial' && (
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full text-[#f0d199] border border-[#f3d699]/30 bg-[#f3d699]/12">
              Balance {formatCurrency(balance)}
            </span>
          )}
          {status === 'unpaid' && (
            <>
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full text-[#f0d199] border border-[#f3d699]/30 bg-[#f3d699]/12">
                <span className="w-1.5 h-1.5 rounded-full bg-current" /> Due {dueText}
              </span>
              <span className="text-xs text-white/60">the {ordinal(dueDay)}</span>
            </>
          )}
        </div>

        <button
          type="button"
          onClick={scrollToPay}
          className="mt-5 w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#f1ecdf] text-[#1c3e30] text-sm font-semibold py-3 transition-transform hover:-translate-y-0.5"
        >
          <DollarSign className="h-4 w-4" /> How to pay
        </button>
      </div>
    </div>
  );
}

// Four large, thumb-friendly shortcuts to the rest of the app.
function QuickActions() {
  const actions = [
    { label: 'Request a repair', to: '/portal/maintenance', Icon: Wrench },
    { label: 'Message office', to: '/portal/messages', Icon: MessageSquare },
    { label: 'My documents', to: '/portal/documents', Icon: FileText },
    { label: 'Payment history', to: '/portal/payments', Icon: Clock },
  ];
  return (
    <div className="grid grid-cols-2 gap-3">
      {actions.map((a) => (
        <Link
          key={a.to}
          to={a.to}
          className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-line-strong"
        >
          <span className="w-10 h-10 rounded-xl bg-primary-soft text-primary grid place-items-center flex-shrink-0">
            <a.Icon className="h-5 w-5" strokeWidth={1.8} />
          </span>
          <span className="text-sm font-semibold text-ink leading-tight">{a.label}</span>
        </Link>
      ))}
    </div>
  );
}

// Where the tenant lives, with the lease term and an at-a-glance status.
function HomeCard({
  property, unit, lease,
}: {
  property?: { name?: string; address?: string } | null;
  unit?: { unitNumber?: string } | null;
  lease: PortalLease;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <p className="eyebrow mb-2.5">Your home</p>
        <div className="flex items-baseline justify-between gap-3">
          <p className="font-display text-xl text-ink truncate">
            {property?.name || property?.address || 'Property not on file'}
          </p>
          {unit?.unitNumber && <span className="text-sm text-muted flex-shrink-0">Unit {unit.unitNumber}</span>}
        </div>
        {property?.name && property?.address && (
          <p className="text-sm text-muted mt-0.5 truncate">{property.address}</p>
        )}
        <div className="flex items-center gap-2 mt-3 pt-3 border-t border-line text-sm text-muted">
          <Calendar className="h-4 w-4 text-faint flex-shrink-0" />
          <span className="truncate">
            {lease.startDate ? formatDate(lease.startDate) : 'Start date unknown'}
            {lease.endDate ? ` to ${formatDate(lease.endDate)}` : ', ongoing'}
          </span>
          {lease.status === 'active' && (
            <span className="ml-auto flex-shrink-0 text-xs font-semibold px-2.5 py-0.5 rounded-full bg-primary-soft text-primary">
              Active
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// The tenant's own profile, front and center on their Home page (folded in
// from the retired "My information" tab). Details are read-only except the
// photo, which they manage here with the same self-service photo API the
// realtor Dashboard uses.
function ProfileCard({ tenant }: { tenant: Tenant }) {
  const { showToast } = useToast();
  // The tenant can ADD an emergency contact if they have none yet; once saved
  // it overlays the (read-only) value from the server.
  const [emergencyOverride, setEmergencyOverride] = useState<Tenant['emergencyContact'] | null>(null);
  const [ecForm, setEcForm] = useState({ name: '', phone: '', relationship: '' });
  const [ecBusy, setEcBusy] = useState(false);

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
        <div className="space-y-3">
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
            <div className="space-y-2.5 rounded-xl border border-warning/40 bg-warning-soft p-4">
              <p className="text-sm font-medium text-ink flex items-center gap-2">
                <ShieldAlert className="h-4 w-4 text-warning flex-shrink-0" />
                Please add an emergency contact
              </p>
              <p className="text-sm text-muted">
                We do not have one on file yet. Please add someone we can reach in an emergency.
              </p>
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
    <Card id="how-to-pay">
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

/** Skeleton that mirrors the RentHero + quick-actions + cards structure. */
function TenantHomeSkeleton() {
  return (
    <div className="space-y-5 animate-in fade-in duration-200">
      {/* Hero skeleton */}
      <div className="rounded-3xl p-6 bg-[#1f4535]">
        <div className="flex items-center gap-3">
          <Skeleton className="w-11 h-11 rounded-full bg-white/10" />
          <div>
            <Skeleton className="h-3 w-24 bg-white/10" />
            <Skeleton className="mt-1 h-5 w-32 bg-white/10" />
          </div>
        </div>
        <div className="my-5 h-px bg-white/10" />
        <Skeleton className="h-3 w-20 bg-white/10" />
        <Skeleton className="mt-2 h-10 w-36 bg-white/10" />
        <Skeleton className="mt-4 h-7 w-40 rounded-full bg-white/10" />
        <Skeleton className="mt-5 h-12 w-full rounded-xl bg-white/10" />
      </div>
      {/* Quick actions */}
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-line bg-surface p-4 flex items-center gap-3">
            <Skeleton className="w-10 h-10 rounded-xl" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
      {/* Cards */}
      {Array.from({ length: 2 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-line bg-surface p-5 space-y-3">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-full" />
        </div>
      ))}
    </div>
  );
}
