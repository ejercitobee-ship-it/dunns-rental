import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft, Building, Home, MapPin, Calendar, DollarSign,
  FileText, Users, ChevronDown, ChevronRight,
  Download, Zap, Droplets, Flame, Plus, Pencil, Trash2,
  ShieldCheck, AlertTriangle, XCircle, X,
} from 'lucide-react';
import { Card, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Skeleton, StatCardSkeleton } from '../components/ui/Skeleton';
import { formatCurrency, formatDate } from '../lib/utils';
import { expenseCategoryLabel } from '../lib/financials';
import { TransactionDrillDown } from '../components/TransactionDrillDown';
import { propertiesApi, capitalProjectsApi, appliancesApi } from '../lib/api';
import { HardHat } from 'lucide-react';
import { useToast } from '../context/ToastContext';
import type { PropertyProfile as ProfileData, CapitalProject, ApplianceType, ApplianceCondition } from '../types';
import { PropertyNotes } from '../components/PropertyNotes';
import { ActivityTimeline } from '../components/ActivityTimeline';

const tabs = ['Overview', 'Financials', 'Tenants', 'Maintenance', 'Appliances', 'Documents', 'Notes', 'Activity'] as const;

const APPLIANCE_TYPE_LABELS: Record<ApplianceType, string> = {
  refrigerator: 'Refrigerator',
  stove_oven: 'Stove / Oven',
  dishwasher: 'Dishwasher',
  washer: 'Washer',
  dryer: 'Dryer',
  hvac: 'HVAC',
  water_heater: 'Water Heater',
  microwave: 'Microwave',
  garbage_disposal: 'Garbage Disposal',
  furnace: 'Furnace',
  air_conditioner: 'Air Conditioner',
  range_hood: 'Range Hood',
  freezer: 'Freezer',
  other: 'Other',
};

const APPLIANCE_TYPES: ApplianceType[] = Object.keys(APPLIANCE_TYPE_LABELS) as ApplianceType[];

const CONDITION_LABELS: Record<ApplianceCondition, string> = {
  excellent: 'Excellent',
  good: 'Good',
  fair: 'Fair',
  replace_soon: 'Replace Soon',
};

const CONDITION_VARIANTS: Record<ApplianceCondition, 'success' | 'secondary' | 'warning' | 'destructive'> = {
  excellent: 'success',
  good: 'secondary',
  fair: 'warning',
  replace_soon: 'destructive',
};

function warrantyStatus(expDate?: string): { label: string; variant: 'success' | 'warning' | 'destructive' | 'secondary'; icon: typeof ShieldCheck } {
  if (!expDate) return { label: 'No warranty', variant: 'secondary', icon: XCircle };
  const now = new Date();
  const exp = new Date(expDate + 'T00:00:00');
  const diffMs = exp.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return { label: 'Expired', variant: 'destructive', icon: XCircle };
  if (diffDays <= 90) return { label: `Expires in ${diffDays}d`, variant: 'warning', icon: AlertTriangle };
  return { label: 'Active', variant: 'success', icon: ShieldCheck };
}

/** Collapsible section used inside the Financials tab. */
function CollapsibleSection({ title, icon, badge, defaultOpen = false, children }: {
  title: string;
  icon?: React.ReactNode;
  badge?: string;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <Card>
      <button
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between p-5 text-left hover:bg-canvas/50 transition-colors"
      >
        <h2 className="font-semibold text-ink flex items-center gap-2">
          {icon}
          {title}
          {badge && <span className="text-xs font-normal text-muted">({badge})</span>}
        </h2>
        {open ? <ChevronDown className="h-4 w-4 text-muted" /> : <ChevronRight className="h-4 w-4 text-muted" />}
      </button>
      {open && <CardContent className="px-5 pb-5 pt-0 space-y-4">{children}</CardContent>}
    </Card>
  );
}
type Tab = typeof tabs[number];

const maintenanceStatusBadge: Record<string, 'success' | 'warning' | 'secondary' | 'destructive'> = {
  completed: 'success',
  in_progress: 'warning',
  scheduled: 'warning',
  assigned: 'secondary',
  submitted: 'destructive',
  paid: 'success',
};

const utilityIcons: Record<string, typeof Zap> = {
  electric: Zap,
  water: Droplets,
  gas: Flame,
};

