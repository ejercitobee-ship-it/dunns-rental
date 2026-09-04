import { useState, useMemo, useRef, useEffect } from 'react';
import {
  DollarSign, TrendingDown, TrendingUp, Search,
  Plus, Download, Home, Calendar, DoorOpen, Trash2, Upload, Pencil, Copy,
  Zap, Receipt, Split,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { formatCurrency, formatDate, formatMonthYear, yearOf, monthOf, todayLocalDate } from '../lib/utils';
import { rentIncomeForMonths } from '../lib/rent';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import type { ExpenseCategory, Expense, Income } from '../types';
import { expensesApi, capitalProjectsApi } from '../lib/api';
import {
  EXPENSE_TIERS, categoriesForTier,
  expenseCategoryLabel, expenseCategoryIcon,
  INCOME_SOURCES,
} from '../lib/financials';
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
  '#24503f', '#2c7a58', '#97671c', '#b98a5e', '#7e8b83',
  '#5a7d6c', '#a23429', '#c2a878', '#4a7c6b', '#d4a853',
  '#8b5e3c', '#6b8f7f', '#c17832', '#3d6b54', '#9a7b5a',
];

/** Threshold below which pie slices are grouped into "Other". */
const PIE_OTHER_THRESHOLD = 0.03;

/** Whether a stored ISO date falls in a given month and year. */
function isInMonth(dateStr: string, month: number, year: number): boolean {
  if (!dateStr) return false;
  return monthOf(dateStr) === month && yearOf(dateStr) === year;
}

