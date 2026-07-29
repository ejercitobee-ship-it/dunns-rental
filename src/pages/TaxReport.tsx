import { useState, useMemo, useCallback } from 'react';
import {
  FileText, Download, Calculator, TrendingDown, TrendingUp,
  DollarSign, Home, Percent, AlertCircle
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { formatCurrency, yearOf, monthOf, getMonthName } from '../lib/utils';
import { useApp } from '../context/AppContext';
import { rentIncomeForMonths } from '../lib/rent';
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
    const otherIncome = pIncome.filter(i => i.source === 'other' || i.source === 'deposit').reduce((s, i) => s + i.amount, 0);
    const totalIncome = rentIncome + lateFeeIncome + otherIncome;

    const expensesByCategory: Record<string, number> = {};
    let totalDeductibleExpenses = 0;
    pExpenses.forEach(e => {
      const taxCat = e.taxCategory || mapToTaxCategory(e.category);
      expensesByCategory[taxCat] = (expensesByCategory[taxCat] || 0) + e.amount;
      if (e.taxDeductible !== false) totalDeductibleExpenses += e.amount;
    });
    const netIncome = totalIncome - totalDeductibleExpenses;

    const leasePropertyId = new Map(leases.map(l => [l.id, l.propertyId]));
    const propertyBreakdown = properties.map(p => {
      const propertyExpenses = pExpenses.filter(e => e.propertyId === p.id).reduce((s, e) => s + (e.taxDeductible !== false ? e.amount : 0), 0);
      const propertyRent = pPaidRent.filter(pmt => leasePropertyId.get(pmt.leaseId) === p.id).reduce((s, pmt) => s + pmt.amount, 0);
      const propertyOther = pIncome.filter(i => i.propertyId === p.id && i.source !== 'rent').reduce((s, i) => s + i.amount, 0);
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

    return { totalIncome, rentIncome, lateFeeIncome, otherIncome, totalDeductibleExpenses, netIncome, expensesByCategory, propertyBreakdown, breakdown };
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
      deductibleExpenses: main.expensesByCategory,
      totalDeductibleExpenses: main.totalDeductibleExpenses,
      netIncome: main.netIncome,
      comparison: comp ? {
        period: compLabel,
        income: { total: comp.totalIncome, rent: comp.rentIncome, lateFees: comp.lateFeeIncome, other: comp.otherIncome },
        deductibleExpenses: comp.expensesByCategory,
        totalDeductibleExpenses: comp.totalDeductibleExpenses,
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
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Income</CardTitle>
            <TrendingUp className="h-4 w-4 text-positive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-positive">{formatCurrency(main.totalIncome)}</div>
            <p className="text-xs text-muted">Taxable rental income</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Deductible Expenses</CardTitle>
            <TrendingDown className="h-4 w-4 text-danger" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-danger">{formatCurrency(main.totalDeductibleExpenses)}</div>
            <p className="text-xs text-muted">Total deductions</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Net Income</CardTitle>
            <DollarSign className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${main.netIncome >= 0 ? 'text-positive' : 'text-danger'}`}>
              {formatCurrency(main.netIncome)}
            </div>
            <p className="text-xs text-muted">Income minus deductions</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Expense Ratio</CardTitle>
            <Percent className="h-4 w-4 text-faint" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">
              {main.totalIncome > 0
                ? ((main.totalDeductibleExpenses / main.totalIncome) * 100).toFixed(1)
                : 0}%
            </div>
            <p className="text-xs text-muted">Expense to income ratio</p>
          </CardContent>
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
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Income Breakdown
          </CardTitle>
        </CardHeader>
        <CardContent>
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
              <span className="font-bold">Total Income</span>
              <span className="font-bold text-positive">{formatCurrency(main.totalIncome)}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Expense Categories Table */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Calculator className="h-5 w-5" />
            Deductible Expenses by Category
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
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
        </CardContent>
      </Card>

      {/* Property Breakdown */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Home className="h-5 w-5" />
            Property Performance
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
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
        </CardContent>
      </Card>

      {/* Tax Tips */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5" />
            Tax Tips & Reminders
          </CardTitle>
        </CardHeader>
        <CardContent>
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
        </CardContent>
      </Card>
    </div>
  );
}
