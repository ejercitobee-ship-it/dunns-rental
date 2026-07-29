import { useState, useMemo, useRef } from 'react';
import {
  DollarSign, TrendingDown, TrendingUp, Search,
  Plus, Download, Home, Wrench, Zap, Shield, Receipt,
  Paintbrush, Trees, Briefcase, MoreHorizontal, Calendar, DoorOpen, Trash2, Upload
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { formatCurrency, formatDate, formatMonthYear, yearOf, monthOf } from '../lib/utils';
import { rentIncomeForMonths } from '../lib/rent';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import type { ExpenseCategory, Expense } from '../types';
import { expensesApi } from '../lib/api';
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

const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4', '#84cc16'];

/** Whether a stored ISO date falls in a given month and year. */
function isInMonth(dateStr: string, month: number, year: number): boolean {
  if (!dateStr) return false;
  return monthOf(dateStr) === month && yearOf(dateStr) === year;
}

const categoryIcons: Record<ExpenseCategory, typeof Wrench> = {
  maintenance: Wrench,
  utilities: Zap,
  insurance: Shield,
  taxes: Receipt,
  mortgage: DollarSign,
  repairs: Wrench,
  cleaning: Paintbrush,
  landscaping: Trees,
  management: Briefcase,
  other: MoreHorizontal,
};

const categoryLabels: Record<ExpenseCategory, string> = {
  maintenance: 'Maintenance',
  utilities: 'Utilities',
  insurance: 'Insurance',
  taxes: 'Taxes',
  mortgage: 'Mortgage',
  repairs: 'Repairs',
  cleaning: 'Cleaning',
  landscaping: 'Landscaping',
  management: 'Management',
  other: 'Other',
};

export function Expenses() {
  const { expenses, incomes, properties, units, rentPayments, leases, maintenance, addExpense, addIncome, deleteExpense, deleteIncome } = useApp();
  const { isSuperAdmin, hasPermission } = useAuth();
  const { showToast } = useToast();
  const canAddExpense = hasPermission('finances_expenses');
  const canAddIncome = hasPermission('finances_income');
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<ExpenseCategory | 'all'>('all');
  const [propertyFilter, setPropertyFilter] = useState('all');
  const [view, setView] = useState<'expenses' | 'income'>('expenses');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const canDelete = isSuperAdmin();

  // Super admins can remove a mistaken manual entry. Derived rows are not
  // deleted here: rent income belongs to a recorded payment (delete it in Rent
  // Management) and a maintenance expense belongs to a job (delete the report on
  // the Maintenance page), so removing them at the source keeps the two in step.
  const handleDeleteExpense = async (id: string, label: string) => {
    if (!confirm(`Delete this expense?\n\n${label}\n\nThis removes it from Finances and cannot be undone.`)) return;
    setDeletingId(id);
    try {
      await deleteExpense(id);
      showToast('Expense deleted.', 'success');
    } catch (err) {
      showToast((err as Error).message || 'Could not delete the expense', 'error');
    } finally {
      setDeletingId(null);
    }
  };

  const handleDeleteIncome = async (id: string, label: string) => {
    if (!confirm(`Delete this income?\n\n${label}\n\nThis removes it from Finances and cannot be undone.`)) return;
    setDeletingId(id);
    try {
      await deleteIncome(id);
      showToast('Income deleted.', 'success');
    } catch (err) {
      showToast((err as Error).message || 'Could not delete the income', 'error');
    } finally {
      setDeletingId(null);
    }
  };

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  // Rent collected (paid rent_payments) is real income, the same figure the
  // Dashboard and Reports use. Before, Finances summed ONLY the manual `incomes`
  // table, so rent never showed here and the totals disagreed with the Dashboard.
  const rentCollected = useMemo(
    () => rentPayments.filter(p => p.status === 'paid').reduce((sum, p) => sum + (p.amount || 0), 0),
    [rentPayments]
  );

  // Maintenance expenses (id `maint-<requestId>`) are normally managed from the
  // Maintenance page. But if the report was already deleted, the expense is an
  // orphan with nowhere else to remove it, so it must be deletable right here.
  // This set holds only the maintenance expenses whose report still exists.
  const linkedMaintenanceExpenseIds = useMemo(
    () => new Set(maintenance.map(m => `maint-${m.id}`)),
    [maintenance]
  );

  const stats = useMemo(() => {
    const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
    const otherIncome = incomes.reduce((sum, i) => sum + i.amount, 0);
    const totalIncome = rentCollected + otherIncome;
    const netIncome = totalIncome - totalExpenses;

    const monthlyExpenses = expenses
      .filter(e => isInMonth(e.date, currentMonth, currentYear))
      .reduce((sum, e) => sum + e.amount, 0);

    return { totalExpenses, totalIncome, netIncome, monthlyExpenses };
  }, [expenses, incomes, rentCollected, currentMonth, currentYear]);

  const expenseByCategory = useMemo(() => {
    const categories: Record<string, number> = {};
    expenses.forEach(e => {
      categories[e.category] = (categories[e.category] || 0) + e.amount;
    });
    return Object.entries(categories)
      .map(([name, value]) => ({ name: categoryLabels[name as ExpenseCategory], value }))
      .sort((a, b) => b.value - a.value);
  }, [expenses]);

  // Every month of the current year. This used to stop at May because the list
  // was hard coded to five months, and it counted any year's March in March
  // because nothing compared the year.
  const monthlyData = useMemo(() => {
    const months = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
    return months.map(month => {
      const monthExpenses = expenses
        .filter(e => isInMonth(e.date, month, currentYear))
        .reduce((sum, e) => sum + e.amount, 0);
      const monthIncome =
        rentIncomeForMonths(rentPayments, [month], currentYear) +
        incomes
          .filter(i => isInMonth(i.date, month, currentYear))
          .reduce((sum, i) => sum + i.amount, 0);

      return {
        name: new Date(currentYear, month - 1).toLocaleDateString('en-US', { month: 'short' }),
        expenses: monthExpenses,
        income: monthIncome,
      };
    });
  }, [expenses, incomes, rentPayments, currentYear]);

  const filteredExpenses = useMemo(() => {
    return expenses.filter(expense => {
      const property = properties.find(p => p.id === expense.propertyId);
      const unit = expense.unitId ? units.find(u => u.id === expense.unitId) : null;
      
      const matchesSearch = 
        !searchTerm ||
        expense.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
        expense.vendor?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        property?.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        unit?.unitNumber.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesCategory = categoryFilter === 'all' || expense.category === categoryFilter;
      const matchesProperty = propertyFilter === 'all' || expense.propertyId === propertyFilter;
      
      return matchesSearch && matchesCategory && matchesProperty;
    }).sort((a, b) => b.date.localeCompare(a.date));
  }, [expenses, properties, units, searchTerm, categoryFilter, propertyFilter]);

  // The income list = rent collected (from paid rent_payments, read-only) PLUS
  // the manually-entered `incomes`, so the list matches the totals above and the
  // Dashboard. Rent rows come from the payment's lease for their property/unit.
  interface IncomeRow {
    id: string;
    date: string;
    propertyId?: string;
    unitId?: string;
    source: string;
    description: string;
    amount: number;
  }
  const incomeRows = useMemo<IncomeRow[]>(() => {
    const manual: IncomeRow[] = incomes.map(i => ({
      id: i.id, date: i.date, propertyId: i.propertyId, unitId: i.unitId,
      source: i.source, description: i.description, amount: i.amount,
    }));
    const rent: IncomeRow[] = rentPayments
      .filter(p => p.status === 'paid')
      .map(p => {
        const lease = leases.find(l => l.id === p.leaseId);
        return {
          id: `rent-${p.id}`,
          date: p.paidDate || p.receivedDate || `${p.year}-${String(p.month).padStart(2, '0')}-01`,
          propertyId: lease?.propertyId,
          unitId: lease?.unitId,
          source: 'rent',
          description: `Rent — ${formatMonthYear(p.month, p.year)}`,
          amount: p.amount,
        };
      });
    return [...manual, ...rent];
  }, [incomes, rentPayments, leases]);

  const filteredIncome = useMemo(() => {
    return incomeRows.filter(income => {
      const property = properties.find(p => p.id === income.propertyId);
      const unit = income.unitId ? units.find(u => u.id === income.unitId) : null;

      const matchesSearch =
        !searchTerm ||
        income.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
        income.source.toLowerCase().includes(searchTerm.toLowerCase()) ||
        property?.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        unit?.unitNumber.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesProperty = propertyFilter === 'all' || income.propertyId === propertyFilter;

      return matchesSearch && matchesProperty;
    }).sort((a, b) => b.date.localeCompare(a.date));
  }, [incomeRows, properties, units, searchTerm, propertyFilter]);

  const getProperty = (propertyId?: string) => propertyId ? properties.find(p => p.id === propertyId) : undefined;
  const getUnit = (unitId?: string) => unitId ? units.find(u => u.id === unitId) : null;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    
    try {
      if (view === 'expenses') {
        await addExpense({
          propertyId: formData.get('propertyId') as string,
          unitId: (formData.get('unitId') as string) || undefined,
          category: formData.get('category') as ExpenseCategory,
          amount: Number(formData.get('amount')),
          date: formData.get('date') as string,
          description: formData.get('description') as string,
          vendor: (formData.get('vendor') as string) || undefined,
          isRecurring: formData.get('isRecurring') === 'on',
          recurringFrequency: (formData.get('recurringFrequency') as 'monthly' | 'quarterly' | 'yearly') || undefined,
        });
      } else {
        await addIncome({
          propertyId: formData.get('propertyId') as string,
          unitId: (formData.get('unitId') as string) || undefined,
          source: formData.get('source') as 'rent' | 'late_fee' | 'deposit' | 'other',
          amount: Number(formData.get('amount')),
          date: formData.get('date') as string,
          description: formData.get('description') as string,
        });
      }
      setIsModalOpen(false);
    } catch (error) {
      alert((error as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-[26px] sm:text-[32px] font-medium text-ink">Finances</h1>
          <p className="text-muted mt-1 text-sm sm:text-base">
            Track expenses and income across all properties
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <Button variant="outline" className="w-full sm:w-auto">
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
          {(view === 'expenses' ? canAddExpense : canAddIncome) && (
            <Button onClick={() => setIsModalOpen(true)} className="w-full sm:w-auto">
              <Plus className="h-4 w-4 mr-2" />
              Add {view === 'expenses' ? 'Expense' : 'Income'}
            </Button>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-4 sm:gap-6 grid-cols-2 lg:grid-cols-4">
        <Card>
          <div className="p-5">
            <div className="flex items-center justify-between">
              <span className="eyebrow">Total Income</span>
              <span className="w-9 h-9 rounded-xl bg-primary-soft text-primary grid place-items-center [&_svg]:h-[18px] [&_svg]:w-[18px]"><TrendingUp /></span>
            </div>
            <div className="mt-3 font-display text-[27px] leading-none font-medium text-positive tnum">{formatCurrency(stats.totalIncome)}</div>
            <p className="mt-1.5 text-[13px] text-muted">All time</p>
          </div>
        </Card>

        <Card>
          <div className="p-5">
            <div className="flex items-center justify-between">
              <span className="eyebrow">Total Expenses</span>
              <span className="w-9 h-9 rounded-xl bg-primary-soft text-primary grid place-items-center [&_svg]:h-[18px] [&_svg]:w-[18px]"><TrendingDown /></span>
            </div>
            <div className="mt-3 font-display text-[27px] leading-none font-medium text-danger tnum">{formatCurrency(stats.totalExpenses)}</div>
            <p className="mt-1.5 text-[13px] text-muted">All time</p>
          </div>
        </Card>

        <Card>
          <div className="p-5">
            <div className="flex items-center justify-between">
              <span className="eyebrow">Net Income</span>
              <span className="w-9 h-9 rounded-xl bg-primary-soft text-primary grid place-items-center [&_svg]:h-[18px] [&_svg]:w-[18px]"><DollarSign /></span>
            </div>
            <div className={`mt-3 font-display text-[27px] leading-none font-medium tnum ${stats.netIncome >= 0 ? 'text-positive' : 'text-danger'}`}>{formatCurrency(stats.netIncome)}</div>
            <p className="mt-1.5 text-[13px] text-muted">Overall profit/loss</p>
          </div>
        </Card>

        <Card>
          <div className="p-5">
            <div className="flex items-center justify-between">
              <span className="eyebrow">This Month</span>
              <span className="w-9 h-9 rounded-xl bg-primary-soft text-primary grid place-items-center [&_svg]:h-[18px] [&_svg]:w-[18px]"><Calendar /></span>
            </div>
            <div className="mt-3 font-display text-[27px] leading-none font-medium text-ink tnum">{formatCurrency(stats.monthlyExpenses)}</div>
            <p className="mt-1.5 text-[13px] text-muted">Expenses</p>
          </div>
        </Card>
      </div>

      {/* Charts */}
      <div className="grid gap-4 sm:gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Income vs Expenses</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="name" />
                <YAxis tickFormatter={(value) => `$${Number(value) / 1000}k`} />
                <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                <Bar dataKey="income" fill="#10b981" name="Income" />
                <Bar dataKey="expenses" fill="#ef4444" name="Expenses" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Expenses by Category</CardTitle>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={250}>
              <PieChart>
                <Pie
                  data={expenseByCategory}
                  cx="50%"
                  cy="50%"
                  outerRadius={80}
                  dataKey="value"
                  label={({ percent }) => `${((percent || 0) * 100).toFixed(0)}%`}
                >
                  {expenseByCategory.map((_entry, index) => (
                    <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip formatter={(value) => formatCurrency(Number(value))} />
              </PieChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      </div>

      {/* View Toggle */}
      <div className="flex gap-2 border-b overflow-x-auto">
        <button
          className={`px-4 py-2 font-medium border-b-2 transition-colors ${
            view === 'expenses' 
              ? 'border-primary text-primary' 
              : 'border-transparent text-muted hover:text-foreground'
          }`}
          onClick={() => setView('expenses')}
        >
          Expenses
        </button>
        <button
          className={`px-4 py-2 font-medium border-b-2 transition-colors ${
            view === 'income' 
              ? 'border-primary text-primary' 
              : 'border-transparent text-muted hover:text-foreground'
          }`}
          onClick={() => setView('income')}
        >
          Income
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
          <input
            type="text"
            placeholder={`Search ${view}...`}
            className="w-full pl-10 pr-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
        <select
          className="px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary w-full sm:w-auto"
          value={propertyFilter}
          onChange={(e) => setPropertyFilter(e.target.value)}
        >
          <option value="all">All Properties</option>
          {properties.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
        
        {view === 'expenses' && (
          <select
            className="px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary w-full sm:w-auto"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as ExpenseCategory | 'all')}
          >
            <option value="all">All Categories</option>
            {Object.entries(categoryLabels).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        )}
      </div>

      {/* Data Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full min-w-[700px] sm:min-w-0">
              <thead>
                <tr className="border-b bg-muted/50">
                  <th className="text-left py-3 px-4 font-medium">Date</th>
                  <th className="text-left py-3 px-4 font-medium">Property & Unit</th>
                  {view === 'expenses' && <th className="text-left py-3 px-4 font-medium">Category</th>}
                  <th className="text-left py-3 px-4 font-medium">Description</th>
                  {view === 'expenses' && <th className="text-left py-3 px-4 font-medium">Vendor</th>}
                  <th className="text-right py-3 px-4 font-medium">Amount</th>
                  {(canDelete || canAddExpense) && <th className="text-right py-3 px-4 font-medium">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {view === 'expenses' ? (
                  filteredExpenses.map(expense => {
                    const property = getProperty(expense.propertyId);
                    const unit = getUnit(expense.unitId);
                    const CategoryIcon = categoryIcons[expense.category];
                    
                    return (
                      <tr key={expense.id} className="border-b last:border-0 hover:bg-muted/50">
                        <td className="py-4 px-4 text-sm">{formatDate(expense.date)}</td>
                        <td className="py-4 px-4">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <Home className="h-4 w-4 text-muted" />
                              <span className="text-sm">{property?.name}</span>
                            </div>
                            {unit && (
                              <div className="flex items-center gap-2">
                                <DoorOpen className="h-4 w-4 text-muted" />
                                <span className="text-sm text-muted">Unit {unit.unitNumber}</span>
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="py-4 px-4">
                          <div className="flex items-center gap-2">
                            <CategoryIcon className="h-4 w-4 text-muted" />
                            <span className="text-sm capitalize">{categoryLabels[expense.category]}</span>
                            {expense.isRecurring && (
                              <Badge variant="secondary" className="text-xs">Recurring</Badge>
                            )}
                          </div>
                        </td>
                        <td className="py-4 px-4 text-sm">{expense.description}</td>
                        <td className="py-4 px-4 text-sm text-muted">
                          {expense.vendor || '-'}
                        </td>
                        <td className="py-4 px-4 text-right font-semibold text-danger">
                          -{formatCurrency(expense.amount)}
                        </td>
                        {(canDelete || canAddExpense) && (
                          <td className="py-4 px-4 text-right">
                            <div className="inline-flex items-center gap-1 justify-end">
                              {canAddExpense && <ExpenseReceiptButton expense={expense} />}
                              {canDelete && (linkedMaintenanceExpenseIds.has(expense.id) ? (
                                <span
                                  className="text-xs text-muted"
                                  title="This came from a maintenance job. Delete it from the Maintenance page."
                                >
                                  Maintenance
                                </span>
                              ) : (
                                <button
                                  onClick={() => handleDeleteExpense(expense.id, `${categoryLabels[expense.category]} — ${formatCurrency(expense.amount)}`)}
                                  disabled={deletingId === expense.id}
                                  title="Delete this expense"
                                  className="p-1.5 text-faint hover:text-danger hover:bg-danger-soft rounded-md transition-colors disabled:opacity-50"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              ))}
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })
                ) : (
                  filteredIncome.map(income => {
                    const property = getProperty(income.propertyId);
                    const unit = getUnit(income.unitId);
                    
                    return (
                      <tr key={income.id} className="border-b last:border-0 hover:bg-muted/50">
                        <td className="py-4 px-4 text-sm">{formatDate(income.date)}</td>
                        <td className="py-4 px-4">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <Home className="h-4 w-4 text-muted" />
                              <span className="text-sm">{property?.name}</span>
                            </div>
                            {unit && (
                              <div className="flex items-center gap-2">
                                <DoorOpen className="h-4 w-4 text-muted" />
                                <span className="text-sm text-muted">Unit {unit.unitNumber}</span>
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="py-4 px-4">
                          <Badge variant="success" className="capitalize">{income.source}</Badge>
                        </td>
                        <td className="py-4 px-4 text-sm">{income.description}</td>
                        <td className="py-4 px-4 text-right font-semibold text-positive">
                          +{formatCurrency(income.amount)}
                        </td>
                        {(canDelete || canAddExpense) && (
                          <td className="py-4 px-4 text-right">
                            {!canDelete ? null : income.id.startsWith('rent-') ? (
                              <span
                                className="text-xs text-muted"
                                title="This rent came from a recorded payment. Delete it in Rent Management."
                              >
                                Rent Mgmt
                              </span>
                            ) : (
                              <button
                                onClick={() => handleDeleteIncome(income.id, `${income.description} — ${formatCurrency(income.amount)}`)}
                                disabled={deletingId === income.id}
                                title="Delete this income"
                                className="p-1.5 text-faint hover:text-danger hover:bg-danger-soft rounded-md transition-colors disabled:opacity-50"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            )}
                          </td>
                        )}
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {(view === 'expenses' ? filteredExpenses : filteredIncome).length === 0 && (
        <div className="text-center py-12">
          <DollarSign className="h-12 w-12 mx-auto text-muted mb-4" />
          <h3 className="text-lg font-medium">No {view} found</h3>
          <p className="text-muted">Try adjusting your search or filters</p>
        </div>
      )}

      {/* Add Expense/Income Modal */}
      <Modal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        title={`Add ${view === 'expenses' ? 'Expense' : 'Income'}`}
        size="lg"
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Property *</label>
              <select
                name="propertyId"
                required
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">Select Property</option>
                {properties.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Unit (Optional)</label>
              <select
                name="unitId"
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">Select Unit</option>
                {units.map(u => (
                  <option key={u.id} value={u.id}>
                    {getProperty(u.propertyId)?.name} - Unit {u.unitNumber}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {view === 'expenses' ? (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Category *</label>
                  <select
                    name="category"
                    required
                    className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="">Select Category</option>
                    {Object.entries(categoryLabels).map(([key, label]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Vendor</label>
                  <input
                    type="text"
                    name="vendor"
                    placeholder="e.g., Home Depot, Electric Company"
                    className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
              </div>

              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    name="isRecurring"
                    className="w-4 h-4 rounded border-line-strong"
                  />
                  <span className="text-sm">Recurring Expense</span>
                </label>
                <select
                  name="recurringFrequency"
                  className="px-3 py-1 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">Select Frequency</option>
                  <option value="monthly">Monthly</option>
                  <option value="quarterly">Quarterly</option>
                  <option value="yearly">Yearly</option>
                </select>
              </div>
            </>
          ) : (
            <div className="space-y-2">
              <label className="text-sm font-medium">Source *</label>
              <select
                name="source"
                required
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">Select Source</option>
                <option value="rent">Rent</option>
                <option value="late_fee">Late Fee</option>
                <option value="deposit">Deposit</option>
                <option value="other">Other</option>
              </select>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Amount *</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">$</span>
                <input
                  type="number"
                  name="amount"
                  step="0.01"
                  min="0"
                  required
                  placeholder="0.00"
                  className="w-full pl-8 pr-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Date *</label>
              <input
                type="date"
                name="date"
                required
                defaultValue={new Date().toISOString().split('T')[0]}
                className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="text-sm font-medium">Description *</label>
            <textarea
              name="description"
              required
              rows={3}
              placeholder={`Enter ${view} description...`}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            />
          </div>

          <div className="flex gap-3 pt-4">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={() => setIsModalOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" className="flex-1">
              Add {view === 'expenses' ? 'Expense' : 'Income'}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}

// Per-expense receipt control: view the uploaded receipt image and upload or
// replace it. The file is stored in the unit's Drive folder server-side.
function ExpenseReceiptButton({ expense }: { expense: Expense }) {
  const { showToast } = useToast();
  const [receiptUrl, setReceiptUrl] = useState<string | null | undefined>(expense.receiptUrl);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);

  const pick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || busy) return;
    setBusy(true);
    try {
      const updated = await expensesApi.uploadReceipt(expense.id, file);
      setReceiptUrl(updated.receiptUrl ?? null);
      showToast('Receipt uploaded.', 'success');
    } catch (err) {
      showToast((err as Error).message || 'Could not upload the receipt.', 'error');
    } finally {
      setBusy(false);
      if (ref.current) ref.current.value = '';
    }
  };

  return (
    <>
      {receiptUrl && (
        <a
          href={receiptUrl}
          target="_blank"
          rel="noopener noreferrer"
          title="View receipt"
          className="p-1.5 text-primary hover:bg-primary-soft rounded-md transition-colors"
        >
          <Receipt className="h-4 w-4" />
        </a>
      )}
      <input ref={ref} type="file" accept="image/*" className="hidden" onChange={pick} />
      <button
        type="button"
        disabled={busy}
        onClick={() => ref.current?.click()}
        title={receiptUrl ? 'Replace receipt' : 'Upload receipt'}
        className="p-1.5 text-faint hover:text-primary hover:bg-primary-soft rounded-md transition-colors disabled:opacity-50"
      >
        <Upload className="h-4 w-4" />
      </button>
    </>
  );
}
