import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Calendar, DollarSign, User, ShieldAlert, CalendarClock, Wrench, MessageSquare, FileText, Clock, Phone, Mail, X } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Avatar } from '../../components/ui/Avatar';
import { Skeleton } from '../../components/ui/Skeleton';
import { useToast } from '../../context/ToastContext';
import { portalApi, type PortalMeResponse, type PortalLease, type HouseholdMember, type RealtorContact } from '../../lib/api';
import { formatCurrency, formatDate, formatMonthYear, formatPhone } from '../../lib/utils';
import { settleMonthWithCredit, leasesOwingMonth, monthsBehind, unsettledMonths } from '../../lib/rent';
import { NotificationsCard } from '../../components/NotificationsCard';
import { PayRent } from '../../components/portal/PayRent';
import type { Lease, RentPayment, PaymentAllocation, Tenant } from '../../types';

function greetingFor(d = new Date()): string {
  const h = d.getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
}

function toLease(pl: PortalLease): Lease {
  return { ...pl, tenantIds: [] };
}

export function TenantHome() {
  const [me, setMe] = useState<PortalMeResponse | null>(null);
  const [payments, setPayments] = useState<RentPayment[]>([]);
  const [allocations, setAllocations] = useState<PaymentAllocation[]>([]);
  const [realtors, setRealtors] = useState<RealtorContact[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
        setPayments(
          leaseId
            ? paymentsRes.payments.map((p, i) => ({ id: `${leaseId}-${i}`, leaseId, ...p }))
            : []
        );
        setAllocations(paymentsRes.allocations ?? []);
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

  const allLeases = useMemo(() => {
    if (!me?.siblingLeases?.length) return me?.lease ? [toLease(me.lease)] : [];
    return me.siblingLeases.map(toLease);
  }, [me]);

  const thisMonth = useMemo(() => {
    if (!me?.lease) return null;
    const lease = toLease(me.lease);
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    const owing = leasesOwingMonth(allLeases, month, year);
    if (!owing.some(l => l.id === lease.id)) return null;
    return settleMonthWithCredit(lease, payments, month, year, allLeases, allocations);
  }, [me, payments, allLeases, allocations]);

  const pastDue = useMemo(() => {
    if (!me?.lease) return null;
    const now = new Date();
    const pd = monthsBehind(toLease(me.lease), payments, now.getMonth() + 1, now.getFullYear(), allLeases, allocations);
    return pd.months >= 1 ? pd : null;
  }, [me, payments, allLeases, allocations]);

  const owedMonths = useMemo(() => {
    if (!me?.lease) return [];
    const now = new Date();
    return unsettledMonths(toLease(me.lease), payments, now.getMonth() + 1, now.getFullYear(), allLeases, allocations);
  }, [me, payments, allLeases, allocations]);

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

  const nowD = new Date();
  const paymentMemo = [
    property?.address,
    unit ? `Unit ${unit.unitNumber}` : null,
    formatMonthYear(nowD.getMonth() + 1, nowD.getFullYear()),
    `${tenant.firstName ?? ''} ${tenant.lastName ?? ''}`.trim(),
  ].filter(Boolean).join(', ');

  const rawDueDay = me.rentDueDay ?? 1;
  const daysInMonth = new Date(nowD.getFullYear(), nowD.getMonth() + 1, 0).getDate();
  const dueDay = Math.min(rawDueDay, daysInMonth);
  const startOfDay = (dt: Date) => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate()).getTime();
  const daysToDue = Math.round(
    (startOfDay(new Date(nowD.getFullYear(), nowD.getMonth(), dueDay)) - startOfDay(nowD)) / 86400000
  );

  const currentPaid = thisMonth?.status === 'paid';
  const firstOwed = owedMonths[0];
  const payMonth = currentPaid && firstOwed ? firstOwed.month : nowD.getMonth() + 1;
  const payYear = currentPaid && firstOwed ? firstOwed.year : nowD.getFullYear();
  const payStatus = currentPaid && firstOwed ? 'unpaid' as const : (thisMonth?.status ?? null);
  const payAmount = currentPaid && firstOwed ? firstOwed.amount : (thisMonth?.due ?? lease?.monthlyRent ?? 0);
  const payBalance = currentPaid && firstOwed ? firstOwed.amount : (thisMonth?.balance ?? 0);

  return (
    <div className="space-y-5">
      {lease ? (
        <RentHero
          monthLabel={formatMonthYear(nowD.getMonth() + 1, nowD.getFullYear())}
          amount={lease.monthlyRent}
          status={thisMonth?.status ?? null}
          balance={thisMonth?.balance ?? 0}
          creditApplied={thisMonth?.creditApplied ?? 0}
          creditRemaining={thisMonth?.creditRemaining ?? 0}
          dueDay={dueDay}
          daysToDue={daysToDue}
          greeting={greetingFor()}
          firstName={tenant.firstName || 'Welcome'}
          initials={`${tenant.firstName?.[0] ?? ''}${tenant.lastName?.[0] ?? ''}`}
          photoUrl={tenant.photoUrl}
          pastDue={pastDue}
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

      <QuickActions tenant={tenant} />

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
          {import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY ? (
            <PayRent
              leaseId={lease.id}
              amount={payAmount}
              month={payMonth}
              year={payYear}
              monthLabel={formatMonthYear(payMonth, payYear)}
              status={payStatus}
              balance={payBalance}
              tenantName={`${tenant.firstName ?? ''} ${tenant.lastName ?? ''}`.trim() || 'Tenant'}
              paymentInstructions={me.paymentInstructions}
              paymentMemo={paymentMemo}
            />
          ) : (
            <HowToPayCard instructions={me.paymentInstructions} memo={paymentMemo} />
          )}
        </>
      )}

      <NotificationsCard />

      <HouseholdCard hasLease={!!me?.lease} />

      <RealtorCard realtors={realtors} />
    </div>
  );
}

