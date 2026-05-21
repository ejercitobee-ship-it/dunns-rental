import { useState, useMemo } from 'react';
import { 
  DollarSign, TrendingDown, TrendingUp, Search, 
  Plus, Download, Home, Wrench, Zap, Shield, Receipt, 
  Paintbrush, Trees, Briefcase, MoreHorizontal, Calendar, DoorOpen 
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { formatCurrency, formatDate } from '../lib/utils';
import { useApp } from '../context/AppContext';
import type { ExpenseCategory } from '../types';
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
  const { expenses, incomes, properties, units, addExpense, addIncome } = useApp();
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<ExpenseCategory | 'all'>('all');
  const [propertyFilter, setPropertyFilter] = useState('all');
  const [view, setView] = useState<'expenses' | 'income'>('expenses');
  const [isModalOpen, setIsModalOpen] = useState(false);

  const stats = useMemo(() => {
    const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
    const totalIncome = incomes.reduce((sum, i) => sum + i.amount, 0);
    const netIncome = totalIncome - totalExpenses;
    
    const currentMonth = new Date().getMonth() + 1;
    const monthlyExpenses = expenses
      .filter(e => new Date(e.date).getMonth() + 1 === currentMonth)
      .reduce((sum, e) => sum + e.amount, 0);
    
    return { totalExpenses, totalIncome, netIncome, monthlyExpenses };
  }, []);

  const expenseByCategory = useMemo(() => {
    const categories: Record<string, number> = {};
    expenses.forEach(e => {
      categories[e.category] = (categories[e.category] || 0) + e.amount;
    });
    return Object.entries(categories)
      .map(([name, value]) => ({ name: categoryLabels[name as ExpenseCategory], value }))
      .sort((a, b) => b.value - a.value);
  }, []);

  const monthlyData = useMemo(() => {
    const months = [1, 2, 3, 4, 5];
    return months.map(month => {
      const monthExpenses = expenses
        .filter(e => new Date(e.date).getMonth() + 1 === month)
        .reduce((sum, e) => sum + e.amount, 0);
      const monthIncome = incomes
        .filter(i => new Date(i.date).getMonth() + 1 === month)
        .reduce((sum, i) => sum + i.amount, 0);
      
      return {
        name: new Date(2024, month - 1).toLocaleDateString('en-US', { month: 'short' }),
        expenses: monthExpenses,
        income: monthIncome,
      };
    });
  }, []);

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
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [searchTerm, categoryFilter, propertyFilter]);

  const filteredIncome = useMemo(() => {
    return incomes.filter(income => {
      const property = properties.find(p => p.id === income.propertyId);
      const unit = income.unitId ? units.find(u => u.id === income.unitId) : null;
      
      const matchesSearch = 
        !searchTerm ||
        income.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
        property?.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        unit?.unitNumber.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesProperty = propertyFilter === 'all' || income.propertyId === propertyFilter;
      
      return matchesSearch && matchesProperty;
    }).sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [searchTerm, propertyFilter]);

  const getProperty = (propertyId: string) => properties.find(p => p.id === propertyId);
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
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Finances</h1>
          <p className="text-muted-foreground mt-1 text-sm sm:text-base">
            Track expenses and income across all properties
          </p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <Button variant="outline" className="w-full sm:w-auto">
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
          <Button onClick={() => setIsModalOpen(true)} className="w-full sm:w-auto">
            <Plus className="h-4 w-4 mr-2" />
            Add {view === 'expenses' ? 'Expense' : 'Income'}
          </Button>
        </div>
      </div>

      {/* Stats Cards */}
      <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Income</CardTitle>
            <TrendingUp className="h-4 w-4 text-green-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600">{formatCurrency(stats.totalIncome)}</div>
            <p className="text-xs text-muted-foreground">All time</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Expenses</CardTitle>
            <TrendingDown className="h-4 w-4 text-red-500" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600">{formatCurrency(stats.totalExpenses)}</div>
            <p className="text-xs text-muted-foreground">All time</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Net Income</CardTitle>
            <DollarSign className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className={`text-2xl font-bold ${stats.netIncome >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              {formatCurrency(stats.netIncome)}
            </div>
            <p className="text-xs text-muted-foreground">Overall profit/loss</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">This Month</CardTitle>
            <Calendar className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{formatCurrency(stats.monthlyExpenses)}</div>
            <p className="text-xs text-muted-foreground">Expenses</p>
          </CardContent>
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
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setView('expenses')}
        >
          Expenses
        </button>
        <button
          className={`px-4 py-2 font-medium border-b-2 transition-colors ${
            view === 'income' 
              ? 'border-primary text-primary' 
              : 'border-transparent text-muted-foreground hover:text-foreground'
          }`}
          onClick={() => setView('income')}
        >
          Income
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 sm:gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
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
                              <Home className="h-4 w-4 text-muted-foreground" />
                              <span className="text-sm">{property?.name}</span>
                            </div>
                            {unit && (
                              <div className="flex items-center gap-2">
                                <DoorOpen className="h-4 w-4 text-muted-foreground" />
                                <span className="text-sm text-muted-foreground">Unit {unit.unitNumber}</span>
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="py-4 px-4">
                          <div className="flex items-center gap-2">
                            <CategoryIcon className="h-4 w-4 text-muted-foreground" />
                            <span className="text-sm capitalize">{categoryLabels[expense.category]}</span>
                            {expense.isRecurring && (
                              <Badge variant="secondary" className="text-xs">Recurring</Badge>
                            )}
                          </div>
                        </td>
                        <td className="py-4 px-4 text-sm">{expense.description}</td>
                        <td className="py-4 px-4 text-sm text-muted-foreground">
                          {expense.vendor || '-'}
                        </td>
                        <td className="py-4 px-4 text-right font-semibold text-red-600">
                          -{formatCurrency(expense.amount)}
                        </td>
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
                              <Home className="h-4 w-4 text-muted-foreground" />
                              <span className="text-sm">{property?.name}</span>
                            </div>
                            {unit && (
                              <div className="flex items-center gap-2">
                                <DoorOpen className="h-4 w-4 text-muted-foreground" />
                                <span className="text-sm text-muted-foreground">Unit {unit.unitNumber}</span>
                              </div>
                            )}
                          </div>
                        </td>
                        <td className="py-4 px-4">
                          <Badge variant="success" className="capitalize">{income.source}</Badge>
                        </td>
                        <td className="py-4 px-4 text-sm">{income.description}</td>
                        <td className="py-4 px-4 text-right font-semibold text-green-600">
                          +{formatCurrency(income.amount)}
                        </td>
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
          <DollarSign className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h3 className="text-lg font-medium">No {view} found</h3>
          <p className="text-muted-foreground">Try adjusting your search or filters</p>
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
                    className="w-4 h-4 rounded border-gray-300"
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
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">$</span>
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
