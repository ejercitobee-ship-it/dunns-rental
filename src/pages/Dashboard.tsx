import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DollarSign, CreditCard, TrendingUp,
  Activity, Building2, BarChart3, Users, AlertTriangle,
  Clock, CalendarCheck, Home, ChevronRight, ChevronDown,
  CalendarDays, ArrowRight, PieChart as PieChartIcon, Check,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Skeleton, StatCardSkeleton } from '../components/ui/Skeleton';
import { formatCurrency, formatDate, getMonthName, yearOf, monthOf, todayLocalDate } from '../lib/utils';
import { expenseCategoryLabel } from '../lib/financials';
import { TransactionDrillDown } from '../components/TransactionDrillDown';
import { useApp } from '../context/AppContext';
import { calendarApi, depositReturnsApi } from '../lib/api';
import { activeLeases, monthlyRevenue, settleMonth, leasesOwingMonth, monthsBehind, isLeaseExpiringSoon, daysUntilLeaseEnd } from '../lib/rent';
import { usePastDueMonths } from '../lib/usePastDueMonths';
import type { DashboardStats, Expense, Unit, CalendarEvent, DepositReturn } from '../types';
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
} from 'recharts';

const COLORS = [
  '#24503f', '#2c7a58', '#97671c', '#a23429', '#7e8b83',
  '#5b6abf', '#c2553a', '#3a8a6e', '#8b6f47', '#6b4c8a',
  '#2e8b8b', '#b5651d', '#5f7a3a', '#9b3a5f', '#4a7a9b',
];
const INCOME_COLOR = '#2c7a58';
const EXPENSE_COLOR = '#b98a5e';

// ---------------------------------------------------------------------------
// Stat Card
// ---------------------------------------------------------------------------
interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  iconBg?: string;
  valueColor?: string;
  onClick?: () => void;
}

