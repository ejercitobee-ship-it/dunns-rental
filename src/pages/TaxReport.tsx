import { useState, useMemo, useCallback } from 'react';
import {
  FileText, Download, Calculator, TrendingDown, TrendingUp,
  DollarSign, Home, Percent, AlertCircle, ChevronDown
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { formatCurrency, formatDate, yearOf, monthOf, getMonthName, cn } from '../lib/utils';
import { useApp } from '../context/AppContext';
import { rentIncomeForMonths } from '../lib/rent';
import {
  depreciationForYear,
  accumulatedDepreciation,
  depreciableBasis,
  landValueFor,
  canDepreciate,
} from '../lib/depreciation';
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

const COLORS = ['#24503f', '#2c7a58', '#97671c', '#b98a5e', '#7e8b83', '#5a7d6c', '#a23429', '#c2a878'];

// IRS de minimis safe-harbor line: a single item at or under this can be
// expensed (deducted this year); anything above it is generally a capital
// improvement to be capitalized and depreciated. We split the deductible
// expenses on this threshold so the two are easy to see and hand to an
// accountant.
const CAPITAL_THRESHOLD = 2500;

interface CapitalItem {
  id: string;
  date: string;
  amount: number;
  categoryLabel: string;
  description?: string;
  propertyName?: string;
}

interface DepreciationRow {
  name: string;
  placedInService?: string;
  purchasePrice: number;
  landValue: number;
  depreciableBasis: number;
  currentYear: number;
  accumulated: number;
  ready: boolean;
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

const TAX_CATEGORIES: Record<string, { label: string; description: string }> = {
  advertising: { label: 'Advertising', description: 'Marketing and advertising costs' },
  auto_travel: { label: 'Auto & Travel', description: 'Vehicle expenses and travel' },
  cleaning_maintenance: { label: 'Cleaning & Maintenance', description: 'Cleaning and maintenance services' },
  commissions: { label: 'Commissions', description: 'Agent and broker commissions' },
  insurance: { label: 'Insurance', description: 'Property and liability insurance' },
  legal_professional: { label: 'Legal & Professional', description: 'Legal and accounting fees' },
  management_fees: { label: 'Management Fees', description: 'Property management fees' },
  mortgage_interest: { label: 'Mortgage Interest', description: 'Interest on mortgage payments' },
  other_interest: { label: 'Other Interest', description: 'Other interest expenses' },
  repairs: { label: 'Repairs', description: 'Property repairs and fixes' },
  supplies: { label: 'Supplies', description: 'Office and maintenance supplies' },
  taxes: { label: 'Taxes', description: 'Property and real estate taxes' },
  utilities: { label: 'Utilities', description: 'Electric, water, gas, etc.' },
  depreciation: { label: 'Depreciation', description: 'Property depreciation' },
  other: { label: 'Other', description: 'Other deductible expenses' },
};

/** Map an expense category to its IRS Schedule E tax category. */
function mapToTaxCategory(expenseCategory: string): string {
  const mapping: Record<string, string> = {
    maintenance: 'cleaning_maintenance',
    utilities: 'utilities',
    insurance: 'insurance',
    taxes: 'taxes',
    mortgage: 'mortgage_interest',
    repairs: 'repairs',
    cleaning: 'cleaning_maintenance',
    landscaping: 'cleaning_maintenance',
    management: 'management_fees',
    realtor_commission: 'commissions',
    other: 'other',
  };
  return mapping[expenseCategory] || 'other';
}

export function TaxReport() {
  const { expenses, incomes, properties, rentPayments, leases } = useApp();
  const now = new Date();
  // Main period.
  const [scope, setScope] = useState<'year' | 'quarter' | 'month'>('year');
  const [year, setYear] = useState(now.getFullYear());
  const [quarter, setQuarter] = useState(Math.floor(now.getMonth() / 3) + 1);
  const [month, setMonth] = useState(now.getMonth() + 1);
  // Comparison period (same scope), defaulting to the year before.
  const [compare, setCompare] = useState(false);
  const [cYear, setCYear] = useState(now.getFullYear() - 1);
  const [cQuarter, setCQuarter] = useState(Math.floor(now.getMonth() / 3) + 1);
  const [cMonth, setCMonth] = useState(now.getMonth() + 1);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => {
    try {
      const raw = sessionStorage.getItem('tax_collapsed');
      return raw ? new Set(JSON.parse(raw)) : new Set();
    } catch { return new Set(); }
  });
  const toggle = (key: string) => setCollapsed(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key); else next.add(key);
    sessionStorage.setItem('tax_collapsed', JSON.stringify([...next]));
    return next;
  });

  // 1-12 months covered by a scope selection.
  const monthsFor = (sc: 'year' | 'quarter' | 'month', q: number, m: number): number[] =>
    sc === 'year' ? [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]
    : sc === 'quarter' ? [(q - 1) * 3 + 1, (q - 1) * 3 + 2, (q - 1) * 3 + 3]
    : [m];

  const periodLabel = (sc: 'year' | 'quarter' | 'month', y: number, q: number, m: number): string =>
    sc === 'year' ? `${y}` : sc === 'quarter' ? `Q${q} ${y}` : `${getMonthName(m)} ${y}`;

  // All the tax figures for a period (year + set of months). Reused for the main
  // period and, when comparing, the comparison period, so they cannot disagree.
  const periodData = useCallback((y: number, months: number[]) => {
    const inP = (d: string) => yearOf(d) === y && months.includes(monthOf(d));
    const pExpenses = expenses.filter(e => inP(e.date));
    const pIncome = incomes.filter(i => inP(i.date));
    const pPaidRent = rentPayments.filter(p => p.status === 'paid' && p.year === y && months.includes(p.month));

    // rentIncomeForMonths is the shared definition of taxable rent income, so
    // this matches Rent Management's Tax tab for the same months.
    const rentIncome = rentIncomeForMonths(rentPayments, months, y);
    const lateFeeIncome = pIncome.filter(i => i.source === 'late_fee').reduce((s, i) => s + i.amount, 0);
    const otherIncome = pIncome.filter(i => i.source === 'other').reduce((s, i) => s + i.amount, 0);
    // A refundable security deposit you are holding is a liability you owe back,
    // NOT taxable income. It becomes income only in the year you keep it (record
    // that as "Other" income). So deposits are tracked separately and excluded
    // from the taxable total.
    const depositsReceived = pIncome.filter(i => i.source === 'deposit').reduce((s, i) => s + i.amount, 0);
    const totalIncome = rentIncome + lateFeeIncome + otherIncome;

    const propertyNameById = new Map(properties.map(p => [p.id, p.name]));
    const expensesByCategory: Record<string, number> = {};
    let totalDeductibleExpenses = 0;
    // Split deductible expenses on the $2,500 de minimis line.
    let operatingExpenses = 0;
    let capitalExpenses = 0;
    const capitalItems: CapitalItem[] = [];
    // Mortgage payments: only the interest is deductible, principal is not.
    let mortgageInterestDeducted = 0;
    let mortgagePrincipalExcluded = 0;
    let mortgageNeedsSplit = 0;
    // The deductible amount of one expense: for a mortgage that's the interest
    // portion (principal is never deductible); everything else is the full
    // amount unless flagged non-deductible.
    const deductibleAmount = (e: typeof pExpenses[number]): number => {
      if (e.taxDeductible === false) return 0;
      if (e.category === 'mortgage') return e.interestAmount != null ? e.interestAmount : e.amount;
      return e.amount;
    };
    pExpenses.forEach(e => {
      const taxCat = e.taxCategory || mapToTaxCategory(e.category);
      const deductible = deductibleAmount(e);

      if (e.category === 'mortgage') {
        // Interest is an operating deduction; principal is set aside.
        if (e.interestAmount != null) {
          mortgagePrincipalExcluded += Math.max(0, e.amount - e.interestAmount);
        } else if (e.taxDeductible !== false) {
          // No split entered: we can't tell interest from principal, so flag it.
          mortgageNeedsSplit += 1;
        }
        mortgageInterestDeducted += deductible;
        expensesByCategory[taxCat] = (expensesByCategory[taxCat] || 0) + deductible;
        totalDeductibleExpenses += deductible;
        operatingExpenses += deductible;
        return;
      }

      expensesByCategory[taxCat] = (expensesByCategory[taxCat] || 0) + deductible;
      if (deductible > 0) {
        totalDeductibleExpenses += deductible;
        // A capital improvement (over the $2,500 line) vs. a current-year expense.
        if (e.amount > CAPITAL_THRESHOLD) {
          capitalExpenses += e.amount;
          capitalItems.push({
            id: e.id,
            date: e.date,
            amount: e.amount,
            categoryLabel: TAX_CATEGORIES[taxCat]?.label || taxCat,
            description: e.description,
            propertyName: e.propertyId ? propertyNameById.get(e.propertyId) : undefined,
          });
        } else {
          operatingExpenses += e.amount;
        }
      }
    });
    capitalItems.sort((a, b) => b.amount - a.amount);

    // Depreciation: a non-cash deduction, spread over 27.5 years. It's an annual
    // figure, so for a sub-year period we prorate it by the share of months
    // shown. The full-year schedule below stays un-prorated for reference.
    const periodFactor = months.length / 12;
    const depreciationByProperty = new Map(
      properties.map(p => [p.id, depreciationForYear(p, y)])
    );
    const depreciationSchedule: DepreciationRow[] = properties
      .filter(p => p.purchasePrice && p.purchasePrice > 0)
      .map(p => ({
        name: p.name,
        placedInService: p.purchaseDate,
        purchasePrice: p.purchasePrice || 0,
        landValue: landValueFor(p),
        depreciableBasis: depreciableBasis(p),
        currentYear: depreciationByProperty.get(p.id) || 0,
        accumulated: accumulatedDepreciation(p, y),
        ready: canDepreciate(p),
      }));
    const depreciation = round2(
      properties.reduce((s, p) => s + (depreciationByProperty.get(p.id) || 0), 0) * periodFactor
    );
    if (depreciation > 0) {
      expensesByCategory['depreciation'] = (expensesByCategory['depreciation'] || 0) + depreciation;
      totalDeductibleExpenses += depreciation;
    }

    const netIncome = totalIncome - totalDeductibleExpenses;

    const leasePropertyId = new Map(leases.map(l => [l.id, l.propertyId]));
    const propertyBreakdown = properties.map(p => {
      const cashExpenses = pExpenses.filter(e => e.propertyId === p.id).reduce((s, e) => s + deductibleAmount(e), 0);
      const propDepreciation = round2((depreciationByProperty.get(p.id) || 0) * periodFactor);
      const propertyExpenses = cashExpenses + propDepreciation;
      const propertyRent = pPaidRent.filter(pmt => leasePropertyId.get(pmt.leaseId) === p.id).reduce((s, pmt) => s + pmt.amount, 0);
      // Property income excludes deposits (not taxable) and rent (counted above).
      const propertyOther = pIncome.filter(i => i.propertyId === p.id && i.source === 'other').reduce((s, i) => s + i.amount, 0);
      const propertyIncome = propertyRent + propertyOther;
      return { name: p.name, income: propertyIncome, expenses: propertyExpenses, netIncome: propertyIncome - propertyExpenses };
    });

    // Income/expenses per month across the selected months, for the chart.
    const breakdown = months.map(m => {
      const mRent = pPaidRent.filter(p => p.month === m).reduce((s, p) => s + p.amount, 0);
      const mOther = pIncome.filter(i => i.source !== 'rent' && monthOf(i.date) === m).reduce((s, i) => s + i.amount, 0);
      const mInc = mRent + mOther;
      const mExp = pExpenses.filter(e => monthOf(e.date) === m).reduce((s, e) => s + (e.taxDeductible !== false ? e.amount : 0), 0);
      return { name: getMonthName(m), income: mInc, expenses: mExp, netIncome: mInc - mExp };
    });

    return { totalIncome, rentIncome, lateFeeIncome, otherIncome, depositsReceived, totalDeductibleExpenses, operatingExpenses, capitalExpenses, capitalItems, depreciation, depreciationSchedule, mortgageInterestDeducted, mortgagePrincipalExcluded, mortgageNeedsSplit, netIncome, expensesByCategory, propertyBreakdown, breakdown };
  }, [expenses, incomes, properties, rentPayments, leases]);

  const main = useMemo(() => periodData(year, monthsFor(scope, quarter, month)), [periodData, year, scope, quarter, month]);
  const comp = useMemo(() => (compare ? periodData(cYear, monthsFor(scope, cQuarter, cMonth)) : null), [compare, periodData, cYear, scope, cQuarter, cMonth]);
  const mainLabel = periodLabel(scope, year, quarter, month);
  const compLabel = periodLabel(scope, cYear, cQuarter, cMonth);

  const expenseChartData = useMemo(() => {
    return Object.entries(main.expensesByCategory)
      .map(([key, value]) => ({ name: TAX_CATEGORIES[key]?.label || key, value }))
      .sort((a, b) => b.value - a.value);
  }, [main.expensesByCategory]);

  const exportTaxReport = () => {
    const report = {
      generatedAt: new Date().toISOString(),
      period: mainLabel,
      income: { total: main.totalIncome, rent: main.rentIncome, lateFees: main.lateFeeIncome, other: main.otherIncome },
      securityDepositsReceived: main.depositsReceived,
      deductibleExpenses: main.expensesByCategory,
      totalDeductibleExpenses: main.totalDeductibleExpenses,
      operatingExpenses: main.operatingExpenses,
      capitalExpenses: main.capitalExpenses,
      capitalItems: main.capitalItems,
      depreciation: main.depreciation,
      depreciationSchedule: main.depreciationSchedule,
      mortgage: {
        interestDeducted: main.mortgageInterestDeducted,
        principalExcluded: main.mortgagePrincipalExcluded,
        entriesNeedingSplit: main.mortgageNeedsSplit,
      },
      netIncome: main.netIncome,
      comparison: comp ? {
        period: compLabel,
        income: { total: comp.totalIncome, rent: comp.rentIncome, lateFees: comp.lateFeeIncome, other: comp.otherIncome },
        deductibleExpenses: comp.expensesByCategory,
        totalDeductibleExpenses: comp.totalDeductibleExpenses,
        operatingExpenses: comp.operatingExpenses,
        capitalExpenses: comp.capitalExpenses,
        netIncome: comp.netIncome,
      } : undefined,
    };
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tax-report-${mainLabel.replace(/\s+/g, '-')}.json`;
    a.click();
  };

  const selectCls = 'px-3 py-2 border border-line rounded-lg bg-surface text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary/25';
  const YEARS = Array.from({ length: 12 }, (_, i) => now.getFullYear() + 1 - i);
  const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <h1 className="text-[26px] sm:text-[32px] font-medium text-ink">Tax Report</h1>
          <p className="text-muted mt-1 text-sm">
            Tax summary and deductible expenses for {mainLabel}{comp ? ` vs ${compLabel}` : ''}.
          </p>
        </div>
        <Button variant="outline" onClick={exportTaxReport} className="flex-shrink-0">
          <Download className="h-4 w-4 mr-2" />
          Export
        </Button>
      </div>

      {/* Period + comparison controls */}
      <div className="flex flex-wrap items-end gap-x-4 gap-y-3 rounded-xl border border-line bg-surface p-4">
        <div>
          <label className="block text-xs text-muted mb-1">Period</label>
          <select className={selectCls} value={scope} onChange={(e) => setScope(e.target.value as 'year' | 'quarter' | 'month')}>
            <option value="year">Year</option>
            <option value="quarter">Quarter</option>
            <option value="month">Month</option>
          </select>
        </div>
        {scope === 'quarter' && (
          <div>
            <label className="block text-xs text-muted mb-1">Quarter</label>
            <select className={selectCls} value={quarter} onChange={(e) => setQuarter(Number(e.target.value))}>
              {[1, 2, 3, 4].map(q => <option key={q} value={q}>Q{q}</option>)}
            </select>
          </div>
        )}
        {scope === 'month' && (
          <div>
            <label className="block text-xs text-muted mb-1">Month</label>
            <select className={selectCls} value={month} onChange={(e) => setMonth(Number(e.target.value))}>
              {MONTHS.map(m => <option key={m} value={m}>{getMonthName(m)}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="block text-xs text-muted mb-1">Year</label>
          <select className={selectCls} value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        <label className="flex items-center gap-2 text-sm text-ink pb-2 sm:ml-2">
          <input type="checkbox" checked={compare} onChange={(e) => setCompare(e.target.checked)} className="w-4 h-4 accent-[#24503f]" />
          Compare
        </label>

        {compare && (
          <div className="flex flex-wrap items-end gap-x-4 gap-y-3 pl-0 sm:pl-3 sm:border-l border-line">
            <span className="text-sm text-muted pb-2 hidden sm:inline">vs</span>
            {scope === 'quarter' && (
              <div>
                <label className="block text-xs text-muted mb-1">Quarter</label>
                <select className={selectCls} value={cQuarter} onChange={(e) => setCQuarter(Number(e.target.value))}>
                  {[1, 2, 3, 4].map(q => <option key={q} value={q}>Q{q}</option>)}
                </select>
              </div>
            )}
            {scope === 'month' && (
              <div>
                <label className="block text-xs text-muted mb-1">Month</label>
                <select className={selectCls} value={cMonth} onChange={(e) => setCMonth(Number(e.target.value))}>
                  {MONTHS.map(m => <option key={m} value={m}>{getMonthName(m)}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="block text-xs text-muted mb-1">Year</label>
              <select className={selectCls} value={cYear} onChange={(e) => setCYear(Number(e.target.value))}>
                {YEARS.map(y => <option key={y} value={y}>{y}</option>)}
              </select>
            </div>
          </div>
        )}
      </div>

      {/* Comparison summary (main vs comparison period) */}
      {comp && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Comparison: {mainLabel} vs {compLabel}</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-canvas">
                    <th className="text-left py-2.5 px-4 font-medium">Metric</th>
                    <th className="text-right py-2.5 px-4 font-medium">{mainLabel}</th>
                    <th className="text-right py-2.5 px-4 font-medium">{compLabel}</th>
                    <th className="text-right py-2.5 px-4 font-medium">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {([
                    ['Total income', main.totalIncome, comp.totalIncome, true],
                    ['Deductible expenses', main.totalDeductibleExpenses, comp.totalDeductibleExpenses, false],
                    ['— Operating (≤ $2,500)', main.operatingExpenses, comp.operatingExpenses, false],
                    ['— Capital (> $2,500)', main.capitalExpenses, comp.capitalExpenses, false],
                    ['— Depreciation', main.depreciation, comp.depreciation, false],
                    ['Net income', main.netIncome, comp.netIncome, true],
                  ] as [string, number, number, boolean][]).map(([label, a, b, higherIsGood]) => {
                    const diff = Math.round((a - b) * 100) / 100;
                    const pct = b !== 0 ? (diff / Math.abs(b)) * 100 : (a !== 0 ? 100 : 0);
                    const good = diff === 0 ? false : (diff > 0) === higherIsGood;
                    return (
                      <tr key={label} className="border-b border-line last:border-0">
                        <td className="py-2.5 px-4 font-medium text-ink">{label}</td>
                        <td className="py-2.5 px-4 text-right tnum">{formatCurrency(a)}</td>
                        <td className="py-2.5 px-4 text-right tnum text-muted">{formatCurrency(b)}</td>
                        <td className={`py-2.5 px-4 text-right tnum font-medium ${diff === 0 ? 'text-muted' : good ? 'text-positive' : 'text-danger'}`}>
                          {diff >= 0 ? '+' : ''}{formatCurrency(diff)}{b !== 0 ? ` (${diff >= 0 ? '+' : ''}${pct.toFixed(0)}%)` : ''}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Summary Cards */}
      <div className="grid gap-4 sm:gap-6 grid-cols-2 lg:grid-cols-4">
        <Card>
          <div className="p-5">
            <div className="flex items-center justify-between">
              <span className="eyebrow">Total Income</span>
              <span className="w-9 h-9 rounded-xl bg-primary-soft text-primary grid place-items-center [&_svg]:h-[18px] [&_svg]:w-[18px]"><TrendingUp /></span>
            </div>
            <div className="mt-3 font-display text-[27px] leading-none font-medium text-positive tnum">{formatCurrency(main.totalIncome)}</div>
            <p className="mt-1.5 text-[13px] text-muted">Taxable rental income</p>
          </div>
        </Card>

        <Card>
          <div className="p-5">
            <div className="flex items-center justify-between">
              <span className="eyebrow">Deductible Expenses</span>
              <span className="w-9 h-9 rounded-xl bg-primary-soft text-primary grid place-items-center [&_svg]:h-[18px] [&_svg]:w-[18px]"><TrendingDown /></span>
            </div>
            <div className="mt-3 font-display text-[27px] leading-none font-medium text-danger tnum">{formatCurrency(main.totalDeductibleExpenses)}</div>
            <p className="mt-1.5 text-[13px] text-muted">Includes depreciation</p>
          </div>
        </Card>

        <Card>
          <div className="p-5">
            <div className="flex items-center justify-between">
              <span className="eyebrow">Net Income</span>
              <span className="w-9 h-9 rounded-xl bg-primary-soft text-primary grid place-items-center [&_svg]:h-[18px] [&_svg]:w-[18px]"><DollarSign /></span>
            </div>
            <div className={`mt-3 font-display text-[27px] leading-none font-medium tnum ${main.netIncome >= 0 ? 'text-positive' : 'text-danger'}`}>{formatCurrency(main.netIncome)}</div>
            <p className="mt-1.5 text-[13px] text-muted">Income minus deductions</p>
          </div>
        </Card>

        <Card>
          <div className="p-5">
            <div className="flex items-center justify-between">
              <span className="eyebrow">Expense Ratio</span>
              <span className="w-9 h-9 rounded-xl bg-primary-soft text-primary grid place-items-center [&_svg]:h-[18px] [&_svg]:w-[18px]"><Percent /></span>
            </div>
            <div className="mt-3 font-display text-[27px] leading-none font-medium text-ink tnum">
              {main.totalIncome > 0 ? ((main.totalDeductibleExpenses / main.totalIncome) * 100).toFixed(1) : 0}%
            </div>
            <p className="mt-1.5 text-[13px] text-muted">Expense to income ratio</p>
          </div>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{scope === 'month' ? 'Month total' : 'Monthly performance'}</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={main.breakdown}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis tickFormatter={(value) => `$${Number(value) / 1000}k`} />
                <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                <Bar dataKey="income" fill="#2c7a58" name="Income" />
                <Bar dataKey="expenses" fill="#b98a5e" name="Expenses" />
                <Bar dataKey="netIncome" fill="#24503f" name="Net Income" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Expenses by Category</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <PieChart>
                <Pie
                  data={expenseChartData}
                  cx="50%"
                  cy="50%"
                  outerRadius={100}
                  dataKey="value"
                  label={({ name, percent }) => `${name}: ${((percent || 0) * 100).toFixed(0)}%`}
                >
                  {expenseChartData.map((_entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => formatCurrency(Number(value))} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* Income Breakdown */}
      <Card>
        <CardHeader className="cursor-pointer select-none" onClick={() => toggle('income')}>
          <CardTitle className="flex items-center gap-2">
            <ChevronDown className={cn('h-4 w-4 text-muted transition-transform', collapsed.has('income') && '-rotate-90')} />
            <FileText className="h-5 w-5" />
            Income Breakdown
          </CardTitle>
        </CardHeader>
        {!collapsed.has('income') && <CardContent>
          <div className="space-y-4">
            <div className="flex justify-between items-center py-2 border-b">
              <span className="font-medium">Rent Income</span>
              <span className="font-bold">{formatCurrency(main.rentIncome)}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b">
              <span className="font-medium">Late Fees</span>
              <span className="font-bold">{formatCurrency(main.lateFeeIncome)}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b">
              <span className="font-medium">Other Income</span>
              <span className="font-bold">{formatCurrency(main.otherIncome)}</span>
            </div>
            <div className="flex justify-between items-center py-2 text-lg">
              <span className="font-bold">Taxable Income</span>
              <span className="font-bold text-positive">{formatCurrency(main.totalIncome)}</span>
            </div>
            {main.depositsReceived > 0 && (
              <div className="flex justify-between items-center py-2 border-t border-line">
                <span className="text-sm text-muted">
                  Security deposits received
                  <span className="block text-xs text-muted">Not taxable while held. Record a kept deposit as Other income.</span>
                </span>
                <span className="text-sm text-muted tnum">{formatCurrency(main.depositsReceived)}</span>
              </div>
            )}
          </div>
        </CardContent>}
      </Card>

      {/* Expense Categories Table */}
      <Card>
        <CardHeader className="cursor-pointer select-none" onClick={() => toggle('expenses')}>
          <CardTitle className="flex items-center gap-2">
            <ChevronDown className={cn('h-4 w-4 text-muted transition-transform', collapsed.has('expenses') && '-rotate-90')} />
            <Calculator className="h-5 w-5" />
            Deductible Expenses by Category
          </CardTitle>
        </CardHeader>
        {!collapsed.has('expenses') && <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-canvas">
                  <th className="text-left py-3 px-4 font-medium">Category</th>
                  <th className="text-left py-3 px-4 font-medium">Description</th>
                  <th className="text-right py-3 px-4 font-medium">Amount</th>
                  <th className="text-right py-3 px-4 font-medium">% of Total</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(main.expensesByCategory)
                  .sort(([, a], [, b]) => b - a)
                  .map(([key, value]) => (
                    <tr key={key} className="border-b last:border-0 hover:bg-canvas">
                      <td className="py-3 px-4 font-medium">
                        {TAX_CATEGORIES[key]?.label || key}
                      </td>
                      <td className="py-3 px-4 text-sm text-muted">
                        {TAX_CATEGORIES[key]?.description || ''}
                      </td>
                      <td className="py-3 px-4 text-right font-semibold">
                        {formatCurrency(value)}
                      </td>
                      <td className="py-3 px-4 text-right">
                        <Badge variant="secondary">
                          {main.totalDeductibleExpenses > 0
                            ? ((value / main.totalDeductibleExpenses) * 100).toFixed(1)
                            : 0}%
                        </Badge>
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </CardContent>}
      </Card>

      {/* Operating vs Capital Expenses (IRS $2,500 de minimis safe harbor) */}
      <Card>
        <CardHeader className="cursor-pointer select-none" onClick={() => toggle('opVsCap')}>
          <CardTitle className="flex items-center gap-2">
            <ChevronDown className={cn('h-4 w-4 text-muted transition-transform', collapsed.has('opVsCap') && '-rotate-90')} />
            <Calculator className="h-5 w-5" />
            Operating vs Capital Expenses
          </CardTitle>
        </CardHeader>
        {!collapsed.has('opVsCap') && <CardContent>
          <p className="text-sm text-muted mb-4">
            Anything over {formatCurrency(CAPITAL_THRESHOLD)} per item is generally a
            capital improvement (capitalize and depreciate), not a same year deduction.
            At or under it can be expensed this year under the IRS de minimis safe harbor.
            Confirm the treatment of larger items with your accountant.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-xl border border-line p-4">
              <div className="flex items-center justify-between">
                <span className="eyebrow">Operating (≤ {formatCurrency(CAPITAL_THRESHOLD)})</span>
                <Badge variant="secondary">Deduct this year</Badge>
              </div>
              <div className="mt-2 font-display text-[24px] leading-none font-medium text-ink tnum">
                {formatCurrency(main.operatingExpenses)}
              </div>
              <p className="mt-1.5 text-[13px] text-muted">
                {main.totalDeductibleExpenses > 0
                  ? `${((main.operatingExpenses / main.totalDeductibleExpenses) * 100).toFixed(0)}% of deductible expenses`
                  : 'No deductible expenses'}
              </p>
            </div>
            <div className="rounded-xl border border-line p-4">
              <div className="flex items-center justify-between">
                <span className="eyebrow">Capital (&gt; {formatCurrency(CAPITAL_THRESHOLD)})</span>
                <Badge variant="warning">Capitalize / depreciate</Badge>
              </div>
              <div className="mt-2 font-display text-[24px] leading-none font-medium text-ink tnum">
                {formatCurrency(main.capitalExpenses)}
              </div>
              <p className="mt-1.5 text-[13px] text-muted">
                {main.capitalItems.length > 0
                  ? `${main.capitalItems.length} item${main.capitalItems.length === 1 ? '' : 's'} above the threshold`
                  : 'No items above the threshold'}
              </p>
            </div>
          </div>

          {main.capitalItems.length > 0 && (
            <div className="mt-5 overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-canvas">
                    <th className="text-left py-2.5 px-4 font-medium">Date</th>
                    <th className="text-left py-2.5 px-4 font-medium">Category</th>
                    <th className="text-left py-2.5 px-4 font-medium">Item</th>
                    <th className="text-left py-2.5 px-4 font-medium">Property</th>
                    <th className="text-right py-2.5 px-4 font-medium">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {main.capitalItems.map(item => (
                    <tr key={item.id} className="border-b border-line last:border-0">
                      <td className="py-2.5 px-4 whitespace-nowrap">{formatDate(item.date)}</td>
                      <td className="py-2.5 px-4">{item.categoryLabel}</td>
                      <td className="py-2.5 px-4 text-muted">{item.description || '—'}</td>
                      <td className="py-2.5 px-4 text-muted">{item.propertyName || '—'}</td>
                      <td className="py-2.5 px-4 text-right font-semibold tnum">{formatCurrency(item.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>}
      </Card>

      {/* Depreciation schedule */}
      <Card>
        <CardHeader className="cursor-pointer select-none" onClick={() => toggle('depreciation')}>
          <CardTitle className="flex items-center gap-2">
            <ChevronDown className={cn('h-4 w-4 text-muted transition-transform', collapsed.has('depreciation') && '-rotate-90')} />
            <Home className="h-5 w-5" />
            Depreciation ({year})
          </CardTitle>
        </CardHeader>
        {!collapsed.has('depreciation') && <CardContent>
          <p className="text-sm text-muted mb-4">
            Residential buildings depreciate over 27.5 years (straight line, mid-month convention). Land does not
            depreciate. This is a non-cash deduction that lowers your taxable income.
            {scope !== 'year' && ' The figures below are full-year amounts; the period totals above use the share for the selected months.'}
          </p>
          {main.depreciationSchedule.length === 0 ? (
            <p className="text-sm text-muted">
              Add a purchase price and purchase date to your properties (Properties page) to calculate depreciation.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-canvas">
                    <th className="text-left py-2.5 px-4 font-medium">Property</th>
                    <th className="text-left py-2.5 px-4 font-medium">Placed in service</th>
                    <th className="text-right py-2.5 px-4 font-medium">Cost basis</th>
                    <th className="text-right py-2.5 px-4 font-medium">Land</th>
                    <th className="text-right py-2.5 px-4 font-medium">Depreciable</th>
                    <th className="text-right py-2.5 px-4 font-medium">This year</th>
                    <th className="text-right py-2.5 px-4 font-medium">Accumulated</th>
                  </tr>
                </thead>
                <tbody>
                  {main.depreciationSchedule.map(d => (
                    <tr key={d.name} className="border-b border-line last:border-0">
                      <td className="py-2.5 px-4 font-medium text-ink">{d.name}</td>
                      <td className="py-2.5 px-4">
                        {d.ready
                          ? (d.placedInService ? formatDate(d.placedInService) : '—')
                          : <span className="text-warning">Add purchase date</span>}
                      </td>
                      <td className="py-2.5 px-4 text-right tnum">{formatCurrency(d.purchasePrice)}</td>
                      <td className="py-2.5 px-4 text-right tnum text-muted">{formatCurrency(d.landValue)}</td>
                      <td className="py-2.5 px-4 text-right tnum">{formatCurrency(d.depreciableBasis)}</td>
                      <td className="py-2.5 px-4 text-right font-semibold tnum">{formatCurrency(d.currentYear)}</td>
                      <td className="py-2.5 px-4 text-right tnum text-muted">{formatCurrency(d.accumulated)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-line-strong">
                    <td className="py-2.5 px-4 font-bold" colSpan={5}>Total annual depreciation</td>
                    <td className="py-2.5 px-4 text-right font-bold tnum">
                      {formatCurrency(main.depreciationSchedule.reduce((s, d) => s + d.currentYear, 0))}
                    </td>
                    <td className="py-2.5 px-4 text-right font-bold tnum text-muted">
                      {formatCurrency(main.depreciationSchedule.reduce((s, d) => s + d.accumulated, 0))}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          <p className="text-xs text-muted mt-3">
            Land value defaults to 20% of the purchase price when left blank on a property. Set the assessed land
            value on each property (from your county tax bill) for accuracy, and confirm the basis with your accountant.
          </p>
        </CardContent>}
      </Card>

      {/* Mortgage interest vs principal */}
      {(main.mortgageInterestDeducted > 0 || main.mortgagePrincipalExcluded > 0 || main.mortgageNeedsSplit > 0) && (
        <Card>
          <CardHeader className="cursor-pointer select-none" onClick={() => toggle('mortgage')}>
            <CardTitle className="flex items-center gap-2">
              <ChevronDown className={cn('h-4 w-4 text-muted transition-transform', collapsed.has('mortgage') && '-rotate-90')} />
              <FileText className="h-5 w-5" />
              Mortgage Interest
            </CardTitle>
          </CardHeader>
          {!collapsed.has('mortgage') && <CardContent className="space-y-3">
            <p className="text-sm text-muted">
              Only mortgage interest is deductible, not principal. The report deducts the interest portion you enter
              on each mortgage expense.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-line p-4">
                <span className="eyebrow">Deductible interest</span>
                <div className="mt-2 font-display text-[22px] leading-none font-medium text-ink tnum">
                  {formatCurrency(main.mortgageInterestDeducted)}
                </div>
              </div>
              <div className="rounded-xl border border-line p-4">
                <span className="eyebrow">Principal (not deductible)</span>
                <div className="mt-2 font-display text-[22px] leading-none font-medium text-muted tnum">
                  {formatCurrency(main.mortgagePrincipalExcluded)}
                </div>
              </div>
            </div>
            {main.mortgageNeedsSplit > 0 && (
              <div className="flex items-start gap-2 rounded-lg bg-warning-soft text-warning p-3 text-sm">
                <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <span>
                  {main.mortgageNeedsSplit} mortgage {main.mortgageNeedsSplit === 1 ? 'entry has' : 'entries have'} no
                  interest portion entered, so the full amount is being treated as deductible. If any of that is
                  principal, it is not deductible. When you log a mortgage payment, enter the interest portion (from
                  your Form 1098) so this stays accurate.
                </span>
              </div>
            )}
          </CardContent>}
        </Card>
      )}

      {/* Property Breakdown */}
      <Card>
        <CardHeader className="cursor-pointer select-none" onClick={() => toggle('property')}>
          <CardTitle className="flex items-center gap-2">
            <ChevronDown className={cn('h-4 w-4 text-muted transition-transform', collapsed.has('property') && '-rotate-90')} />
            <Home className="h-5 w-5" />
            Property Performance
          </CardTitle>
        </CardHeader>
        {!collapsed.has('property') && <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b bg-canvas">
                  <th className="text-left py-3 px-4 font-medium">Property</th>
                  <th className="text-right py-3 px-4 font-medium">Income</th>
                  <th className="text-right py-3 px-4 font-medium">Expenses</th>
                  <th className="text-right py-3 px-4 font-medium">Net Income</th>
                </tr>
              </thead>
              <tbody>
                {main.propertyBreakdown.map((p) => (
                  <tr key={p.name} className="border-b last:border-0 hover:bg-canvas">
                    <td className="py-3 px-4 font-medium">{p.name}</td>
                    <td className="py-3 px-4 text-right text-positive">{formatCurrency(p.income)}</td>
                    <td className="py-3 px-4 text-right text-danger">{formatCurrency(p.expenses)}</td>
                    <td className={`py-3 px-4 text-right font-semibold ${p.netIncome >= 0 ? 'text-positive' : 'text-danger'}`}>
                      {formatCurrency(p.netIncome)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>}
      </Card>

      {/* Tax Tips */}
      <Card>
        <CardHeader className="cursor-pointer select-none" onClick={() => toggle('tips')}>
          <CardTitle className="flex items-center gap-2">
            <ChevronDown className={cn('h-4 w-4 text-muted transition-transform', collapsed.has('tips') && '-rotate-90')} />
            <AlertCircle className="h-5 w-5" />
            Tax Tips & Reminders
          </CardTitle>
        </CardHeader>
        {!collapsed.has('tips') && <CardContent>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <h4 className="font-semibold">Income to Report</h4>
              <ul className="list-disc list-inside space-y-1 text-sm text-muted">
                <li>All rent payments received</li>
                <li>Late fees and penalties</li>
                <li>Security deposits kept (not returned)</li>
                <li>Payments for repairs from tenants</li>
              </ul>
            </div>
            <div className="space-y-2">
              <h4 className="font-semibold">Common Deductions</h4>
              <ul className="list-disc list-inside space-y-1 text-sm text-muted">
                <li>Mortgage interest and points</li>
                <li>Property taxes</li>
                <li>Operating expenses</li>
                <li>Depreciation (residential: 27.5 years)</li>
                <li>Repairs and maintenance</li>
              </ul>
            </div>
          </div>
        </CardContent>}
      </Card>
    </div>
  );
}
