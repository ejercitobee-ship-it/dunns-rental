import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Users, TrendingUp,
  TrendingDown, AlertCircle, Wallet, Building2, Percent, ArrowRight, DoorOpen, Home, CalendarClock,
  ChevronDown, ChevronRight
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { formatCurrency, formatDate, getMonthName, yearOf, monthOf, parseLocalDate, todayLocalDate } from '../lib/utils';
import { useApp } from '../context/AppContext';
import { activeLeases, monthlyRevenue, settleMonth, leasesOwingMonth, monthsBehind, isLeaseExpiringSoon, daysUntilLeaseEnd } from '../lib/rent';
import { usePastDueMonths } from '../lib/usePastDueMonths';
import type { DashboardStats, Property, Tenant, Unit } from '../types';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
} from 'recharts';

const COLORS = ['#24503f', '#2c7a58', '#97671c', '#a23429', '#7e8b83'];
const INCOME_COLOR = '#2c7a58';
const EXPENSE_COLOR = '#b98a5e';
const NET_COLOR = '#24503f';

// Stat Card Component
interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  onClick?: () => void;
  trend?: { value: string; positive: boolean };
}

function StatCard({ title, value, subtitle, icon, onClick, trend }: StatCardProps) {
  return (
    <Card
      className="cursor-pointer hover:border-line-strong hover:shadow-[0_2px_12px_rgba(27,26,23,0.07)]"
      onClick={onClick}
    >
      <div className="p-5">
        <div className="flex items-center justify-between">
          <span className="eyebrow">{title}</span>
          <span className="text-faint [&_svg]:h-[18px] [&_svg]:w-[18px]">{icon}</span>
        </div>
        <div className="mt-3.5 flex items-end gap-2">
          <span className="font-display text-[27px] leading-none font-medium text-ink tnum">{value}</span>
          {trend && (
            <span className={`mb-1 text-xs font-medium ${trend.positive ? 'text-positive' : 'text-danger'}`}>
              {trend.positive ? '↑' : '↓'} {trend.value}
            </span>
          )}
        </div>
        {subtitle && <p className="mt-1.5 text-[13px] text-muted">{subtitle}</p>}
      </div>
    </Card>
  );
}

// Clickable Card Component
interface ClickableCardProps {
  children: React.ReactNode;
  onClick?: () => void;
  className?: string;
}

function ClickableCard({ children, onClick, className = '' }: ClickableCardProps) {
  return (
    <Card 
      className={`shadow-lg cursor-pointer transform transition-all duration-300 hover:scale-[1.02] hover:shadow-xl ${className}`}
      onClick={onClick}
    >
      {children}
    </Card>
  );
}

