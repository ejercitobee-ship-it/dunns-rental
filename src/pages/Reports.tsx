import { useMemo, useState } from 'react';
import {
  Download, ClipboardList, AlertTriangle, Building2,
  DollarSign, TrendingDown, TrendingUp, Wrench,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { formatCurrency, formatDate, getMonthName } from '../lib/utils';
import { useApp } from '../context/AppContext';
import { activeLeases, monthlyRevenue, settleMonth, leaseCoversMonth, type MonthSettlement } from '../lib/rent';
import {
  expenseCategoryLabel, expensesByCategory, expensesByTier,
  EXPENSE_TIERS, propertyFinancials, maintenanceCosts,
  monthlyBreakdown, incomeSourceLabel, rentCollected, otherIncome,
  type DateRange, periodToDateRange,
} from '../lib/financials';
import { TransactionDrillDown } from '../components/TransactionDrillDown';
import type { Lease, Tenant, Expense } from '../types';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';

const COLORS = [
  '#24503f', '#2c7a58', '#97671c', '#a23429', '#7e8b83',
  '#5b6abf', '#c2553a', '#3a8a6e', '#8b6f47', '#6b4c8a',
];

// ---------------------------------------------------------------------------
// Shared filter bar
// ---------------------------------------------------------------------------

function useReportFilters() {
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [scope, setScope] = useState<'year' | 'quarter' | 'month'>('year');
  const [quarter, setQuarter] = useState(Math.floor(now.getMonth() / 3) + 1);
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [propertyFilter, setPropertyFilter] = useState('all');

  const range: DateRange = useMemo(
    () => periodToDateRange(scope, year, quarter, month),
    [scope, year, quarter, month],
  );

  const availableYears = useMemo(() => {
    const s = new Set<number>();
    for (let y = 2020; y <= now.getFullYear() + 1; y++) s.add(y);
    return Array.from(s).sort((a, b) => b - a);
  }, []);

  return { year, setYear, scope, setScope, quarter, setQuarter, month, setMonth,
           propertyFilter, setPropertyFilter, range, availableYears };
}

interface FilterBarProps {
  f: ReturnType<typeof useReportFilters>;
  properties: { id: string; name: string }[];
  onExport?: () => void;
  exportLabel?: string;
}

function FilterBar({ f, properties, onExport, exportLabel }: FilterBarProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <select value={f.scope} onChange={e => f.setScope(e.target.value as 'year' | 'quarter' | 'month')}
        className="px-3 py-2 border border-line rounded-lg text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-primary">
        <option value="year">Yearly</option>
        <option value="quarter">Quarterly</option>
        <option value="month">Monthly</option>
      </select>
      <select value={f.year} onChange={e => f.setYear(Number(e.target.value))}
        className="px-3 py-2 border border-line rounded-lg text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-primary">
        {f.availableYears.map(y => <option key={y} value={y}>{y}</option>)}
      </select>
      {f.scope === 'quarter' && (
        <select value={f.quarter} onChange={e => f.setQuarter(Number(e.target.value))}
          className="px-3 py-2 border border-line rounded-lg text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-primary">
          <option value={1}>Q1</option><option value={2}>Q2</option>
          <option value={3}>Q3</option><option value={4}>Q4</option>
        </select>
      )}
      {f.scope === 'month' && (
        <select value={f.month} onChange={e => f.setMonth(Number(e.target.value))}
          className="px-3 py-2 border border-line rounded-lg text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-primary">
          {Array.from({ length: 12 }, (_, i) => (
            <option key={i + 1} value={i + 1}>{getMonthName(i + 1)}</option>
          ))}
        </select>
      )}
      <select value={f.propertyFilter} onChange={e => f.setPropertyFilter(e.target.value)}
        className="px-3 py-2 border border-line rounded-lg text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-primary">
        <option value="all">All Properties</option>
        {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
      </select>
      {onExport && (
        <Button variant="outline" size="sm" onClick={onExport}>
          <Download className="h-4 w-4 mr-1" />{exportLabel || 'Export CSV'}
        </Button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Report tabs
// ---------------------------------------------------------------------------

type ReportTab = 'overview' | 'income' | 'expenses' | 'profitability' | 'maintenance';

/** One row of the rent roll: a single active lease and this month's settlement. */
interface RentRollRow {
  lease: Lease;
  property: string;
  unit: string;
  occupants: Tenant[];
  rent: number;
  leaseEnd?: string;
  settlement: MonthSettlement | null;
}

// ---------------------------------------------------------------------------
// Reports page
// ---------------------------------------------------------------------------

export function Reports() {
  const { properties, units, leases, rentPayments, expenses, incomes, maintenance, getLeaseTenants } = useApp();
  const [tab, setTab] = useState<ReportTab>('overview');
  const f = useReportFilters();

  // Drilldown state
  const [drillTitle, setDrillTitle] = useState('');
  const [drillExpenses, setDrillExpenses] = useState<Expense[]>([]);
  const [drillOpen, setDrillOpen] = useState(false);

  const openDrill = (title: string, exps: Expense[]) => {
    setDrillTitle(title);
    setDrillExpenses(exps);
    setDrillOpen(true);
  };

  const propertyName = (id?: string) => properties.find(p => p.id === id)?.name || '—';
  const unitNumber = (id?: string) => units.find(u => u.id === id)?.unitNumber || '—';

  // Filter data by property when selected.
  const filteredExpenses = useMemo(() =>
    f.propertyFilter === 'all' ? expenses : expenses.filter(e => e.propertyId === f.propertyFilter),
    [expenses, f.propertyFilter]);

  const filteredIncomes = useMemo(() =>
    f.propertyFilter === 'all' ? incomes : incomes.filter(i => i.propertyId === f.propertyFilter),
    [incomes, f.propertyFilter]);

  const filteredPayments = useMemo(() => {
    if (f.propertyFilter === 'all') return rentPayments;
    const leaseIds = new Set(leases.filter(l => l.propertyId === f.propertyFilter).map(l => l.id));
    return rentPayments.filter(p => leaseIds.has(p.leaseId));
  }, [rentPayments, leases, f.propertyFilter]);

  // ── Overview tab (existing content) ─────────────────────────────────
  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  const rentRoll = useMemo<RentRollRow[]>(() => {
    return activeLeases(leases)
      .map(lease => {
        const covers = leaseCoversMonth(lease, currentMonth, currentYear);
        return {
          lease,
          property: propertyName(lease.propertyId),
          unit: unitNumber(lease.unitId),
          occupants: getLeaseTenants(lease.id),
          rent: lease.monthlyRent || 0,
          leaseEnd: lease.endDate,
          settlement: covers ? settleMonth(lease, rentPayments, currentMonth, currentYear) : null,
        };
      })
      .sort((a, b) => a.property.localeCompare(b.property));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leases, rentPayments, properties, units, getLeaseTenants, currentMonth, currentYear]);

  const totals = useMemo(() => {
    const scheduled = monthlyRevenue(leases);
    const collected = rentPayments
      .filter(p => p.status === 'paid' && p.month === currentMonth && p.year === currentYear)
      .reduce((s, p) => s + p.amount, 0);
    const outstanding = rentRoll.reduce((s, r) => s + (r.settlement?.balance || 0), 0);
    return { scheduled, collected, outstanding };
  }, [leases, rentPayments, rentRoll, currentMonth, currentYear]);

  const delinquencies = useMemo(() => {
    return rentRoll
      .filter(r => r.settlement && r.settlement.status !== 'paid')
      .sort((a, b) => (b.settlement?.balance || 0) - (a.settlement?.balance || 0));
  }, [rentRoll]);

  const statusView = (status: MonthSettlement['status'] | null) => {
    switch (status) {
      case 'paid': return <Badge variant="success">Paid</Badge>;
      case 'partial': return <Badge variant="secondary">Partial</Badge>;
      case 'unpaid': return <Badge variant="destructive">Unpaid</Badge>;
      default: return <Badge variant="secondary">Not due yet</Badge>;
    }
  };

  // ── Income report ───────────────────────────────────────────────────
  const incomeData = useMemo(() => {
    const rent = rentCollected(filteredPayments, f.range);
    const other = otherIncome(filteredIncomes, f.range);
    const total = rent + other;

    // By source.
    const bySource: Record<string, number> = { rent };
    for (const i of filteredIncomes) {
      if (f.range.from && i.date < f.range.from) continue;
      if (f.range.to && i.date > f.range.to) continue;
      bySource[i.source] = (bySource[i.source] || 0) + i.amount;
    }

    // By property.
    const byProperty: Record<string, number> = {};
    for (const p of filteredPayments) {
      if (p.status !== 'paid') continue;
      const pDate = `${p.year}-${String(p.month).padStart(2, '0')}-01`;
      if (f.range.from && pDate < f.range.from) continue;
      if (f.range.to && pDate > f.range.to) continue;
      const lease = leases.find(l => l.id === p.leaseId);
      const pid = lease?.propertyId || 'unassigned';
      byProperty[pid] = (byProperty[pid] || 0) + p.amount;
    }
    for (const i of filteredIncomes) {
      if (f.range.from && i.date < f.range.from) continue;
      if (f.range.to && i.date > f.range.to) continue;
      const pid = i.propertyId || 'unassigned';
      byProperty[pid] = (byProperty[pid] || 0) + i.amount;
    }

    return { rent, other, total, bySource, byProperty };
  }, [filteredPayments, filteredIncomes, leases, f.range]);

  // ── Expense report ──────────────────────────────────────────────────
  const expenseData = useMemo(() => {
    const inRange = filteredExpenses.filter(e => {
      if (f.range.from && e.date < f.range.from) return false;
      if (f.range.to && e.date > f.range.to) return false;
      return true;
    });
    const total = inRange.reduce((s, e) => s + e.amount, 0);
    const byCategory = expensesByCategory(inRange);
    const byTier = expensesByTier(inRange);

    // By property.
    const byProperty: Record<string, number> = {};
    for (const e of inRange) {
      const pid = e.propertyId || 'unassigned';
      byProperty[pid] = (byProperty[pid] || 0) + e.amount;
    }

    // By vendor.
    const byVendor: Record<string, number> = {};
    for (const e of inRange) {
      const v = e.vendor || 'No vendor';
      byVendor[v] = (byVendor[v] || 0) + e.amount;
    }

    // Monthly.
    const monthly = monthlyBreakdown(f.year, filteredPayments, filteredIncomes, inRange);

    return { total, byCategory, byTier, byProperty, byVendor, monthly, inRange };
  }, [filteredExpenses, filteredPayments, filteredIncomes, f.range, f.year]);

  // ── Profitability report ────────────────────────────────────────────
  const profitData = useMemo(() => {
    const targetProperties = f.propertyFilter === 'all'
      ? properties
      : properties.filter(p => p.id === f.propertyFilter);

    return targetProperties
      .map(p => propertyFinancials(p, leases, rentPayments, incomes, expenses, f.range))
      .sort((a, b) => a.propertyName.localeCompare(b.propertyName));
  }, [properties, leases, rentPayments, incomes, expenses, f.range, f.propertyFilter]);

  const profitTotals = useMemo(() => {
    return profitData.reduce(
      (t, r) => ({
        totalIncome: t.totalIncome + r.totalIncome,
        totalExpenses: t.totalExpenses + r.totalExpenses,
        noi: t.noi + r.noi,
        netProfit: t.netProfit + r.netProfit,
      }),
      { totalIncome: 0, totalExpenses: 0, noi: 0, netProfit: 0 },
    );
  }, [profitData]);

  // ── Maintenance cost report ─────────────────────────────────────────
  const maintData = useMemo(() => maintenanceCosts(maintenance, f.range), [maintenance, f.range]);

  // ── CSV exports ─────────────────────────────────────────────────────
  const downloadCSV = (headers: string[], rows: (string | number)[][], filename: string) => {
    const csv = [headers, ...rows].map(row => row.map(c => `"${String(c ?? '')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportRentRoll = () => {
    downloadCSV(
      ['Property', 'Unit', 'Occupants', 'Monthly Rent', 'Lease End', 'This Month'],
      rentRoll.map(r => [r.property, r.unit,
        r.occupants.map(t => `${t.firstName} ${t.lastName}`).join(', '),
        r.rent, r.leaseEnd || '', r.settlement?.status || 'not_due']),
      `rent-roll-${currentYear}-${String(currentMonth).padStart(2, '0')}.csv`,
    );
  };

  const exportProfitability = () => {
    downloadCSV(
      ['Property', 'Gross Rent', 'Other Income', 'Total Income', 'Total Expenses', 'NOI', 'Net Profit'],
      profitData.map(r => [r.propertyName, r.grossRentalIncome, r.otherIncome, r.totalIncome, r.totalExpenses, r.noi, r.netProfit]),
      `profitability-${f.year}.csv`,
    );
  };

  const exportExpenses = () => {
    downloadCSV(
      ['Date', 'Property', 'Category', 'Description', 'Vendor', 'Amount'],
      expenseData.inRange.map(e => [e.date, propertyName(e.propertyId), expenseCategoryLabel(e.category), e.description, e.vendor || '', e.amount]),
      `expenses-${f.year}.csv`,
    );
  };

  // ── Tab content ─────────────────────────────────────────────────────
  const tabs: { key: ReportTab; label: string; icon: typeof DollarSign }[] = [
    { key: 'overview', label: 'Overview', icon: ClipboardList },
    { key: 'income', label: 'Income', icon: TrendingUp },
    { key: 'expenses', label: 'Expenses', icon: TrendingDown },
    { key: 'profitability', label: 'Profitability', icon: DollarSign },
    { key: 'maintenance', label: 'Maintenance Costs', icon: Wrench },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-[26px] sm:text-[32px] font-medium text-ink">Financial Reports</h1>
          <p className="text-muted mt-1 text-sm">Comprehensive financial analysis across all properties.</p>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 overflow-x-auto border-b border-line">
        {tabs.map(t => {
          const Icon = t.icon;
          return (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 whitespace-nowrap transition-colors ${
                tab === t.key
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted hover:text-ink'
              }`}
            >
              <Icon className="h-4 w-4" />
              {t.label}
            </button>
          );
        })}
      </div>

      {/* ═══════════════════════ OVERVIEW ═══════════════════════ */}
      {tab === 'overview' && (
        <>
          {/* Totals */}
          <div className="grid gap-4 sm:gap-6 grid-cols-1 sm:grid-cols-3">
            {[
              { label: 'Scheduled Rent', value: formatCurrency(totals.scheduled), sub: 'Active leases, monthly' },
              { label: 'Collected This Month', value: formatCurrency(totals.collected), sub: 'Marked paid' },
              { label: 'Outstanding', value: formatCurrency(totals.outstanding), sub: 'Balance due this month' },
            ].map(s => (
              <Card key={s.label}>
                <div className="p-5">
                  <span className="eyebrow">{s.label}</span>
                  <div className="mt-3 text-[27px] leading-none font-semibold text-ink tnum">{s.value}</div>
                  <p className="mt-1.5 text-[13px] text-muted">{s.sub}</p>
                </div>
              </Card>
            ))}
          </div>

          {/* Rent Roll */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2">
                  <div className="p-2 bg-primary-soft rounded-lg">
                    <ClipboardList className="h-5 w-5 text-primary" />
                  </div>
                  Rent Roll
                </CardTitle>
                <Button variant="outline" size="sm" onClick={exportRentRoll}>
                  <Download className="h-4 w-4 mr-1" />Export
                </Button>
              </div>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px]">
                  <thead>
                    <tr className="border-b border-line bg-canvas">
                      <th className="text-left py-3 px-4 font-semibold text-ink text-sm">Property & Unit</th>
                      <th className="text-left py-3 px-4 font-semibold text-ink text-sm">Occupants</th>
                      <th className="text-right py-3 px-4 font-semibold text-ink text-sm">Monthly Rent</th>
                      <th className="text-left py-3 px-4 font-semibold text-ink text-sm">Lease Ends</th>
                      <th className="text-center py-3 px-4 font-semibold text-ink text-sm">This Month</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rentRoll.map(r => (
                      <tr key={r.lease.id} className="border-b border-line last:border-0 hover:bg-black/[0.02]">
                        <td className="py-3 px-4 text-sm">
                          <span className="text-ink">{r.property}</span>
                          <span className="text-faint"> · {r.unit}</span>
                        </td>
                        <td className="py-3 px-4 text-sm text-ink">
                          {r.occupants.length > 0 ? r.occupants.map(t => `${t.firstName} ${t.lastName}`).join(', ') : '—'}
                        </td>
                        <td className="py-3 px-4 text-right text-sm text-ink tnum">{formatCurrency(r.rent)}</td>
                        <td className="py-3 px-4 text-sm text-muted">{r.leaseEnd ? formatDate(r.leaseEnd) : '—'}</td>
                        <td className="py-3 px-4 text-center">{statusView(r.settlement?.status ?? null)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rentRoll.length === 0 && (
                <div className="text-center py-14 text-sm text-muted">No active leases to report yet.</div>
              )}
            </CardContent>
          </Card>

          {/* Delinquency */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <div className="p-2 bg-danger-soft rounded-lg">
                  <AlertTriangle className="h-5 w-5 text-danger" />
                </div>
                Outstanding Balances ({delinquencies.length})
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0">
              {delinquencies.length === 0 ? (
                <div className="text-center py-14 text-sm text-muted">Nothing outstanding. Every active lease is settled for this month.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px]">
                    <thead>
                      <tr className="border-b border-line bg-canvas">
                        <th className="text-left py-3 px-4 font-semibold text-ink text-sm">Property & Unit</th>
                        <th className="text-left py-3 px-4 font-semibold text-ink text-sm">Occupants</th>
                        <th className="text-right py-3 px-4 font-semibold text-ink text-sm">Balance</th>
                        <th className="text-center py-3 px-4 font-semibold text-ink text-sm">Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {delinquencies.map(r => (
                        <tr key={r.lease.id} className="border-b border-line last:border-0 hover:bg-black/[0.02]">
                          <td className="py-3 px-4 text-sm">
                            <span className="text-ink">{r.property}</span>
                            <span className="text-faint"> · {r.unit}</span>
                          </td>
                          <td className="py-3 px-4 text-sm text-ink">
                            {r.occupants.length > 0 ? r.occupants.map(t => `${t.firstName} ${t.lastName}`).join(', ') : '—'}
                          </td>
                          <td className="py-3 px-4 text-right text-sm text-danger font-medium tnum">{formatCurrency(r.settlement?.balance || 0)}</td>
                          <td className="py-3 px-4 text-center">{statusView(r.settlement?.status ?? null)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* ═══════════════════════ INCOME REPORT ═══════════════════════ */}
      {tab === 'income' && (
        <>
          <FilterBar f={f} properties={properties} />

          <div className="grid gap-4 sm:gap-6 grid-cols-1 sm:grid-cols-3">
            <Card><div className="p-5">
              <span className="eyebrow">Rental Income</span>
              <div className="mt-3 text-[27px] leading-none font-semibold text-positive tnum">{formatCurrency(incomeData.rent)}</div>
            </div></Card>
            <Card><div className="p-5">
              <span className="eyebrow">Other Income</span>
              <div className="mt-3 text-[27px] leading-none font-semibold text-positive tnum">{formatCurrency(incomeData.other)}</div>
            </div></Card>
            <Card><div className="p-5">
              <span className="eyebrow">Total Income</span>
              <div className="mt-3 text-[27px] leading-none font-semibold text-ink tnum">{formatCurrency(incomeData.total)}</div>
            </div></Card>
          </div>

          <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
            {/* By source */}
            <Card>
              <CardHeader><CardTitle>Income by Category</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {Object.entries(incomeData.bySource)
                    .sort(([, a], [, b]) => b - a)
                    .map(([source, amount], idx) => (
                      <div key={source} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[idx % COLORS.length] }} />
                          <span className="text-sm text-ink">{incomeSourceLabel(source)}</span>
                        </div>
                        <span className="text-sm font-semibold text-ink tnum">{formatCurrency(amount)}</span>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>

            {/* By property */}
            <Card>
              <CardHeader><CardTitle>Income by Property</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {Object.entries(incomeData.byProperty)
                    .sort(([, a], [, b]) => b - a)
                    .map(([pid, amount], idx) => (
                      <div key={pid} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[idx % COLORS.length] }} />
                          <span className="text-sm text-ink">{propertyName(pid)}</span>
                        </div>
                        <span className="text-sm font-semibold text-ink tnum">{formatCurrency(amount)}</span>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {/* ═══════════════════════ EXPENSE REPORT ═══════════════════════ */}
      {tab === 'expenses' && (
        <>
          <FilterBar f={f} properties={properties} onExport={exportExpenses} />

          <div className="grid gap-4 sm:gap-6 grid-cols-1 sm:grid-cols-3">
            {EXPENSE_TIERS.map(tier => (
              <Card key={tier.value}><div className="p-5">
                <span className="eyebrow">{tier.label}</span>
                <div className="mt-3 text-[27px] leading-none font-semibold text-danger tnum">
                  {formatCurrency(expenseData.byTier[tier.value])}
                </div>
              </div></Card>
            ))}
          </div>

          <Card>
            <CardHeader><CardTitle>Total Expenses: {formatCurrency(expenseData.total)}</CardTitle></CardHeader>
            <CardContent className="p-0">
              <div className="grid gap-0 grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-line">
                {/* By category */}
                <div className="p-5">
                  <h3 className="text-sm font-semibold text-ink mb-4">By Category</h3>
                  <div className="space-y-2.5">
                    {expenseData.byCategory.map((cat, idx) => (
                      <button
                        key={cat.category}
                        onClick={() => openDrill(
                          `${cat.label} Expenses`,
                          expenseData.inRange.filter(e => e.category === cat.category)
                        )}
                        className="flex items-center justify-between w-full text-left hover:bg-black/[0.02] rounded-lg px-2 py-1 -mx-2 transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[idx % COLORS.length] }} />
                          <span className="text-sm text-ink">{cat.label}</span>
                        </div>
                        <span className="text-sm font-semibold text-ink tnum">{formatCurrency(cat.total)}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* By vendor */}
                <div className="p-5">
                  <h3 className="text-sm font-semibold text-ink mb-4">By Vendor</h3>
                  <div className="space-y-2.5 max-h-80 overflow-y-auto">
                    {Object.entries(expenseData.byVendor)
                      .sort(([, a], [, b]) => b - a)
                      .map(([vendor, amount]) => (
                        <button
                          key={vendor}
                          onClick={() => openDrill(
                            `${vendor} Expenses`,
                            expenseData.inRange.filter(e => (e.vendor || 'No vendor') === vendor)
                          )}
                          className="flex items-center justify-between w-full text-left hover:bg-black/[0.02] rounded-lg px-2 py-1 -mx-2 transition-colors"
                        >
                          <span className="text-sm text-ink truncate mr-2">{vendor}</span>
                          <span className="text-sm font-semibold text-ink tnum">{formatCurrency(amount)}</span>
                        </button>
                      ))}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* By property table */}
          <Card>
            <CardHeader><CardTitle>Expenses by Property</CardTitle></CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead>
                    <tr className="border-b border-line bg-canvas">
                      <th className="text-left py-3 px-4 font-semibold text-ink text-sm">Property</th>
                      <th className="text-right py-3 px-4 font-semibold text-ink text-sm">Amount</th>
                      <th className="text-right py-3 px-4 font-semibold text-ink text-sm">% of Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(expenseData.byProperty)
                      .sort(([, a], [, b]) => b - a)
                      .map(([pid, amount]) => (
                        <tr key={pid}
                          className="border-b border-line last:border-0 hover:bg-black/[0.02] cursor-pointer"
                          onClick={() => openDrill(
                            `${propertyName(pid)} Expenses`,
                            expenseData.inRange.filter(e => (e.propertyId || 'unassigned') === pid)
                          )}
                        >
                          <td className="py-3 px-4 text-sm text-ink">{propertyName(pid)}</td>
                          <td className="py-3 px-4 text-right text-sm text-danger font-medium tnum">{formatCurrency(amount)}</td>
                          <td className="py-3 px-4 text-right text-sm text-muted tnum">
                            {expenseData.total > 0 ? `${((amount / expenseData.total) * 100).toFixed(1)}%` : '—'}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                  <tfoot>
                    <tr className="border-t-2 border-line bg-canvas font-semibold">
                      <td className="py-3 px-4 text-sm text-ink">Total</td>
                      <td className="py-3 px-4 text-right text-sm text-danger tnum">{formatCurrency(expenseData.total)}</td>
                      <td className="py-3 px-4 text-right text-sm text-muted">100%</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </CardContent>
          </Card>

          {/* Monthly chart */}
          <Card>
            <CardHeader><CardTitle>Monthly Trend ({f.year})</CardTitle></CardHeader>
            <CardContent>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={expenseData.monthly}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--color-line, #e5e5e5)" />
                    <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} tickFormatter={v => `$${(v / 1000).toFixed(0)}k`} />
                    <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                    <Bar dataKey="expenses" fill="#a23429" name="Expenses" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="income" fill="#2c7a58" name="Income" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>
        </>
      )}

      {/* ═══════════════════════ PROFITABILITY ═══════════════════════ */}
      {tab === 'profitability' && (
        <>
          <FilterBar f={f} properties={properties} onExport={exportProfitability} exportLabel="Export Profitability" />

          <div className="grid gap-4 sm:gap-6 grid-cols-1 sm:grid-cols-4">
            <Card><div className="p-5">
              <span className="eyebrow">Total Income</span>
              <div className="mt-3 text-[27px] leading-none font-semibold text-positive tnum">{formatCurrency(profitTotals.totalIncome)}</div>
            </div></Card>
            <Card><div className="p-5">
              <span className="eyebrow">Total Expenses</span>
              <div className="mt-3 text-[27px] leading-none font-semibold text-danger tnum">{formatCurrency(profitTotals.totalExpenses)}</div>
            </div></Card>
            <Card><div className="p-5">
              <span className="eyebrow">NOI</span>
              <div className={`mt-3 text-[27px] leading-none font-semibold tnum ${profitTotals.noi >= 0 ? 'text-ink' : 'text-danger'}`}>
                {formatCurrency(profitTotals.noi)}
              </div>
              <p className="mt-1.5 text-[13px] text-muted">Net Operating Income</p>
            </div></Card>
            <Card><div className="p-5">
              <span className="eyebrow">Net Profit</span>
              <div className={`mt-3 text-[27px] leading-none font-semibold tnum ${profitTotals.netProfit >= 0 ? 'text-positive' : 'text-danger'}`}>
                {formatCurrency(profitTotals.netProfit)}
              </div>
            </div></Card>
          </div>

          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2">
              <div className="p-2 bg-primary-soft rounded-lg">
                <Building2 className="h-5 w-5 text-primary" />
              </div>
              Property Profitability
            </CardTitle></CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px]">
                  <thead>
                    <tr className="border-b border-line bg-canvas">
                      <th className="text-left py-3 px-4 font-semibold text-ink text-sm">Property</th>
                      <th className="text-right py-3 px-4 font-semibold text-ink text-sm">Gross Rent</th>
                      <th className="text-right py-3 px-4 font-semibold text-ink text-sm">Other Income</th>
                      <th className="text-right py-3 px-4 font-semibold text-ink text-sm">Total Income</th>
                      <th className="text-right py-3 px-4 font-semibold text-ink text-sm">Expenses</th>
                      <th className="text-right py-3 px-4 font-semibold text-ink text-sm">HOA</th>
                      <th className="text-right py-3 px-4 font-semibold text-ink text-sm">Taxes</th>
                      <th className="text-right py-3 px-4 font-semibold text-ink text-sm">Insurance</th>
                      <th className="text-right py-3 px-4 font-semibold text-ink text-sm">NOI</th>
                      <th className="text-right py-3 px-4 font-semibold text-ink text-sm">Net Profit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {profitData.map(r => (
                      <tr key={r.propertyId} className="border-b border-line last:border-0 hover:bg-black/[0.02]">
                        <td className="py-3 px-4 text-sm text-ink font-medium">{r.propertyName}</td>
                        <td className="py-3 px-4 text-right text-sm text-positive tnum">{formatCurrency(r.grossRentalIncome)}</td>
                        <td className="py-3 px-4 text-right text-sm text-positive tnum">{formatCurrency(r.otherIncome)}</td>
                        <td className="py-3 px-4 text-right text-sm text-positive font-medium tnum">{formatCurrency(r.totalIncome)}</td>
                        <td className="py-3 px-4 text-right text-sm text-danger tnum">{formatCurrency(r.totalExpenses)}</td>
                        <td className="py-3 px-4 text-right text-sm text-muted tnum">{formatCurrency(r.hoaExpenses)}</td>
                        <td className="py-3 px-4 text-right text-sm text-muted tnum">{formatCurrency(r.taxExpenses)}</td>
                        <td className="py-3 px-4 text-right text-sm text-muted tnum">{formatCurrency(r.insuranceExpenses)}</td>
                        <td className={`py-3 px-4 text-right text-sm font-medium tnum ${r.noi >= 0 ? 'text-ink' : 'text-danger'}`}>
                          {formatCurrency(r.noi)}
                        </td>
                        <td className={`py-3 px-4 text-right text-sm font-medium tnum ${r.netProfit >= 0 ? 'text-positive' : 'text-danger'}`}>
                          {formatCurrency(r.netProfit)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  {profitData.length > 1 && (
                    <tfoot>
                      <tr className="border-t-2 border-line bg-canvas font-semibold">
                        <td className="py-3 px-4 text-sm text-ink">Total</td>
                        <td className="py-3 px-4 text-right text-sm text-positive tnum">{formatCurrency(profitData.reduce((s, r) => s + r.grossRentalIncome, 0))}</td>
                        <td className="py-3 px-4 text-right text-sm text-positive tnum">{formatCurrency(profitData.reduce((s, r) => s + r.otherIncome, 0))}</td>
                        <td className="py-3 px-4 text-right text-sm text-positive tnum">{formatCurrency(profitTotals.totalIncome)}</td>
                        <td className="py-3 px-4 text-right text-sm text-danger tnum">{formatCurrency(profitTotals.totalExpenses)}</td>
                        <td className="py-3 px-4 text-right text-sm text-muted tnum">{formatCurrency(profitData.reduce((s, r) => s + r.hoaExpenses, 0))}</td>
                        <td className="py-3 px-4 text-right text-sm text-muted tnum">{formatCurrency(profitData.reduce((s, r) => s + r.taxExpenses, 0))}</td>
                        <td className="py-3 px-4 text-right text-sm text-muted tnum">{formatCurrency(profitData.reduce((s, r) => s + r.insuranceExpenses, 0))}</td>
                        <td className={`py-3 px-4 text-right text-sm tnum ${profitTotals.noi >= 0 ? 'text-ink' : 'text-danger'}`}>
                          {formatCurrency(profitTotals.noi)}
                        </td>
                        <td className={`py-3 px-4 text-right text-sm tnum ${profitTotals.netProfit >= 0 ? 'text-positive' : 'text-danger'}`}>
                          {formatCurrency(profitTotals.netProfit)}
                        </td>
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
              {profitData.length === 0 && (
                <div className="text-center py-14 text-sm text-muted">No properties to report yet.</div>
              )}
            </CardContent>
          </Card>
        </>
      )}

      {/* ═══════════════════════ MAINTENANCE COSTS ═══════════════════════ */}
      {tab === 'maintenance' && (
        <>
          <FilterBar f={f} properties={properties} />

          <div className="grid gap-4 sm:gap-6 grid-cols-1 sm:grid-cols-2">
            <Card><div className="p-5">
              <span className="eyebrow">Total Maintenance Cost</span>
              <div className="mt-3 text-[27px] leading-none font-semibold text-danger tnum">{formatCurrency(maintData.totalCost)}</div>
            </div></Card>
            <Card><div className="p-5">
              <span className="eyebrow">Jobs Completed</span>
              <div className="mt-3 text-[27px] leading-none font-semibold text-ink tnum">
                {maintenance.filter(m => m.status === 'completed' || m.status === 'paid').length}
              </div>
            </div></Card>
          </div>

          <div className="grid gap-6 grid-cols-1 lg:grid-cols-2">
            {/* By property */}
            <Card>
              <CardHeader><CardTitle>Cost by Property</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {Object.entries(maintData.byProperty)
                    .sort(([, a], [, b]) => b - a)
                    .map(([pid, amount], idx) => (
                      <div key={pid} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[idx % COLORS.length] }} />
                          <span className="text-sm text-ink">{propertyName(pid)}</span>
                        </div>
                        <span className="text-sm font-semibold text-ink tnum">{formatCurrency(amount)}</span>
                      </div>
                    ))}
                  {Object.keys(maintData.byProperty).length === 0 && (
                    <p className="text-sm text-muted">No maintenance costs recorded.</p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* By vendor */}
            <Card>
              <CardHeader><CardTitle>Cost by Vendor / Technician</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {Object.entries(maintData.byVendor)
                    .sort(([, a], [, b]) => b - a)
                    .map(([vendor, amount], idx) => (
                      <div key={vendor} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[idx % COLORS.length] }} />
                          <span className="text-sm text-ink">{vendor}</span>
                        </div>
                        <span className="text-sm font-semibold text-ink tnum">{formatCurrency(amount)}</span>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>

            {/* By category */}
            <Card>
              <CardHeader><CardTitle>Cost by Category</CardTitle></CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {Object.entries(maintData.byCategory)
                    .sort(([, a], [, b]) => b - a)
                    .map(([cat, amount], idx) => (
                      <div key={cat} className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[idx % COLORS.length] }} />
                          <span className="text-sm text-ink capitalize">{cat}</span>
                        </div>
                        <span className="text-sm font-semibold text-ink tnum">{formatCurrency(amount)}</span>
                      </div>
                    ))}
                </div>
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {/* Drill-down modal */}
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
