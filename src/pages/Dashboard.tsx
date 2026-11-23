import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DollarSign, Building2, BarChart3, Users, AlertTriangle,
  Clock, CalendarCheck, Home, ChevronRight, ChevronDown,
  CalendarDays, ArrowRight, PieChart as PieChartIcon, Check,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Skeleton } from '../components/ui/Skeleton';
import { PageHeader } from '../components/ui/PageHeader';
import { CHART_TOOLTIP, CHART_AXIS, CHART_GRID, INCOME_COLOR, EXPENSE_COLOR } from '../components/ui/chartConstants';
import { formatCurrency, formatDate, getMonthName, yearOf, monthOf, todayLocalDate } from '../lib/utils';
import { expenseCategoryLabel } from '../lib/financials';
import { TransactionDrillDown } from '../components/TransactionDrillDown';
import { useApp } from '../context/AppContext';
import { calendarApi, depositReturnsApi } from '../lib/api';
import { activeLeases, monthlyRevenue, settleMonthWithCredit, leasesOwingMonth, monthsBehind, daysUntilLeaseEnd, vacancyLossForYear, leaseCoversMonth } from '../lib/rent';
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

// ---------------------------------------------------------------------------
// Attention tab types
// ---------------------------------------------------------------------------
type AttentionTab = 'pastDue' | 'overdue' | 'expiring' | 'vacant' | 'deposits';

