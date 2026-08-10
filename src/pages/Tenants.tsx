import React, { useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import {
  Search, Users, UserCheck, Home, DoorOpen, Mail, Phone, Calendar, DollarSign,
  Plus, Trash2, UserPlus, Check, X, ChevronDown, Download,
} from 'lucide-react';
import { Card, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { formatCurrency, formatDate, todayLocalDate, cn } from '../lib/utils';
import { ProspectiveTenantsPanel } from '../components/ProspectiveTenantsPanel';
import { tenantsApi } from '../lib/api';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { monthlyRevenue, isLeaseExpiringSoon, leasesOwingMonth, settleMonth } from '../lib/rent';
import type { Lease, LeaseStatus, Property, Unit, Tenant } from '../types';

interface PersonRow {
  key: string;
  /** Set once addTenant succeeds for this row, so a retry after a partial
   * failure reuses the person instead of creating a duplicate. */
  tenantId?: string;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
}

let personRowSeq = 0;
function createPersonRow(): PersonRow {
  personRowSeq += 1;
  return { key: `person-${personRowSeq}`, firstName: '', lastName: '', email: '', phone: '' };
}

const emptyTenancyForm = {
  unitId: '',
  startDate: '',
  endDate: '',
  monthlyRent: '',
  securityDeposit: '',
  moveInFeePaid: true,
  notes: '',
  rentDueDay: '',
};

const leaseStatusBadge: Record<LeaseStatus, 'success' | 'warning' | 'secondary'> = {
  active: 'success',
  paused: 'warning',
  ended: 'secondary',
};

const leaseStatusLabel: Record<LeaseStatus, string> = {
  active: 'Active',
  paused: 'Paused',
  ended: 'Ended',
};

export function Tenants() {
  const {
    tenants, properties, units, leases, rentPayments,
    getLeaseTenants, getTenantLeases, getUnitLease,
    addTenant, addLease,
  } = useApp();
  const { showToast } = useToast();
  const { hasPermission } = useAuth();
  const canCreateTenant = hasPermission('tenants_create');
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [searchTerm, setSearchTerm] = useState('');
  // Filter the list to households whose lease is expiring soon. Opens on when
  // the page is reached with ?expiring=1 (from the Dashboard section).
  const [expiringOnly, setExpiringOnly] = useState(searchParams.get('expiring') === '1');
  const today = todayLocalDate();

  const [isAddOpen, setIsAddOpen] = useState(false);
  // Which list we are looking at: current tenants, terminated tenancies, or
  // prospective applicants.
  const [view, setView] = useState<'active' | 'terminated' | 'prospective'>('active');
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Synchronous re-entry guard for handleAddTenancy. isSubmitting (state)
  // only flips the disabled prop after a re-render, so a fast double-click
  // or double-Enter can start a second overlapping submit before that
  // render lands. This ref is set the instant the first submit starts, so
  // the second invocation sees it immediately and bails out.
  const isSubmittingRef = useRef(false);
  const [tenancyForm, setTenancyForm] = useState(emptyTenancyForm);
  const [personRows, setPersonRows] = useState<PersonRow[]>(() => [createPersonRow()]);
  // Invite people with an email to the portal as soon as the tenancy is created,
  // so it's never a forgotten second step. Only those with an email are invited.
  const [inviteOnCreate, setInviteOnCreate] = useState(true);

  const rows = useMemo(() => {
    return tenants.map(tenant => {
      const all = getTenantLeases(tenant.id);
      // The lease to display: the current (active/paused) one, or, for a
      // terminated tenant with no current tenancy, their most recent ended one.
      const current = all.find(l => l.status !== 'ended');
      const ended = current
        ? undefined
        : all.filter(l => l.status === 'ended')
             .sort((a, b) => (b.endDate || b.startDate || '').localeCompare(a.endDate || a.startDate || ''))[0];
      const lease: Lease | undefined = current || ended;
      const property = lease?.propertyId ? properties.find(p => p.id === lease.propertyId) : undefined;
      const unit = lease?.unitId ? units.find(u => u.id === lease.unitId) : undefined;
      const housemates = lease ? getLeaseTenants(lease.id).filter(h => h.id !== tenant.id) : [];
      return { tenant, lease, property, unit, housemates };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenants, leases, properties, units]);

  // One row per household (lease/unit) rather than per person: everyone on the
  // same lease is shown together on a single line. People with no current
  // tenancy each stand alone. Sorted by property then unit. (This replaces the
  // old per-person filteredRows list.)
  interface HouseholdRow {
    key: string;
    lease?: Lease;
    property?: Property;
    unit?: Unit;
    occupants: Tenant[];
  }
  const households = useMemo<HouseholdRow[]>(() => {
    const byLease = new Map<string, HouseholdRow>();
    const singles: HouseholdRow[] = [];
    for (const r of rows) {
      if (r.lease) {
        const g = byLease.get(r.lease.id);
        if (g) g.occupants.push(r.tenant);
        else byLease.set(r.lease.id, { key: r.lease.id, lease: r.lease, property: r.property, unit: r.unit, occupants: [r.tenant] });
      } else {
        singles.push({ key: r.tenant.id, occupants: [r.tenant] });
      }
    }
    const groups = [...byLease.values(), ...singles];
    groups.forEach(g =>
      g.occupants.sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`))
    );
    return groups.sort((a, b) => {
      const an = a.property?.name || '~';
      const bn = b.property?.name || '~';
      if (an !== bn) return an.localeCompare(bn);
      return (a.unit?.unitNumber || '').localeCompare(b.unit?.unitNumber || '');
    });
  }, [rows]);

  // A household is 'terminated' when the lease it shows has ended, 'active' when
  // it has a current lease, or 'unplaced' (no lease) — which sits with active so
  // the terminated tab stays purely former tenants.
  const categoryOf = (g: HouseholdRow): 'active' | 'terminated' | 'unplaced' =>
    g.lease ? (g.lease.status === 'ended' ? 'terminated' : 'active') : 'unplaced';

  const filteredGroups = useMemo(() => {
    // Terminated tab shows only ended tenancies; the current-tenants tab shows
    // everything else (active leases plus not-yet-placed people).
    let list = households.filter(g => {
      const isTerminated = categoryOf(g) === 'terminated';
      return view === 'terminated' ? isTerminated : !isTerminated;
    });
    if (expiringOnly && view === 'active') {
      list = list.filter(g => g.lease && isLeaseExpiringSoon(g.lease, today));
    }
    const q = searchTerm.trim().toLowerCase();
    if (!q) return list;
    return list.filter(g =>
      g.occupants.some(t =>
        `${t.firstName} ${t.lastName}`.toLowerCase().includes(q) ||
        (t.email || '').toLowerCase().includes(q) ||
        (t.phone || '').toLowerCase().includes(q) ||
        // Search the private notes too, so a rent payer (or anyone) recorded
        // in a tenant's notes turns up when you search their name.
        (t.notes || '').toLowerCase().includes(q)
      ) ||
      (g.property?.name || '').toLowerCase().includes(q) ||
      (g.unit ? `unit ${g.unit.unitNumber}`.toLowerCase().includes(q) : false)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [households, searchTerm, expiringOnly, today, view]);

  interface PropertyGroup {
    propertyId: string;
    propertyName: string;
    households: typeof filteredGroups;
  }
  const propertyGroups = useMemo<PropertyGroup[]>(() => {
    const map = new Map<string, PropertyGroup>();
    for (const g of filteredGroups) {
      const pid = g.property?.id || '__none__';
      const pname = g.property?.name || 'Unassigned';
      let grp = map.get(pid);
      if (!grp) {
        grp = { propertyId: pid, propertyName: pname, households: [] };
        map.set(pid, grp);
      }
      grp.households.push(g);
    }
    return [...map.values()].sort((a, b) => a.propertyName.localeCompare(b.propertyName));
  }, [filteredGroups]);

  const [collapsedProps, setCollapsedProps] = useState<Set<string>>(() => {
    try {
      const raw = sessionStorage.getItem('tenants_collapsed');
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch { return new Set(); }
  });
  const toggleProperty = (pid: string) => {
    setCollapsedProps(prev => {
      const next = new Set(prev);
      if (next.has(pid)) next.delete(pid); else next.add(pid);
      sessionStorage.setItem('tenants_collapsed', JSON.stringify([...next]));
      return next;
    });
  };

  const hasActiveSearch = searchTerm.trim().length > 0;
  const isCollapsed = (pid: string) => !hasActiveSearch && collapsedProps.has(pid);

  const highlightMatch = (text: string) => {
    if (!hasActiveSearch || !text) return text;
    const q = searchTerm.trim();
    const idx = text.toLowerCase().indexOf(q.toLowerCase());
    if (idx === -1) return text;
    return (
      <>
        {text.slice(0, idx)}
        <mark className="bg-amber-200/60 text-inherit rounded-sm px-0.5">{text.slice(idx, idx + q.length)}</mark>
        {text.slice(idx + q.length)}
      </>
    );
  };

  // Toggle the expiring-soon filter and keep it in the URL so the view is
  // shareable and survives a refresh.
  const toggleExpiring = () => {
    setExpiringOnly(prev => {
      const next = !prev;
      const params = new URLSearchParams(searchParams);
      if (next) params.set('expiring', '1');
      else params.delete('expiring');
      setSearchParams(params, { replace: true });
      return next;
    });
  };

  // Export active tenants to CSV with rent details for the current month.
  const exportActiveCSV = () => {
    const now = new Date();
    const curMonth = now.getMonth() + 1;
    const curYear = now.getFullYear();
    const owingLeaseIds = new Set(
      leasesOwingMonth(leases, curMonth, curYear).map(l => l.id)
    );

    const csvRows: string[][] = [];
    csvRows.push([
      'Tenant', 'Email', 'Phone', 'Property', 'Unit',
      'Monthly Rent', 'Lease Start', 'Lease End', 'Status',
      `${curMonth}/${curYear} Owed`, `${curMonth}/${curYear} Paid`,
      `${curMonth}/${curYear} Balance`, `${curMonth}/${curYear} Status`,
    ]);

    // Walk active households and emit one row per tenant.
    const activeHouseholds = households.filter(g => categoryOf(g) !== 'terminated');
    for (const group of activeHouseholds) {
      const { lease, property, unit, occupants } = group;
      const propName = property?.name || '';
      const unitNum = unit ? `Unit ${unit.unitNumber}` : '';
      const rent = lease ? formatCurrency(lease.monthlyRent) : '';
      const start = lease?.startDate || '';
      const end = lease?.endDate || '';
      const status = lease ? (lease.status === 'active' ? 'Active' : lease.status === 'paused' ? 'Paused' : lease.status) : 'No tenancy';

      // Current month settlement
      let owed = '', paid = '', balance = '', monthStatus = '';
      if (lease && owingLeaseIds.has(lease.id)) {
        const s = settleMonth(lease, rentPayments, curMonth, curYear);
        owed = formatCurrency(s.due);
        paid = formatCurrency(s.paid);
        balance = formatCurrency(s.balance);
        monthStatus = s.status === 'paid' ? 'Paid' : s.status === 'partial' ? 'Partial' : 'Unpaid';
      } else if (lease) {
        owed = '$0.00';
        paid = '$0.00';
        balance = '$0.00';
        monthStatus = 'N/A';
      }

      for (const t of occupants) {
        csvRows.push([
          `${t.firstName} ${t.lastName}`,
          t.email || '',
          t.phone || '',
          propName,
          unitNum,
          rent,
          start,
          end,
          status,
          owed,
          paid,
          balance,
          monthStatus,
        ]);
      }
    }

    const escaped = csvRows.map(row =>
      row.map(cell => {
        const s = String(cell);
        return s.includes(',') || s.includes('"') || s.includes('\n')
          ? `"${s.replace(/"/g, '""')}"`
          : s;
      }).join(',')
    ).join('\n');

    const blob = new Blob([escaped], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `active-tenants-${curYear}-${String(curMonth).padStart(2, '0')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const stats = useMemo(() => {
    const totalPeople = tenants.length;
    const housed = rows.filter(r => r.lease?.status === 'active').length;
    const expiringSoon = leases.filter(l => isLeaseExpiringSoon(l, today)).length;
    return {
      totalPeople,
      housed,
      expiringSoon,
      revenue: monthlyRevenue(leases),
    };
  }, [tenants, rows, leases, today]);

  // The "Expiring Soon" card doubles as a filter: clicking it narrows the list
  // to households whose lease is expiring soon. `?expiring=1` opens it that way
  // (the Dashboard section links here).
  const statCards = [
    { key: 'total', label: 'Total People', value: stats.totalPeople, icon: <Users />, filter: false },
    { key: 'housed', label: 'Housed', value: stats.housed, icon: <UserCheck />, filter: false },
    { key: 'expiring', label: 'Expiring Soon', value: stats.expiringSoon, icon: <Calendar />, filter: true },
    { key: 'revenue', label: 'Monthly Revenue', value: formatCurrency(stats.revenue), icon: <DollarSign />, filter: false },
  ];

  // A unit is free when its current lease has ended. A paused lease still has
  // people living there (paused just means rent collection is on hold), so it
  // stays blocked to avoid double-booking and double-counted revenue.
  //
  // ALSO include units whose current tenant has a scheduled termination (active
  // lease with endDate + endReason set). These appear in the dropdown labelled
  // with the date they free up, so Belle can pre-schedule a replacement tenant.
  const availableUnits = useMemo(() => {
    return units
      .map(unit => {
        const currentLease = getUnitLease(unit.id);
        const property = properties.find(p => p.id === unit.propertyId);
        if (!currentLease) {
          // Fully free right now.
          return { unit, property, leavingDate: undefined as string | undefined };
        }
        // Scheduled termination: active lease with a future end date + reason.
        if (currentLease.status === 'active' && currentLease.endDate && currentLease.endReason) {
          return { unit, property, leavingDate: currentLease.endDate };
        }
        // Occupied (active or paused, no scheduled termination) — blocked.
        return null;
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [units, leases, properties]);

  const resetTenancyModal = () => {
    setTenancyForm(emptyTenancyForm);
    setPersonRows([createPersonRow()]);
    setInviteOnCreate(true);
  };

  const closeTenancyModal = () => {
    setIsAddOpen(false);
    resetTenancyModal();
  };

  const updatePersonRow = (key: string, patch: Partial<PersonRow>) => {
    setPersonRows(prev => prev.map(row => (row.key === key ? { ...row, ...patch } : row)));
  };

  const addPersonRow = () => {
    setPersonRows(prev => [...prev, createPersonRow()]);
  };

  const removePersonRow = (key: string) => {
    setPersonRows(prev => prev.filter(row => row.key !== key));
  };

  const handleUnitChange = (unitId: string) => {
    const unit = units.find(u => u.id === unitId);
    const avail = availableUnits.find(a => a.unit.id === unitId);
    setTenancyForm(prev => ({
      ...prev,
      unitId,
      // Prefill the unit's listed rent as a starting point, but never
      // overwrite a value the user already typed in.
      monthlyRent: prev.monthlyRent || (unit ? String(unit.monthlyRent) : ''),
      // When picking a unit with a scheduled termination, auto-fill the start
      // date to the day the current tenant leaves so the new lease begins when
      // the old one ends. The user can still adjust it.
      startDate: avail?.leavingDate && !prev.startDate ? avail.leavingDate : prev.startDate,
    }));
  };

  const handleAddTenancy = async (e: React.FormEvent) => {
    e.preventDefault();
    // Bail out immediately if a submit is already in flight. This check has
    // to happen synchronously, before any state update, or a fast
    // double-click/double-Enter can slip a second invocation through while
    // both read the same personRows snapshot (no tenantId yet on either
    // read) and both call addTenant for the same person.
    if (isSubmittingRef.current) return;

    const unit = units.find(u => u.id === tenancyForm.unitId);
    if (!unit) {
      showToast('Please choose a unit.', 'error');
      return;
    }

    // If the unit has a current tenant leaving on a scheduled date, the new
    // lease must start on or after that date to avoid overlap.
    const avail = availableUnits.find(a => a.unit.id === unit.id);
    if (avail?.leavingDate) {
      if (!tenancyForm.startDate) {
        showToast(`This unit is occupied until ${formatDate(avail.leavingDate)}. Please set a start date on or after that.`, 'error');
        return;
      }
      if (tenancyForm.startDate < avail.leavingDate) {
        showToast(`Start date must be on or after ${formatDate(avail.leavingDate)} (current tenant's move-out date).`, 'error');
        return;
      }
    }

    isSubmittingRef.current = true;
    setIsSubmitting(true);
    try {
      // Create each person who doesn't already have an id from a previous,
      // partially failed attempt. Reusing ids on retry means a failed
      // addLease call never leaves duplicate people behind.
      const nextRows = [...personRows];
      for (let i = 0; i < nextRows.length; i++) {
        const row = nextRows[i];
        if (row.tenantId) continue;
        const created = await addTenant({
          firstName: row.firstName.trim(),
          lastName: row.lastName.trim(),
          email: row.email.trim() || undefined,
          phone: row.phone.trim() || undefined,
        });
        nextRows[i] = { ...row, tenantId: created.id };
        setPersonRows([...nextRows]);
      }

      const tenantIds = nextRows.map(row => row.tenantId).filter((id): id is string => !!id);

      await addLease({
        unitId: unit.id,
        propertyId: unit.propertyId,
        startDate: tenancyForm.startDate || undefined,
        endDate: tenancyForm.endDate || undefined,
        monthlyRent: Number(tenancyForm.monthlyRent) || 0,
        securityDeposit: tenancyForm.securityDeposit ? Number(tenancyForm.securityDeposit) : undefined,
        moveInFeePaid: tenancyForm.moveInFeePaid,
        rentDueDay: tenancyForm.rentDueDay ? Number(tenancyForm.rentDueDay) : undefined,
        status: 'active',
        notes: tenancyForm.notes.trim() || undefined,
        tenantIds,
        // A brand new tenancy starts with no pause history; the server
        // stamps this list itself from then on.
        pauses: [],
      });

      // Best-effort portal invites right after the tenancy exists, so onboarding
      // is one step. Only people with an email are invited; a failed invite
      // never fails the tenancy (it can be re-sent from the profile).
      let invited = 0;
      if (inviteOnCreate) {
        for (const row of nextRows) {
          if (!row.tenantId || !row.email.trim()) continue;
          try { await tenantsApi.invite(row.tenantId); invited += 1; } catch { /* re-send from profile */ }
        }
      }

      showToast(
        invited > 0
          ? `Tenancy added. Portal invite sent to ${invited} ${invited === 1 ? 'tenant' : 'tenants'}.`
          : 'Tenancy added.',
        'success'
      );
      closeTenancyModal();
    } catch (err) {
      showToast((err as Error).message, 'error');
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
    }
  };


  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-[26px] sm:text-[32px] font-medium text-ink">Tenants</h1>
          <p className="text-muted mt-1 text-sm">People, their households and where they live.</p>
        </div>
        <div className="flex gap-2 w-full sm:w-auto">
          {view === 'active' && (
            <Button variant="outline" onClick={exportActiveCSV} className="w-full sm:w-auto">
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
          )}
          {canCreateTenant && view === 'active' && (
            <Button onClick={() => setIsAddOpen(true)} className="w-full sm:w-auto">
              <Plus className="h-4 w-4 mr-2" />
              Add Tenancy
            </Button>
          )}
        </div>
      </div>

      {/* Current tenants vs terminated tenancies vs prospective applicants */}
      <div className="flex gap-1 border-b border-line -mt-2">
        {([['active', 'Current tenants'], ['terminated', 'Terminated'], ['prospective', 'Prospective']] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setView(key)}
            className={cn(
              'px-4 py-2.5 text-sm border-b-2 -mb-px transition-colors',
              view === key ? 'border-primary text-ink font-medium' : 'border-transparent text-muted hover:text-ink'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {view === 'prospective' ? (
        <ProspectiveTenantsPanel canCreate={canCreateTenant} />
      ) : (
      <>
      {/* Stats (current tenants only — expiry/revenue don't apply to former tenants) */}
      {view === 'active' && (
      <div className="grid gap-4 sm:gap-6 grid-cols-2 lg:grid-cols-4">
        {statCards.map(s => {
          const active = s.filter && expiringOnly;
          const clickable = s.filter && (stats.expiringSoon > 0 || expiringOnly);
          const inner = (
            <div className="p-5 text-left w-full">
              <div className="flex items-center justify-between">
                <span className="eyebrow">{s.label}</span>
                <span className={`w-9 h-9 rounded-xl grid place-items-center [&_svg]:h-[18px] [&_svg]:w-[18px] ${active ? 'bg-primary text-white' : 'bg-primary-soft text-primary'}`}>{s.icon}</span>
              </div>
              <div className="mt-3 text-[27px] leading-none font-semibold text-ink tnum">{s.value}</div>
              {s.filter && (
                <span className="mt-2 block text-[11px] text-muted">
                  {active ? 'Filtering · click to clear' : clickable ? 'Click to filter' : 'None expiring'}
                </span>
              )}
            </div>
          );
          return clickable ? (
            <Card key={s.key} className={active ? 'ring-2 ring-primary' : 'hover:border-primary/40 transition-colors'}>
              <button type="button" onClick={toggleExpiring} className="w-full">{inner}</button>
            </Card>
          ) : (
            <Card key={s.key}>{inner}</Card>
          );
        })}
      </div>
      )}

      {/* Search */}
      <div className="flex flex-col sm:flex-row gap-3 items-center">
        <div className="relative flex-1 w-full">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-faint" />
          <input
            type="text"
            placeholder="Search by name, email, or phone..."
            className="w-full pl-10 pr-4 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        {expiringOnly && (
          <button
            type="button"
            onClick={toggleExpiring}
            className="flex-shrink-0 inline-flex items-center gap-1.5 text-sm text-primary border border-primary/30 bg-primary-soft rounded-lg px-3 py-2"
          >
            <Calendar className="h-4 w-4" />
            Showing leases expiring soon
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      {/* People table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto sm:overflow-visible">
            <table className="w-full min-w-[860px] sm:min-w-0">
              <thead>
                <tr className="border-b border-line bg-canvas">
                  <th className="text-left py-3 px-4 font-semibold text-ink text-sm">Household</th>
                  <th className="text-left py-3 px-4 font-semibold text-ink text-sm">Property &amp; Unit</th>
                  <th className="text-left py-3 px-4 font-semibold text-ink text-sm">Contact</th>
                  <th className="text-left py-3 px-4 font-semibold text-ink text-sm">Lease Term</th>
                  <th className="text-right py-3 px-4 font-semibold text-ink text-sm">Rent</th>
                  <th className="text-center py-3 px-4 font-semibold text-ink text-sm">Status</th>
                </tr>
              </thead>
              <tbody>
                {propertyGroups.map(pg => {
                  const collapsed = isCollapsed(pg.propertyId);
                  const totalRent = pg.households.reduce((s, h) => s + (h.lease?.monthlyRent || 0), 0);
                  return (
                    <React.Fragment key={pg.propertyId}>
                      {propertyGroups.length > 1 && (
                        <tr
                          className="bg-canvas border-b border-line cursor-pointer select-none"
                          onClick={() => toggleProperty(pg.propertyId)}
                        >
                          <td colSpan={6} className="py-2.5 px-4">
                            <div className="flex items-center gap-2">
                              <ChevronDown className={cn('h-4 w-4 text-muted transition-transform', collapsed && '-rotate-90')} />
                              <Home className="h-4 w-4 text-primary" />
                              <span className="font-semibold text-ink text-sm">{pg.propertyName}</span>
                              <span className="text-xs text-muted">
                                {pg.households.length} {pg.households.length === 1 ? 'household' : 'households'}
                                {totalRent > 0 ? ` · ${formatCurrency(totalRent)}/mo` : ''}
                              </span>
                            </div>
                          </td>
                        </tr>
                      )}
                      {!collapsed && pg.households.map(({ key, lease, property, unit, occupants }) => (
                        <tr
                          key={key}
                          onClick={() => navigate(`/tenants/${occupants[0].id}`)}
                          className="border-b border-line last:border-0 hover:bg-black/[0.02] cursor-pointer align-top"
                        >
                          <td className="py-4 px-4">
                            <div className="flex items-start gap-3">
                              <div className="w-10 h-10 rounded-full bg-primary-soft flex items-center justify-center flex-shrink-0">
                                {occupants.length > 1 ? (
                                  <Users className="h-4 w-4 text-primary" />
                                ) : (
                                  <span className="font-semibold text-primary text-sm">
                                    {occupants[0].firstName[0]}{occupants[0].lastName[0]}
                                  </span>
                                )}
                              </div>
                              <div className="min-w-0">
                                <div className="flex flex-wrap gap-x-1.5">
                                  {occupants.map((t, i) => (
                                    <span key={t.id} className="whitespace-nowrap inline-flex items-center gap-0.5">
                                      <Link
                                        to={`/tenants/${t.id}`}
                                        onClick={(e) => e.stopPropagation()}
                                        className="font-medium text-ink hover:text-primary"
                                      >
                                        {highlightMatch(`${t.firstName} ${t.lastName}`)}
                                      </Link>
                                      {t.verified && (
                                        <Check className="h-3.5 w-3.5 text-positive" aria-label="Verified: has logged in" />
                                      )}{i < occupants.length - 1 ? ',' : ''}
                                    </span>
                                  ))}
                                </div>
                                {occupants.length > 1 && (
                                  <p className="text-xs text-muted mt-0.5">{occupants.length} housemates</p>
                                )}
                              </div>
                            </div>
                          </td>

                          <td className="py-4 px-4">
                            {(() => {
                              const propLabel = property?.name || lease?.endedPropertyLabel;
                              const unitLabel = unit ? `Unit ${unit.unitNumber}` : lease?.endedUnitLabel;
                              return propLabel || unitLabel ? (
                                <div className="space-y-1">
                                  <div className="flex items-center gap-2 text-sm text-ink">
                                    <Home className="h-3.5 w-3.5 text-faint" />
                                    <span>{propLabel ? highlightMatch(propLabel) : '—'}</span>
                                  </div>
                                  <div className="flex items-center gap-2 text-sm text-muted">
                                    <DoorOpen className="h-3.5 w-3.5 text-faint" />
                                    <span>{unitLabel ? highlightMatch(unitLabel) : '—'}</span>
                                  </div>
                                </div>
                              ) : (
                                <span className="text-sm text-faint">—</span>
                              );
                            })()}
                          </td>

                          <td className="py-4 px-4">
                            {occupants.length === 1 ? (
                              <div className="space-y-1">
                                <div className="flex items-center gap-2 text-sm text-muted">
                                  <Mail className="h-3 w-3 text-faint" />
                                  <span className="truncate">{occupants[0].email ? highlightMatch(occupants[0].email) : '—'}</span>
                                </div>
                                <div className="flex items-center gap-2 text-sm text-muted">
                                  <Phone className="h-3 w-3 text-faint" />
                                  <span>{occupants[0].phone ? highlightMatch(occupants[0].phone) : '—'}</span>
                                </div>
                              </div>
                            ) : (
                              <span className="text-sm text-muted">{occupants.length} people</span>
                            )}
                          </td>

                          <td className="py-4 px-4">
                            {lease?.startDate || lease?.endDate ? (
                              <span className="text-sm text-ink">
                                {lease?.startDate ? formatDate(lease.startDate) : '—'} to {lease?.endDate ? formatDate(lease.endDate) : '—'}
                              </span>
                            ) : (
                              <span className="text-sm text-faint">—</span>
                            )}
                          </td>

                          <td className="py-4 px-4 text-right">
                            {lease ? (
                              <p className="font-semibold text-ink tnum">{formatCurrency(lease.monthlyRent)}</p>
                            ) : (
                              <span className="text-sm text-faint">—</span>
                            )}
                          </td>

                          <td className="py-4 px-4 text-center">
                            {lease ? (
                              lease.needsReview ? (
                                <Badge variant="warning">Pending review</Badge>
                              ) : (
                                <div className="inline-flex flex-col items-center gap-1">
                                  <Badge variant={leaseStatusBadge[lease.status]}>{leaseStatusLabel[lease.status]}</Badge>
                                  {lease.status !== 'ended' && lease.startDate && lease.startDate > today && (
                                    <Badge variant="default">Moving in {formatDate(lease.startDate)}</Badge>
                                  )}
                                  {lease.status !== 'ended' && lease.endDate && lease.endReason && (
                                    <Badge variant="warning">Leaving {formatDate(lease.endDate)}</Badge>
                                  )}
                                  {lease.status === 'ended' && lease.endReason && (
                                    <span className="text-[11px] text-muted max-w-[160px] truncate" title={lease.endReason}>
                                      {lease.endReason}
                                    </span>
                                  )}
                                </div>
                              )
                            ) : (
                              <Badge variant="outline">No tenancy</Badge>
                            )}
                          </td>
                        </tr>
                      ))}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          {filteredGroups.length === 0 && (
            <div className="text-center py-16">
              <Users className="h-10 w-10 mx-auto text-faint mb-3" />
              <h3 className="font-medium text-ink">
                {view === 'terminated' ? 'No terminated tenancies' : 'No people found'}
              </h3>
              <p className="text-sm text-muted mt-1">
                {view === 'terminated'
                  ? searchTerm
                    ? 'Try adjusting your search.'
                    : 'Tenancies you terminate will appear here.'
                  : expiringOnly
                    ? 'No leases are expiring in the next 60 days.'
                    : 'Try adjusting your search.'}
              </p>
            </div>
          )}
        </CardContent>
      </Card>
      </>
      )}

      {/* Add Tenancy modal: pick a unit, set the rent once, add one or more people.
          The backdrop click and header X both call onClose directly and aren't
          gated by isSubmitting the way the in-form Cancel button is, so while a
          submit is in flight this is a no-op: otherwise addLease could still
          resolve and silently create a lease after the user thought they'd
          cancelled, and the abandoned closure's setPersonRows call could
          clobber whatever the user typed after reopening the modal. */}
      <Modal
        isOpen={isAddOpen}
        onClose={isSubmitting ? () => {} : closeTenancyModal}
        title="Add Tenancy"
        size="xl"
      >
        <form onSubmit={handleAddTenancy} className="space-y-6">
          <div className="space-y-4">
            <h3 className="font-semibold text-ink">The tenancy</h3>

            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">Unit *</label>
              <select
                required
                className="w-full px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
                value={tenancyForm.unitId}
                onChange={(e) => handleUnitChange(e.target.value)}
              >
                <option value="">Select a unit</option>
                {availableUnits.map(({ unit, property, leavingDate }) => (
                  <option key={unit.id} value={unit.id}>
                    {property ? `${property.name}, Unit ${unit.unitNumber}` : `Unit ${unit.unitNumber}`}
                    {leavingDate ? ` — available ${leavingDate}` : ''}
                  </option>
                ))}
              </select>
              {availableUnits.length === 0 && (
                <p className="text-xs text-muted mt-1.5">No units are free right now. Every unit already has an active tenancy.</p>
              )}
              {tenancyForm.unitId && availableUnits.find(a => a.unit.id === tenancyForm.unitId)?.leavingDate && (
                <p className="text-xs text-amber-600 mt-1.5">
                  This unit has a tenant leaving on {formatDate(availableUnits.find(a => a.unit.id === tenancyForm.unitId)!.leavingDate!)}.
                  The new lease must start on or after that date.
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-ink mb-1.5">Start Date</label>
                <input
                  type="date"
                  className="w-full px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
                  value={tenancyForm.startDate}
                  onChange={(e) => setTenancyForm({ ...tenancyForm, startDate: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1.5">End Date</label>
                <input
                  type="date"
                  className="w-full px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
                  value={tenancyForm.endDate}
                  onChange={(e) => setTenancyForm({ ...tenancyForm, endDate: e.target.value })}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-ink mb-1.5">Monthly Rent *</label>
                <input
                  type="number"
                  required
                  min={0}
                  step="0.01"
                  className="w-full px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
                  value={tenancyForm.monthlyRent}
                  onChange={(e) => setTenancyForm({ ...tenancyForm, monthlyRent: e.target.value })}
                  placeholder="0.00"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1.5">Move-In Fee</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className="w-full px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
                  value={tenancyForm.securityDeposit}
                  onChange={(e) => setTenancyForm({ ...tenancyForm, securityDeposit: e.target.value })}
                  placeholder="0.00"
                />
                <label className="mt-2 flex items-center gap-2 text-sm text-ink cursor-pointer">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-line-strong"
                    checked={tenancyForm.moveInFeePaid}
                    onChange={(e) => setTenancyForm({ ...tenancyForm, moveInFeePaid: e.target.checked })}
                  />
                  Move-in fee already paid
                </label>
                {!tenancyForm.moveInFeePaid && tenancyForm.securityDeposit && (
                  <p className="text-xs text-muted mt-1">Will show as owed on their record until you mark it paid.</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-ink mb-1.5">Rent Due Day</label>
                <input
                  type="number"
                  min={1}
                  max={31}
                  className="w-full px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
                  value={tenancyForm.rentDueDay}
                  onChange={(e) => setTenancyForm({ ...tenancyForm, rentDueDay: e.target.value })}
                  placeholder="Global default"
                />
                <p className="text-xs text-muted mt-1">Leave blank to use the global setting from Settings.</p>
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">Notes</label>
              <textarea
                rows={2}
                className="w-full px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
                value={tenancyForm.notes}
                onChange={(e) => setTenancyForm({ ...tenancyForm, notes: e.target.value })}
                placeholder="Any additional notes..."
              />
            </div>
          </div>

          <hr className="border-line" />

          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-ink">The people</h3>
              <button
                type="button"
                onClick={addPersonRow}
                className="text-sm font-medium text-primary hover:text-primary-hover flex items-center gap-1.5"
              >
                <UserPlus className="h-4 w-4" />
                Add another person
              </button>
            </div>

            {personRows.map((row, index) => (
              <div key={row.key} className="border border-line rounded-lg p-4 space-y-3 relative">
                {index > 0 && (
                  <button
                    type="button"
                    onClick={() => removePersonRow(row.key)}
                    className="absolute top-3 right-3 p-1 text-faint hover:text-danger hover:bg-danger-soft rounded transition-colors"
                    title="Remove person"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
                <p className="eyebrow">Person {index + 1}</p>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-ink mb-1.5">First Name *</label>
                    <input
                      type="text"
                      required
                      className="w-full px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
                      value={row.firstName}
                      onChange={(e) => updatePersonRow(row.key, { firstName: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-ink mb-1.5">Last Name *</label>
                    <input
                      type="text"
                      required
                      className="w-full px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
                      value={row.lastName}
                      onChange={(e) => updatePersonRow(row.key, { lastName: e.target.value })}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-ink mb-1.5">Email</label>
                    <input
                      type="email"
                      className="w-full px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
                      value={row.email}
                      onChange={(e) => updatePersonRow(row.key, { email: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-ink mb-1.5">Phone</label>
                    <input
                      type="tel"
                      className="w-full px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
                      value={row.phone}
                      onChange={(e) => updatePersonRow(row.key, { phone: e.target.value })}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>

          <label className="flex items-start gap-2.5 rounded-lg border border-line p-3 cursor-pointer">
            <input
              type="checkbox"
              className="mt-0.5"
              checked={inviteOnCreate}
              onChange={(e) => setInviteOnCreate(e.target.checked)}
            />
            <span className="text-sm text-ink">
              Invite to the tenant portal now
              <span className="block text-xs text-muted">Emails a set-password link to anyone above with an email address.</span>
            </span>
          </label>

          <div className="flex gap-3 pt-2">
            <Button type="button" variant="outline" className="flex-1" onClick={closeTenancyModal} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="submit" className="flex-1" disabled={isSubmitting}>
              {isSubmitting ? 'Saving...' : 'Add Tenancy'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