function RentHero({
  monthLabel, amount, status, balance, creditApplied, creditRemaining, dueDay, daysToDue, greeting, firstName, initials, photoUrl, pastDue,
}: {
  monthLabel: string;
  amount: number;
  status: 'paid' | 'partial' | 'unpaid' | null;
  balance: number;
  creditApplied: number;
  creditRemaining: number;
  dueDay: number;
  daysToDue: number;
  greeting: string;
  firstName: string;
  initials: string;
  photoUrl?: string | null;
  pastDue: { months: number; balance: number } | null;
}) {
  const scrollToPay = () => {
    const target = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY
      ? document.getElementById('pay-rent-online')
      : document.getElementById('how-to-pay');
    target?.scrollIntoView({ behavior: 'smooth', block: 'start' });
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
        <div className="flex items-center gap-3">
          {photoUrl ? (
            <img src={photoUrl} alt="" className="w-11 h-11 rounded-full object-cover ring-2 ring-[#c9a96e]/40" />
          ) : (
            <span className="w-11 h-11 rounded-full bg-white/15 ring-2 ring-[#c9a96e]/40 grid place-items-center text-white font-medium">{initials}</span>
          )}
          <div className="min-w-0">
            <p className="text-[13px] text-white/60 leading-tight">{greeting},</p>
            <p className="font-display text-[20px] leading-tight text-white truncate">{firstName}</p>
          </div>
        </div>

        <div className="my-5 h-px bg-[#c9a96e]/20" />

        <p className="text-[11px] uppercase tracking-[0.18em] font-semibold text-[#c9a96e]">{monthLabel} rent</p>
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
            <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full text-[#c9a96e] border border-[#c9a96e]/30 bg-[#c9a96e]/12">
              Balance {formatCurrency(balance)}
            </span>
          )}
          {status === 'unpaid' && (
            <>
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full text-[#c9a96e] border border-[#c9a96e]/30 bg-[#c9a96e]/12">
                <span className="w-1.5 h-1.5 rounded-full bg-current" /> Due {dueText}
              </span>
              <span className="text-xs text-white/60">the {ordinal(dueDay)}</span>
            </>
          )}
        </div>

        {(creditApplied > 0 || creditRemaining > 0) && (
          <div className="mt-3 rounded-xl bg-[#a9e0c3]/15 border border-[#a9e0c3]/25 px-4 py-3">
            {creditApplied > 0 && (
              <p className="text-[13px] text-[#a9e0c3] font-medium">
                {formatCurrency(creditApplied)} credit applied this month
              </p>
            )}
            {creditRemaining > 0 && (
              <p className={`text-[12px] text-white/70 ${creditApplied > 0 ? 'mt-1' : ''}`}>
                {formatCurrency(creditRemaining)} credit available for next month
              </p>
            )}
          </div>
        )}

        {pastDue && (
          <div className="mt-4 rounded-xl bg-[#c0342a]/20 border border-[#c0342a]/30 px-4 py-3 flex items-start gap-2.5">
            <ShieldAlert className="h-4 w-4 text-[#ffb3ad] flex-shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-[13px] font-semibold text-white leading-snug">
                {pastDue.months} {pastDue.months === 1 ? 'month' : 'months'} past due
              </p>
              <p className="text-[12px] text-white/70 leading-snug mt-0.5">
                Outstanding balance: {formatCurrency(pastDue.balance)}
              </p>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={scrollToPay}
          className="mt-5 w-full inline-flex items-center justify-center gap-2 rounded-xl bg-[#c9a96e] text-[#1c3e30] text-sm font-semibold py-3.5 transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_12px_rgba(201,169,110,0.4)]"
        >
          <DollarSign className="h-4 w-4" /> {import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY ? 'Pay now' : 'How to pay'}
        </button>
      </div>
    </div>
  );
}

function QuickActions({ tenant }: { tenant: Tenant }) {
  const { showToast } = useToast();
  const [ecModal, setEcModal] = useState(false);
  const [ecForm, setEcForm] = useState({ name: '', phone: '', relationship: '' });
  const [ecBusy, setEcBusy] = useState(false);
  const [emergencyOverride, setEmergencyOverride] = useState<Tenant['emergencyContact'] | null>(null);

  const emergency = emergencyOverride ?? tenant.emergencyContact;
  const hasEmergency = !!(emergency?.name || emergency?.phone);

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
      setEcModal(false);
      showToast('Emergency contact added.', 'success');
    } catch (err) {
      showToast((err as Error).message || 'Could not save your emergency contact.', 'error');
    } finally {
      setEcBusy(false);
    }
  };

  const actions = [
    { label: 'Request a repair', to: '/portal/maintenance', Icon: Wrench },
    { label: 'Message office', to: '/portal/messages', Icon: MessageSquare },
    { label: 'My documents', to: '/portal/documents', Icon: FileText },
    { label: 'Payment history', to: '/portal/payments', Icon: Clock },
  ];

  return (
    <>
      <div className="grid grid-cols-2 gap-3">
        {/* Contact info tile */}
        <div className="rounded-2xl border border-gold-line bg-surface p-4 shadow-sm">
          <div className="flex items-center gap-2.5 mb-3">
            <span className="w-9 h-9 rounded-xl bg-gold-soft text-gold grid place-items-center flex-shrink-0">
              <User className="h-[18px] w-[18px]" strokeWidth={1.8} />
            </span>
            <span className="text-sm font-semibold text-ink">Contact</span>
          </div>
          <div className="space-y-1.5">
            {tenant.email && (
              <div className="flex items-center gap-2 text-muted">
                <Mail className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="text-xs truncate">{tenant.email}</span>
              </div>
            )}
            {tenant.phone && (
              <div className="flex items-center gap-2 text-muted">
                <Phone className="h-3.5 w-3.5 flex-shrink-0" />
                <span className="text-xs">{formatPhone(tenant.phone)}</span>
              </div>
            )}
            {!tenant.email && !tenant.phone && (
              <p className="text-xs text-muted">Not on file</p>
            )}
          </div>
        </div>

        {/* Emergency contact tile */}
        {hasEmergency ? (
          <div className="rounded-2xl border border-gold-line bg-surface p-4 shadow-sm">
            <div className="flex items-center gap-2.5 mb-3">
              <span className="w-9 h-9 rounded-xl bg-gold-soft text-gold grid place-items-center flex-shrink-0">
                <ShieldAlert className="h-[18px] w-[18px]" strokeWidth={1.8} />
              </span>
              <span className="text-sm font-semibold text-ink">Emergency</span>
            </div>
            <div className="space-y-1.5">
              {emergency?.name && <p className="text-xs font-medium text-ink">{emergency.name}</p>}
              {emergency?.phone && (
                <div className="flex items-center gap-2 text-muted">
                  <Phone className="h-3.5 w-3.5 flex-shrink-0" />
                  <span className="text-xs">{formatPhone(emergency.phone)}</span>
                </div>
              )}
              {emergency?.relationship && (
                <p className="text-xs text-muted">{emergency.relationship}</p>
              )}
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEcModal(true)}
            className="rounded-2xl border border-warning/40 bg-warning-soft p-4 shadow-sm text-left transition hover:-translate-y-0.5"
          >
            <div className="flex items-center gap-2.5 mb-3">
              <span className="w-9 h-9 rounded-xl bg-warning/15 text-warning grid place-items-center flex-shrink-0">
                <ShieldAlert className="h-[18px] w-[18px]" strokeWidth={1.8} />
              </span>
              <span className="text-sm font-semibold text-ink">Emergency</span>
            </div>
            <p className="text-xs text-warning font-medium">Tap to add a contact</p>
          </button>
        )}

        {/* Navigation action tiles */}
        {actions.map((a) => (
          <Link
            key={a.to}
            to={a.to}
            className="flex items-center gap-3 rounded-2xl border border-line bg-surface p-4 shadow-sm transition hover:-translate-y-0.5 hover:border-gold-line"
          >
            <span className="w-9 h-9 rounded-xl bg-gold-soft text-gold grid place-items-center flex-shrink-0">
              <a.Icon className="h-[18px] w-[18px]" strokeWidth={1.8} />
            </span>
            <span className="text-sm font-semibold text-ink leading-tight">{a.label}</span>
          </Link>
        ))}
      </div>

      {/* Emergency contact modal */}
      {ecModal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="fixed inset-0 bg-ink/40 backdrop-blur-sm" onClick={() => setEcModal(false)} />
          <div className="relative w-full max-w-md bg-surface rounded-2xl shadow-xl border border-line p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg text-ink">Add emergency contact</h3>
              <button type="button" onClick={() => setEcModal(false)} className="p-1 rounded-lg hover:bg-canvas">
                <X className="h-5 w-5 text-muted" />
              </button>
            </div>
            <p className="text-sm text-muted">Someone we can reach in case of an emergency at your unit.</p>
            <div className="space-y-3">
              <input
                className="w-full rounded-xl border border-line bg-canvas px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/10"
                placeholder="Full name"
                value={ecForm.name}
                onChange={e => setEcForm({ ...ecForm, name: e.target.value })}
              />
              <input
                className="w-full rounded-xl border border-line bg-canvas px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/10"
                placeholder="Relationship"
                value={ecForm.relationship}
                onChange={e => setEcForm({ ...ecForm, relationship: e.target.value })}
              />
              <input
                className="w-full rounded-xl border border-line bg-canvas px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/10"
                placeholder="Phone number"
                value={formatPhone(ecForm.phone)}
                onChange={e => setEcForm({ ...ecForm, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })}
              />
            </div>
            <div className="flex gap-3 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => setEcModal(false)}>Cancel</Button>
              <Button className="flex-1" disabled={!ecForm.name.trim() || ecBusy} onClick={handleAddEmergency}>
                {ecBusy ? 'Saving...' : 'Save contact'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

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
        <p className="text-[11px] uppercase tracking-[0.18em] font-semibold text-gold mb-2.5">Your home</p>
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
          <Calendar className="h-4 w-4 text-gold flex-shrink-0" />
          <span className="truncate">
            {lease.startDate ? formatDate(lease.startDate) : 'Start date unknown'}
            {lease.leaseType === 'month_to_month'
              ? ' · Month to Month'
              : (lease.endDate ? ` to ${formatDate(lease.endDate)}` : ', ongoing')}
          </span>
          {lease.status === 'active' && (
            <span className="ml-auto flex-shrink-0 text-xs font-semibold px-2.5 py-0.5 rounded-full bg-gold-soft text-gold border border-gold-line">
              Active
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function HowToPayCard({ instructions, memo }: { instructions?: string; memo: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(memo);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard unavailable */ }
  };
  return (
    <Card id="how-to-pay">
      <CardContent className="p-5 space-y-3">
        <h3 className="font-semibold text-ink flex items-center gap-2">
          <DollarSign className="h-4 w-4 text-gold" /> How to pay
        </h3>
        {instructions && <p className="text-sm text-ink">{instructions}</p>}
        {memo && (
          <div className="rounded-lg border border-line bg-canvas p-3 space-y-2">
            <p className="text-[11px] uppercase tracking-[0.18em] font-semibold text-gold">Put this in the memo</p>
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
              {r.phone && <p className="text-muted text-sm">{formatPhone(r.phone)}</p>}
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
        <p className="text-[11px] uppercase tracking-[0.18em] font-semibold text-gold">Who lives here</p>
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
                      {[m.relationship, m.phone ? formatPhone(m.phone) : null].filter(Boolean).join(' · ')}
                    </p>
                  </div>
                </li>
              ))}
              {members.length === 0 && <li className="text-muted text-sm">No one added yet.</li>}
            </ul>
            <div className="grid gap-2 sm:grid-cols-3">
              <input className="rounded-lg border border-line px-3 py-2 text-sm" placeholder="Name" value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} />
              <input className="rounded-lg border border-line px-3 py-2 text-sm" placeholder="Relationship" value={form.relationship} onChange={e => setForm({ ...form, relationship: e.target.value })} />
              <input className="rounded-lg border border-line px-3 py-2 text-sm" placeholder="Phone" value={formatPhone(form.phone)} onChange={e => setForm({ ...form, phone: e.target.value.replace(/\D/g, '').slice(0, 10) })} />
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

function TenantHomeSkeleton() {
  return (
    <div className="space-y-5 animate-in fade-in duration-200">
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
        <Skeleton className="mt-5 h-12 w-full rounded-xl bg-[#c9a96e]/30" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-2xl border border-line bg-surface p-4 flex items-center gap-3">
            <Skeleton className="w-9 h-9 rounded-xl" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
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
