import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Search, Users, UserCheck, Home, DoorOpen, Mail, Phone, Calendar, DollarSign,
  Plus, MoreVertical, Trash2, UserPlus,
} from 'lucide-react';
import { Card, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Modal } from '../components/ui/Modal';
import { formatCurrency, formatDate, todayLocalDate, parseLocalDate } from '../lib/utils';
import { tenantsApi } from '../lib/api';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { monthlyRevenue } from '../lib/rent';
import type { Lease, LeaseStatus } from '../types';

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
  notes: '',
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

const DAY_MS = 1000 * 60 * 60 * 24;

export function Tenants() {
  const {
    tenants, properties, units, leases,
    getLeaseTenants, getTenantLeases, getUnitLease,
    addTenant, addLease, updateLease,
  } = useApp();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');

  const [isAddOpen, setIsAddOpen] = useState(false);
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
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);

  const rows = useMemo(() => {
    return tenants.map(tenant => {
      const lease: Lease | undefined = getTenantLeases(tenant.id).find(l => l.status !== 'ended');
      const property = lease?.propertyId ? properties.find(p => p.id === lease.propertyId) : undefined;
      const unit = lease?.unitId ? units.find(u => u.id === lease.unitId) : undefined;
      const housemates = lease ? getLeaseTenants(lease.id).filter(h => h.id !== tenant.id) : [];
      return { tenant, lease, property, unit, housemates };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenants, leases, properties, units]);

  const filteredRows = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(({ tenant }) => {
      const fullName = `${tenant.firstName} ${tenant.lastName}`.toLowerCase();
      return (
        fullName.includes(q) ||
        (tenant.email || '').toLowerCase().includes(q) ||
        (tenant.phone || '').toLowerCase().includes(q)
      );
    });
  }, [rows, searchTerm]);

  const stats = useMemo(() => {
    const totalPeople = tenants.length;
    const housed = rows.filter(r => r.lease?.status === 'active').length;
    const today = new Date();
    const expiringSoon = leases.filter(l => {
      if (l.status !== 'active' || !l.endDate) return false;
      const daysUntilEnd = Math.ceil((parseLocalDate(l.endDate).getTime() - today.getTime()) / DAY_MS);
      return daysUntilEnd > 0 && daysUntilEnd <= 60;
    }).length;
    return {
      totalPeople,
      housed,
      expiringSoon,
      revenue: monthlyRevenue(leases),
    };
  }, [tenants, rows, leases]);

  const statCards = [
    { label: 'Total People', value: stats.totalPeople, icon: <Users /> },
    { label: 'Housed', value: stats.housed, icon: <UserCheck /> },
    { label: 'Expiring Soon', value: stats.expiringSoon, icon: <Calendar /> },
    { label: 'Monthly Revenue', value: formatCurrency(stats.revenue), icon: <DollarSign /> },
  ];

  // A unit is only free for a brand new tenancy once its current lease has
  // ended. A paused lease still has people living there (paused just means
  // rent collection is on hold), so it must keep the unit off this list, or
  // resuming that lease later would leave the unit double booked and
  // monthlyRevenue would double count its rent. getUnitLease already excludes
  // ended leases, so any lease it returns (active or paused) blocks the unit.
  const availableUnits = useMemo(() => {
    return units
      .filter(unit => !getUnitLease(unit.id))
      .map(unit => ({ unit, property: properties.find(p => p.id === unit.propertyId) }));
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
    setTenancyForm(prev => ({
      ...prev,
      unitId,
      // Prefill the unit's listed rent as a starting point, but never
      // overwrite a value the user already typed in.
      monthlyRent: prev.monthlyRent || (unit ? String(unit.monthlyRent) : ''),
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

  const handleLeaseStatusChange = async (lease: Lease, status: LeaseStatus, confirmMessage: string, successMessage: string) => {
    setOpenMenuId(null);
    if (!confirm(confirmMessage)) return;
    try {
      // Neither action prompts for a date, so today is the only date the
      // owner could mean. Ending stamps endDate (so leasesOwingMonth stops
      // billing this lease from next month on, instead of it being billed
      // forever on a blank or future endDate). Pause and resume intervals
      // are no longer stamped here at all: the server records them itself
      // off statusChangedOn, so the client can't forget to or disagree with
      // the database. The PUT still overwrites every column rather than
      // merging, so the full lease object goes along regardless.
      const today = todayLocalDate();
      const dateFields: Partial<Lease> = status === 'ended' ? { endDate: today } : {};
      await updateLease({ ...lease, ...dateFields, status, statusChangedOn: today });
      showToast(successMessage, 'success');
    } catch (err) {
      showToast((err as Error).message, 'error');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-[26px] sm:text-[32px] font-medium text-ink">Tenants</h1>
          <p className="text-muted mt-1 text-sm">People, their households and where they live.</p>
        </div>
        <Button onClick={() => setIsAddOpen(true)} className="w-full sm:w-auto">
          <Plus className="h-4 w-4 mr-2" />
          Add Tenancy
        </Button>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:gap-6 grid-cols-2 lg:grid-cols-4">
        {statCards.map(s => (
          <Card key={s.label}>
            <div className="p-5">
              <div className="flex items-center justify-between">
                <span className="eyebrow">{s.label}</span>
                <span className="text-faint [&_svg]:h-[18px] [&_svg]:w-[18px]">{s.icon}</span>
              </div>
              <div className="mt-3 font-display text-[27px] leading-none font-medium text-ink tnum">{s.value}</div>
            </div>
          </Card>
        ))}
      </div>

      {/* Search */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-faint" />
          <input
            type="text"
            placeholder="Search by name, email, or phone..."
            className="w-full pl-10 pr-4 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* People table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto sm:overflow-visible">
            <table className="w-full min-w-[860px] sm:min-w-0">
              <thead>
                <tr className="border-b border-line bg-canvas">
                  <th className="text-left py-3 px-4 font-semibold text-ink text-sm">Person</th>
                  <th className="text-left py-3 px-4 font-semibold text-ink text-sm">Property &amp; Unit</th>
                  <th className="text-left py-3 px-4 font-semibold text-ink text-sm">Contact</th>
                  <th className="text-left py-3 px-4 font-semibold text-ink text-sm">Lease Term</th>
                  <th className="text-right py-3 px-4 font-semibold text-ink text-sm">Rent</th>
                  <th className="text-center py-3 px-4 font-semibold text-ink text-sm">Status</th>
                  <th className="w-12 py-3 px-4"><span className="sr-only">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map(({ tenant, lease, property, unit, housemates }) => (
                  <tr
                    key={tenant.id}
                    onClick={() => navigate(`/tenants/${tenant.id}`)}
                    className="border-b border-line last:border-0 hover:bg-black/[0.02] cursor-pointer"
                  >
                    <td className="py-4 px-4">
                      <Link
                        to={`/tenants/${tenant.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-3"
                      >
                        <div className="w-10 h-10 rounded-full bg-primary-soft flex items-center justify-center flex-shrink-0">
                          <span className="font-semibold text-primary text-sm">
                            {tenant.firstName[0]}{tenant.lastName[0]}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-ink truncate">{tenant.firstName} {tenant.lastName}</p>
                          {housemates.length > 0 && (
                            <p className="text-xs text-muted truncate">
                              with {housemates.map(h => `${h.firstName} ${h.lastName}`).join(', ')}
                            </p>
                          )}
                        </div>
                      </Link>
                    </td>

                    <td className="py-4 px-4">
                      {property || unit ? (
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 text-sm text-ink">
                            <Home className="h-3.5 w-3.5 text-faint" />
                            <span>{property?.name || '—'}</span>
                          </div>
                          <div className="flex items-center gap-2 text-sm text-muted">
                            <DoorOpen className="h-3.5 w-3.5 text-faint" />
                            <span>{unit ? `Unit ${unit.unitNumber}` : '—'}</span>
                          </div>
                        </div>
                      ) : (
                        <span className="text-sm text-faint">—</span>
                      )}
                    </td>

                    <td className="py-4 px-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-sm text-muted">
                          <Mail className="h-3 w-3 text-faint" />
                          <span className="truncate">{tenant.email || '—'}</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-muted">
                          <Phone className="h-3 w-3 text-faint" />
                          <span>{tenant.phone || '—'}</span>
                        </div>
                      </div>
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
                        <Badge variant={leaseStatusBadge[lease.status]}>{leaseStatusLabel[lease.status]}</Badge>
                      ) : (
                        <Badge variant="outline">No tenancy</Badge>
                      )}
                    </td>

                    <td className="py-4 px-4 text-right" onClick={(e) => e.stopPropagation()}>
                      {lease ? (
                        <div className="relative inline-block">
                          <button
                            type="button"
                            onClick={() => setOpenMenuId(openMenuId === tenant.id ? null : tenant.id)}
                            className="p-1.5 hover:bg-black/[0.05] rounded-lg transition-colors"
                          >
                            <MoreVertical className="h-4 w-4 text-faint" />
                          </button>
                          {openMenuId === tenant.id && (
                            <div className="absolute right-0 z-20 mt-1 w-48 rounded-lg border border-line bg-surface shadow-[0_12px_28px_-8px_rgba(27,26,23,0.28)] py-1">
                              {lease.status === 'active' && (
                                <button
                                  type="button"
                                  onClick={() => handleLeaseStatusChange(
                                    lease,
                                    'paused',
                                    'Pause rent for this tenancy? You can resume it later.',
                                    'Rent paused.'
                                  )}
                                  className="w-full text-left px-3 py-2 text-sm text-ink hover:bg-black/[0.04]"
                                >
                                  Pause rent
                                </button>
                              )}
                              {lease.status === 'paused' && (
                                <button
                                  type="button"
                                  onClick={() => handleLeaseStatusChange(
                                    lease,
                                    'active',
                                    'Resume this tenancy?',
                                    'Tenancy resumed.'
                                  )}
                                  className="w-full text-left px-3 py-2 text-sm text-ink hover:bg-black/[0.04]"
                                >
                                  Resume
                                </button>
                              )}
                              {lease.status !== 'ended' && (
                                <button
                                  type="button"
                                  onClick={() => handleLeaseStatusChange(
                                    lease,
                                    'ended',
                                    'End this tenancy? This cannot be undone.',
                                    'Tenancy ended.'
                                  )}
                                  className="w-full text-left px-3 py-2 text-sm text-danger hover:bg-danger-soft"
                                >
                                  End tenancy
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      ) : (
                        <span className="text-sm text-faint">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filteredRows.length === 0 && (
            <div className="text-center py-16">
              <Users className="h-10 w-10 mx-auto text-faint mb-3" />
              <h3 className="font-medium text-ink">No people found</h3>
              <p className="text-sm text-muted mt-1">Try adjusting your search.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Click anywhere outside an open row menu to close it. */}
      {openMenuId && (
        <div className="fixed inset-0 z-10" onClick={() => setOpenMenuId(null)} />
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
                {availableUnits.map(({ unit, property }) => (
                  <option key={unit.id} value={unit.id}>
                    {property ? `${property.name}, Unit ${unit.unitNumber}` : `Unit ${unit.unitNumber}`}
                  </option>
                ))}
              </select>
              {availableUnits.length === 0 && (
                <p className="text-xs text-muted mt-1.5">No units are free right now. Every unit already has an active tenancy.</p>
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
                <label className="block text-sm font-medium text-ink mb-1.5">Security Deposit</label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  className="w-full px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
                  value={tenancyForm.securityDeposit}
                  onChange={(e) => setTenancyForm({ ...tenancyForm, securityDeposit: e.target.value })}
                  placeholder="0.00"
                />
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