export function Dashboard() {
  const navigate = useNavigate();
  const { properties, units, leases, rentPayments, expenses, getUnitLease, getLeaseTenants, isLoading, error } = useApp();
  const pastDueMonths = usePastDueMonths();

  const stats: DashboardStats = useMemo(() => {
    const totalProperties = properties.length;
    const totalUnits = units.length;
    // Occupied means the unit currently has a lease, active or paused: the
    // people still live there even while collection is on hold. This is the
    // same rule Properties.tsx uses, via getUnitLease.
    const occupiedUnits = units.filter(u => !!getUnitLease(u.id)).length;
    // A person can be double counted here only if they are on two active
    // leases at once, so dedupe by tenant id.
    const totalTenants = new Set(activeLeases(leases).flatMap(l => l.tenantIds)).size;

    const currentMonth = new Date().getMonth() + 1;
    const currentYear = new Date().getFullYear();

    // Calculate monthly income from paid rent payments (not the separate incomes array)
    const monthlyIncome = rentPayments
      .filter(r => r.status === 'paid' && r.month === currentMonth && r.year === currentYear)
      .reduce((sum, r) => sum + r.amount, 0);

    const monthlyExpenses = expenses
      .filter(e => monthOf(e.date) === currentMonth && yearOf(e.date) === currentYear)
      .reduce((sum, e) => sum + e.amount, 0);

    // What's still owed across every elapsed month of the current year, one
    // lease at a time. Walks leasesOwingMonth rather than activeLeases so a
    // lease that ended at turnover mid-year still counts for the months it
    // was lived in, and this figure can never disagree with Rent Management
    // or the Tax Report.
    const elapsedMonths = Array.from({ length: currentMonth }, (_, i) => i + 1);
    let totalOwed = 0;
    for (const month of elapsedMonths) {
      for (const lease of leasesOwingMonth(leases, month, currentYear)) {
        totalOwed += settleMonth(lease, rentPayments, month, currentYear).balance;
      }
    }

    // Projected yearly income counts each lease once, not each occupant.
    const projectedYearlyIncome = monthlyRevenue(leases) * 12;

    return {
      totalProperties,
      totalUnits,
      occupiedUnits,
      totalTenants,
      monthlyIncome,
      monthlyExpenses,
      netIncome: monthlyIncome - monthlyExpenses,
      totalOwed,
      occupancyRate: totalUnits > 0 ? (occupiedUnits / totalUnits) * 100 : 0,
      projectedYearlyIncome,
    };
  }, [properties, units, leases, expenses, rentPayments, getUnitLease]);

  const monthlyData = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const months = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    return months.map(month => {
      // Calculate income from paid rent payments for this month
      const monthIncome = rentPayments
        .filter(r => r.status === 'paid' && r.month === month && r.year === currentYear)
        .reduce((sum, r) => sum + r.amount, 0);
      
      const monthExpenses = expenses
        .filter(e => monthOf(e.date) === month && yearOf(e.date) === currentYear)
        .reduce((sum, e) => sum + e.amount, 0);
      
      return {
        name: getMonthName(month),
        income: monthIncome,
        expenses: monthExpenses,
        net: monthIncome - monthExpenses,
      };
    });
  }, [rentPayments, expenses]);

  const expenseByCategory = useMemo(() => {
    const categories: Record<string, number> = {};
    expenses.forEach(e => {
      categories[e.category] = (categories[e.category] || 0) + e.amount;
    });
    return Object.entries(categories).map(([name, value]) => ({ name, value }));
  }, [expenses]);

  const recentActivity = useMemo(() => {
    const activities = [
      ...rentPayments
        .filter(r => r.paidDate)
        .map(r => {
          const lease = leases.find(l => l.id === r.leaseId);
          const property = lease?.propertyId ? properties.find(p => p.id === lease.propertyId) : undefined;
          return {
            type: 'payment' as const,
            date: r.paidDate!,
            description: `Rent payment received`,
            amount: r.amount,
            property: property?.name || '',
          };
        }),
      ...expenses.map(e => ({
        type: 'expense' as const,
        date: e.date,
        description: e.description,
        amount: -e.amount,
        property: properties.find(p => p.id === e.propertyId)?.name || '',
      })),
    ]
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, 10);

    return activities;
  }, [rentPayments, expenses, properties, leases]);

  // Derived from settlement, not payment.status: nothing in the app ever
  // writes the 'overdue' payment status, so filtering on it always found
  // zero rows here while Rent Management (which settles each lease month
  // instead) showed real overdue counts for the same data. A month is
  // overdue when the lease owed it, the month has already elapsed, and
  // settleMonth says it isn't paid, matching how Rents.tsx counts overdue.
  const overduePayments = useMemo(() => {
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();
    const elapsedMonths = Array.from({ length: currentMonth }, (_, i) => i + 1);

    const rows: {
      key: string;
      property?: Property;
      occupants: Tenant[];
      month: number;
      year: number;
      amount: number;
    }[] = [];

    for (const month of elapsedMonths) {
      for (const lease of leasesOwingMonth(leases, month, currentYear)) {
        const settlement = settleMonth(lease, rentPayments, month, currentYear);
        if (settlement.status === 'paid') continue;
        const property = lease.propertyId ? properties.find(p => p.id === lease.propertyId) : undefined;
        rows.push({
          key: `${lease.id}-${currentYear}-${month}`,
          property,
          occupants: getLeaseTenants(lease.id),
          month,
          year: currentYear,
          amount: settlement.balance,
        });
      }
    }
    return rows;
  }, [leases, rentPayments, properties, getLeaseTenants]);

  // Tenancies that owe two or more months of rent, the ones to chase first.
  const pastDue = useMemo(() => {
    const now = new Date();
    const month = now.getMonth() + 1;
    const year = now.getFullYear();
    return activeLeases(leases)
      .map(lease => ({ lease, ...monthsBehind(lease, rentPayments, month, year) }))
      .filter(x => x.months >= pastDueMonths)
      .map(x => ({
        ...x,
        property: x.lease.propertyId ? properties.find(p => p.id === x.lease.propertyId) : undefined,
        unit: x.lease.unitId ? units.find(u => u.id === x.lease.unitId) : undefined,
        occupants: getLeaseTenants(x.lease.id),
      }))
      .sort((a, b) => b.months - a.months || b.balance - a.balance);
  }, [leases, rentPayments, properties, units, getLeaseTenants, pastDueMonths]);

  // Leases coming up for renewal: end date within the next 60 days. Soonest
  // first, so the most urgent renewal sits at the top.
  const expiringSoon = useMemo(() => {
    const today = todayLocalDate();
    return activeLeases(leases)
      .filter(lease => isLeaseExpiringSoon(lease, today))
      .map(lease => ({
        lease,
        days: daysUntilLeaseEnd(lease, today) ?? 0,
        property: lease.propertyId ? properties.find(p => p.id === lease.propertyId) : undefined,
        unit: lease.unitId ? units.find(u => u.id === lease.unitId) : undefined,
        occupants: getLeaseTenants(lease.id),
      }))
      .sort((a, b) => a.days - b.days);
  }, [leases, properties, units, getLeaseTenants]);

  // Both danger lists are grouped by property so they stay tidy across a large
  // portfolio: one collapsible row per address, expanding to the detail.
  const pastDueByProperty = useMemo(() => {
    const groups = new Map<string, { key: string; name: string; total: number; items: typeof pastDue }>();
    for (const row of pastDue) {
      const key = row.property?.id ?? 'unassigned';
      const name = row.property?.name ?? row.property?.address ?? 'Unassigned';
      let g = groups.get(key);
      if (!g) { g = { key, name, total: 0, items: [] }; groups.set(key, g); }
      g.items.push(row);
      g.total += row.balance;
    }
    return Array.from(groups.values()).sort((a, b) => b.total - a.total);
  }, [pastDue]);

  // Overdue rent as a Property → Unit tree. Each unit rolls its unpaid months
  // into ONE summary (tenant, monthly rent, months missed, total owed) instead
  // of a row per month, so a big portfolio stays readable.
  interface OverdueUnit {
    key: string; unitNumber: string; tenantNames: string; firstTenantId?: string;
    monthlyRent: number; months: number; total: number;
  }
  interface OverdueProperty { key: string; name: string; total: number; units: OverdueUnit[] }
  const overdueTree = useMemo<OverdueProperty[]>(() => {
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();
    const elapsed = Array.from({ length: currentMonth }, (_, i) => i + 1);

    const perLease = new Map<string, { lease: ReturnType<typeof leasesOwingMonth>[number]; months: number; total: number }>();
    for (const month of elapsed) {
      for (const lease of leasesOwingMonth(leases, month, currentYear)) {
        const s = settleMonth(lease, rentPayments, month, currentYear);
        if (s.status === 'paid') continue;
        let e = perLease.get(lease.id);
        if (!e) { e = { lease, months: 0, total: 0 }; perLease.set(lease.id, e); }
        e.months += 1;
        e.total = Math.round((e.total + s.balance) * 100) / 100;
      }
    }

    const props = new Map<string, OverdueProperty>();
    for (const { lease, months, total } of perLease.values()) {
      const property = lease.propertyId ? properties.find(p => p.id === lease.propertyId) : undefined;
      const unit = lease.unitId ? units.find(u => u.id === lease.unitId) : undefined;
      const occupants = getLeaseTenants(lease.id);
      const pkey = property?.id ?? 'unassigned';
      let pg = props.get(pkey);
      if (!pg) { pg = { key: pkey, name: property?.name ?? property?.address ?? 'Unassigned', total: 0, units: [] }; props.set(pkey, pg); }
      pg.total = Math.round((pg.total + total) * 100) / 100;
      pg.units.push({
        key: lease.id,
        unitNumber: unit?.unitNumber ?? '—',
        tenantNames: occupants.map(t => `${t.firstName} ${t.lastName}`).join(', ') || 'Tenant',
        firstTenantId: occupants[0]?.id,
        monthlyRent: lease.monthlyRent || 0,
        months,
        total,
      });
    }
    const out = Array.from(props.values()).sort((a, b) => b.total - a.total);
    out.forEach(p => p.units.sort((a, b) => a.unitNumber.localeCompare(b.unitNumber)));
    return out;
  }, [leases, rentPayments, properties, units, getLeaseTenants]);

  // A flat summary list for the dashboard: one row per overdue tenancy, most
  // owed first. Just the tenant, months missed, and total, no property/unit
  // grouping, since the dashboard is only a summary.
  const overdueList = useMemo(
    () => overdueTree.flatMap(p => p.units).sort((a, b) => b.total - a.total),
    [overdueTree]
  );

  const [expandedPastDue, setExpandedPastDue] = useState<Set<string>>(new Set());
  const toggleIn = (setter: React.Dispatch<React.SetStateAction<Set<string>>>, key: string) =>
    setter(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Vacant mirrors occupiedUnits: derived from whether the unit has a lease
  // rather than the unit's own stored status field, so the two counts can
  // never disagree (maintenance is the one status still set by hand).
  // Every vacant unit (no lease, not under maintenance).
  const vacantUnits = useMemo(() => {
    return units.filter(u => u.status !== 'maintenance' && !getUnitLease(u.id));
  }, [units, getUnitLease]);

  // Vacant units grouped by their address (property), one entry per property,
  // sorted by name. The dashboard shows one collapsible row per address.
  const vacantByProperty = useMemo(() => {
    const groups = new Map<string, { key: string; name: string; units: Unit[] }>();
    for (const u of vacantUnits) {
      const key = u.propertyId ?? 'unassigned';
      const name = properties.find(p => p.id === u.propertyId)?.name ?? 'Unassigned';
      if (!groups.has(key)) groups.set(key, { key, name, units: [] });
      groups.get(key)!.units.push(u);
    }
    return Array.from(groups.values()).sort((a, b) => a.name.localeCompare(b.name));
  }, [vacantUnits, properties]);

  // Which address rows are expanded to show their open units. Collapsed by
  // default so the section stays a tidy one-line-per-address list.
  const [expandedVacant, setExpandedVacant] = useState<Set<string>>(new Set());
  const toggleVacant = (key: string) =>
    setExpandedVacant(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const upcomingRenewals = useMemo(() => {
    const now = new Date();
    return activeLeases(leases)
      .filter(l => l.endDate)
      .map(l => {
        const end = parseLocalDate(l.endDate!);
        const days = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
        const unit = l.unitId ? units.find(u => u.id === l.unitId) : undefined;
        const occupants = getLeaseTenants(l.id);
        return { lease: l, unit, occupants, days, end };
      })
      .filter(r => r.days >= 0 && r.days <= 90)
      .sort((a, b) => a.days - b.days);
  }, [leases, units, getLeaseTenants]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary"></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-danger">Error loading data: {error}</div>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-[26px] sm:text-[32px] font-medium text-ink">Dashboard</h1>
          <p className="text-muted mt-1 text-sm">
            An overview of your properties, tenants, and cash flow.
          </p>
        </div>
        <div className="flex items-center gap-2 text-[13px] text-muted">
          <span className="w-1.5 h-1.5 bg-positive rounded-full"></span>
          Updated {formatDate(new Date().toISOString())}
        </div>
      </div>

      {/* Past due: tenancies 2+ months behind on rent */}
      {pastDue.length > 0 && (
        <div className="rounded-xl border border-danger/30 bg-danger-soft p-5">
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle className="h-5 w-5 text-danger flex-shrink-0" />
            <h2 className="font-semibold text-ink">
              {pastDue.length} {pastDue.length === 1 ? 'tenancy is' : 'tenancies are'} {pastDueMonths} or more months past due
            </h2>
          </div>
          <div className="divide-y divide-danger/15">
            {pastDueByProperty.map(group => {
              const isOpen = expandedPastDue.has(group.key);
              return (
                <div key={group.key}>
                  <button
                    type="button"
                    onClick={() => toggleIn(setExpandedPastDue, group.key)}
                    aria-expanded={isOpen}
                    className="w-full flex items-center gap-3 py-2.5 text-left hover:opacity-80 transition-opacity"
                  >
                    {isOpen
                      ? <ChevronDown className="h-4 w-4 text-danger/70 flex-shrink-0" />
                      : <ChevronRight className="h-4 w-4 text-danger/70 flex-shrink-0" />}
                    <span className="font-medium text-ink flex-1 truncate">{group.name}</span>
                    <span className="text-xs text-muted whitespace-nowrap">
                      {group.items.length} {group.items.length === 1 ? 'tenancy' : 'tenancies'}
                    </span>
                    <span className="text-sm font-semibold text-danger tnum whitespace-nowrap ml-2">{formatCurrency(group.total)}</span>
                  </button>
                  {isOpen && (
                    <div className="pl-7 pb-1">
                      {group.items.map(row => {
                        const names = row.occupants.map(t => `${t.firstName} ${t.lastName}`).join(', ') || 'Tenant';
                        const place = row.unit ? `Unit ${row.unit.unitNumber}` : '';
                        const firstTenant = row.occupants[0];
                        return (
                          <button
                            key={row.lease.id}
                            onClick={() => firstTenant && navigate(`/tenants/${firstTenant.id}`)}
                            className="w-full flex items-center justify-between gap-4 py-2 text-left hover:opacity-80 transition-opacity"
                          >
                            <div className="min-w-0">
                              <p className="text-sm font-medium text-ink truncate">{names}</p>
                              {place && <p className="text-xs text-muted truncate">{place}</p>}
                            </div>
                            <div className="text-right flex-shrink-0">
                              <p className="text-sm font-semibold text-danger tnum">{formatCurrency(row.balance)}</p>
                              <p className="text-xs text-muted">{row.months} months behind</p>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Stats Grid - All Clickable */}
      <div className="grid gap-4 sm:gap-6 grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Total Properties"
          value={stats.totalProperties}
          subtitle={`${stats.totalUnits} total units`}
          icon={<Building2 className="h-6 w-6" />}
          onClick={() => navigate('/properties')}
        />

        <StatCard
          title="Occupancy Rate"
          value={`${stats.occupancyRate.toFixed(0)}%`}
          subtitle={`${stats.occupiedUnits} of ${stats.totalUnits} units occupied`}
          icon={<Percent className="h-6 w-6" />}
          onClick={() => navigate('/properties')}
        />

        <StatCard
          title="Active Tenants"
          value={stats.totalTenants}
          subtitle="Across all properties"
          icon={<Users className="h-6 w-6" />}
          onClick={() => navigate('/tenants')}
        />

        <StatCard
          title="Projected Yearly"
          value={formatCurrency(stats.projectedYearlyIncome || 0)}
          subtitle="From active tenants"
          icon={<TrendingUp className="h-6 w-6" />}
          onClick={() => navigate('/rents')}
        />
      </div>

      {/* Alerts - Clickable */}
      {stats.totalOwed > 0 && (
        <div 
          className="bg-danger-soft border border-[#e8cdc8] rounded-xl p-5 flex items-start gap-4 shadow-sm cursor-pointer hover:shadow-md transition-shadow"
          onClick={() => navigate('/rents')}
        >
          <div className="p-2 bg-danger-soft rounded-lg">
            <AlertCircle className="h-5 w-5 text-danger" />
          </div>
          <div className="flex-1">
            <h3 className="font-semibold text-red-900">Outstanding Payments</h3>
            <p className="text-danger mt-1">
              You have {formatCurrency(stats.totalOwed)} in unpaid rent so far this year.
            </p>
          </div>
          <button className="px-4 py-2 bg-red-600 text-white rounded-lg text-sm font-medium hover:bg-red-700 transition-colors flex items-center gap-2">
            View Details
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      )}

      {/* Charts Row - Clickable */}
      <div className="grid gap-4 sm:gap-6 md:grid-cols-2">
        <ClickableCard onClick={() => navigate('/finances')}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <div className="p-2 bg-primary-soft rounded-lg">
                <TrendingUp className="h-5 w-5 text-primary" />
              </div>
              Income vs Expenses
              <ArrowRight className="h-4 w-4 text-faint ml-auto" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e7e4dd" vertical={false} />
                <XAxis dataKey="name" stroke="#a6a29a" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={(value) => `$${Number(value) / 1000}k`} stroke="#a6a29a" fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip
                  formatter={(value) => formatCurrency(Number(value))}
                  cursor={{ fill: 'rgba(27,26,23,0.04)' }}
                  contentStyle={{ borderRadius: '10px', border: '1px solid #e7e4dd', boxShadow: '0 8px 30px -8px rgba(27,26,23,0.18)' }}
                />
                <Bar dataKey="income" fill={INCOME_COLOR} radius={[3, 3, 0, 0]} maxBarSize={22} />
                <Bar dataKey="expenses" fill={EXPENSE_COLOR} radius={[3, 3, 0, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </ClickableCard>

        <ClickableCard onClick={() => navigate('/finances')}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <div className="p-2 bg-primary-soft rounded-lg">
                <Wallet className="h-5 w-5 text-primary" />
              </div>
              Net Income Trend
              <ArrowRight className="h-4 w-4 text-faint ml-auto" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e7e4dd" vertical={false} />
                <XAxis dataKey="name" stroke="#a6a29a" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={(value) => `$${Number(value) / 1000}k`} stroke="#a6a29a" fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip
                  formatter={(value) => formatCurrency(Number(value))}
                  contentStyle={{ borderRadius: '10px', border: '1px solid #e7e4dd', boxShadow: '0 8px 30px -8px rgba(27,26,23,0.18)' }}
                />
                <Line
                  type="monotone"
                  dataKey="net"
                  stroke={NET_COLOR}
                  strokeWidth={2}
                  dot={{ fill: NET_COLOR, strokeWidth: 0, r: 3 }}
                  activeDot={{ r: 5, strokeWidth: 0 }}
                />
              </LineChart>
            </ResponsiveContainer>
          </CardContent>
        </ClickableCard>
      </div>

      {/* Bottom Row */}
      <div className="grid gap-4 sm:gap-6 md:grid-cols-3">
        {/* Expenses by Category - Clickable */}
        <ClickableCard onClick={() => navigate('/finances')}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <div className="p-2 bg-primary-soft rounded-lg">
                <TrendingDown className="h-5 w-5 text-primary" />
              </div>
              Expenses by Category
            </CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={expenseByCategory}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={70}
                  paddingAngle={5}
                  dataKey="value"
                >
                  {expenseByCategory.map((_entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => formatCurrency(Number(value))} />
              </PieChart>
            </ResponsiveContainer>
            <div className="space-y-2 mt-2">
              {expenseByCategory.slice(0, 4).map((cat, idx) => (
                <div key={cat.name} className="flex items-center justify-between text-sm">
                  <div className="flex items-center gap-2">
                    <div 
                      className="w-3 h-3 rounded-full" 
                      style={{ backgroundColor: COLORS[idx % COLORS.length] }}
                    />
                    <span className="capitalize text-muted">{cat.name}</span>
                  </div>
                  <span className="font-semibold text-ink">{formatCurrency(cat.value)}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </ClickableCard>

        {/* Recent Activity - Clickable items */}
        <Card className="md:col-span-2 shadow-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <div className="p-2 bg-primary-soft rounded-lg">
                <TrendingUp className="h-5 w-5 text-primary" />
              </div>
              Recent Activity
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {recentActivity.slice(0, 6).map((activity, idx) => (
                <div 
                  key={idx} 
                  className="flex items-center justify-between py-3 border-b border-line last:border-0 cursor-pointer hover:bg-black/[0.03] rounded-lg px-2 -mx-2 transition-colors"
                  onClick={() => activity.type === 'payment' ? navigate('/rents') : navigate('/finances')}
                >
                  <div className="flex items-center gap-3">
                    <div className={`p-2.5 rounded-lg ${
                      activity.type === 'payment'
                        ? 'bg-positive-soft text-positive'
                        : 'bg-danger-soft text-danger'
                    }`}>
                      {activity.type === 'payment' ? (
                        <TrendingUp className="h-4 w-4" />
                      ) : (
                        <TrendingDown className="h-4 w-4" />
                      )}
                    </div>
                    <div>
                      <p className="font-medium text-ink">{activity.description}</p>
                      <p className="text-sm text-muted">{activity.property}</p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className={`font-semibold tnum ${
                      activity.amount > 0 ? 'text-positive' : 'text-danger'
                    }`}>
                      {activity.amount > 0 ? '+' : ''}{formatCurrency(activity.amount)}
                    </p>
                    <p className="text-xs text-faint">{formatDate(activity.date)}</p>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Upcoming Lease Renewals */}
      {upcomingRenewals.length > 0 && (
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <div className="p-2 bg-primary-soft rounded-lg">
                <CalendarClock className="h-5 w-5 text-primary" />
              </div>
              Upcoming Lease Renewals ({upcomingRenewals.length})
              <ArrowRight
                className="h-4 w-4 text-faint ml-auto cursor-pointer"
                onClick={() => navigate('/tenants')}
              />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {upcomingRenewals.slice(0, 6).map(({ lease, unit, occupants, days }) => {
                const tone = days <= 30 ? 'destructive' : days <= 60 ? 'warning' : 'secondary';
                const occupantNames = occupants.length > 0
                  ? occupants.map(t => `${t.firstName} ${t.lastName}`).join(', ')
                  : 'Occupant unknown';
                return (
                  <div
                    key={lease.id}
                    className="flex items-center justify-between py-2.5 border-b border-line last:border-0 cursor-pointer hover:bg-black/[0.02] rounded-lg px-2 -mx-2 transition-colors"
                    onClick={() => navigate('/tenants')}
                  >
                    <div>
                      <p className="font-medium text-ink">{unit ? `Unit ${unit.unitNumber}` : 'Unit unknown'}</p>
                      <p className="text-sm text-muted">{occupantNames}</p>
                      <p className="text-sm text-muted">Lease ends {lease.endDate ? formatDate(lease.endDate) : '—'}</p>
                    </div>
                    <Badge variant={tone}>
                      {days === 0 ? 'Ends today' : days === 1 ? '1 day left' : `${days} days left`}
                    </Badge>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Leases expiring soon, soonest first */}
      {expiringSoon.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <div className="p-2 bg-warning-soft rounded-lg">
                <CalendarClock className="h-5 w-5 text-warning" />
              </div>
              Leases Expiring Soon ({expiringSoon.length})
              <button
                type="button"
                onClick={() => navigate('/tenants?expiring=1')}
                title="View in Tenants"
                className="ml-auto text-faint hover:text-ink transition-colors"
              >
                <ArrowRight className="h-4 w-4" />
              </button>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="border-t border-line">
              {expiringSoon.map(row => {
                const names = row.occupants.map(t => `${t.firstName} ${t.lastName}`).join(', ') || 'Tenant';
                const where = [row.property?.name ?? row.property?.address, row.unit ? `Unit ${row.unit.unitNumber}` : null]
                  .filter(Boolean).join(' · ');
                return (
                  <div
                    key={row.lease.id}
                    className="flex items-center gap-3 px-4 py-3.5 border-b border-line last:border-0 cursor-pointer hover:bg-black/[0.02]"
                    onClick={() => row.occupants[0] && navigate(`/tenants/${row.occupants[0].id}`)}
                  >
                    <CalendarClock className="h-4 w-4 text-faint flex-shrink-0" />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-ink truncate">{names}</p>
                      {where && <p className="text-xs text-muted truncate">{where}</p>}
                    </div>
                    <div className="text-right flex-shrink-0">
                      <Badge variant="warning" className="whitespace-nowrap">
                        {row.days === 0 ? 'Expires today' : `Expires in ${row.days} ${row.days === 1 ? 'day' : 'days'}`}
                      </Badge>
                      {row.lease.endDate && (
                        <p className="text-xs text-faint mt-1">{formatDate(row.lease.endDate)}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Vacant Units, one collapsible row per address */}
      {vacantUnits.length > 0 && (
        <Card className="border-dashed border-2 border-line-strong">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-muted">
              <div className="p-2 bg-primary-soft rounded-lg">
                <DoorOpen className="h-5 w-5 text-primary" />
              </div>
              Vacant Units ({vacantUnits.length})
              <button
                type="button"
                onClick={() => navigate('/properties')}
                title="Open Properties"
                className="ml-auto text-faint hover:text-ink transition-colors"
              >
                <ArrowRight className="h-4 w-4" />
              </button>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="border-t border-line">
              {vacantByProperty.map(group => {
                const isOpen = expandedVacant.has(group.key);
                return (
                  <div key={group.key} className="border-b border-line last:border-0">
                    <button
                      type="button"
                      onClick={() => toggleVacant(group.key)}
                      aria-expanded={isOpen}
                      className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-black/[0.02] text-left"
                    >
                      {isOpen
                        ? <ChevronDown className="h-4 w-4 text-faint flex-shrink-0" />
                        : <ChevronRight className="h-4 w-4 text-faint flex-shrink-0" />}
                      <span className="text-sm font-medium text-ink flex-1 truncate">{group.name}</span>
                      <Badge variant="warning" className="whitespace-nowrap">
                        {group.units.length} {group.units.length === 1 ? 'unit' : 'units'} vacant
                      </Badge>
                    </button>

                    {isOpen && (
                      <div className="bg-canvas px-4 sm:px-6 pb-2">
                        {group.units.map(unit => (
                          <div
                            key={unit.id}
                            className="flex items-center gap-3 py-2.5 border-b border-line last:border-0 cursor-pointer hover:bg-black/[0.03]"
                            onClick={() => navigate('/properties')}
                          >
                            <Home className="h-4 w-4 text-faint flex-shrink-0" />
                            <span className="text-sm text-ink w-24 sm:w-32 flex-shrink-0 truncate">Unit {unit.unitNumber}</span>
                            <span className="text-sm text-muted flex-1">{unit.bedrooms} bd · {unit.bathrooms} ba</span>
                            <span className="text-sm font-semibold text-primary tnum">
                              {formatCurrency(unit.monthlyRent)}<span className="text-xs text-faint font-normal">/mo</span>
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Overdue Payments Table - Clickable */}
      {overduePayments.length > 0 && (
        <Card className="shadow-lg border-[#e8cdc8]">
          <CardHeader>
            <CardTitle 
              className="flex items-center gap-2 text-danger cursor-pointer hover:text-red-800 transition-colors"
              onClick={() => navigate('/rents')}
            >
              <div className="p-2 bg-danger-soft rounded-lg">
                <AlertCircle className="h-5 w-5 text-danger" />
              </div>
              Overdue Payments ({overdueList.length})
              <ArrowRight className="h-4 w-4 ml-auto" />
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="border-t border-line">
              {overdueList.map(row => (
                <button
                  key={row.key}
                  type="button"
                  onClick={() => row.firstTenantId && navigate(`/tenants/${row.firstTenantId}`)}
                  className="w-full flex items-center gap-3 px-4 py-3 border-b border-line last:border-0 hover:bg-danger-soft/40 text-left transition-colors"
                >
                  <span className="text-sm font-medium text-ink flex-1 min-w-0 truncate">{row.tenantNames}</span>
                  <span className="text-xs text-muted whitespace-nowrap w-24 text-right">
                    {row.months} {row.months === 1 ? 'month' : 'months'}
                  </span>
                  <span className="text-sm font-semibold text-danger tnum whitespace-nowrap w-24 text-right">{formatCurrency(row.total)}</span>
                </button>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