function StatCard({ title, value, subtitle, icon, iconBg = 'bg-primary-soft text-primary', valueColor = 'text-ink', onClick }: StatCardProps) {
  return (
    <Card
      className="cursor-pointer hover:border-line-strong hover:shadow-[0_2px_12px_rgba(27,26,23,0.07)] transition-all"
      onClick={onClick}
    >
      <div className="p-5">
        <div className="flex items-center justify-between mb-1">
          <span className="eyebrow">{title}</span>
          <span className={`w-[34px] h-[34px] rounded-[10px] grid place-items-center [&_svg]:h-[18px] [&_svg]:w-[18px] ${iconBg}`}>{icon}</span>
        </div>
        <div className="mt-3 flex items-end gap-2">
          <span className={`font-display text-[24px] leading-none font-medium ${valueColor} tnum`}>{value}</span>
        </div>
        {subtitle && <p className="mt-1.5 text-[12px] text-muted">{subtitle}</p>}
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Context card (compact row under stat cards)
// ---------------------------------------------------------------------------
interface ContextCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  onClick?: () => void;
}

function ContextCard({ icon, label, value, onClick }: ContextCardProps) {
  return (
    <Card
      className="cursor-pointer hover:border-line-strong transition-all"
      onClick={onClick}
    >
      <div className="p-3 flex items-center gap-2.5">
        <span className="w-[34px] h-[34px] rounded-[10px] bg-canvas text-muted grid place-items-center flex-shrink-0 [&_svg]:h-[18px] [&_svg]:w-[18px]">{icon}</span>
        <div className="min-w-0">
          <p className="eyebrow !text-[10px]">{label}</p>
          <p className="text-[17px] font-medium text-ink mt-0.5">{value}</p>
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Attention tab types
// ---------------------------------------------------------------------------
type AttentionTab = 'pastDue' | 'overdue' | 'expiring' | 'vacant' | 'deposits';

export function Dashboard() {
  const navigate = useNavigate();
  const { properties, units, leases, rentPayments, expenses, incomes, getUnitLease, getLeaseTenants, isLoading, error } = useApp();
  const pastDueMonths = usePastDueMonths();
  const [expenseView, setExpenseView] = useState<'monthly' | 'annual'>('monthly');
  const [drillTitle, setDrillTitle] = useState('');
  const [drillExpenses, setDrillExpenses] = useState<Expense[]>([]);
  const [drillOpen, setDrillOpen] = useState(false);
  const [attentionTab, setAttentionTab] = useState<AttentionTab>('pastDue');

  const openDrill = (title: string, exps: Expense[]) => {
    setDrillTitle(title);
    setDrillExpenses(exps);
    setDrillOpen(true);
  };

  // ---------------------------------------------------------------------------
  // Data computations (unchanged logic)
  // ---------------------------------------------------------------------------
  const stats: DashboardStats = useMemo(() => {
    const totalProperties = properties.length;
    const totalUnits = units.length;
    const occupiedUnits = units.filter(u => !!getUnitLease(u.id)).length;
    const totalTenants = new Set(activeLeases(leases).flatMap(l => l.tenantIds)).size;

    const currentMonth = new Date().getMonth() + 1;
    const currentYear = new Date().getFullYear();

    const monthlyRentIncome = rentPayments
      .filter(r => r.status === 'paid' && r.month === currentMonth && r.year === currentYear && r.type !== 'credit')
      .reduce((sum, r) => sum + r.amount, 0);

    const monthlyOtherIncome = incomes
      .filter(i => i.source !== 'deposit' && monthOf(i.date) === currentMonth && yearOf(i.date) === currentYear)
      .reduce((sum, i) => sum + i.amount, 0);

    const monthlyIncome = monthlyRentIncome + monthlyOtherIncome;

    const monthlyExpenses = expenses
      .filter(e => monthOf(e.date) === currentMonth && yearOf(e.date) === currentYear)
      .reduce((sum, e) => sum + e.amount, 0);

    const currentLeases = leases.filter(l => l.status !== 'ended');
    const elapsedMonths = Array.from({ length: currentMonth }, (_, i) => i + 1);
    let totalOwed = 0;
    for (const month of elapsedMonths) {
      for (const lease of leasesOwingMonth(currentLeases, month, currentYear)) {
        totalOwed += settleMonth(lease, rentPayments, month, currentYear).balance;
      }
    }

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
  }, [properties, units, leases, expenses, incomes, rentPayments, getUnitLease]);

  const monthlyData = useMemo(() => {
    const currentYear = new Date().getFullYear();
    const months = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    return months.map(month => {
      const rent = rentPayments
        .filter(r => r.status === 'paid' && r.month === month && r.year === currentYear && r.type !== 'credit')
        .reduce((sum, r) => sum + r.amount, 0);
      const other = incomes
        .filter(i => i.source !== 'deposit' && monthOf(i.date) === month && yearOf(i.date) === currentYear)
        .reduce((sum, i) => sum + i.amount, 0);
      const monthIncome = rent + other;
      const monthExpenses = expenses
        .filter(e => monthOf(e.date) === month && yearOf(e.date) === currentYear)
        .reduce((sum, e) => sum + e.amount, 0);
      return { name: getMonthName(month), income: monthIncome, expenses: monthExpenses, net: monthIncome - monthExpenses };
    });
  }, [rentPayments, incomes, expenses]);

  const { expenseByCategory, filteredDashExpenses } = useMemo(() => {
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    const filtered = expenses.filter(e => {
      const y = yearOf(e.date);
      if (expenseView === 'annual') return y === currentYear;
      return y === currentYear && monthOf(e.date) === currentMonth;
    });
    const categories: Record<string, number> = {};
    filtered.forEach(e => {
      categories[e.category] = (categories[e.category] || 0) + e.amount;
    });
    return {
      expenseByCategory: Object.entries(categories)
        .map(([name, value]) => ({ name, value }))
        .sort((a, b) => b.value - a.value),
      filteredDashExpenses: filtered,
    };
  }, [expenses, expenseView]);

  // Monthly expense count for subtitle
  const monthlyExpenseCount = useMemo(() => {
    const now = new Date();
    return expenses.filter(e => monthOf(e.date) === now.getMonth() + 1 && yearOf(e.date) === now.getFullYear()).length;
  }, [expenses]);

  // Tenancies that owe two or more months of rent.
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

  // Overdue rent as a flat list: one row per overdue tenancy, most owed first.
  interface OverdueUnit {
    key: string; unitNumber: string; tenantNames: string; firstTenantId?: string;
    monthlyRent: number; months: number; total: number; propertyName: string;
  }
  const overdueList = useMemo<OverdueUnit[]>(() => {
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();
    const elapsed = Array.from({ length: currentMonth }, (_, i) => i + 1);
    const currentLeases = leases.filter(l => l.status !== 'ended');

    const perLease = new Map<string, { lease: ReturnType<typeof leasesOwingMonth>[number]; months: number; total: number }>();
    for (const month of elapsed) {
      for (const lease of leasesOwingMonth(currentLeases, month, currentYear)) {
        const s = settleMonth(lease, rentPayments, month, currentYear);
        if (s.status === 'paid') continue;
        let e = perLease.get(lease.id);
        if (!e) { e = { lease, months: 0, total: 0 }; perLease.set(lease.id, e); }
        e.months += 1;
        e.total = Math.round((e.total + s.balance) * 100) / 100;
      }
    }

    const rows: OverdueUnit[] = [];
    for (const { lease, months, total } of perLease.values()) {
      const property = lease.propertyId ? properties.find(p => p.id === lease.propertyId) : undefined;
      const unit = lease.unitId ? units.find(u => u.id === lease.unitId) : undefined;
      const occupants = getLeaseTenants(lease.id);
      rows.push({
        key: lease.id,
        unitNumber: unit?.unitNumber ?? '',
        tenantNames: occupants.map(t => `${t.firstName} ${t.lastName}`).join(', ') || 'Tenant',
        firstTenantId: occupants[0]?.id,
        monthlyRent: lease.monthlyRent || 0,
        months,
        total,
        propertyName: property?.name ?? property?.address ?? 'Unassigned',
      });
    }
    return rows.sort((a, b) => b.total - a.total);
  }, [leases, rentPayments, properties, units, getLeaseTenants]);

  // Leases expiring within 60 days.
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

  // Vacant units (no lease, not under maintenance).
  const vacantUnits = useMemo(() => {
    return units.filter(u => u.status !== 'maintenance' && !getUnitLease(u.id));
  }, [units, getUnitLease]);

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

  const [expandedVacant, setExpandedVacant] = useState<Set<string>>(new Set());
  const toggleVacant = (key: string) =>
    setExpandedVacant(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  // Calendar
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const loadCalendar = useCallback(() => {
    calendarApi.list().then(setCalendarEvents).catch(() => {});
  }, []);
  useEffect(() => { loadCalendar(); }, [loadCalendar]);

  // Deposit returns approaching deadline
  const [pendingDeposits, setPendingDeposits] = useState<DepositReturn[]>([]);
  useEffect(() => {
    depositReturnsApi.getAll({ status: 'pending' }).then(setPendingDeposits).catch(() => {});
    depositReturnsApi.getAll({ status: 'processing' }).then(more => {
      setPendingDeposits(prev => [...prev, ...more]);
    }).catch(() => {});
  }, []);

  const urgentDeposits = useMemo(() => {
    const today = todayLocalDate();
    return pendingDeposits
      .filter(dr => {
        const daysLeft = Math.ceil(
          (new Date(dr.deadlineDate + 'T00:00:00').getTime() - new Date(today + 'T00:00:00').getTime()) / (1000 * 60 * 60 * 24)
        );
        return daysLeft <= 14; // Show deposits due within 14 days or overdue
      })
      .sort((a, b) => a.deadlineDate.localeCompare(b.deadlineDate));
  }, [pendingDeposits]);

  const upcomingActivities = useMemo(() => {
    const t = todayLocalDate();
    return calendarEvents
      .filter(e => !e.completed && e.eventDate >= t)
      .sort((a, b) => a.eventDate.localeCompare(b.eventDate))
      .slice(0, 8);
  }, [calendarEvents]);

  // Auto-select the first non-empty attention tab
  const attentionCounts = useMemo(() => ({
    pastDue: pastDue.length,
    overdue: overdueList.length,
    expiring: expiringSoon.length,
    vacant: vacantUnits.length,
    deposits: urgentDeposits.length,
  }), [pastDue, overdueList, expiringSoon, vacantUnits, urgentDeposits]);

  const totalAttention = attentionCounts.pastDue + attentionCounts.overdue + attentionCounts.expiring + attentionCounts.vacant + attentionCounts.deposits;

  // On first render, pick the tab with the most items
  useEffect(() => {
    if (attentionCounts.pastDue > 0) setAttentionTab('pastDue');
    else if (attentionCounts.overdue > 0) setAttentionTab('overdue');
    else if (attentionCounts.deposits > 0) setAttentionTab('deposits');
    else if (attentionCounts.expiring > 0) setAttentionTab('expiring');
    else if (attentionCounts.vacant > 0) setAttentionTab('vacant');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Projected rent for collection rate
  const projectedMonthlyRent = monthlyRevenue(leases);
  const collectionRate = projectedMonthlyRent > 0
    ? Math.round((stats.monthlyIncome / projectedMonthlyRent) * 100)
    : 0;
  const unitsPaid = useMemo(() => {
    const now = new Date();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();
    const currentLeases = leasesOwingMonth(leases.filter(l => l.status !== 'ended'), currentMonth, currentYear);
    let paid = 0;
    for (const lease of currentLeases) {
      if (settleMonth(lease, rentPayments, currentMonth, currentYear).status === 'paid') paid++;
    }
    return { paid, total: currentLeases.length };
  }, [leases, rentPayments]);

  if (isLoading) return <DashboardSkeleton />;

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-danger">Error loading data: {error}</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <p className="eyebrow">Portfolio overview</p>
          <h1 className="font-display text-[28px] sm:text-[34px] text-ink mt-1">Dashboard</h1>
        </div>
        <div className="flex items-center gap-2 text-[13px] text-muted">
          <span className="w-1.5 h-1.5 bg-positive rounded-full" />
          {formatDate(new Date().toISOString())}
        </div>
      </div>

      {/* ================================================================
          ZONE 1: THIS MONTH SNAPSHOT
          ================================================================ */}
      <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-4">
        <StatCard
          title="Collected"
          value={formatCurrency(stats.monthlyIncome)}
          subtitle={`of ${formatCurrency(projectedMonthlyRent)} projected`}
          icon={<DollarSign />}
          onClick={() => navigate('/rents')}
        />
        <StatCard
          title="Expenses"
          value={formatCurrency(stats.monthlyExpenses)}
          subtitle={`${monthlyExpenseCount} transaction${monthlyExpenseCount !== 1 ? 's' : ''}`}
          icon={<CreditCard />}
          iconBg="bg-warning-soft text-warning"
          onClick={() => navigate('/finances')}
        />
        <StatCard
          title="Net cash flow"
          value={`${stats.netIncome >= 0 ? '+' : ''}${formatCurrency(stats.netIncome)}`}
          subtitle="Income minus expenses"
          icon={<TrendingUp />}
          valueColor={stats.netIncome >= 0 ? 'text-positive' : 'text-danger'}
          onClick={() => navigate('/finances')}
        />
        <StatCard
          title="Collection rate"
          value={`${collectionRate}%`}
          subtitle={`${unitsPaid.paid} of ${unitsPaid.total} units paid`}
          icon={<Activity />}
          onClick={() => navigate('/rents')}
        />
      </div>

      {/* Context row: portfolio at a glance */}
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        <ContextCard icon={<Building2 />} label="Properties" value={stats.totalProperties} onClick={() => navigate('/properties')} />
        <ContextCard icon={<Home />} label="Units" value={stats.totalUnits} onClick={() => navigate('/properties')} />
        <ContextCard icon={<Users />} label="Active tenants" value={stats.totalTenants} onClick={() => navigate('/tenants')} />
        <ContextCard icon={<BarChart3 />} label="Occupancy" value={`${stats.occupancyRate.toFixed(0)}%`} onClick={() => navigate('/properties')} />
      </div>

      {/* ================================================================
          ZONE 2: TRENDS
          ================================================================ */}
      <h2 className="eyebrow mt-2">Trends</h2>
      <div className="grid gap-4 md:grid-cols-[5fr_3fr]">
        {/* Income vs Expenses bar chart */}
        <Card className="cursor-pointer hover:border-line-strong transition-all" onClick={() => navigate('/finances')}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-lg bg-primary-soft text-primary grid place-items-center [&_svg]:h-[15px] [&_svg]:w-[15px]"><BarChart3 /></span>
              Income vs expenses
              <ArrowRight className="h-4 w-4 text-faint ml-auto" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-4 mb-2 text-[11px] text-muted">
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: INCOME_COLOR }} />Income</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: EXPENSE_COLOR }} />Expenses</span>
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e7e4dd" vertical={false} />
                <XAxis dataKey="name" stroke="#a6a29a" fontSize={11} tickLine={false} axisLine={false} />
                <YAxis tickFormatter={(value) => `$${Number(value) / 1000}k`} stroke="#a6a29a" fontSize={11} tickLine={false} axisLine={false} />
                <Tooltip
                  formatter={(value) => formatCurrency(Number(value))}
                  cursor={{ fill: 'rgba(27,26,23,0.04)' }}
                  contentStyle={{ borderRadius: '10px', border: '1px solid #e7e4dd', boxShadow: '0 8px 30px -8px rgba(27,26,23,0.18)' }}
                />
                <Bar dataKey="income" fill={INCOME_COLOR} radius={[3, 3, 0, 0]} maxBarSize={20} />
                <Bar dataKey="expenses" fill={EXPENSE_COLOR} radius={[3, 3, 0, 0]} maxBarSize={20} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Expenses by Category */}
        <Card className="cursor-pointer hover:border-line-strong transition-all" onClick={() => navigate('/finances')}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-lg bg-primary-soft text-primary grid place-items-center [&_svg]:h-[15px] [&_svg]:w-[15px]"><PieChartIcon /></span>
                By category
              </CardTitle>
              <div
                className="flex rounded-lg border border-line overflow-hidden text-xs"
                onClick={e => e.stopPropagation()}
              >
                <button
                  className={`px-2.5 py-1 transition-colors ${expenseView === 'monthly' ? 'bg-primary text-white' : 'text-muted hover:bg-canvas'}`}
                  onClick={() => setExpenseView('monthly')}
                >Monthly</button>
                <button
                  className={`px-2.5 py-1 transition-colors ${expenseView === 'annual' ? 'bg-primary text-white' : 'text-muted hover:bg-canvas'}`}
                  onClick={() => setExpenseView('annual')}
                >Annual</button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {expenseByCategory.length === 0 ? (
              <p className="text-center text-sm text-muted py-8">No expenses this {expenseView === 'monthly' ? 'month' : 'year'}</p>
            ) : (
              <>
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie
                      data={expenseByCategory}
                      cx="50%"
                      cy="50%"
                      innerRadius={45}
                      outerRadius={65}
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
                <div className="space-y-1.5 mt-2 max-h-48 overflow-y-auto">
                  {expenseByCategory.map((cat, idx) => (
                    <button
                      key={cat.name}
                      onClick={(e) => {
                        e.stopPropagation();
                        openDrill(
                          `${expenseCategoryLabel(cat.name)} Expenses`,
                          filteredDashExpenses.filter(ex => ex.category === cat.name)
                        );
                      }}
                      className="flex items-center justify-between text-sm w-full text-left hover:bg-black/[0.02] rounded-lg px-2 py-1 -mx-2 transition-colors"
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: COLORS[idx % COLORS.length] }} />
                        <span className="text-muted text-[12px]">{expenseCategoryLabel(cat.name)}</span>
                      </div>
                      <span className="font-semibold text-ink tnum text-[13px]">{formatCurrency(cat.value)}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Upcoming Activities */}
      {upcomingActivities.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="w-7 h-7 rounded-lg bg-primary-soft text-primary grid place-items-center [&_svg]:h-[15px] [&_svg]:w-[15px]"><CalendarDays /></span>
              Upcoming ({upcomingActivities.length})
              <button
                type="button"
                onClick={() => navigate('/calendar')}
                title="Open Calendar"
                className="ml-auto text-faint hover:text-ink transition-colors"
              >
                <ArrowRight className="h-4 w-4" />
              </button>
            </CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="border-t border-line divide-y divide-line">
              {upcomingActivities.map(event => {
                const t = todayLocalDate();
                const diffMs = new Date(event.eventDate + 'T00:00:00').getTime() - new Date(t + 'T00:00:00').getTime();
                const daysLeft = Math.round(diffMs / 86400000);
                const property = event.propertyId ? properties.find(p => p.id === event.propertyId) : null;
                const catLabel = event.category.replace(/_/g, ' ');
                const isUrgent = event.priority === 'urgent' || event.priority === 'high';
                const eventMonth = new Date(event.eventDate + 'T00:00:00').toLocaleString('en-US', { month: 'short' });
                const eventDay = new Date(event.eventDate + 'T00:00:00').getDate();
                return (
                  <div
                    key={event.id}
                    className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-canvas/60 transition-colors"
                    onClick={() => navigate('/calendar')}
                  >
                    <div className="w-[38px] h-[38px] rounded-lg bg-canvas flex flex-col items-center justify-center flex-shrink-0">
                      <span className="text-[9px] uppercase text-faint leading-none tracking-wide">{eventMonth}</span>
                      <span className="text-[15px] font-semibold text-ink leading-none">{eventDay}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-ink truncate">{event.title}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-xs text-muted capitalize">{catLabel}</span>
                        {property && <span className="text-xs text-muted">· {property.name || property.address}</span>}
                      </div>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <Badge variant={daysLeft <= 3 ? (isUrgent ? 'destructive' : 'warning') : 'default'}>
                        {daysLeft === 0 ? 'Today' : daysLeft === 1 ? 'Tomorrow' : `In ${daysLeft} days`}
                      </Badge>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ================================================================
          ZONE 3: NEEDS ATTENTION (bottom)
          ================================================================ */}
      <h2 className="eyebrow mt-2">Needs attention</h2>
      <Card>
        {/* Tab bar */}
        <div className="flex border-b border-line bg-canvas/50 rounded-t-xl overflow-x-auto">
          {([
            { key: 'pastDue' as const, label: 'Past due', icon: <AlertTriangle className="h-3.5 w-3.5" />, count: attentionCounts.pastDue, color: 'danger' },
            { key: 'overdue' as const, label: 'Overdue', icon: <Clock className="h-3.5 w-3.5" />, count: attentionCounts.overdue, color: 'danger' },
            { key: 'deposits' as const, label: 'Deposits', icon: <DollarSign className="h-3.5 w-3.5" />, count: attentionCounts.deposits, color: 'warning' },
            { key: 'expiring' as const, label: 'Expiring', icon: <CalendarCheck className="h-3.5 w-3.5" />, count: attentionCounts.expiring, color: 'warning' },
            { key: 'vacant' as const, label: 'Vacant', icon: <Home className="h-3.5 w-3.5" />, count: attentionCounts.vacant, color: 'muted' },
          ]).map(tab => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setAttentionTab(tab.key)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-3 px-2 text-xs font-semibold transition-colors relative whitespace-nowrap ${
                attentionTab === tab.key ? 'text-ink' : 'text-faint hover:text-muted'
              }`}
            >
              {tab.icon}
              <span className="hidden sm:inline">{tab.label}</span>
              <span className={`inline-flex items-center justify-center text-[10px] font-semibold min-w-[18px] h-[18px] px-1 rounded-full ${
                tab.count === 0
                  ? 'bg-positive-soft text-positive'
                  : tab.color === 'danger'
                    ? 'bg-danger-soft text-danger'
                    : tab.color === 'warning'
                      ? 'bg-warning-soft text-warning'
                      : 'bg-canvas text-muted'
              }`}>{tab.count}</span>
              {attentionTab === tab.key && (
                <span className="absolute bottom-0 left-4 right-4 h-0.5 bg-primary rounded-t" />
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        {totalAttention === 0 ? (
          // All clear state
          <div className="py-10 text-center">
            <span className="w-10 h-10 rounded-full bg-positive-soft text-positive inline-flex items-center justify-center mb-3">
              <Check className="h-5 w-5" />
            </span>
            <p className="font-medium text-ink">Everything is running smoothly</p>
            <p className="text-sm text-muted mt-1">No overdue payments, no expiring leases, no vacant units.</p>
          </div>
        ) : (
          <CardContent className="p-0">
            <div className="divide-y divide-line">
              {/* Past due tab */}
              {attentionTab === 'pastDue' && (pastDue.length === 0 ? (
                <p className="text-center text-sm text-muted py-8">No tenancies are {pastDueMonths}+ months past due.</p>
              ) : pastDue.map(row => {
                const names = row.occupants.map(t => `${t.firstName} ${t.lastName}`).join(', ') || 'Tenant';
                const place = [row.property?.name, row.unit ? `Unit ${row.unit.unitNumber}` : null].filter(Boolean).join(' · ');
                const firstTenant = row.occupants[0];
                return (
                  <button
                    key={row.lease.id}
                    type="button"
                    onClick={() => firstTenant && navigate(`/tenants/${firstTenant.id}`)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-canvas/60 transition-colors"
                  >
                    <span className="w-[30px] h-[30px] rounded-lg bg-danger-soft text-danger grid place-items-center flex-shrink-0">
                      <AlertTriangle className="h-[15px] w-[15px]" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-ink truncate">{names}</p>
                      {place && <p className="text-[11px] text-muted truncate">{place}</p>}
                    </div>
                    <Badge variant="destructive" className="whitespace-nowrap">{row.months} months</Badge>
                    <span className="text-[13px] font-semibold text-danger tnum flex-shrink-0">{formatCurrency(row.balance)}</span>
                    <ChevronRight className="h-3.5 w-3.5 text-faint flex-shrink-0" />
                  </button>
                );
              }))}

              {/* Overdue tab */}
              {attentionTab === 'overdue' && (overdueList.length === 0 ? (
                <p className="text-center text-sm text-muted py-8">No overdue payments.</p>
              ) : overdueList.map(row => (
                <button
                  key={row.key}
                  type="button"
                  onClick={() => row.firstTenantId && navigate(`/tenants/${row.firstTenantId}`)}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-canvas/60 transition-colors"
                >
                  <span className="w-[30px] h-[30px] rounded-lg bg-danger-soft text-danger grid place-items-center flex-shrink-0">
                    <Clock className="h-[15px] w-[15px]" />
                  </span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[13px] font-medium text-ink truncate">{row.tenantNames}</p>
                    <p className="text-[11px] text-muted truncate">{row.propertyName}{row.unitNumber ? ` · Unit ${row.unitNumber}` : ''}</p>
                  </div>
                  <Badge variant="destructive" className="whitespace-nowrap">
                    {row.months} {row.months === 1 ? 'month' : 'months'}
                  </Badge>
                  <span className="text-[13px] font-semibold text-danger tnum flex-shrink-0">{formatCurrency(row.total)}</span>
                  <ChevronRight className="h-3.5 w-3.5 text-faint flex-shrink-0" />
                </button>
              )))}

              {/* Expiring tab */}
              {attentionTab === 'expiring' && (expiringSoon.length === 0 ? (
                <p className="text-center text-sm text-muted py-8">No leases expiring soon.</p>
              ) : expiringSoon.map(row => {
                const names = row.occupants.map(t => `${t.firstName} ${t.lastName}`).join(', ') || 'Tenant';
                const where = [row.property?.name ?? row.property?.address, row.unit ? `Unit ${row.unit.unitNumber}` : null]
                  .filter(Boolean).join(' · ');
                return (
                  <button
                    key={row.lease.id}
                    type="button"
                    onClick={() => row.occupants[0] && navigate(`/tenants/${row.occupants[0].id}`)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-canvas/60 transition-colors"
                  >
                    <span className="w-[30px] h-[30px] rounded-lg bg-warning-soft text-warning grid place-items-center flex-shrink-0">
                      <CalendarCheck className="h-[15px] w-[15px]" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-ink truncate">{names}</p>
                      {where && <p className="text-[11px] text-muted truncate">{where}</p>}
                    </div>
                    <Badge variant="warning" className="whitespace-nowrap">
                      {row.days === 0 ? 'Expires today' : `${row.days} day${row.days === 1 ? '' : 's'}`}
                    </Badge>
                    {row.lease.endDate && (
                      <span className="text-xs text-faint flex-shrink-0">{formatDate(row.lease.endDate)}</span>
                    )}
                    <ChevronRight className="h-3.5 w-3.5 text-faint flex-shrink-0" />
                  </button>
                );
              }))}

              {/* Deposits tab */}
              {attentionTab === 'deposits' && (urgentDeposits.length === 0 ? (
                <p className="text-center text-sm text-muted py-8">No deposit returns approaching deadline.</p>
              ) : urgentDeposits.map(dr => {
                const daysLeft = Math.ceil(
                  (new Date(dr.deadlineDate + 'T00:00:00').getTime() - new Date(todayLocalDate() + 'T00:00:00').getTime()) / (1000 * 60 * 60 * 24)
                );
                const overdue = daysLeft < 0;
                return (
                  <button
                    key={dr.id}
                    type="button"
                    onClick={() => dr.tenantId && navigate(`/tenants/${dr.tenantId}`)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-canvas/60 transition-colors"
                  >
                    <span className={`w-[30px] h-[30px] rounded-lg grid place-items-center flex-shrink-0 ${
                      overdue ? 'bg-danger-soft text-danger' : 'bg-warning-soft text-warning'
                    }`}>
                      <DollarSign className="h-[15px] w-[15px]" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-ink truncate">{dr.tenantName || 'Tenant'}</p>
                      <p className="text-[11px] text-muted truncate">
                        {dr.propertyName}{dr.unitNumber ? ` · Unit ${dr.unitNumber}` : ''}
                      </p>
                    </div>
                    <Badge variant={overdue ? 'destructive' : 'warning'} className="whitespace-nowrap">
                      {overdue ? `${Math.abs(daysLeft)} days overdue` : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`}
                    </Badge>
                    <span className="text-[13px] font-semibold text-ink tnum flex-shrink-0">{formatCurrency(dr.depositAmount)}</span>
                    <ChevronRight className="h-3.5 w-3.5 text-faint flex-shrink-0" />
                  </button>
                );
              }))}

              {/* Vacant tab */}
              {attentionTab === 'vacant' && (vacantUnits.length === 0 ? (
                <p className="text-center text-sm text-muted py-8">No vacant units.</p>
              ) : vacantByProperty.map(group => {
                const isOpen = expandedVacant.has(group.key);
                return (
                  <div key={group.key}>
                    <button
                      type="button"
                      onClick={() => toggleVacant(group.key)}
                      aria-expanded={isOpen}
                      className="w-full flex items-center gap-3 px-4 py-3 hover:bg-canvas/60 text-left transition-colors"
                    >
                      <span className="w-[30px] h-[30px] rounded-lg bg-canvas text-muted grid place-items-center flex-shrink-0">
                        <Home className="h-[15px] w-[15px]" />
                      </span>
                      <span className="text-[13px] font-medium text-ink flex-1 truncate">{group.name}</span>
                      <Badge variant="warning" className="whitespace-nowrap">
                        {group.units.length} {group.units.length === 1 ? 'unit' : 'units'}
                      </Badge>
                      {isOpen
                        ? <ChevronDown className="h-3.5 w-3.5 text-faint flex-shrink-0" />
                        : <ChevronRight className="h-3.5 w-3.5 text-faint flex-shrink-0" />}
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
              }))}
            </div>
          </CardContent>
        )}
      </Card>

      {/* Drill-down modal for expense categories */}
      <TransactionDrillDown
        isOpen={drillOpen}
        onClose={() => setDrillOpen(false)}
        title={drillTitle}
        expenses={drillExpenses}
        properties={properties}
        units={units}
        forceTab="expenses"
      />
    </div>
  );
}

function DashboardSkeleton() {
  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div>
        <Skeleton className="h-8 w-48" />
        <Skeleton className="mt-2 h-4 w-72" />
      </div>
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)}
      </div>
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <StatCardSkeleton key={i} />)}
      </div>
      <div className="grid gap-6 md:grid-cols-[5fr_3fr]">
        <div className="rounded-xl border border-line bg-surface p-6">
          <Skeleton className="h-5 w-32 mb-4" />
          <Skeleton className="h-[200px] w-full rounded-lg" />
        </div>
        <div className="rounded-xl border border-line bg-surface p-6">
          <Skeleton className="h-5 w-32 mb-4" />
          <Skeleton className="h-[200px] w-full rounded-lg" />
        </div>
      </div>
    </div>
  );
}
