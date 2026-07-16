import { useState, useMemo } from 'react';
import {
  FileText, Download, Calculator, TrendingDown, TrendingUp,
  DollarSign, Home, Percent, AlertCircle
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { formatCurrency, yearOf, monthOf } from '../lib/utils';
import { useApp } from '../context/AppContext';
import { rentIncomeForYear } from '../lib/rent';
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

export function TaxReport() {
  const { expenses, incomes, properties, rentPayments, leases } = useApp();
  const [yearFilter, setYearFilter] = useState(new Date().getFullYear().toString());

  const taxYearData = useMemo(() => {
    const year = parseInt(yearFilter);
    const yearExpenses = expenses.filter(e => yearOf(e.date) === year);
    const yearIncome = incomes.filter(i => yearOf(i.date) === year);
    // Rent actually collected lives in rent payments, not the incomes table.
    const yearPaidRent = rentPayments.filter(p => p.status === 'paid' && p.year === year);

    // Income summary. rentIncomeForYear is the ONE definition of taxable rent
    // income (money received that year, whatever month it settles against),
    // shared with Rent Management's Tax tab so the two pages cannot disagree.
    const rentIncome = rentIncomeForYear(rentPayments, year);
    const lateFeeIncome = yearIncome
      .filter(i => i.source === 'late_fee')
      .reduce((sum, i) => sum + i.amount, 0);
    const otherIncome = yearIncome
      .filter(i => i.source === 'other' || i.source === 'deposit')
      .reduce((sum, i) => sum + i.amount, 0);
    const totalIncome = rentIncome + lateFeeIncome + otherIncome;

    // Expense summary by tax category
    const expensesByCategory: Record<string, number> = {};
    let totalDeductibleExpenses = 0;

    yearExpenses.forEach(e => {
      const taxCat = e.taxCategory || mapToTaxCategory(e.category);
      expensesByCategory[taxCat] = (expensesByCategory[taxCat] || 0) + e.amount;
      if (e.taxDeductible !== false) {
        totalDeductibleExpenses += e.amount;
      }
    });

    const netIncome = totalIncome - totalDeductibleExpenses;

    // RentPayment no longer carries its own propertyId: join through the
    // lease it belongs to instead.
    const leasePropertyId = new Map(leases.map(l => [l.id, l.propertyId]));

    // Property breakdown
    const propertyBreakdown = properties.map(p => {
      const propertyExpenses = yearExpenses
        .filter(e => e.propertyId === p.id)
        .reduce((sum, e) => sum + (e.taxDeductible !== false ? e.amount : 0), 0);
      const propertyRent = yearPaidRent
        .filter(pmt => leasePropertyId.get(pmt.leaseId) === p.id)
        .reduce((sum, pmt) => sum + pmt.amount, 0);
      const propertyOther = yearIncome
        .filter(i => i.propertyId === p.id && i.source !== 'rent')
        .reduce((sum, i) => sum + i.amount, 0);
      const propertyIncome = propertyRent + propertyOther;

      return {
        name: p.name,
        income: propertyIncome,
        expenses: propertyExpenses,
        netIncome: propertyIncome - propertyExpenses,
      };
    });

    // Quarterly breakdown
    const quarters = [
      { name: 'Q1', months: [0, 1, 2] },
      { name: 'Q2', months: [3, 4, 5] },
      { name: 'Q3', months: [6, 7, 8] },
      { name: 'Q4', months: [9, 10, 11] },
    ];

    const quarterlyData = quarters.map(q => {
      // rentPayments store month as 1-12; quarters here are 0-indexed months.
      const qMonths = q.months.map(m => m + 1);
      const qRent = yearPaidRent
        .filter(p => qMonths.includes(p.month))
        .reduce((sum, p) => sum + p.amount, 0);
      const qOther = yearIncome
        .filter(i => i.source !== 'rent' && qMonths.includes(monthOf(i.date)))
        .reduce((sum, i) => sum + i.amount, 0);
      const qIncome = qRent + qOther;
      const qExpenses = yearExpenses
        .filter(e => qMonths.includes(monthOf(e.date)))
        .reduce((sum, e) => sum + (e.taxDeductible !== false ? e.amount : 0), 0);

      return {
        name: q.name,
        income: qIncome,
        expenses: qExpenses,
        netIncome: qIncome - qExpenses,
      };
    });

    return {
      totalIncome,
      rentIncome,
      lateFeeIncome,
      otherIncome,
      totalDeductibleExpenses,
      netIncome,
      expensesByCategory,
      propertyBreakdown,
      quarterlyData,
    };
  }, [expenses, incomes, properties, rentPayments, leases, yearFilter]);

  const expenseChartData = useMemo(() => {
    return Object.entries(taxYearData.expensesByCategory)
      .map(([key, value]) => ({
        name: TAX_CATEGORIES[key]?.label || key,
        value,
      }))
      .sort((a, b) => b.value - a.value);
  }, [taxYearData.expensesByCategory]);

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

  const exportTaxReport = () => {
    const report = {
      year: yearFilter,
      generatedAt: new Date().toISOString(),
      income: {
        total: taxYearData.totalIncome,
        rent: taxYearData.rentIncome,
        lateFees: taxYearData.lateFeeIncome,
        other: taxYearData.otherIncome,
      },
      expenses: taxYearData.expensesByCategory,
      netIncome: taxYearData.netIncome,
    };

    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tax-report-${yearFilter}.json`;
    a.click();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Tax Report</h1>
          <p className="text-muted mt-1">
            Annual tax summary and deductible expenses
          </p>
        </div>
        <div className="flex gap-2">
          <select
            className="px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
            value={yearFilter}
            onChange={(e) => setYearFilter(e.target.value)}
          >
            <option value="2030">2030</option>
            <option value="2029">2029</option>
            <option value="2028">2028</option>
            <option value="2027">2027</option>
            <option value="2026">2026</option>
            <option value="2025">2025</option>
            <option value="2024">2024</option>
            <option value="2023">2023</option>
            <option value="2022">2022</option>
            <option value="2021">2021</option>
            <option value="2020">2020</option>
            <option value="2019">2019</option>
          </select>
          <Button variant="outline" onClick={exportTaxReport}>
            <Download className="h-4 w-4 mr-2" />
            Export Report
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Income</CardTitle>
            <TrendingUp className="h-4 w-4 text-positive" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-positive">{formatCurrency(taxYearData.totalIncome)}</div>
            <p className="text-xs text-muted">Taxable rental income</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Deductible Expenses</CardTitle>
            <TrendingDown className="h-4 w-4 text-danger" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-danger">{formatCurrency(taxYearData.totalDeductibleExpenses)}</div>
            <p className="text-xs text-muted">Total deductions</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Net Income</CardTitle>
            <DollarSign className="h-4 w-4 text-primary" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${taxYearData.netIncome >= 0 ? 'text-positive' : 'text-danger'}`}>
              {formatCurrency(taxYearData.netIncome)}
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
              {taxYearData.totalIncome > 0
                ? ((taxYearData.totalDeductibleExpenses / taxYearData.totalIncome) * 100).toFixed(1)
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
            <CardTitle>Quarterly Performance</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={taxYearData.quarterlyData}>
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
              <span className="font-bold">{formatCurrency(taxYearData.rentIncome)}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b">
              <span className="font-medium">Late Fees</span>
              <span className="font-bold">{formatCurrency(taxYearData.lateFeeIncome)}</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b">
              <span className="font-medium">Other Income</span>
              <span className="font-bold">{formatCurrency(taxYearData.otherIncome)}</span>
            </div>
            <div className="flex justify-between items-center py-2 text-lg">
              <span className="font-bold">Total Income</span>
              <span className="font-bold text-positive">{formatCurrency(taxYearData.totalIncome)}</span>
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
                {Object.entries(taxYearData.expensesByCategory)
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
                          {taxYearData.totalDeductibleExpenses > 0
                            ? ((value / taxYearData.totalDeductibleExpenses) * 100).toFixed(1)
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
                {taxYearData.propertyBreakdown.map((p) => (
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