export function PropertyProfile() {
  const { id } = useParams<{ id: string }>();
  const { showToast } = useToast();
  const [data, setData] = useState<ProfileData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('Overview');
  const [financialYear, setFinancialYear] = useState(String(new Date().getFullYear()));
  const [expandedLeases, setExpandedLeases] = useState<Set<string>>(new Set());
  const [drillTitle, setDrillTitle] = useState('');
  const [drillExpenses, setDrillExpenses] = useState<ProfileData['expenses']>([]);
  const [drillOpen, setDrillOpen] = useState(false);
  const [capitalProjects, setCapitalProjects] = useState<CapitalProject[]>([]);

  // Fetch capital projects for this property.
  useEffect(() => {
    if (!id) return;
    capitalProjectsApi.list()
      .then(all => setCapitalProjects(all.filter(p => p.propertyId === id)))
      .catch(() => {});
  }, [id]);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    setError(null);
    propertiesApi.getProfile(id)
      .then(d => setData(d))
      .catch(err => {
        const msg = (err as Error).message || 'Could not load property profile.';
        setError(msg);
        showToast(msg, 'error');
      })
      .finally(() => setLoading(false));
  }, [id]);

  // Derived data
  const financialYears = useMemo(() => {
    if (!data) return [];
    return Object.keys(data.financialSummary).sort((a, b) => Number(b) - Number(a));
  }, [data]);

  const activeLeases = useMemo(() => {
    if (!data) return [];
    return data.leases.filter(l => l.status === 'active' && l.renewalStatus !== 'pending');
  }, [data]);

  const endedLeases = useMemo(() => {
    if (!data) return [];
    return data.leases.filter(l => l.status === 'ended');
  }, [data]);

  const yearExpenses = useMemo(() => {
    if (!data) return [];
    return data.expenses.filter(e => e.date.startsWith(financialYear));
  }, [data, financialYear]);

  const yearPayments = useMemo(() => {
    if (!data) return [];
    return data.rentPayments.filter(rp => String(rp.year) === financialYear && rp.status === 'paid');
  }, [data, financialYear]);

  /** Expense breakdown by category for the selected year. */
  const categoryBreakdown = useMemo(() => {
    const totals: Record<string, number> = {};
    for (const e of yearExpenses) {
      totals[e.category] = (totals[e.category] || 0) + e.amount;
    }
    return Object.entries(totals)
      .map(([cat, total]) => ({ category: cat, label: expenseCategoryLabel(cat), total }))
      .sort((a, b) => b.total - a.total);
  }, [yearExpenses]);

  /** Quick unit-id → unit-number lookup for the expense table. */
  const unitLabel = useMemo(() => {
    if (!data) return new Map<string, string>();
    return new Map(data.units.map(u => [u.id, `Unit ${u.unitNumber}`]));
  }, [data]);

  /** HOA expenses for the selected year. */
  const hoaExpenses = useMemo(() => yearExpenses.filter(e => e.category === 'hoa'), [yearExpenses]);
  const hoaTotal = useMemo(() => hoaExpenses.reduce((sum, e) => sum + e.amount, 0), [hoaExpenses]);

  const totalMonthlyRent = useMemo(() => {
    return activeLeases.reduce((sum, l) => sum + (l.monthlyRent || 0), 0);
  }, [activeLeases]);

  const occupiedUnits = useMemo(() => {
    if (!data) return 0;
    const unitIdsWithActiveLease = new Set(activeLeases.map(l => l.unitId).filter(Boolean));
    return unitIdsWithActiveLease.size;
  }, [data, activeLeases]);

  if (loading) return <ProfileSkeleton />;
  if (!data) return (
    <div className="text-center py-20 space-y-3">
      <p className="text-muted">{error || 'Property not found.'}</p>
      <Link to="/properties" className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to properties
      </Link>
    </div>
  );

  const { property, units, maintenance, documents, utilityAccounts, calendarEvents } = data;

  const toggleLease = (leaseId: string) => {
    setExpandedLeases(prev => {
      const next = new Set(prev);
      next.has(leaseId) ? next.delete(leaseId) : next.add(leaseId);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start gap-4">
        <Link to="/properties" className="mt-1 p-1.5 rounded-lg hover:bg-line/50 text-muted hover:text-ink transition-colors">
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="flex-1 min-w-0">
          <p className="eyebrow !text-[10px]">Property</p>
          <h1 className="font-display text-[26px] sm:text-[30px] text-ink">{property.name}</h1>
          <div className="flex items-center gap-2 mt-1 text-sm text-muted">
            <MapPin className="h-3.5 w-3.5" />
            <span>{property.address}, {property.city}, {property.state} {property.zipCode}</span>
          </div>
        </div>
        <Badge variant="secondary">{property.type}</Badge>
      </div>

      {/* Quick stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <StatCard label="Units" value={String(units.length)} icon={Building} />
        <StatCard label="Occupied" value={`${occupiedUnits}/${units.length}`} icon={Home} />
        <StatCard label="Monthly Rent" value={formatCurrency(totalMonthlyRent)} icon={DollarSign} />
        <StatCard
          label="Occupancy"
          value={units.length > 0 ? `${Math.round((occupiedUnits / units.length) * 100)}%` : 'N/A'}
          icon={Users}
        />
      </div>

      {/* Tabs */}
      <div className="border-b border-line">
        <nav className="flex gap-1 overflow-x-auto" role="tablist">
          {tabs.map(tab => (
            <button
              key={tab}
              role="tab"
              aria-selected={activeTab === tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted hover:text-ink hover:border-line-strong'
              }`}
            >
              {tab}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab content */}
      {activeTab === 'Overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Property details */}
          <Card>
            <CardContent className="p-5 space-y-4">
              <h2 className="font-semibold text-ink">Property Details</h2>
              <dl className="space-y-3 text-sm">
                {property.purchaseDate && (
                  <Row label="Purchase Date" value={formatDate(property.purchaseDate)} />
                )}
                {property.purchasePrice != null && (
                  <Row label="Purchase Price" value={formatCurrency(property.purchasePrice)} />
                )}
                {property.landValue != null && (
                  <Row label="Land Value" value={formatCurrency(property.landValue)} />
                )}
                {property.description && (
                  <Row label="Description" value={property.description} />
                )}
              </dl>
            </CardContent>
          </Card>

          {/* Units */}
          <Card>
            <CardContent className="p-5 space-y-4">
              <h2 className="font-semibold text-ink">Units ({units.length})</h2>
              {units.length === 0 ? (
                <p className="text-sm text-muted">No units configured.</p>
              ) : (
                <div className="space-y-2">
                  {units.map(u => {
                    const activeLease = activeLeases.find(l => l.unitId === u.id);
                    return (
                      <div key={u.id} className="flex items-center justify-between p-3 rounded-lg bg-canvas border border-line">
                        <div>
                          <span className="font-medium text-sm text-ink">{u.unitNumber}</span>
                          <div className="text-xs text-muted">
                            {[
                              u.bedrooms != null && `${u.bedrooms} bed`,
                              u.bathrooms != null && `${u.bathrooms} bath`,
                              u.squareFeet && `${u.squareFeet} sqft`,
                            ].filter(Boolean).join(' · ')}
                          </div>
                        </div>
                        <div className="text-right">
                          {activeLease ? (
                            <Badge variant="success">Occupied</Badge>
                          ) : (
                            <Badge variant="secondary">Vacant</Badge>
                          )}
                          {u.monthlyRent != null && (
                            <div className="text-xs text-muted mt-0.5 tnum">{formatCurrency(u.monthlyRent)}/mo</div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Utility Accounts */}
          {utilityAccounts.length > 0 && (
            <Card>
              <CardContent className="p-5 space-y-4">
                <h2 className="font-semibold text-ink">Utility Accounts</h2>
                <div className="space-y-2">
                  {utilityAccounts.map(ua => {
                    const Icon = utilityIcons[ua.utilityType] || Zap;
                    return (
                      <div key={ua.id} className="flex items-center gap-3 p-3 rounded-lg bg-canvas border border-line">
                        <Icon className="h-4 w-4 text-muted flex-shrink-0" />
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-ink capitalize">{ua.utilityType}</div>
                          {ua.provider && <div className="text-xs text-muted">{ua.provider}</div>}
                        </div>
                        {ua.accountNumber && (
                          <span className="text-xs text-muted tnum">#{ua.accountNumber}</span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Upcoming Events */}
          {calendarEvents.length > 0 && (
            <Card>
              <CardContent className="p-5 space-y-4">
                <h2 className="font-semibold text-ink">Upcoming Events</h2>
                <div className="space-y-2">
                  {calendarEvents.slice(0, 5).map(ev => (
                    <div key={ev.id} className="flex items-center gap-3 p-3 rounded-lg bg-canvas border border-line">
                      <Calendar className="h-4 w-4 text-muted flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-ink">{ev.title}</div>
                        {ev.startDate && <div className="text-xs text-muted">{formatDate(ev.startDate)}</div>}
                      </div>
                      {ev.category && (
                        <Badge variant="secondary">{ev.category === 'hoa' ? 'HOA' : ev.category.replace(/_/g, ' ')}</Badge>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {activeTab === 'Financials' && (
        <div className="space-y-6">
          {/* Year selector */}
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-muted">Year</label>
            <select
              value={financialYear}
              onChange={e => setFinancialYear(e.target.value)}
              className="rounded-lg border border-line bg-surface px-3 py-1.5 text-sm text-ink"
            >
              {financialYears.map(yr => (
                <option key={yr} value={yr}>{yr}</option>
              ))}
              {financialYears.length === 0 && <option value={String(new Date().getFullYear())}>{new Date().getFullYear()}</option>}
            </select>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card>
              <CardContent className="p-5">
                <p className="eyebrow mb-1">Total Income</p>
                <p className="text-xl font-bold font-display text-positive tnum">
                  {formatCurrency(data.financialSummary[financialYear]?.income || 0)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <p className="eyebrow mb-1">Total Expenses</p>
                <p className="text-xl font-bold font-display text-danger tnum">
                  {formatCurrency(data.financialSummary[financialYear]?.expenses || 0)}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="p-5">
                <p className="eyebrow mb-1">Net Income</p>
                <p className={`text-xl font-bold font-display tnum ${
                  (data.financialSummary[financialYear]?.net || 0) >= 0 ? 'text-positive' : 'text-danger'
                }`}>
                  {formatCurrency(data.financialSummary[financialYear]?.net || 0)}
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Expense Breakdown by Category — always visible */}
          {categoryBreakdown.length > 0 && (
            <Card>
              <CardContent className="p-5 space-y-4">
                <h2 className="font-semibold text-ink">Expense Breakdown ({financialYear})</h2>
                <div className="space-y-2">
                  {categoryBreakdown.map(({ category, label, total }) => {
                    const totalExpenses = data.financialSummary[financialYear]?.expenses || 1;
                    const pct = totalExpenses > 0 ? Math.round((total / totalExpenses) * 100) : 0;
                    return (
                      <button
                        key={category}
                        className="flex items-center gap-3 w-full text-left hover:bg-black/[0.02] rounded-lg px-1 py-0.5 -mx-1 transition-colors"
                        onClick={() => {
                          setDrillTitle(`${label} Expenses`);
                          setDrillExpenses(yearExpenses.filter(e => e.category === category));
                          setDrillOpen(true);
                        }}
                      >
                        <div className="w-32 text-sm font-medium text-ink truncate">{label}</div>
                        <div className="flex-1 bg-canvas rounded-full h-3 overflow-hidden">
                          <div
                            className="h-full bg-primary rounded-full transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <div className="w-24 text-right text-sm tnum font-medium text-ink">{formatCurrency(total)}</div>
                        <div className="w-10 text-right text-xs text-muted tnum">{pct}%</div>
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Year over year — collapsible */}
          {financialYears.length > 1 && (
            <CollapsibleSection title="Year Over Year" badge={`${financialYears.length} years`}>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line">
                      <th className="text-left py-2 px-3 font-semibold text-ink">Year</th>
                      <th className="text-right py-2 px-3 font-semibold text-ink">Income</th>
                      <th className="text-right py-2 px-3 font-semibold text-ink">Expenses</th>
                      <th className="text-right py-2 px-3 font-semibold text-ink">Net</th>
                    </tr>
                  </thead>
                  <tbody>
                    {financialYears.map(yr => {
                      const s = data.financialSummary[yr];
                      return (
                        <tr key={yr} className="border-b border-line last:border-0">
                          <td className="py-2 px-3 font-medium">{yr}</td>
                          <td className="py-2 px-3 text-right tnum text-positive">{formatCurrency(s.income)}</td>
                          <td className="py-2 px-3 text-right tnum text-danger">{formatCurrency(s.expenses)}</td>
                          <td className={`py-2 px-3 text-right tnum font-medium ${s.net >= 0 ? 'text-positive' : 'text-danger'}`}>{formatCurrency(s.net)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </CollapsibleSection>
          )}

          {/* HOA Summary — collapsible */}
          {hoaExpenses.length > 0 && (
            <CollapsibleSection
              title={`HOA Dues (${financialYear})`}
              icon={<Home className="h-4 w-4 text-faint" />}
              badge={formatCurrency(hoaTotal)}
            >
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <div>
                  <p className="eyebrow mb-1">Annual Total</p>
                  <p className="text-lg font-bold font-display text-danger tnum">{formatCurrency(hoaTotal)}</p>
                </div>
                <div>
                  <p className="eyebrow mb-1">Monthly Average</p>
                  <p className="text-lg font-bold font-display text-ink tnum">
                    {formatCurrency(hoaTotal / (hoaExpenses.length > 0 ? hoaExpenses.length : 1))}
                  </p>
                  <p className="text-xs text-muted">{hoaExpenses.length} payment{hoaExpenses.length !== 1 ? 's' : ''}</p>
                </div>
              </div>
              <div className="overflow-x-auto mt-2">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line">
                      <th className="text-left py-2 px-3 font-semibold text-ink">Date</th>
                      <th className="text-left py-2 px-3 font-semibold text-ink">Description</th>
                      <th className="text-left py-2 px-3 font-semibold text-ink">Vendor</th>
                      <th className="text-right py-2 px-3 font-semibold text-ink">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {hoaExpenses.map(e => (
                      <tr key={e.id} className="border-b border-line last:border-0">
                        <td className="py-2 px-3">{formatDate(e.date)}</td>
                        <td className="py-2 px-3 text-muted">{e.description || '—'}</td>
                        <td className="py-2 px-3 text-muted">{e.vendor || '—'}</td>
                        <td className="py-2 px-3 text-right tnum">{formatCurrency(e.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CollapsibleSection>
          )}

          {/* Capital Improvement History — collapsible */}
          {capitalProjects.length > 0 && (
            <CollapsibleSection
              title="Capital Improvements"
              icon={<HardHat className="h-4 w-4 text-faint" />}
              badge={`${capitalProjects.length}`}
            >
              <div className="space-y-3">
                {capitalProjects
                  .sort((a, b) => (b.startDate || '').localeCompare(a.startDate || ''))
                  .map(proj => {
                    const statusColor = proj.status === 'completed' ? 'success' : proj.status === 'in_progress' ? 'default' : 'destructive';
                    return (
                      <div key={proj.id} className="rounded-lg border border-line p-4 space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-ink">{proj.name}</span>
                          <Badge variant={statusColor as any}>
                            {proj.status === 'in_progress' ? 'In Progress' : proj.status === 'completed' ? 'Completed' : 'Cancelled'}
                          </Badge>
                        </div>
                        {proj.description && <p className="text-sm text-muted">{proj.description}</p>}
                        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted">
                          {proj.startDate && <span>Started: {formatDate(proj.startDate)}</span>}
                          {proj.completionDate && <span>Completed: {formatDate(proj.completionDate)}</span>}
                          <span className="font-semibold text-ink tnum">Total: {formatCurrency(proj.totalCost)}</span>
                          <span>{proj.expenseCount} receipt{proj.expenseCount !== 1 ? 's' : ''}</span>
                        </div>
                      </div>
                    );
                  })}
              </div>
            </CollapsibleSection>
          )}

          {/* Rent payments — collapsible */}
          <CollapsibleSection
            title={`Rent Payments (${financialYear})`}
            icon={<DollarSign className="h-4 w-4 text-faint" />}
            badge={`${yearPayments.length}`}
          >
            {yearPayments.length === 0 ? (
              <p className="text-sm text-muted">No rent payments recorded for this year.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line">
                      <th className="text-left py-2 px-3 font-semibold text-ink">Month</th>
                      <th className="text-left py-2 px-3 font-semibold text-ink">Unit</th>
                      <th className="text-right py-2 px-3 font-semibold text-ink">Amount</th>
                      <th className="text-left py-2 px-3 font-semibold text-ink">Method</th>
                      <th className="text-left py-2 px-3 font-semibold text-ink">Paid Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {yearPayments.map(rp => (
                      <tr key={rp.id} className="border-b border-line last:border-0">
                        <td className="py-2 px-3">{monthName(rp.month)}</td>
                        <td className="py-2 px-3 text-muted">{rp.unitNumber || '—'}</td>
                        <td className="py-2 px-3 text-right tnum">
                          {rp.type === 'credit' ? (
                            <span className="text-amber-600 dark:text-amber-400">{formatCurrency(rp.amount)} credit</span>
                          ) : formatCurrency(rp.amount)}
                        </td>
                        <td className="py-2 px-3 text-muted capitalize">{rp.type === 'credit' ? (rp.creditReason || 'credit') : (rp.paymentMethod?.replace(/_/g, ' ') || '—')}</td>
                        <td className="py-2 px-3 text-muted">{rp.paidDate ? formatDate(rp.paidDate) : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CollapsibleSection>

          {/* All expenses — collapsible */}
          <CollapsibleSection
            title={`All Expenses (${financialYear})`}
            badge={`${yearExpenses.length}`}
          >
            {yearExpenses.length === 0 ? (
              <p className="text-sm text-muted">No expenses recorded for this year.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line">
                      <th className="text-left py-2 px-3 font-semibold text-ink">Date</th>
                      <th className="text-left py-2 px-3 font-semibold text-ink">Unit</th>
                      <th className="text-left py-2 px-3 font-semibold text-ink">Category</th>
                      <th className="text-left py-2 px-3 font-semibold text-ink">Description</th>
                      <th className="text-left py-2 px-3 font-semibold text-ink">Vendor</th>
                      <th className="text-right py-2 px-3 font-semibold text-ink">Amount</th>
                    </tr>
                  </thead>
                  <tbody>
                    {yearExpenses.map(e => (
                      <tr key={e.id} className="border-b border-line last:border-0">
                        <td className="py-2 px-3">{formatDate(e.date)}</td>
                        <td className="py-2 px-3 text-muted">{e.unitId ? unitLabel.get(e.unitId) || '—' : 'Property'}</td>
                        <td className="py-2 px-3">{expenseCategoryLabel(e.category)}</td>
                        <td className="py-2 px-3 text-muted">{e.description || '—'}</td>
                        <td className="py-2 px-3 text-muted">{e.vendor || '—'}</td>
                        <td className="py-2 px-3 text-right tnum">{formatCurrency(e.amount)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CollapsibleSection>
        </div>
      )}

      {activeTab === 'Tenants' && (
        <div className="space-y-6">
          {/* Current tenants */}
          <Card>
            <CardContent className="p-5 space-y-4">
              <h2 className="font-semibold text-ink">Current Tenants ({activeLeases.length})</h2>
              {activeLeases.length === 0 ? (
                <p className="text-sm text-muted">No active tenants.</p>
              ) : (
                <div className="space-y-2">
                  {activeLeases.map(l => (
                    <div key={l.id} className="rounded-lg border border-line overflow-hidden">
                      <button
                        onClick={() => toggleLease(l.id)}
                        className="w-full flex items-center justify-between p-4 text-left hover:bg-canvas transition-colors"
                      >
                        <div className="flex items-center gap-3">
                          <Users className="h-4 w-4 text-muted" />
                          <div>
                            <span className="font-medium text-sm text-ink">{l.tenantNames || 'Unknown'}</span>
                            <div className="text-xs text-muted">
                              Unit {l.unitNumber || '—'} · {formatCurrency(l.monthlyRent || 0)}/mo
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge variant="success">Active</Badge>
                          {expandedLeases.has(l.id) ? <ChevronDown className="h-4 w-4 text-muted" /> : <ChevronRight className="h-4 w-4 text-muted" />}
                        </div>
                      </button>
                      {expandedLeases.has(l.id) && (
                        <div className="px-4 pb-4 border-t border-line pt-3 space-y-2 text-sm">
                          <Row label="Lease Start" value={l.startDate ? formatDate(l.startDate) : '—'} />
                          <Row label="Lease End" value={l.endDate ? formatDate(l.endDate) : 'Month to month'} />
                          <Row label="Monthly Rent" value={formatCurrency(l.monthlyRent || 0)} />
                          <Row label="Move-in Fee" value={l.moveInFeePaid ? `Paid (${formatCurrency(l.securityDeposit || 0)})` : 'Not paid'} />
                          {l.tenantIds.length > 0 && (
                            <div className="pt-2">
                              {l.tenantIds.map(tid => (
                                <Link
                                  key={tid}
                                  to={`/tenants/${tid}`}
                                  className="inline-block text-xs text-primary hover:text-primary-hover mr-2"
                                >
                                  View tenant profile →
                                </Link>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Former tenants */}
          <Card>
            <CardContent className="p-5 space-y-4">
              <h2 className="font-semibold text-ink">Former Tenants ({endedLeases.length})</h2>
              {endedLeases.length === 0 ? (
                <p className="text-sm text-muted">No former tenants on record.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-line">
                        <th className="text-left py-2 px-3 font-semibold text-ink">Tenant</th>
                        <th className="text-left py-2 px-3 font-semibold text-ink">Unit</th>
                        <th className="text-left py-2 px-3 font-semibold text-ink">Lease Period</th>
                        <th className="text-right py-2 px-3 font-semibold text-ink">Rent</th>
                        <th className="text-left py-2 px-3 font-semibold text-ink">Reason</th>
                      </tr>
                    </thead>
                    <tbody>
                      {endedLeases.map(l => (
                        <tr key={l.id} className="border-b border-line last:border-0">
                          <td className="py-2 px-3">
                            {l.tenantIds.length > 0 ? (
                              <Link to={`/tenants/${l.tenantIds[0]}`} className="text-primary hover:text-primary-hover">
                                {l.tenantNames || 'Unknown'}
                              </Link>
                            ) : (
                              l.tenantNames || 'Unknown'
                            )}
                          </td>
                          <td className="py-2 px-3 text-muted">{l.unitNumber || '—'}</td>
                          <td className="py-2 px-3 text-muted">
                            {l.startDate ? formatDate(l.startDate) : '—'} to {l.endDate ? formatDate(l.endDate) : '—'}
                          </td>
                          <td className="py-2 px-3 text-right tnum">{formatCurrency(l.monthlyRent || 0)}</td>
                          <td className="py-2 px-3 text-muted">{l.endReason || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {activeTab === 'Maintenance' && (
        <div className="space-y-6">
          {/* Maintenance summary cards */}
          {maintenance.length > 0 && (() => {
            const totalSpend = maintenance.reduce((sum, m) => sum + (m.cost || 0), 0);
            const completedCount = maintenance.filter(m => m.status === 'completed' || m.status === 'paid').length;
            const openCount = maintenance.filter(m => m.status !== 'completed' && m.status !== 'paid').length;
            return (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <Card>
                  <CardContent className="p-5">
                    <p className="eyebrow mb-1">Total Maintenance Spend</p>
                    <p className="text-xl font-bold font-display text-danger tnum">{formatCurrency(totalSpend)}</p>
                    <p className="text-xs text-muted mt-1">{maintenance.length} request{maintenance.length !== 1 ? 's' : ''} total</p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-5">
                    <p className="eyebrow mb-1">Completed</p>
                    <p className="text-xl font-bold font-display text-positive tnum">{completedCount}</p>
                    <p className="text-xs text-muted mt-1">
                      {formatCurrency(maintenance.filter(m => m.status === 'completed' || m.status === 'paid').reduce((s, m) => s + (m.cost || 0), 0))} spent
                    </p>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-5">
                    <p className="eyebrow mb-1">Open Requests</p>
                    <p className={`text-xl font-bold font-display tnum ${openCount > 0 ? 'text-warning' : 'text-positive'}`}>{openCount}</p>
                    <p className="text-xs text-muted mt-1">
                      {formatCurrency(maintenance.filter(m => m.status !== 'completed' && m.status !== 'paid').reduce((s, m) => s + (m.cost || 0), 0))} estimated
                    </p>
                  </CardContent>
                </Card>
              </div>
            );
          })()}

          <Card>
            <CardContent className="p-5 space-y-4">
              <h2 className="font-semibold text-ink">Maintenance History ({maintenance.length})</h2>
              {maintenance.length === 0 ? (
                <p className="text-sm text-muted">No maintenance requests on record.</p>
              ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-line">
                      <th className="text-left py-2 px-3 font-semibold text-ink">Title</th>
                      <th className="text-left py-2 px-3 font-semibold text-ink">Unit</th>
                      <th className="text-left py-2 px-3 font-semibold text-ink">Requested By</th>
                      <th className="text-left py-2 px-3 font-semibold text-ink">Assigned To</th>
                      <th className="text-left py-2 px-3 font-semibold text-ink">Status</th>
                      <th className="text-right py-2 px-3 font-semibold text-ink">Cost</th>
                      <th className="text-left py-2 px-3 font-semibold text-ink">Date</th>
                    </tr>
                  </thead>
                  <tbody>
                    {maintenance.map(m => (
                      <tr key={m.id} className="border-b border-line last:border-0">
                        <td className="py-2 px-3 font-medium">{m.title}</td>
                        <td className="py-2 px-3 text-muted">{m.unitNumber || '—'}</td>
                        <td className="py-2 px-3 text-muted">{m.tenantName || '—'}</td>
                        <td className="py-2 px-3 text-muted">{m.handymanName || '—'}</td>
                        <td className="py-2 px-3">
                          <Badge variant={maintenanceStatusBadge[m.status] || 'secondary'}>
                            {m.status.replace(/_/g, ' ')}
                          </Badge>
                        </td>
                        <td className="py-2 px-3 text-right tnum">
                          {m.cost ? formatCurrency(m.cost) : '—'}
                        </td>
                        <td className="py-2 px-3 text-muted">
                          {m.createdAt ? new Date(m.createdAt * 1000).toLocaleDateString() : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
        </div>
      )}

      {activeTab === 'Appliances' && id && (
        <AppliancesTab
          appliances={data.appliances}
          units={units}
          propertyId={id}
          onRefresh={() => {
            propertiesApi.getProfile(id).then(d => setData(d)).catch(() => {});
          }}
        />
      )}

      {activeTab === 'Documents' && (
        <Card>
          <CardContent className="p-5 space-y-4">
            <h2 className="font-semibold text-ink">Documents ({documents.length})</h2>
            {documents.length === 0 ? (
              <p className="text-sm text-muted">No documents linked to this property.</p>
            ) : (
              <div className="space-y-2">
                {documents.map(d => (
                  <div key={d.id} className="flex items-center justify-between p-3 rounded-lg border border-line hover:bg-canvas transition-colors">
                    <div className="flex items-center gap-3">
                      <FileText className="h-4 w-4 text-muted flex-shrink-0" />
                      <div>
                        <div className="text-sm font-medium text-ink">{d.name}</div>
                        <div className="text-xs text-muted">
                          {d.contentType || 'Unknown type'}
                          {d.createdAt && ` · ${new Date(d.createdAt * 1000).toLocaleDateString()}`}
                        </div>
                      </div>
                    </div>
                    <a
                      href={`/api/documents/${d.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-primary hover:text-primary-hover"
                    >
                      <Download className="h-4 w-4" />
                    </a>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {activeTab === 'Notes' && id && (
        <PropertyNotes propertyId={id} />
      )}

      {activeTab === 'Activity' && (
        <Card>
          <CardContent className="p-5">
            <ActivityTimeline propertyId={id} title="Activity Timeline" />
          </CardContent>
        </Card>
      )}

      {/* Drill-down modal */}
      <TransactionDrillDown
        isOpen={drillOpen}
        onClose={() => setDrillOpen(false)}
        title={drillTitle}
        expenses={drillExpenses as any}
        properties={data ? [data.property] as any : []}
        units={data ? data.units as any : []}
        forceTab="expenses"
      />
    </div>
  );
}

/* ---------- helpers ---------- */

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted">{label}</dt>
      <dd className="text-ink text-right">{value}</dd>
    </div>
  );
}

function StatCard({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Building }) {
  return (
    <Card>
      <CardContent className="p-4 flex items-center gap-3">
        <div className="p-2 rounded-lg bg-primary-soft">
          <Icon className="h-4 w-4 text-primary" />
        </div>
        <div>
          <p className="eyebrow">{label}</p>
          <p className="text-lg font-bold font-display tnum">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}

function monthName(m: number): string {
  return ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m] || '?';
}

/* ---------- Appliances Tab ---------- */

type ApplianceRow = ProfileData['appliances'][number];

interface ApplianceFormData {
  type: ApplianceType;
  brand: string;
  modelNumber: string;
  serialNumber: string;
  unitId: string;
  purchaseDate: string;
  warrantyExpiration: string;
  condition: ApplianceCondition;
  notes: string;
}

const emptyForm: ApplianceFormData = {
  type: 'refrigerator',
  brand: '',
  modelNumber: '',
  serialNumber: '',
  unitId: '',
  purchaseDate: '',
  warrantyExpiration: '',
  condition: 'good',
  notes: '',
};

function AppliancesTab({
  appliances,
  units,
  propertyId,
  onRefresh,
}: {
  appliances: ApplianceRow[];
  units: ProfileData['units'];
  propertyId: string;
  onRefresh: () => void;
}) {
  const { showToast } = useToast();
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ApplianceRow | null>(null);
  const [deleting, setDeleting] = useState<ApplianceRow | null>(null);
  const [filterUnit, setFilterUnit] = useState<string>('all');
  const [saving, setSaving] = useState(false);

  const filtered = filterUnit === 'all'
    ? appliances
    : filterUnit === 'common'
      ? appliances.filter(a => !a.unitId)
      : appliances.filter(a => a.unitId === filterUnit);

  const warrantyExpiring = appliances.filter(a => {
    if (!a.warrantyExpiration) return false;
    const diff = new Date(a.warrantyExpiration + 'T00:00:00').getTime() - Date.now();
    return diff > 0 && diff <= 90 * 24 * 60 * 60 * 1000;
  }).length;

  const warrantyExpired = appliances.filter(a => {
    if (!a.warrantyExpiration) return false;
    return new Date(a.warrantyExpiration + 'T00:00:00').getTime() < Date.now();
  }).length;

  const handleSave = async (form: ApplianceFormData) => {
    setSaving(true);
    try {
      const payload = {
        propertyId,
        type: form.type,
        brand: form.brand || undefined,
        modelNumber: form.modelNumber || undefined,
        serialNumber: form.serialNumber || undefined,
        unitId: form.unitId || undefined,
        purchaseDate: form.purchaseDate || undefined,
        warrantyExpiration: form.warrantyExpiration || undefined,
        condition: form.condition,
        notes: form.notes || undefined,
      };
      if (editing) {
        await appliancesApi.update(editing.id, { id: editing.id, ...payload } as any);
        showToast('Appliance updated.', 'success');
      } else {
        await appliancesApi.create(payload as any);
        showToast('Appliance added.', 'success');
      }
      setModalOpen(false);
      setEditing(null);
      onRefresh();
    } catch {
      showToast('Failed to save appliance.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleting) return;
    try {
      await appliancesApi.delete(deleting.id);
      showToast('Appliance removed.', 'success');
      setDeleting(null);
      onRefresh();
    } catch {
      showToast('Failed to remove appliance.', 'error');
    }
  };

  return (
    <div className="space-y-6">
      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-5">
            <p className="eyebrow mb-1">Total Appliances</p>
            <p className="text-xl font-bold font-display tnum">{appliances.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="eyebrow mb-1">Warranty Expiring Soon</p>
            <p className={`text-xl font-bold font-display tnum ${warrantyExpiring > 0 ? 'text-warning' : 'text-positive'}`}>
              {warrantyExpiring}
            </p>
            <p className="text-xs text-muted mt-1">within 90 days</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="eyebrow mb-1">Warranty Expired</p>
            <p className={`text-xl font-bold font-display tnum ${warrantyExpired > 0 ? 'text-danger' : 'text-positive'}`}>
              {warrantyExpired}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Filter + Add */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <label className="text-sm text-muted">Filter by unit:</label>
          <select
            value={filterUnit}
            onChange={e => setFilterUnit(e.target.value)}
            className="input py-1.5 px-3 text-sm min-w-[140px]"
          >
            <option value="all">All units</option>
            <option value="common">Common area</option>
            {units.map(u => (
              <option key={u.id} value={u.id}>Unit {u.unitNumber}</option>
            ))}
          </select>
        </div>
        <button
          onClick={() => { setEditing(null); setModalOpen(true); }}
          className="btn btn-primary flex items-center gap-1.5 text-sm"
        >
          <Plus className="h-4 w-4" /> Add Appliance
        </button>
      </div>

      {/* Appliance cards */}
      {filtered.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center">
            <p className="text-sm text-muted">No appliances recorded{filterUnit !== 'all' ? ' for this filter' : ''}.</p>
            <p className="text-xs text-muted mt-1">Click "Add Appliance" to start tracking.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filtered.map(a => {
            const ws = warrantyStatus(a.warrantyExpiration);
            const WarrantyIcon = ws.icon;
            return (
              <Card key={a.id}>
                <CardContent className="p-5 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="font-semibold text-ink text-sm">
                        {APPLIANCE_TYPE_LABELS[a.type as ApplianceType] || a.type}
                      </h3>
                      {a.brand && <p className="text-sm text-muted">{a.brand}</p>}
                    </div>
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => { setEditing(a); setModalOpen(true); }}
                        className="p-1.5 rounded-md hover:bg-line/50 text-muted hover:text-ink transition-colors"
                        title="Edit"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => setDeleting(a)}
                        className="p-1.5 rounded-md hover:bg-line/50 text-muted hover:text-danger transition-colors"
                        title="Remove"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <Badge variant={CONDITION_VARIANTS[a.condition as ApplianceCondition] || 'secondary'}>
                      {CONDITION_LABELS[a.condition as ApplianceCondition] || a.condition}
                    </Badge>
                    <Badge variant={ws.variant}>
                      <WarrantyIcon className="h-3 w-3 mr-1 inline" />
                      {ws.label}
                    </Badge>
                    {a.unitNumber ? (
                      <Badge variant="secondary">Unit {a.unitNumber}</Badge>
                    ) : (
                      <Badge variant="secondary">Common</Badge>
                    )}
                  </div>

                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                    {a.modelNumber && (
                      <>
                        <dt className="text-muted">Model</dt>
                        <dd className="text-ink">{a.modelNumber}</dd>
                      </>
                    )}
                    {a.serialNumber && (
                      <>
                        <dt className="text-muted">Serial</dt>
                        <dd className="text-ink">{a.serialNumber}</dd>
                      </>
                    )}
                    {a.purchaseDate && (
                      <>
                        <dt className="text-muted">Purchased</dt>
                        <dd className="text-ink">{formatDate(a.purchaseDate)}</dd>
                      </>
                    )}
                    {a.warrantyExpiration && (
                      <>
                        <dt className="text-muted">Warranty Exp.</dt>
                        <dd className="text-ink">{formatDate(a.warrantyExpiration)}</dd>
                      </>
                    )}
                  </dl>

                  {a.notes && (
                    <p className="text-xs text-muted border-t border-line pt-2">{a.notes}</p>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Add/Edit modal */}
      {modalOpen && (
        <ApplianceModal
          initial={editing ? {
            type: editing.type as ApplianceType,
            brand: editing.brand || '',
            modelNumber: editing.modelNumber || '',
            serialNumber: editing.serialNumber || '',
            unitId: editing.unitId || '',
            purchaseDate: editing.purchaseDate || '',
            warrantyExpiration: editing.warrantyExpiration || '',
            condition: (editing.condition || 'good') as ApplianceCondition,
            notes: editing.notes || '',
          } : emptyForm}
          units={units}
          isEditing={!!editing}
          saving={saving}
          onSave={handleSave}
          onClose={() => { setModalOpen(false); setEditing(null); }}
        />
      )}

      {/* Delete confirmation */}
      {deleting && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <Card className="w-full max-w-sm mx-4">
            <CardContent className="p-6 space-y-4">
              <h3 className="font-semibold text-ink">Remove Appliance</h3>
              <p className="text-sm text-muted">
                Remove the {APPLIANCE_TYPE_LABELS[deleting.type as ApplianceType] || deleting.type}
                {deleting.brand ? ` (${deleting.brand})` : ''}? This cannot be undone.
              </p>
              <div className="flex justify-end gap-3">
                <button onClick={() => setDeleting(null)} className="btn btn-secondary text-sm">Cancel</button>
                <button onClick={handleDelete} className="btn btn-danger text-sm">Remove</button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

function ApplianceModal({
  initial,
  units,
  isEditing,
  saving,
  onSave,
  onClose,
}: {
  initial: ApplianceFormData;
  units: ProfileData['units'];
  isEditing: boolean;
  saving: boolean;
  onSave: (form: ApplianceFormData) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<ApplianceFormData>(initial);

  const set = <K extends keyof ApplianceFormData>(key: K, val: ApplianceFormData[K]) =>
    setForm(f => ({ ...f, [key]: val }));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <Card className="w-full max-w-lg mx-4 max-h-[90vh] overflow-y-auto">
        <CardContent className="p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-ink">{isEditing ? 'Edit Appliance' : 'Add Appliance'}</h3>
            <button onClick={onClose} className="p-1.5 rounded-md hover:bg-line/50 text-muted hover:text-ink transition-colors">
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="label">Type *</label>
              <select value={form.type} onChange={e => set('type', e.target.value as ApplianceType)} className="input">
                {APPLIANCE_TYPES.map(t => (
                  <option key={t} value={t}>{APPLIANCE_TYPE_LABELS[t]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Unit</label>
              <select value={form.unitId} onChange={e => set('unitId', e.target.value)} className="input">
                <option value="">Common area</option>
                {units.map(u => (
                  <option key={u.id} value={u.id}>Unit {u.unitNumber}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Brand</label>
              <input value={form.brand} onChange={e => set('brand', e.target.value)} className="input" placeholder="e.g. LG, Samsung" />
            </div>
            <div>
              <label className="label">Model Number</label>
              <input value={form.modelNumber} onChange={e => set('modelNumber', e.target.value)} className="input" placeholder="Model #" />
            </div>
            <div>
              <label className="label">Serial Number</label>
              <input value={form.serialNumber} onChange={e => set('serialNumber', e.target.value)} className="input" placeholder="Serial #" />
            </div>
            <div>
              <label className="label">Condition</label>
              <select value={form.condition} onChange={e => set('condition', e.target.value as ApplianceCondition)} className="input">
                {(Object.keys(CONDITION_LABELS) as ApplianceCondition[]).map(c => (
                  <option key={c} value={c}>{CONDITION_LABELS[c]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Purchase Date</label>
              <input type="date" value={form.purchaseDate} onChange={e => set('purchaseDate', e.target.value)} className="input" />
            </div>
            <div>
              <label className="label">Warranty Expiration</label>
              <input type="date" value={form.warrantyExpiration} onChange={e => set('warrantyExpiration', e.target.value)} className="input" />
            </div>
          </div>
          <div>
            <label className="label">Notes</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} className="input" rows={2} placeholder="Optional notes" />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button onClick={onClose} className="btn btn-secondary text-sm" disabled={saving}>Cancel</button>
            <button onClick={() => onSave(form)} className="btn btn-primary text-sm" disabled={saving}>
              {saving ? 'Saving...' : isEditing ? 'Update' : 'Add'}
            </button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function ProfileSkeleton() {
  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div className="flex items-start gap-4">
        <Skeleton className="h-8 w-8 rounded-lg" />
        <div>
          <Skeleton className="h-7 w-56" />
          <Skeleton className="mt-1 h-4 w-72" />
        </div>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)}
      </div>
      <Skeleton className="h-10 w-full" />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Skeleton className="h-48 rounded-xl" />
        <Skeleton className="h-48 rounded-xl" />
      </div>
    </div>
  );
}