export function Dashboard() {
  const navigate = useNavigate();
  const { properties, units, leases, rentPayments, expenses, incomes, paymentAllocations, getUnitLease, getLeaseTenants, isLoading, error } = useApp();
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

    const elapsedMonths = Array.from({ length: currentMonth }, (_, i) => i + 1);
    let totalOwed = 0;
    for (const month of elapsedMonths) {
      for (const lease of leasesOwingMonth(leases, month, currentYear)) {
        if (lease.status === 'ended') continue;
        totalOwed += settleMonthWithCredit(lease, rentPayments, month, currentYear, leases, paymentAllocations).balance;
      }
    }

    const projectedYearlyIncome = monthlyRevenue(leases) * 12;

    // Vacancy loss: daily-prorated rent lost from vacant units.
    const vacancy = vacancyLossForYear(units, leases, currentYear, currentMonth);
    const vacancyRate = vacancy.totalAvailableDays > 0
      ? (vacancy.totalVacantDays / vacancy.totalAvailableDays) * 100
      : 0;

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
      vacancyLossThisMonth: vacancy.thisMonth,
      vacancyLossYTD: vacancy.total,
      grossPotentialRentMonth: vacancy.grossPotentialRentMonth,
      vacancyRate,
      vacantAvailable: 0, // filled after vacantUnits computed
      vacantPendingLease: 0, // filled after futureLeaseUnitIds computed
    };
  }, [properties, units, leases, expenses, incomes, rentPayments, paymentAllocations, getUnitLease]);

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
      .map(lease => ({ lease, ...monthsBehind(lease, rentPayments, month, year, leases, paymentAllocations) }))
      .filter(x => x.months >= pastDueMonths)
      .map(x => ({
        ...x,
        property: x.lease.propertyId ? properties.find(p => p.id === x.lease.propertyId) : undefined,
        unit: x.lease.unitId ? units.find(u => u.id === x.lease.unitId) : undefined,
        occupants: getLeaseTenants(x.lease.id),
      }))
      .sort((a, b) => b.months - a.months || b.balance - a.balance);
  }, [leases, rentPayments, paymentAllocations, properties, units, getLeaseTenants, pastDueMonths]);

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
    const perLease = new Map<string, { lease: ReturnType<typeof leasesOwingMonth>[number]; months: number; total: number }>();
    for (const month of elapsed) {
      for (const lease of leasesOwingMonth(leases, month, currentYear)) {
        if (lease.status === 'ended') continue;
        const s = settleMonthWithCredit(lease, rentPayments, month, currentYear, leases, paymentAllocations);
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
  }, [leases, rentPayments, paymentAllocations, properties, units, getLeaseTenants]);

  // All active fixed-term leases with an end date, sorted by soonest expiration.
  const expiringSoon = useMemo(() => {
    const today = todayLocalDate();
    return activeLeases(leases)
      .filter(lease => lease.endDate && daysUntilLeaseEnd(lease, today) !== null)
      .map(lease => ({
        lease,
        days: daysUntilLeaseEnd(lease, today) ?? 0,
        property: lease.propertyId ? properties.find(p => p.id === lease.propertyId) : undefined,
        unit: lease.unitId ? units.find(u => u.id === lease.unitId) : undefined,
        occupants: getLeaseTenants(lease.id),
      }))
      .sort((a, b) => a.days - b.days);
  }, [leases, properties, units, getLeaseTenants]);

  // Vacant units: no lease covers the current month (even if a future lease
  // exists). Units under maintenance are excluded from the listing concern but
  // vacancy loss still counted them above.
  const currentMonth = new Date().getMonth() + 1;
  const currentYear = new Date().getFullYear();

  const vacantUnits = useMemo(() => {
    return units
      .filter(u => u.status !== 'maintenance' && u.status !== 'renovation'
        && u.status !== 'owner_hold' && u.status !== 'unrentable')
      .filter(u => {
        // Only non-ended leases matter: an ended lease means the unit is
        // vacant now even if its date range still includes this month.
        const unitLeases = leases.filter(l => l.unitId === u.id && l.status !== 'ended');
        return !unitLeases.some(l => leaseCoversMonth(l, currentMonth, currentYear));
      });
  }, [units, leases, currentMonth, currentYear]);

  /** Units that are vacant now but have a lease starting in the future (not
   *  available for new listings). */
  const futureLeaseUnitIds = useMemo(() => {
    const ids = new Set<string>();
    const target = currentYear * 12 + currentMonth;
    for (const u of vacantUnits) {
      const hasUpcoming = leases.some(l =>
        l.unitId === u.id && l.status !== 'ended' && !l.needsReview
        && l.renewalStatus !== 'pending' && l.renewalStatus !== 'rejected'
        && l.renewalStatus !== 'draft' && l.renewalStatus !== 'cancelled'
        && l.startDate && (() => {
          const [y, m] = l.startDate!.split('-').map(Number);
          return y * 12 + m > target;
        })()
      );
      if (hasUpcoming) ids.add(u.id);
    }
    return ids;
  }, [vacantUnits, leases, currentMonth, currentYear]);

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
    const currentLeases = leasesOwingMonth(leases, currentMonth, currentYear).filter(l => l.status !== 'ended');
    let paid = 0;
    for (const lease of currentLeases) {
      if (settleMonthWithCredit(lease, rentPayments, currentMonth, currentYear, leases, paymentAllocations).status === 'paid') paid++;
    }
    return { paid, total: currentLeases.length };
  }, [leases, rentPayments, paymentAllocations]);

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
      <PageHeader
        eyebrow="Portfolio overview"
        title="Dashboard"
        actions={
          <div className="flex items-center gap-2 text-[13px] text-muted">
            <span className="w-1.5 h-1.5 bg-positive rounded-full" />
            {formatDate(new Date().toISOString())}
          </div>
        }
      />

      {/* ================================================================
          ZONE 1: HERO SNAPSHOT
          ================================================================ */}
      <div className="rounded-2xl overflow-hidden relative" style={{ background: 'linear-gradient(135deg, #1e3a2e 0%, #24503f 40%, #2c5c4a 100%)' }}>
        <div className="absolute -top-20 -right-10 w-72 h-72 rounded-full pointer-events-none" style={{ background: 'rgba(201,169,110,0.06)' }} />

        <div className="flex items-center justify-between px-5 sm:px-7 pt-5 relative z-10">
          <span className="text-[13px] text-white/55 font-medium">{getMonthName(new Date().getMonth() + 1)} {new Date().getFullYear()}</span>
          <span className="flex items-center gap-1.5 text-[12px] text-white/40">
            <span className="w-1.5 h-1.5 bg-emerald-400 rounded-full" />
            Live
          </span>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 px-5 sm:px-7 pt-5 pb-6 gap-y-5 relative z-10">
          <button type="button" onClick={() => navigate('/rents')} className="text-left lg:pr-5 lg:border-r lg:border-white/[0.08] hover:opacity-80 transition-opacity">
            <p className="text-[11px] text-white/45 uppercase tracking-wider font-medium">Collected</p>
            <p className="font-display text-[26px] font-semibold leading-tight tnum mt-1.5" style={{ color: '#c9a96e' }}>{formatCurrency(stats.monthlyIncome)}</p>
            <p className="text-[11px] text-white/35 mt-1">of {formatCurrency(projectedMonthlyRent)} projected</p>
          </button>
          <button type="button" onClick={() => navigate('/finances')} className="text-left lg:px-5 lg:border-r lg:border-white/[0.08] hover:opacity-80 transition-opacity">
            <p className="text-[11px] text-white/45 uppercase tracking-wider font-medium">Expenses</p>
            <p className="font-display text-[26px] font-semibold text-white leading-tight tnum mt-1.5">{formatCurrency(stats.monthlyExpenses)}</p>
            <p className="text-[11px] text-white/35 mt-1">{monthlyExpenseCount} transaction{monthlyExpenseCount !== 1 ? 's' : ''}</p>
          </button>
          <button type="button" onClick={() => navigate('/finances')} className="text-left lg:px-5 lg:border-r lg:border-white/[0.08] hover:opacity-80 transition-opacity">
            <p className="text-[11px] text-white/45 uppercase tracking-wider font-medium">Net cash flow</p>
            <p className="font-display text-[26px] font-semibold leading-tight tnum mt-1.5" style={{ color: stats.netIncome >= 0 ? '#6ee7a0' : '#f87171' }}>{stats.netIncome >= 0 ? '+' : ''}{formatCurrency(stats.netIncome)}</p>
            <p className="text-[11px] text-white/35 mt-1">Income minus expenses</p>
          </button>
          <button type="button" onClick={() => navigate('/rents')} className="text-left lg:pl-5 hover:opacity-80 transition-opacity">
            <p className="text-[11px] text-white/45 uppercase tracking-wider font-medium">Collection</p>
            <p className="font-display text-[26px] font-semibold text-white leading-tight tnum mt-1.5">{collectionRate}%</p>
            <p className="text-[11px] text-white/35 mt-1">{unitsPaid.paid} of {unitsPaid.total} units paid</p>
          </button>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 border-t border-white/[0.06] relative z-10" style={{ background: 'rgba(0,0,0,0.12)' }}>
          <button type="button" onClick={() => navigate('/properties')} className="flex items-center gap-2 px-4 sm:px-5 py-3.5 lg:border-r border-white/[0.06] hover:bg-white/[0.03] transition-colors">
            <span className="w-7 h-7 rounded-lg bg-white/[0.08] grid place-items-center flex-shrink-0"><Building2 className="h-3.5 w-3.5 text-white/50" /></span>
            <div><p className="text-[15px] font-semibold text-white tnum">{stats.totalProperties}</p><p className="text-[10px] text-white/35 uppercase tracking-wide">Properties</p></div>
          </button>
          <button type="button" onClick={() => navigate('/properties')} className="flex items-center gap-2 px-4 sm:px-5 py-3.5 lg:border-r border-white/[0.06] hover:bg-white/[0.03] transition-colors">
            <span className="w-7 h-7 rounded-lg bg-white/[0.08] grid place-items-center flex-shrink-0"><Home className="h-3.5 w-3.5 text-white/50" /></span>
            <div><p className="text-[15px] font-semibold text-white tnum">{stats.totalUnits}</p><p className="text-[10px] text-white/35 uppercase tracking-wide">Units</p></div>
          </button>
          <button type="button" onClick={() => navigate('/tenants')} className="flex items-center gap-2 px-4 sm:px-5 py-3.5 lg:border-r border-white/[0.06] hover:bg-white/[0.03] transition-colors">
            <span className="w-7 h-7 rounded-lg bg-white/[0.08] grid place-items-center flex-shrink-0"><Users className="h-3.5 w-3.5 text-white/50" /></span>
            <div><p className="text-[15px] font-semibold text-white tnum">{stats.totalTenants}</p><p className="text-[10px] text-white/35 uppercase tracking-wide">Tenants</p></div>
          </button>
          <button type="button" onClick={() => navigate('/properties')} className="flex items-center gap-2 px-4 sm:px-5 py-3.5 hover:bg-white/[0.03] transition-colors">
            <span className="w-7 h-7 rounded-lg bg-white/[0.08] grid place-items-center flex-shrink-0"><BarChart3 className="h-3.5 w-3.5 text-white/50" /></span>
            <div><p className="text-[15px] font-semibold text-white tnum">{stats.occupancyRate.toFixed(0)}%</p><p className="text-[10px] text-white/35 uppercase tracking-wide">Occupancy</p></div>
          </button>
        </div>
      </div>


      {/* ================================================================
          ZONE 2: TRENDS
          ================================================================ */}
      <h2 className="section-heading mt-2">Trends</h2>
      <div className="grid gap-4 md:grid-cols-[5fr_3fr]">
        {/* Income vs Expenses bar chart */}
        <Card className="group cursor-pointer hover:border-line-strong hover:shadow-[0_4px_16px_rgba(27,26,23,0.08)] transition-all" onClick={() => navigate('/finances')}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2.5">
              <span className="w-10 h-10 rounded-xl bg-primary-soft text-primary grid place-items-center [&_svg]:h-[20px] [&_svg]:w-[20px] shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]"><BarChart3 /></span>
              Income vs expenses
              <ArrowRight className="h-4 w-4 text-faint ml-auto opacity-0 group-hover:opacity-100 transition-opacity" />
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex gap-4 mb-2 text-[11px] text-muted">
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: INCOME_COLOR }} />Income</span>
              <span className="flex items-center gap-1.5"><span className="w-2 h-2 rounded-sm" style={{ background: EXPENSE_COLOR }} />Expenses</span>
            </div>
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={monthlyData}>
                <CartesianGrid {...CHART_GRID} />
                <XAxis dataKey="name" {...CHART_AXIS} />
                <YAxis tickFormatter={(value) => `$${Number(value) / 1000}k`} {...CHART_AXIS} />
                <Tooltip
                  formatter={(value) => formatCurrency(Number(value))}
                  cursor={{ fill: 'rgba(27,26,23,0.04)' }}
                  contentStyle={CHART_TOOLTIP}
                />
                <Bar dataKey="income" fill={INCOME_COLOR} radius={[4, 4, 0, 0]} maxBarSize={22} />
                <Bar dataKey="expenses" fill={EXPENSE_COLOR} radius={[4, 4, 0, 0]} maxBarSize={22} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        {/* Expenses by Category */}
        <Card className="group cursor-pointer hover:border-line-strong hover:shadow-[0_4px_16px_rgba(27,26,23,0.08)] transition-all" onClick={() => navigate('/finances')}>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle className="flex items-center gap-2.5">
                <span className="w-10 h-10 rounded-xl bg-primary-soft text-primary grid place-items-center [&_svg]:h-[20px] [&_svg]:w-[20px] shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]"><PieChartIcon /></span>
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
                    <Tooltip formatter={(value) => formatCurrency(Number(value))} contentStyle={CHART_TOOLTIP} />
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
            <CardTitle className="flex items-center gap-2.5">
              <span className="w-10 h-10 rounded-xl bg-primary-soft text-primary grid place-items-center [&_svg]:h-[20px] [&_svg]:w-[20px] shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]"><CalendarDays /></span>
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
      <h2 className="section-heading mt-2">Needs attention</h2>
      <Card>
        {/* Tab bar */}
        <div className="flex border-b border-line bg-canvas/50 rounded-t-xl overflow-x-auto">
          {([
            { key: 'pastDue' as const, label: 'Past due', icon: <AlertTriangle className="h-3.5 w-3.5" />, count: attentionCounts.pastDue, color: 'danger' },
            { key: 'overdue' as const, label: 'Overdue', icon: <Clock className="h-3.5 w-3.5" />, count: attentionCounts.overdue, color: 'danger' },
            { key: 'deposits' as const, label: 'Deposits', icon: <DollarSign className="h-3.5 w-3.5" />, count: attentionCounts.deposits, color: 'warning' },
            { key: 'expiring' as const, label: 'Contracts', icon: <CalendarCheck className="h-3.5 w-3.5" />, count: attentionCounts.expiring, color: 'warning' },
            { key: 'vacant' as const, label: 'Vacant', icon: <Home className="h-3.5 w-3.5" />, count: attentionCounts.vacant, color: 'muted' },
          ]).map(tab => (
            <button
              key={tab.key}
              type="button"
              onClick={() => setAttentionTab(tab.key)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-3.5 px-3 text-xs font-semibold transition-colors relative whitespace-nowrap ${
                attentionTab === tab.key ? 'text-ink' : 'text-faint hover:text-muted hover:bg-black/[0.02]'
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
                <span className="absolute bottom-0 left-2 right-2 h-0.5 bg-primary rounded-t" />
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
                <p className="text-center text-sm text-muted py-8">All tenants are on month to month leases.</p>
              ) : expiringSoon.map(row => {
                const names = row.occupants.map(t => `${t.firstName} ${t.lastName}`).join(', ') || 'Tenant';
                const where = [row.property?.name ?? row.property?.address, row.unit ? `Unit ${row.unit.unitNumber}` : null]
                  .filter(Boolean).join(' · ');
                const urgent = row.days <= 60;
                const timeLabel = row.days <= 0
                  ? (row.days === 0 ? 'Expires today' : `${Math.abs(row.days)} day${Math.abs(row.days) === 1 ? '' : 's'} past`)
                  : row.days > 90
                    ? `${Math.round(row.days / 30)} months`
                    : `${row.days} day${row.days === 1 ? '' : 's'}`;
                return (
                  <button
                    key={row.lease.id}
                    type="button"
                    onClick={() => row.occupants[0] && navigate(`/tenants/${row.occupants[0].id}`)}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-canvas/60 transition-colors"
                  >
                    <span className={`w-[30px] h-[30px] rounded-lg grid place-items-center flex-shrink-0 ${
                      row.days <= 0 ? 'bg-danger-soft text-danger' : urgent ? 'bg-warning-soft text-warning' : 'bg-canvas text-muted'
                    }`}>
                      <CalendarCheck className="h-[15px] w-[15px]" />
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-medium text-ink truncate">{names}</p>
                      {where && <p className="text-[11px] text-muted truncate">{where}</p>}
                    </div>
                    <Badge variant={row.days <= 0 ? 'destructive' : urgent ? 'warning' : 'default'} className="whitespace-nowrap">
                      {timeLabel}
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
              {attentionTab === 'vacant' && (<>
                {(stats.vacancyLossThisMonth > 0 || stats.vacancyLossYTD > 0) && (
                  <div className="px-4 py-3 bg-amber-50/40 border-b border-amber-200/60">
                    <div className="flex items-center gap-6 flex-wrap">
                      <div className="flex items-center gap-2 flex-shrink-0">
                        <AlertTriangle className="h-4 w-4 text-amber-600" />
                        <span className="text-xs font-semibold text-amber-800 uppercase tracking-wide">Vacancy loss</span>
                      </div>
                      {stats.vacancyLossThisMonth > 0 && (
                        <div>
                          <p className="text-[10px] text-amber-600 uppercase tracking-wide">This month</p>
                          <p className="text-sm font-semibold text-amber-800 tnum">{formatCurrency(stats.vacancyLossThisMonth)}</p>
                        </div>
                      )}
                      <div>
                        <p className="text-[10px] text-amber-600 uppercase tracking-wide">Year to date</p>
                        <p className="text-sm font-semibold text-amber-800 tnum">{formatCurrency(stats.vacancyLossYTD)}</p>
                      </div>
                      {stats.vacancyRate > 0 && (
                        <div>
                          <p className="text-[10px] text-amber-600 uppercase tracking-wide">Rate</p>
                          <p className="text-sm font-semibold text-amber-800 tnum">{stats.vacancyRate.toFixed(1)}%</p>
                        </div>
                      )}
                      {stats.grossPotentialRentMonth > 0 && (
                        <div className="ml-auto hidden sm:block">
                          <p className="text-[10px] text-amber-600 uppercase tracking-wide">Gross potential</p>
                          <p className="text-sm font-semibold text-amber-800 tnum">{formatCurrency(stats.grossPotentialRentMonth)}/mo</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}
                {vacantUnits.length === 0 ? (
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
                            {futureLeaseUnitIds.has(unit.id) ? (
                              <Badge variant="default" className="text-[10px] flex-shrink-0">Leased</Badge>
                            ) : (
                              <Badge variant="warning" className="text-[10px] flex-shrink-0">Available</Badge>
                            )}
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
              </>)}
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
      <div className="flex items-start justify-between gap-4">
        <div>
          <Skeleton className="h-3 w-28" />
          <Skeleton className="mt-2.5 h-8 w-48" />
        </div>
        <Skeleton className="h-4 w-24 mt-3" />
      </div>
      <div className="rounded-2xl p-6 sm:p-7" style={{ background: 'linear-gradient(135deg, #1e3a2e 0%, #24503f 40%, #2c5c4a 100%)' }}>
        <Skeleton className="h-3 w-32 opacity-20" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-y-5 mt-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-2.5 w-16 opacity-20" />
              <Skeleton className="h-7 w-24 opacity-20" />
              <Skeleton className="h-2.5 w-20 opacity-20" />
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-6 pt-4 border-t border-white/[0.06]">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2">
              <Skeleton className="h-7 w-7 rounded-lg opacity-20" />
              <div><Skeleton className="h-4 w-8 opacity-20" /><Skeleton className="h-2 w-14 mt-1 opacity-20" /></div>
            </div>
          ))}
        </div>
      </div>
      <Skeleton className="h-3 w-16" />
      <div className="grid gap-4 md:grid-cols-[5fr_3fr]">
        <div className="rounded-xl border border-line bg-surface p-6">
          <div className="flex items-center gap-2 mb-4">
            <Skeleton className="h-7 w-7 rounded-lg" />
            <Skeleton className="h-5 w-36" />
          </div>
          <Skeleton className="h-[260px] w-full rounded-lg" />
        </div>
        <div className="rounded-xl border border-line bg-surface p-6">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Skeleton className="h-7 w-7 rounded-lg" />
              <Skeleton className="h-5 w-24" />
            </div>
            <Skeleton className="h-7 w-28 rounded-lg" />
          </div>
          <Skeleton className="h-[180px] w-full rounded-full mx-auto max-w-[180px]" />
        </div>
      </div>
    </div>
  );
}