export function Expenses() {
  const { expenses, incomes, properties, units, rentPayments, leases, tenants, getLeaseTenants, maintenance, utilityAccounts, addExpense, updateExpense, addIncome, updateIncome, deleteExpense, deleteIncome, dispatch } = useApp();
  const { hasPermission } = useAuth();
  const { showToast } = useToast();
  const canAddExpense = hasPermission('finances_expenses');
  const canAddIncome = hasPermission('finances_income');
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<ExpenseCategory | 'all'>('all');
  const [propertyFilter, setPropertyFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState<string>('all');
  const [view, setView] = useState<'expenses' | 'income'>('expenses');
  const [isModalOpen, setIsModalOpen] = useState(false);
  // Tracked so the mortgage "interest portion" field can appear only for a
  // mortgage expense. The rest of the form stays uncontrolled (FormData).
  const [expenseCategory, setExpenseCategory] = useState<ExpenseCategory | ''>('');
  // The expense or income currently being edited (null = the modal is adding a new one).
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [editingIncome, setEditingIncome] = useState<Income | null>(null);
  // The expense modal keeps property/unit/vendor in state (not just FormData) so
  // the utility-account lookup can auto-fill them from a pasted account number.
  const [expensePropertyId, setExpensePropertyId] = useState('');
  const [expenseUnitId, setExpenseUnitId] = useState('');
  const [expenseVendor, setExpenseVendor] = useState('');
  // What the admin pasted into the "utility account #" lookup, and the match.
  const [accountLookup, setAccountLookup] = useState('');
  // Split an expense equally across multiple properties.
  const [splitMode, setSplitMode] = useState(false);
  const [splitPropertyIds, setSplitPropertyIds] = useState<Set<string>>(new Set());
  const [splitTotalAmount, setSplitTotalAmount] = useState<number>(0);
  // Expense type: operating (default) or capital project.
  const [expenseType, setExpenseType] = useState<'operating' | 'capital'>('operating');
  const [capitalProjectId, setCapitalProjectId] = useState('');
  const [capitalProjects, setCapitalProjects] = useState<{ id: string; name: string; propertyId: string }[]>([]);
  const [showNewProject, setShowNewProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  // Recurring expense tracking (controlled so we can auto-set for utilities).
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurringFrequency, setRecurringFrequency] = useState<'monthly' | 'quarterly' | 'yearly' | ''>('');
  // An invoice/receipt file to attach when adding (or replacing on) the expense.
  const [receiptFile, setReceiptFile] = useState<File | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmState, setConfirmState] = useState<{
    open: boolean; title: string; message: string; onConfirm: () => void;
    variant?: 'danger' | 'warning' | 'info'; confirmText?: string;
  }>({ open: false, title: '', message: '', onConfirm: () => {} });
  const canDelete = hasPermission('finances_expenses_delete');
  // Editing a recorded expense or income requires the history permission.
  const canEditExpense = hasPermission('finances_history');
  const canEditIncome = hasPermission('finances_history');
  // Description truncation: track which rows are expanded.
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  // Pagination: show N rows at a time with a "Load More" button.
  const [visibleCount, setVisibleCount] = useState(10);
  // Separate month and year filters.
  const [monthFilter, setMonthFilter] = useState<string>('all');
  const [yearFilter, setYearFilter] = useState<string>('all');
  // Reset pagination when any filter or view changes.
  useEffect(() => { setVisibleCount(10); }, [searchTerm, categoryFilter, propertyFilter, sourceFilter, monthFilter, yearFilter, view]);

  // Load capital projects when the expense modal opens.
  useEffect(() => {
    if (isModalOpen && view === 'expenses') {
      capitalProjectsApi.list()
        .then(ps => setCapitalProjects(ps.map(p => ({ id: p.id, name: p.name, propertyId: p.propertyId }))))
        .catch(() => {});
    }
  }, [isModalOpen, view]);

  const accountMatch = useMemo(() => {
    const q = accountLookup.trim().toLowerCase();
    if (!q) return null;
    return utilityAccounts.find(u => {
      const acct = (u.accountNumber || '').trim().toLowerCase();
      return acct === q || (q.length >= 4 && acct.endsWith(q));
    }) || null;
  }, [accountLookup, utilityAccounts]);

  // Paste an account number: fill the property, unit, category, and vendor from
  // the utility account it belongs to, so the admin does not hunt for them.
  const applyAccountLookup = (value: string) => {
    setAccountLookup(value);
    const q = value.trim().toLowerCase();
    const match = q ? utilityAccounts.find(u => {
      const acct = (u.accountNumber || '').trim().toLowerCase();
      return acct === q || (q.length >= 4 && acct.endsWith(q));
    }) : null;
    if (match) {
      setExpensePropertyId(match.propertyId);
      setExpenseUnitId(match.unitId || '');
      setExpenseCategory('utilities');
      if (match.provider) setExpenseVendor(match.provider);
      // Utilities are monthly; auto-set so the admin doesn't have to.
      setIsRecurring(true);
      setRecurringFrequency('monthly');
    }
  };

  const openExpenseModal = () => {
    setEditingExpense(null);
    setEditingIncome(null);
    setExpenseCategory('');
    setExpensePropertyId('');
    setExpenseUnitId('');
    setExpenseVendor('');
    setAccountLookup('');
    setReceiptFile(null);
    setSplitMode(false);
    setSplitPropertyIds(new Set());
    setSplitTotalAmount(0);
    setExpenseType('operating');
    setCapitalProjectId('');
    setShowNewProject(false);
    setNewProjectName('');
    setIsRecurring(false);
    setRecurringFrequency('');
    setIsModalOpen(true);
  };

  const openEditExpense = (expense: Expense) => {
    setEditingExpense(expense);
    setEditingIncome(null);
    setExpenseCategory(expense.category);
    setExpensePropertyId(expense.propertyId || '');
    setExpenseUnitId(expense.unitId || '');
    setExpenseVendor(expense.vendor || '');
    setAccountLookup('');
    setReceiptFile(null);
    setSplitMode(false);
    setSplitPropertyIds(new Set());
    setSplitTotalAmount(0);
    setExpenseType(expense.expenseType || (expense.capitalProjectId ? 'capital' : 'operating'));
    setCapitalProjectId(expense.capitalProjectId || '');
    setShowNewProject(false);
    setNewProjectName('');
    setIsRecurring(expense.isRecurring || false);
    setRecurringFrequency(expense.recurringFrequency || '');
    setIsModalOpen(true);
  };

  const openEditIncome = (income: Income) => {
    setEditingIncome(income);
    setEditingExpense(null);
    setView('income');
    setExpensePropertyId(income.propertyId || '');
    setExpenseUnitId(income.unitId || '');
    setIsModalOpen(true);
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setEditingExpense(null);
    setEditingIncome(null);
  };

  // Super admins can remove a mistaken manual entry. Derived rows are not
  // deleted here: rent income belongs to a recorded payment (delete it in Rent
  // Management) and a maintenance expense belongs to a job (delete the report on
  // the Maintenance page), so removing them at the source keeps the two in step.
  const handleDeleteExpense = (id: string, label: string) => {
    setConfirmState({
      open: true,
      title: 'Delete expense',
      message: `${label}\n\nThis removes it from Finances and cannot be undone.`,
      confirmText: 'Delete',
      variant: 'danger',
      onConfirm: async () => {
        setDeletingId(id);
        try {
          await deleteExpense(id);
          showToast('Expense deleted.', 'success');
        } catch (err) {
          showToast((err as Error).message || 'Could not delete the expense', 'error');
        } finally {
          setDeletingId(null);
        }
      },
    });
  };

  const handleDeleteIncome = (id: string, label: string) => {
    setConfirmState({
      open: true,
      title: 'Delete income',
      message: `${label}\n\nThis removes it from Finances and cannot be undone.`,
      confirmText: 'Delete',
      variant: 'danger',
      onConfirm: async () => {
        setDeletingId(id);
        try {
          await deleteIncome(id);
          showToast('Income deleted.', 'success');
        } catch (err) {
          showToast((err as Error).message || 'Could not delete the income', 'error');
        } finally {
          setDeletingId(null);
        }
      },
    });
  };

  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;

  // Rent collected (paid rent_payments) is real income, the same figure the
  // Dashboard and Reports use. Before, Finances summed ONLY the manual `incomes`
  // table, so rent never showed here and the totals disagreed with the Dashboard.
  const rentCollected = useMemo(
    () => rentPayments.filter(p => p.status === 'paid' && p.type !== 'credit').reduce((sum, p) => sum + (p.amount || 0), 0),
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
    const otherIncome = incomes.filter(i => i.source !== 'deposit').reduce((sum, i) => sum + i.amount, 0);
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
    const all = Object.entries(categories)
      .map(([name, value]) => ({ name: expenseCategoryLabel(name), value }))
      .sort((a, b) => b.value - a.value);
    const total = all.reduce((s, d) => s + d.value, 0);
    if (total === 0) return all;
    const major: typeof all = [];
    let otherSum = 0;
    for (const d of all) {
      if (d.value / total < PIE_OTHER_THRESHOLD) otherSum += d.value;
      else major.push(d);
    }
    if (otherSum > 0) major.push({ name: 'Other', value: otherSum });
    return major;
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
        expense.paymentAccount?.includes(searchTerm) ||
        property?.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        unit?.unitNumber.toLowerCase().includes(searchTerm.toLowerCase());
      
      const matchesCategory = categoryFilter === 'all' || expense.category === categoryFilter;
      const matchesProperty = propertyFilter === 'all' || expense.propertyId === propertyFilter;
      const matchesYear = yearFilter === 'all' || expense.date.substring(0, 4) === yearFilter;
      const matchesMonth = monthFilter === 'all' || expense.date.substring(5, 7) === monthFilter;

      return matchesSearch && matchesCategory && matchesProperty && matchesYear && matchesMonth;
    }).sort((a, b) => b.date.localeCompare(a.date));
  }, [expenses, properties, units, searchTerm, categoryFilter, propertyFilter, yearFilter, monthFilter]);

  // The income list = rent collected (from paid rent_payments, read-only) PLUS
  // the manually-entered `incomes`, so the list matches the totals above and the
  // Dashboard. Rent rows come from the payment's lease for their property/unit.
  const sourceLabels = Object.fromEntries(
    Object.entries(INCOME_SOURCES).map(([k, v]) => [k, v.label])
  ) as Record<string, string>;
  interface IncomeRow {
    id: string;
    date: string;
    propertyId?: string;
    unitId?: string;
    source: string;
    description: string;
    amount: number;
    tenantName?: string;
    rentMonth?: string;
  }
  const incomeRows = useMemo<IncomeRow[]>(() => {
    const manual: IncomeRow[] = incomes.map(i => {
      let tenantName: string | undefined;
      // Resolve tenant name: first try the stored tenantId, then fall back
      // to the lease lookup for system-generated move-in fee entries.
      if (i.tenantId) {
        const t = tenants.find(tt => tt.id === i.tenantId);
        if (t) tenantName = `${t.firstName} ${t.lastName}`;
      } else if (i.source === 'move_in_fee' && i.id.startsWith('movein-')) {
        const leaseId = i.id.replace('movein-', '');
        const names = getLeaseTenants(leaseId).map(t => `${t.firstName} ${t.lastName}`);
        if (names.length) tenantName = names.join(', ');
      }
      return {
        id: i.id, date: i.date, propertyId: i.propertyId, unitId: i.unitId,
        source: i.source, description: i.description, amount: i.amount, tenantName,
      };
    });
    const rent: IncomeRow[] = rentPayments
      .filter(p => p.status === 'paid')
      .map(p => {
        const lease = leases.find(l => l.id === p.leaseId);
        const payer = p.paidByTenantId ? tenants.find(t => t.id === p.paidByTenantId) : undefined;
        const tenantName = payer
          ? `${payer.firstName} ${payer.lastName}`
          : lease ? getLeaseTenants(lease.id).map(t => `${t.firstName} ${t.lastName}`).join(', ') : undefined;
        return {
          id: `rent-${p.id}`,
          date: p.paidDate || p.receivedDate || `${p.year}-${String(p.month).padStart(2, '0')}-01`,
          propertyId: lease?.propertyId,
          unitId: lease?.unitId,
          source: 'rent',
          description: `Rent`,
          amount: p.amount,
          tenantName,
          rentMonth: formatMonthYear(p.month, p.year),
        };
      });
    return [...manual, ...rent];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomes, rentPayments, leases, tenants]);

  // Unique years present in the data, sorted newest first.
  const yearOptions = useMemo(() => {
    const years = new Set<string>();
    expenses.forEach(e => { if (e.date) years.add(e.date.substring(0, 4)); });
    incomeRows.forEach(i => { if (i.date) years.add(i.date.substring(0, 4)); });
    return [...years].sort((a, b) => b.localeCompare(a));
  }, [expenses, incomeRows]);

  const filteredIncome = useMemo(() => {
    return incomeRows.filter(income => {
      const property = properties.find(p => p.id === income.propertyId);
      const unit = income.unitId ? units.find(u => u.id === income.unitId) : null;

      const matchesSearch =
        !searchTerm ||
        income.description.toLowerCase().includes(searchTerm.toLowerCase()) ||
        income.source.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (income.tenantName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
        property?.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
        unit?.unitNumber.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesProperty = propertyFilter === 'all' || income.propertyId === propertyFilter;
      const matchesSource = sourceFilter === 'all' || income.source === sourceFilter;
      const matchesYear = yearFilter === 'all' || income.date.substring(0, 4) === yearFilter;
      const matchesMonth = monthFilter === 'all' || income.date.substring(5, 7) === monthFilter;

      return matchesSearch && matchesProperty && matchesSource && matchesYear && matchesMonth;
    }).sort((a, b) => b.date.localeCompare(a.date));
  }, [incomeRows, properties, units, searchTerm, propertyFilter, sourceFilter, yearFilter, monthFilter]);

  const getProperty = (propertyId?: string) => propertyId ? properties.find(p => p.id === propertyId) : undefined;
  const getUnit = (unitId?: string) => unitId ? units.find(u => u.id === unitId) : null;

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);

    try {
      if (view === 'expenses') {
        const totalAmount = Number(formData.get('amount'));
        const category = formData.get('category') as ExpenseCategory;
        const date = formData.get('date') as string;
        const description = formData.get('description') as string;
        const vendor = (formData.get('vendor') as string) || undefined;
        const paymentAccount = (formData.get('paymentAccount') as string)?.trim() || undefined;
        const isRecurringVal = isRecurring;
        const recurringFrequencyVal = recurringFrequency || undefined;
        const interestAmount = category === 'mortgage' && formData.get('interestAmount')
          ? Number(formData.get('interestAmount'))
          : undefined;

        // Split mode: create one expense per selected property with an equal share.
        const targetPropertyIds = splitMode && splitPropertyIds.size > 1
          ? [...splitPropertyIds]
          : [formData.get('propertyId') as string];
        const perPropertyAmount = Math.round((totalAmount / targetPropertyIds.length) * 100) / 100;
        // Distribute any rounding remainder onto the first property so the sum
        // is exact: e.g., $100 / 3 = $33.34 + $33.33 + $33.33.
        const remainder = Math.round((totalAmount - perPropertyAmount * targetPropertyIds.length) * 100) / 100;

        // If creating a new capital project inline, do that first.
        let resolvedProjectId = expenseType === 'capital' ? capitalProjectId : undefined;
        if (expenseType === 'capital' && showNewProject && newProjectName.trim()) {
          const newProject = await capitalProjectsApi.create({
            name: newProjectName.trim(),
            propertyId: targetPropertyIds[0],
            status: 'in_progress',
          });
          resolvedProjectId = newProject.id;
          setCapitalProjects(prev => [...prev, { id: newProject.id, name: newProject.name, propertyId: newProject.propertyId }]);
        }

        const savedIds: string[] = [];
        for (let idx = 0; idx < targetPropertyIds.length; idx++) {
          const propId = targetPropertyIds[idx];
          const amount = idx === 0 ? perPropertyAmount + remainder : perPropertyAmount;
          const splitNote = targetPropertyIds.length > 1
            ? `[Split ${idx + 1}/${targetPropertyIds.length}] ${description}`
            : description;
          const fields = {
            propertyId: propId,
            unitId: splitMode ? undefined : ((formData.get('unitId') as string) || undefined),
            category,
            amount,
            date,
            description: splitNote,
            vendor,
            paymentAccount,
            isRecurring: isRecurringVal,
            recurringFrequency: recurringFrequencyVal,
            expenseType,
            classificationStatus: 'confirmed' as const,
            capitalProjectId: expenseType === 'capital' ? resolvedProjectId : undefined,
            interestAmount: interestAmount != null
              ? Math.round((interestAmount / targetPropertyIds.length) * 100) / 100
              : undefined,
          };
          if (editingExpense && idx === 0) {
            await updateExpense({ ...editingExpense, ...fields });
            savedIds.push(editingExpense.id);
          } else {
            savedIds.push((await addExpense(fields)).id);
          }
        }
        // Upload the receipt to every split expense in the background.
        if (receiptFile) {
          const pendingFile = receiptFile;
          const label = savedIds.length > 1 ? 'Expenses saved. Uploading receipt...' : 'Expense saved. Uploading receipt...';
          showToast(label, 'success');
          Promise.all(savedIds.map(id =>
            expensesApi.uploadReceipt(id, pendingFile)
              .then(withReceipt => dispatch({ type: 'UPDATE_EXPENSE', payload: withReceipt }))
          ))
            .then(() => showToast('Receipt uploaded.', 'success'))
            .catch(() => showToast('Receipt upload failed. Add it from the receipt icon on the row.', 'error'));
        }
      } else {
        const incomeFields = {
          propertyId: formData.get('propertyId') as string,
          unitId: (formData.get('unitId') as string) || undefined,
          tenantId: (formData.get('tenantId') as string) || undefined,
          source: (formData.get('source') || 'other') as Income['source'],
          amount: Number(formData.get('amount')),
          date: formData.get('date') as string,
          description: formData.get('description') as string,
        };
        if (editingIncome) {
          await updateIncome({ ...editingIncome, ...incomeFields });
        } else {
          await addIncome(incomeFields);
        }
      }
      closeModal();
    } catch (error) {
      alert((error as Error).message);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <p className="eyebrow">Money in, money out</p>
          <h1 className="font-display text-[28px] sm:text-[34px] text-ink mt-1">Finances</h1>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <Button variant="outline" className="w-full sm:w-auto">
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
          {(view === 'expenses' ? canAddExpense : canAddIncome) && (
            <Button onClick={openExpenseModal} className="w-full sm:w-auto">
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
            <div className="mt-3 font-display text-[27px] leading-none font-semibold text-positive tnum">{formatCurrency(stats.totalIncome)}</div>
            <p className="mt-1.5 text-[13px] text-muted">All time</p>
          </div>
        </Card>

        <Card>
          <div className="p-5">
            <div className="flex items-center justify-between">
              <span className="eyebrow">Total Expenses</span>
              <span className="w-9 h-9 rounded-xl bg-primary-soft text-primary grid place-items-center [&_svg]:h-[18px] [&_svg]:w-[18px]"><TrendingDown /></span>
            </div>
            <div className="mt-3 font-display text-[27px] leading-none font-semibold text-danger tnum">{formatCurrency(stats.totalExpenses)}</div>
            <p className="mt-1.5 text-[13px] text-muted">All time</p>
          </div>
        </Card>

        <Card>
          <div className="p-5">
            <div className="flex items-center justify-between">
              <span className="eyebrow">Net Income</span>
              <span className="w-9 h-9 rounded-xl bg-primary-soft text-primary grid place-items-center [&_svg]:h-[18px] [&_svg]:w-[18px]"><DollarSign /></span>
            </div>
            <div className={`mt-3 font-display text-[27px] leading-none font-semibold tnum ${stats.netIncome >= 0 ? 'text-positive' : 'text-danger'}`}>{formatCurrency(stats.netIncome)}</div>
            <p className="mt-1.5 text-[13px] text-muted">Overall profit/loss</p>
          </div>
        </Card>

        <Card>
          <div className="p-5">
            <div className="flex items-center justify-between">
              <span className="eyebrow">This Month</span>
              <span className="w-9 h-9 rounded-xl bg-primary-soft text-primary grid place-items-center [&_svg]:h-[18px] [&_svg]:w-[18px]"><Calendar /></span>
            </div>
            <div className="mt-3 font-display text-[27px] leading-none font-semibold text-ink tnum">{formatCurrency(stats.monthlyExpenses)}</div>
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
                <Bar dataKey="income" fill="#2c7a58" name="Income" />
                <Bar dataKey="expenses" fill="#b98a5e" name="Expenses" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Expenses by Category</CardTitle>
          </CardHeader>
          <CardContent>
            {(() => {
              const total = expenseByCategory.reduce((s, d) => s + d.value, 0);
              return (
                <div className="flex flex-col items-center gap-4">
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie
                        data={expenseByCategory}
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={100}
                        paddingAngle={1}
                        dataKey="value"
                        label={false}
                      >
                        {expenseByCategory.map((_entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
                    {expenseByCategory.map((d, i) => {
                      const pct = total > 0 ? ((d.value / total) * 100).toFixed(1) : '0';
                      return (
                        <div key={d.name} className="flex items-center gap-2 py-1 min-w-0">
                          <span
                            className="w-3 h-3 rounded-sm flex-shrink-0"
                            style={{ backgroundColor: COLORS[i % COLORS.length] }}
                          />
                          <span className="truncate text-muted flex-1">{d.name}</span>
                          <span className="font-medium tnum text-ink whitespace-nowrap">{pct}%</span>
                          <span className="text-muted tnum whitespace-nowrap">{formatCurrency(d.value)}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })()}
          </CardContent>
        </Card>
      </div>

      {/* View Toggle */}
      <div className="rounded-xl border border-line bg-surface p-1 inline-flex">
        {([['expenses', 'Expenses'], ['income', 'Income']] as const).map(([key, label]) => (
          <button
            key={key}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
              view === key
                ? 'bg-primary text-white shadow-sm'
                : 'text-muted hover:text-ink'
            }`}
            onClick={() => setView(key as 'expenses' | 'income')}
          >
            {label}
          </button>
        ))}
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
        <select
          className="px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary w-full sm:w-auto"
          value={yearFilter}
          onChange={(e) => setYearFilter(e.target.value)}
        >
          <option value="all">All Years</option>
          {yearOptions.map(y => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <select
          className="px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary w-full sm:w-auto"
          value={monthFilter}
          onChange={(e) => setMonthFilter(e.target.value)}
        >
          <option value="all">All Months</option>
          <option value="01">January</option>
          <option value="02">February</option>
          <option value="03">March</option>
          <option value="04">April</option>
          <option value="05">May</option>
          <option value="06">June</option>
          <option value="07">July</option>
          <option value="08">August</option>
          <option value="09">September</option>
          <option value="10">October</option>
          <option value="11">November</option>
          <option value="12">December</option>
        </select>

        {view === 'expenses' && (
          <select
            className="px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary w-full sm:w-auto"
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value as ExpenseCategory | 'all')}
          >
            <option value="all">All Categories</option>
            {EXPENSE_TIERS.map(tier => (
              <optgroup key={tier.value} label={tier.label}>
                {categoriesForTier(tier.value).map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        )}
        {view === 'income' && (
          <select
            className="px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary w-full sm:w-auto"
            value={sourceFilter}
            onChange={(e) => setSourceFilter(e.target.value)}
          >
            <option value="all">All Sources</option>
            {Object.entries(sourceLabels).map(([key, label]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        )}
      </div>

      {/* Data Table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className={`w-full sm:min-w-0 ${view === 'income' ? 'min-w-[900px]' : 'min-w-[780px]'}`}>
              <thead>
                <tr className="border-b bg-canvas">
                  <th className="text-left py-3 px-4 font-medium">Date</th>
                  <th className="text-left py-3 px-4 font-medium">Property & Unit</th>
                  {view === 'expenses' && <th className="text-left py-3 px-4 font-medium">Category</th>}
                  {view === 'income' && <th className="text-left py-3 px-4 font-medium">Source</th>}
                  {view === 'income' && <th className="text-left py-3 px-4 font-medium">Tenant</th>}
                  <th className="text-left py-3 px-4 font-medium">Description</th>
                  {view === 'expenses' && <th className="text-left py-3 px-4 font-medium">Vendor</th>}
                  {view === 'expenses' && <th className="text-left py-3 px-4 font-medium">Acct</th>}
                  <th className="text-right py-3 px-4 font-medium">Amount</th>
                  {(canDelete || canAddExpense) && <th className="text-right py-3 px-4 font-medium">Actions</th>}
                </tr>
              </thead>
              <tbody>
                {view === 'expenses' ? (
                  filteredExpenses.slice(0, visibleCount).map(expense => {
                    const property = getProperty(expense.propertyId);
                    const unit = getUnit(expense.unitId);
                    const CategoryIcon = expenseCategoryIcon(expense.category);
                    
                    return (
                      <tr key={expense.id} className="border-b last:border-0 hover:bg-black/[0.02]">
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
                            <span className="text-sm">{expenseCategoryLabel(expense.category)}</span>
                            {expense.expenseType === 'capital' && (
                              <Badge variant="warning" className="text-xs">Capital</Badge>
                            )}
                            {expense.classificationStatus === 'needs_review' && (
                              <Badge variant="destructive" className="text-xs">Needs Review</Badge>
                            )}
                            {expense.isRecurring && (
                              <Badge variant="secondary" className="text-xs">Recurring</Badge>
                            )}
                          </div>
                        </td>
                        <td className="py-4 px-4 text-sm max-w-[200px]">
                          <div
                            onClick={() => setExpandedIds(prev => {
                              const next = new Set(prev);
                              if (next.has(expense.id)) next.delete(expense.id);
                              else next.add(expense.id);
                              return next;
                            })}
                            className={`cursor-pointer ${expandedIds.has(expense.id) ? 'whitespace-normal break-words' : 'truncate'}`}
                            title={expense.description}
                          >
                            {expense.description}
                          </div>
                        </td>
                        <td className="py-4 px-4 text-sm text-muted">
                          {expense.vendor || '-'}
                        </td>
                        <td className="py-4 px-4 text-sm text-muted font-mono">
                          {expense.paymentAccount ? `···${expense.paymentAccount}` : '-'}
                        </td>
                        <td className="py-4 px-4 text-right font-semibold text-danger">
                          -{formatCurrency(expense.amount)}
                        </td>
                        {(canDelete || canAddExpense) && (
                          <td className="py-4 px-4 text-right">
                            <div className="inline-flex items-center gap-1 justify-end">
                              {canEditExpense && (
                                <button
                                  onClick={() => openEditExpense(expense)}
                                  title="Edit this expense"
                                  className="p-1.5 text-faint hover:text-primary hover:bg-primary-soft rounded-md transition-colors"
                                >
                                  <Pencil className="h-4 w-4" />
                                </button>
                              )}
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
                                  onClick={() => handleDeleteExpense(expense.id, `${expenseCategoryLabel(expense.category)}: ${formatCurrency(expense.amount)}`)}
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
                  filteredIncome.slice(0, visibleCount).map(income => {
                    const property = getProperty(income.propertyId);
                    const unit = getUnit(income.unitId);

                    return (
                      <tr key={income.id} className="border-b last:border-0 hover:bg-black/[0.02]">
                        <td className="py-4 px-4 text-sm">{formatDate(income.date)}</td>
                        <td className="py-4 px-4">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <Home className="h-4 w-4 text-muted" />
                              <span className="text-sm">{property?.name || '—'}</span>
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
                          <Badge variant="success">{sourceLabels[income.source] || income.source}</Badge>
                        </td>
                        <td className="py-4 px-4 text-sm text-ink">
                          {income.tenantName || <span className="text-faint">{'—'}</span>}
                        </td>
                        <td className="py-4 px-4 text-sm max-w-[200px]">
                          <div
                            onClick={() => setExpandedIds(prev => {
                              const next = new Set(prev);
                              if (next.has(income.id)) next.delete(income.id);
                              else next.add(income.id);
                              return next;
                            })}
                            className={`cursor-pointer ${expandedIds.has(income.id) ? 'whitespace-normal break-words' : 'truncate'}`}
                            title={income.description}
                          >
                            {income.description}
                          </div>
                          {income.rentMonth && (
                            <span className="block text-xs text-muted">{income.rentMonth}</span>
                          )}
                        </td>
                        <td className="py-4 px-4 text-right font-semibold text-positive">
                          +{formatCurrency(income.amount)}
                        </td>
                        {(canDelete || canAddExpense || canEditIncome) && (
                          <td className="py-4 px-4 text-right">
                            <div className="flex items-center justify-end gap-1">
                              {canEditIncome && !income.id.startsWith('rent-') && !income.id.startsWith('movein-') && (() => {
                                const orig = incomes.find(i => i.id === income.id);
                                return orig ? (
                                  <button
                                    onClick={() => openEditIncome(orig)}
                                    title="Edit this income"
                                    className="p-1.5 text-faint hover:text-primary hover:bg-primary/10 rounded-md transition-colors"
                                  >
                                    <Pencil className="h-4 w-4" />
                                  </button>
                                ) : null;
                              })()}
                              {!canDelete ? null : income.id.startsWith('rent-') ? (
                                <span
                                  className="text-xs text-muted"
                                  title="This rent came from a recorded payment. Delete it in Rent Management."
                                >
                                  Rent Mgmt
                                </span>
                              ) : (
                                <button
                                  onClick={() => handleDeleteIncome(income.id, `${income.description}: ${formatCurrency(income.amount)}`)}
                                  disabled={deletingId === income.id}
                                  title="Delete this income"
                                  className="p-1.5 text-faint hover:text-danger hover:bg-danger-soft rounded-md transition-colors disabled:opacity-50"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              )}
                            </div>
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

      {(() => {
        const total = (view === 'expenses' ? filteredExpenses : filteredIncome).length;
        const remaining = total - visibleCount;
        return remaining > 0 ? (
          <div className="flex justify-center">
            <Button
              variant="outline"
              onClick={() => setVisibleCount(prev => prev + 10)}
            >
              Load More ({remaining} remaining)
            </Button>
          </div>
        ) : null;
      })()}

      {(view === 'expenses' ? filteredExpenses : filteredIncome).length === 0 && (
        <div className="text-center py-12">
          <DollarSign className="h-12 w-12 mx-auto text-muted mb-4" />
          <h3 className="text-lg font-medium">No {view} found</h3>
          <p className="text-muted">Try adjusting your search or filters</p>
        </div>
      )}

      {/* Add/Edit Expense or Add Income Modal. `key` re-mounts the form when
          switching between adding and editing so the uncontrolled defaultValues
          reset to the right record. */}
      <Modal
        isOpen={isModalOpen}
        onClose={closeModal}
        title={editingExpense ? 'Edit Expense' : editingIncome ? 'Edit Income' : `Add ${view === 'expenses' ? 'Expense' : 'Income'}`}
        size="lg"
      >
        <form key={editingExpense?.id || editingIncome?.id || 'new'} onSubmit={handleSubmit} className="space-y-4">
          {/* Split toggle — new expenses only, expense view only */}
          {view === 'expenses' && !editingExpense && properties.length > 1 && (
            <button
              type="button"
              onClick={() => {
                const next = !splitMode;
                setSplitMode(next);
                if (next) { setExpensePropertyId(''); setExpenseUnitId(''); setSplitPropertyIds(new Set()); }
                else { setSplitPropertyIds(new Set()); }
              }}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border text-sm font-medium transition-colors ${
                splitMode
                  ? 'border-primary bg-primary-soft text-primary'
                  : 'border-line text-muted hover:border-primary/40 hover:text-ink'
              }`}
            >
              <Split className="h-4 w-4" />
              Split across properties
              {splitMode && <span className="ml-auto text-xs">({splitPropertyIds.size} selected)</span>}
            </button>
          )}

          {splitMode && view === 'expenses' ? (
            /* Multi-select property checkboxes for split mode */
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Select properties *</label>
                <button
                  type="button"
                  onClick={() => setSplitPropertyIds(prev =>
                    prev.size === properties.length ? new Set() : new Set(properties.map(p => p.id))
                  )}
                  className="text-xs text-primary hover:underline"
                >
                  {splitPropertyIds.size === properties.length ? 'Deselect all' : 'Select all'}
                </button>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5 rounded-lg border border-line p-3 max-h-48 overflow-y-auto">
                {properties.map(p => (
                  <label key={p.id} className="flex items-center gap-2 py-1 px-1 rounded hover:bg-black/[0.02] cursor-pointer">
                    <input
                      type="checkbox"
                      checked={splitPropertyIds.has(p.id)}
                      onChange={() => setSplitPropertyIds(prev => {
                        const next = new Set(prev);
                        if (next.has(p.id)) next.delete(p.id);
                        else next.add(p.id);
                        return next;
                      })}
                      className="rounded border-line text-primary focus:ring-primary"
                    />
                    <span className="text-sm text-ink">{p.name}</span>
                  </label>
                ))}
              </div>
              {splitPropertyIds.size < 2 && (
                <p className="text-xs text-muted">Select at least 2 properties to split.</p>
              )}
              {/* Hidden input so the form validation doesn't require the single-property select */}
              <input type="hidden" name="propertyId" value={[...splitPropertyIds][0] || ''} />
            </div>
          ) : (
            /* Standard single-property + unit selectors */
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Property *</label>
                <select
                  name="propertyId"
                  required
                  value={expensePropertyId}
                  onChange={(e) => { setExpensePropertyId(e.target.value); setExpenseUnitId(''); }}
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
                  value={expenseUnitId}
                  onChange={(e) => setExpenseUnitId(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">Select Unit</option>
                  {units.filter(u => !expensePropertyId || u.propertyId === expensePropertyId).map(u => (
                    <option key={u.id} value={u.id}>
                      {getProperty(u.propertyId)?.name} - Unit {u.unitNumber}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {view === 'expenses' ? (
            <>
              {/* Paste a utility account number to auto-fill the property, unit,
                  category, and vendor from the saved utility account. */}
              <div className="space-y-1.5 rounded-lg border border-primary/30 bg-primary-soft/40 p-3">
                <label className="text-sm font-medium flex items-center gap-1.5">
                  <Zap className="h-4 w-4 text-primary" /> Utility account number (quick fill)
                </label>
                <input
                  type="text"
                  value={accountLookup}
                  onChange={(e) => applyAccountLookup(e.target.value)}
                  placeholder="Paste full or last 4+ digits of account number"
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                />
                {accountLookup.trim() && (accountMatch ? (
                  <p className="text-xs text-positive">
                    Matched {getProperty(accountMatch.propertyId)?.name || 'property'}
                    {accountMatch.unitId && getUnit(accountMatch.unitId) ? ` · Unit ${getUnit(accountMatch.unitId)?.unitNumber}` : ''}
                    {accountMatch.provider ? ` · ${accountMatch.provider}` : ''} <span className="capitalize">({accountMatch.type})</span>. Filled in below.
                  </p>
                ) : (
                  <p className="text-xs text-muted">No match found. Try the last 4+ digits, or add this account on the property's Utilities section.</p>
                ))}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Category *</label>
                  <select
                    name="category"
                    required
                    value={expenseCategory}
                    onChange={(e) => {
                      const cat = e.target.value as ExpenseCategory | '';
                      setExpenseCategory(cat);
                      // Utilities are always monthly; auto-set so the admin doesn't have to.
                      if (cat === 'utilities' && !editingExpense) {
                        setIsRecurring(true);
                        setRecurringFrequency('monthly');
                      }
                    }}
                    className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="">Select Category</option>
                    {EXPENSE_TIERS.map(tier => (
                      <optgroup key={tier.value} label={tier.label}>
                        {categoriesForTier(tier.value).map(c => (
                          <option key={c.value} value={c.value}>{c.label}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </div>

                <div className="space-y-2">
                  <label className="text-sm font-medium">Vendor</label>
                  <input
                    type="text"
                    name="vendor"
                    placeholder="e.g., Home Depot, Electric Company"
                    value={expenseVendor}
                    onChange={(e) => setExpenseVendor(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Paid from (last 4 digits)</label>
                  <input
                    type="text"
                    name="paymentAccount"
                    placeholder="e.g., 4523"
                    maxLength={4}
                    defaultValue={editingExpense?.paymentAccount || ''}
                    className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary font-mono"
                  />
                  <p className="text-xs text-muted">Bank account or card number (last few digits) so you can match the statement.</p>
                </div>
              </div>

              {/* Expense Type: Operating vs Capital Project */}
              <div className="space-y-3 rounded-lg border border-line bg-canvas p-4">
                <label className="text-sm font-medium text-ink">Expense Type</label>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => { setExpenseType('operating'); setCapitalProjectId(''); setShowNewProject(false); }}
                    className={`px-3 py-2.5 rounded-lg border text-sm transition-colors text-left ${
                      expenseType === 'operating'
                        ? 'border-primary bg-primary/5 text-primary font-medium'
                        : 'border-line hover:border-primary/50 text-ink'
                    }`}
                  >
                    Operating Expense
                    <p className="text-xs text-muted mt-0.5 font-normal">Day to day costs, repairs, maintenance</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => setExpenseType('capital')}
                    className={`px-3 py-2.5 rounded-lg border text-sm transition-colors text-left ${
                      expenseType === 'capital'
                        ? 'border-primary bg-primary/5 text-primary font-medium'
                        : 'border-line hover:border-primary/50 text-ink'
                    }`}
                  >
                    Capital Project
                    <p className="text-xs text-muted mt-0.5 font-normal">Improvements that add value or extend life</p>
                  </button>
                </div>

                {expenseType === 'capital' && (
                  <div className="space-y-2 pt-1">
                    {!showNewProject ? (
                      <>
                        <label className="text-xs text-muted">Link to Capital Project</label>
                        <select
                          value={capitalProjectId}
                          onChange={(e) => setCapitalProjectId(e.target.value)}
                          className="w-full px-3 py-2 border border-line rounded-lg bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary/25"
                        >
                          <option value="">Select a project...</option>
                          {capitalProjects
                            .filter(p => !expensePropertyId || p.propertyId === expensePropertyId)
                            .map(p => (
                              <option key={p.id} value={p.id}>{p.name}</option>
                            ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => setShowNewProject(true)}
                          className="text-xs text-primary hover:underline"
                        >
                          + Create new project
                        </button>
                      </>
                    ) : (
                      <>
                        <label className="text-xs text-muted">New Project Name</label>
                        <input
                          type="text"
                          value={newProjectName}
                          onChange={(e) => setNewProjectName(e.target.value)}
                          placeholder="e.g., Kitchen Renovation"
                          className="w-full px-3 py-2 border border-line rounded-lg bg-surface text-sm focus:outline-none focus:ring-2 focus:ring-primary/25"
                        />
                        <button
                          type="button"
                          onClick={() => { setShowNewProject(false); setNewProjectName(''); }}
                          className="text-xs text-muted hover:text-ink"
                        >
                          Cancel, select existing project instead
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>

              {expenseCategory === 'utilities' && expensePropertyId && (() => {
                const accts = utilityAccounts.filter(u => u.propertyId === expensePropertyId);
                if (accts.length === 0) return null;
                return (
                  <div className="rounded-lg border border-line bg-canvas p-3 space-y-2">
                    <p className="text-xs font-medium text-ink">Utility accounts on this property</p>
                    <div className="space-y-1.5">
                      {accts.map(a => (
                        <div key={a.id} className="flex items-center justify-between gap-2 text-sm">
                          <span className="text-muted">
                            <span className="font-medium text-ink capitalize">{a.type}</span>
                            {a.provider ? ` · ${a.provider}` : ''}
                          </span>
                          {a.accountNumber && (
                            <span className="inline-flex items-center gap-1.5">
                              <span className="tnum text-ink">{a.accountNumber}</span>
                              <button type="button" onClick={() => navigator.clipboard?.writeText(a.accountNumber || '')} className="p-1 text-faint hover:text-primary hover:bg-primary-soft rounded" title="Copy account number"><Copy className="h-3.5 w-3.5" /></button>
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                    <p className="text-[11px] text-muted">Copy the account number into the vendor or description so the bill is easy to trace.</p>
                  </div>
                );
              })()}

              <div className="flex items-center gap-4">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={isRecurring}
                    onChange={(e) => setIsRecurring(e.target.checked)}
                    className="w-4 h-4 rounded border-line-strong"
                  />
                  <span className="text-sm">Recurring Expense</span>
                </label>
                {isRecurring && (
                  <select
                    value={recurringFrequency}
                    onChange={(e) => setRecurringFrequency(e.target.value as 'monthly' | 'quarterly' | 'yearly' | '')}
                    className="px-3 py-1 border rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary"
                  >
                    <option value="">Select Frequency</option>
                    <option value="monthly">Monthly</option>
                    <option value="quarterly">Quarterly</option>
                    <option value="yearly">Yearly</option>
                  </select>
                )}
              </div>

              {expenseCategory === 'mortgage' && (
                <div className="space-y-2 rounded-lg border border-line bg-canvas p-3">
                  <label className="text-sm font-medium">Deductible interest portion</label>
                  <div className="relative">
                    <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">$</span>
                    <input
                      type="number"
                      name="interestAmount"
                      step="0.01"
                      min="0"
                      placeholder="0.00"
                      defaultValue={editingExpense?.interestAmount ?? ''}
                      className="w-full pl-8 pr-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                    />
                  </div>
                  <p className="text-xs text-muted">
                    Only mortgage <strong>interest</strong> is tax-deductible, not the principal. Enter the interest
                    portion of this payment (from your statement or Form 1098). The remainder is treated as
                    non-deductible principal on the Tax Report.
                  </p>
                </div>
              )}

              <div className="space-y-2">
                <label className="text-sm font-medium">Invoice / receipt (optional)</label>
                <input
                  type="file"
                  accept="image/*,.pdf"
                  onChange={(e) => setReceiptFile(e.target.files?.[0] ?? null)}
                  className="block w-full text-sm text-muted file:mr-3 file:rounded-lg file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-ink hover:file:border-primary/50"
                />
                <p className="text-xs text-muted">
                  {receiptFile
                    ? `Selected: ${receiptFile.name}`
                    : editingExpense?.receiptUrl
                      ? 'A receipt is already attached. Choosing a file replaces it. Stored in the unit\'s folder.'
                      : 'Attach the invoice or payment receipt. Stored in the unit\'s Drive folder.'}
                </p>
              </div>
            </>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Source *</label>
                <select
                  name="source"
                  required
                  defaultValue={editingIncome?.source || ''}
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">Select Source</option>
                  {Object.entries(INCOME_SOURCES).map(([key, meta]) => (
                    <option key={key} value={key}>{meta.label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Tenant (Optional)</label>
                <select
                  name="tenantId"
                  defaultValue={editingIncome?.tenantId || ''}
                  className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                >
                  <option value="">Select Tenant</option>
                  {tenants
                    .filter(t => !expensePropertyId || leases.some(l => l.propertyId === expensePropertyId && l.tenantIds?.includes(t.id)))
                    .map(t => (
                      <option key={t.id} value={t.id}>{t.firstName} {t.lastName}</option>
                    ))}
                </select>
              </div>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">{splitMode && splitPropertyIds.size > 1 ? 'Total amount *' : 'Amount *'}</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">$</span>
                <input
                  type="number"
                  name="amount"
                  step="0.01"
                  min="0"
                  required
                  placeholder="0.00"
                  defaultValue={editingExpense?.amount ?? editingIncome?.amount ?? ''}
                  onChange={splitMode ? (e) => setSplitTotalAmount(Number(e.target.value) || 0) : undefined}
                  className="w-full pl-8 pr-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary"
                />
              </div>
              {splitMode && splitPropertyIds.size > 1 && splitTotalAmount > 0 && (
                <p className="text-xs text-primary font-medium">
                  {formatCurrency(Math.round((splitTotalAmount / splitPropertyIds.size) * 100) / 100)} per property × {splitPropertyIds.size} properties
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium">Date *</label>
              <input
                type="date"
                name="date"
                required
                defaultValue={editingExpense?.date || editingIncome?.date || todayLocalDate()}
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
              defaultValue={editingExpense?.description || editingIncome?.description || ''}
              className="w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-primary resize-none"
            />
          </div>

          <div className="flex gap-3 pt-4">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={closeModal}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="flex-1"
              disabled={splitMode && splitPropertyIds.size < 2}
            >
              {editingExpense || editingIncome
                ? 'Save Changes'
                : splitMode && splitPropertyIds.size > 1
                  ? `Add ${splitPropertyIds.size} Expenses (split)`
                  : `Add ${view === 'expenses' ? 'Expense' : 'Income'}`}
            </Button>
          </div>
        </form>
      </Modal>

      <ConfirmDialog
        isOpen={confirmState.open}
        onClose={() => setConfirmState(s => ({ ...s, open: false }))}
        onConfirm={confirmState.onConfirm}
        title={confirmState.title}
        message={confirmState.message}
        confirmText={confirmState.confirmText}
        variant={confirmState.variant}
      />
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
