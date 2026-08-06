/**
 * financials.ts — Central Financial Reporting Engine
 *
 * Single source of truth for every category label, icon mapping, tier
 * assignment, tax mapping, and financial computation in the app. Every
 * page that shows financial numbers should use this library instead of
 * deriving its own totals.
 */

import type {
  ExpenseCategory,
  ExpenseTier,
  IncomeSource,
  Expense,
  Income,
  RentPayment,
  Lease,
  Property,
  MaintenanceRequest,
} from '../types';
import {
  Wrench, Zap, Shield, Receipt, DollarSign, Home, Paintbrush, Trees,
  Briefcase, MoreHorizontal, Users, Snowflake, Bug, HardHat, Building2,
  Sofa, RefreshCw, Hammer, AlertTriangle, Lightbulb,
  Monitor, FileText, Megaphone, Calculator, Scale, UserCog,
  CreditCard, FolderCog, type LucideIcon,
} from 'lucide-react';
import { yearOf, monthOf } from './utils';

// ---------------------------------------------------------------------------
// Expense Category Metadata
// ---------------------------------------------------------------------------

export interface CategoryMeta {
  label: string;
  icon: LucideIcon;
  tier: ExpenseTier;
  /** IRS Schedule E tax category this maps to. */
  taxCategory: string;
}

/**
 * Master registry of every expense category. Keyed by the DB value.
 * Every UI that displays a category label, icon, or tier should read from
 * here instead of maintaining its own lookup.
 */
export const EXPENSE_CATEGORIES: Record<ExpenseCategory, CategoryMeta> = {
  // ── Property-level ──────────────────────────────────────────────────
  utilities:              { label: 'Utilities',              icon: Zap,           tier: 'property', taxCategory: 'utilities' },
  hoa:                    { label: 'HOA',                    icon: Home,          tier: 'property', taxCategory: 'hoa' },
  taxes:                  { label: 'Property Taxes',         icon: Receipt,       tier: 'property', taxCategory: 'taxes' },
  insurance:              { label: 'Insurance',              icon: Shield,        tier: 'property', taxCategory: 'insurance' },
  mortgage:               { label: 'Mortgage',               icon: DollarSign,    tier: 'property', taxCategory: 'mortgage_interest' },
  landscaping:            { label: 'Landscaping',            icon: Trees,         tier: 'property', taxCategory: 'cleaning_maintenance' },
  snow_removal:           { label: 'Snow Removal',           icon: Snowflake,     tier: 'property', taxCategory: 'cleaning_maintenance' },
  pest_control:           { label: 'Pest Control',           icon: Bug,           tier: 'property', taxCategory: 'cleaning_maintenance' },
  capital_improvements:   { label: 'Capital Improvements',   icon: HardHat,       tier: 'property', taxCategory: 'other' },
  repairs:                { label: 'Repairs',                icon: Wrench,        tier: 'property', taxCategory: 'repairs' },
  maintenance:            { label: 'Maintenance',            icon: Wrench,        tier: 'property', taxCategory: 'cleaning_maintenance' },
  cleaning:               { label: 'Cleaning',               icon: Paintbrush,    tier: 'property', taxCategory: 'cleaning_maintenance' },
  common_area:            { label: 'Common Area',            icon: Building2,     tier: 'property', taxCategory: 'cleaning_maintenance' },
  property_improvements:  { label: 'Property Improvements',  icon: Lightbulb,     tier: 'property', taxCategory: 'other' },

  // ── Unit-level ──────────────────────────────────────────────────────
  tenant_repairs:         { label: 'Tenant Repairs',         icon: Wrench,        tier: 'unit', taxCategory: 'repairs' },
  appliance_replacement:  { label: 'Appliance Replacement',  icon: Sofa,          tier: 'unit', taxCategory: 'other' },
  turnover_costs:         { label: 'Turnover Costs',         icon: RefreshCw,     tier: 'unit', taxCategory: 'cleaning_maintenance' },
  unit_maintenance:       { label: 'Unit Maintenance',       icon: Hammer,        tier: 'unit', taxCategory: 'cleaning_maintenance' },
  tenant_damage:          { label: 'Tenant Damage',          icon: AlertTriangle, tier: 'unit', taxCategory: 'repairs' },
  unit_improvements:      { label: 'Unit Improvements',      icon: Lightbulb,     tier: 'unit', taxCategory: 'other' },

  // ── Business / management ───────────────────────────────────────────
  software:               { label: 'Software',               icon: Monitor,       tier: 'business', taxCategory: 'other' },
  office_expenses:        { label: 'Office Expenses',        icon: FileText,      tier: 'business', taxCategory: 'supplies' },
  marketing:              { label: 'Marketing',              icon: Megaphone,     tier: 'business', taxCategory: 'advertising' },
  accounting:             { label: 'Accounting',             icon: Calculator,    tier: 'business', taxCategory: 'legal_professional' },
  legal:                  { label: 'Legal',                  icon: Scale,         tier: 'business', taxCategory: 'legal_professional' },
  payroll:                { label: 'Payroll',                icon: UserCog,       tier: 'business', taxCategory: 'management_fees' },
  administrative:         { label: 'Administrative',         icon: Briefcase,     tier: 'business', taxCategory: 'management_fees' },
  banking_fees:           { label: 'Banking Fees',           icon: CreditCard,    tier: 'business', taxCategory: 'other' },
  other_business:         { label: 'Other Business',         icon: FolderCog,     tier: 'business', taxCategory: 'other' },

  // ── Legacy (still stored in older records) ──────────────────────────
  realtor_commission:     { label: 'Realtor Commission',     icon: Users,         tier: 'property', taxCategory: 'commissions' },
  management:             { label: 'Management',             icon: Briefcase,     tier: 'business', taxCategory: 'management_fees' },
  other:                  { label: 'Other',                  icon: MoreHorizontal, tier: 'property', taxCategory: 'other' },
};

/** Get a human-readable label for any expense category. */
export function expenseCategoryLabel(cat: string): string {
  return (EXPENSE_CATEGORIES as Record<string, CategoryMeta>)[cat]?.label ?? cat;
}

/** Get the Lucide icon component for an expense category. */
export function expenseCategoryIcon(cat: string): LucideIcon {
  return (EXPENSE_CATEGORIES as Record<string, CategoryMeta>)[cat]?.icon ?? MoreHorizontal;
}

/** Derive which tier a category belongs to. Uses the explicit `tier` column
 *  on the expense if present; otherwise derives from the category registry. */
export function getExpenseTier(expense: Expense): ExpenseTier {
  if (expense.tier) return expense.tier;
  return (EXPENSE_CATEGORIES as Record<string, CategoryMeta>)[expense.category]?.tier ?? 'property';
}

/** Map an expense category to its IRS Schedule E tax category. */
export function mapToTaxCategory(cat: string): string {
  return (EXPENSE_CATEGORIES as Record<string, CategoryMeta>)[cat]?.taxCategory ?? 'other';
}

/** All categories in a given tier, sorted by label. */
export function categoriesForTier(tier: ExpenseTier): { value: ExpenseCategory; label: string }[] {
  return (Object.entries(EXPENSE_CATEGORIES) as [ExpenseCategory, CategoryMeta][])
    .filter(([, m]) => m.tier === tier)
    .sort((a, b) => a[1].label.localeCompare(b[1].label))
    .map(([value, m]) => ({ value, label: m.label }));
}

/** The three tiers with their display names. */
export const EXPENSE_TIERS: { value: ExpenseTier; label: string }[] = [
  { value: 'property', label: 'Property Level' },
  { value: 'unit', label: 'Unit Level' },
  { value: 'business', label: 'Business / Management' },
];

/**
 * Categories that are ALWAYS operating expenses regardless of dollar amount.
 * These should never be classified as capital improvements even if they
 * exceed the $2,500 de minimis threshold (e.g. a $12,000 property tax bill
 * is an operating expense, not a capital improvement).
 */
export const ALWAYS_OPERATING_CATEGORIES = new Set<string>([
  'taxes', 'insurance', 'hoa', 'mortgage', 'utilities',
  'landscaping', 'snow_removal', 'pest_control', 'cleaning',
  'software', 'office_expenses', 'marketing', 'accounting', 'legal',
  'payroll', 'administrative', 'banking_fees', 'other_business',
  'management', 'realtor_commission', 'common_area',
]);

/**
 * Categories that represent capital improvements: physical improvements
 * to the property that add value, extend useful life, or adapt to a new use.
 * Only these are eligible for the de minimis capital threshold test.
 */
export const CAPITAL_ELIGIBLE_CATEGORIES = new Set<string>([
  'capital_improvements', 'property_improvements', 'unit_improvements',
  'appliance_replacement', 'repairs', 'tenant_repairs', 'maintenance',
  'unit_maintenance', 'tenant_damage', 'turnover_costs', 'other',
]);

/**
 * Determine whether an expense should be treated as a capital improvement
 * for tax purposes. Returns true when:
 *  1. The expense is linked to a Capital Project (capitalProjectId is set), OR
 *  2. The category is explicitly 'capital_improvements', 'property_improvements',
 *     or 'unit_improvements', OR
 *  3. The category is in the capital-eligible set AND the amount exceeds the
 *     IRS de minimis safe-harbor threshold ($2,500)
 *
 * Recurring costs (taxes, insurance, HOA, utilities, etc.) are NEVER capital,
 * even if linked to a project or over the threshold.
 */
export function isCapitalExpense(expense: Expense, threshold = 2500): boolean {
  const cat = expense.category;
  // Categories that are always operating never cross into capital,
  // even if accidentally linked to a project.
  if (ALWAYS_OPERATING_CATEGORIES.has(cat)) return false;
  // If the expense is linked to a Capital Project, it is capital.
  // The user made a deliberate classification by linking it.
  if (expense.capitalProjectId) return true;
  // These categories are always capital, regardless of amount.
  if (cat === 'capital_improvements' || cat === 'property_improvements' || cat === 'unit_improvements') {
    return true;
  }
  // For everything else, apply the de minimis threshold.
  return expense.amount > threshold;
}

// ---------------------------------------------------------------------------
// Income Category Metadata
// ---------------------------------------------------------------------------

export interface IncomeMeta {
  label: string;
}

export const INCOME_SOURCES: Record<IncomeSource, IncomeMeta> = {
  rent:                   { label: 'Monthly Rent' },
  late_fee:               { label: 'Late Fees' },
  move_in_fee:            { label: 'Move-In Fees' },
  deposit:                { label: 'Security Deposits Received' },
  utility_reimbursement:  { label: 'Utility Reimbursements' },
  hoa_reimbursement:      { label: 'HOA Reimbursements' },
  application_fee:        { label: 'Application Fees' },
  pet_fee:                { label: 'Pet Fees' },
  parking_fee:            { label: 'Parking Fees' },
  other:                  { label: 'Other Income' },
};

export function incomeSourceLabel(source: string): string {
  return (INCOME_SOURCES as Record<string, IncomeMeta>)[source]?.label ?? source;
}

/** All income sources, sorted by label. */
export function allIncomeSources(): { value: IncomeSource; label: string }[] {
  return (Object.entries(INCOME_SOURCES) as [IncomeSource, IncomeMeta][])
    .sort((a, b) => a[1].label.localeCompare(b[1].label))
    .map(([value, m]) => ({ value, label: m.label }));
}

// ---------------------------------------------------------------------------
// Shared Financial Computations
// ---------------------------------------------------------------------------

/** A date range filter. All boundaries are inclusive ISO date strings. */
export interface DateRange {
  from?: string;
  to?: string;
}

/** Whether an ISO date string falls within a date range. */
export function inDateRange(dateStr: string, range: DateRange): boolean {
  if (!dateStr) return false;
  if (range.from && dateStr < range.from) return false;
  if (range.to && dateStr > range.to) return false;
  return true;
}

/** Build a DateRange for a given year/quarter/month. */
export function periodToDateRange(
  scope: 'year' | 'quarter' | 'month',
  year: number,
  quarter?: number,
  month?: number,
): DateRange {
  if (scope === 'year') {
    return { from: `${year}-01-01`, to: `${year}-12-31` };
  }
  if (scope === 'quarter' && quarter) {
    const startMonth = (quarter - 1) * 3 + 1;
    const endMonth = startMonth + 2;
    const endDay = new Date(year, endMonth, 0).getDate();
    return {
      from: `${year}-${String(startMonth).padStart(2, '0')}-01`,
      to: `${year}-${String(endMonth).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`,
    };
  }
  if (scope === 'month' && month) {
    const endDay = new Date(year, month, 0).getDate();
    return {
      from: `${year}-${String(month).padStart(2, '0')}-01`,
      to: `${year}-${String(month).padStart(2, '0')}-${String(endDay).padStart(2, '0')}`,
    };
  }
  return {};
}

// ── Expense totals ────────────────────────────────────────────────────

/** Sum expenses, optionally filtered by a predicate. */
export function sumExpenses(
  expenses: Expense[],
  filter?: (e: Expense) => boolean,
): number {
  const list = filter ? expenses.filter(filter) : expenses;
  return list.reduce((sum, e) => sum + e.amount, 0);
}

/** Group expenses by a key function and sum each group. */
export function groupExpenses<K extends string>(
  expenses: Expense[],
  keyFn: (e: Expense) => K,
): Record<K, number> {
  const result = {} as Record<K, number>;
  for (const e of expenses) {
    const key = keyFn(e);
    result[key] = (result[key] || 0) + e.amount;
  }
  return result;
}

/** Group expenses by category, returning label + total, sorted descending. */
export function expensesByCategory(expenses: Expense[]): { category: string; label: string; total: number }[] {
  const grouped = groupExpenses(expenses, e => e.category);
  return Object.entries(grouped)
    .map(([category, total]) => ({ category, label: expenseCategoryLabel(category), total }))
    .sort((a, b) => b.total - a.total);
}

/** Group expenses by tier. */
export function expensesByTier(expenses: Expense[]): Record<ExpenseTier, number> {
  const result: Record<ExpenseTier, number> = { property: 0, unit: 0, business: 0 };
  for (const e of expenses) {
    result[getExpenseTier(e)] += e.amount;
  }
  return result;
}

// ── Income totals ─────────────────────────────────────────────────────

/** Total rent collected (paid rent payments), optionally within a date range.
 *  Rent is dated by month/year, not by paidDate, for consistency with all
 *  other financial modules. */
export function rentCollected(
  payments: RentPayment[],
  range?: DateRange,
): number {
  return payments
    .filter(p => {
      if (p.status !== 'paid') return false;
      if (!range) return true;
      // Construct an ISO date from month/year for range comparison.
      const dateStr = `${p.year}-${String(p.month).padStart(2, '0')}-01`;
      return inDateRange(dateStr, range);
    })
    .reduce((sum, p) => sum + p.amount, 0);
}

/** Total other (non-rent) income, optionally within a date range. */
export function otherIncome(
  incomes: Income[],
  range?: DateRange,
): number {
  return incomes
    .filter(i => !range || inDateRange(i.date, range))
    .reduce((sum, i) => sum + i.amount, 0);
}

/** Total income = rent collected + other income. */
export function totalIncome(
  payments: RentPayment[],
  incomes: Income[],
  range?: DateRange,
): number {
  return rentCollected(payments, range) + otherIncome(incomes, range);
}

/** Total expenses within a date range. */
export function totalExpenses(expenses: Expense[], range?: DateRange): number {
  return sumExpenses(expenses, range ? e => inDateRange(e.date, range) : undefined);
}

/** Net income = total income minus total expenses. */
export function netIncome(
  payments: RentPayment[],
  incomes: Income[],
  expenses: Expense[],
  range?: DateRange,
): number {
  return totalIncome(payments, incomes, range) - totalExpenses(expenses, range);
}

// ── Per-property profitability ────────────────────────────────────────

export interface PropertyFinancials {
  propertyId: string;
  propertyName: string;
  grossRentalIncome: number;
  otherIncome: number;
  totalIncome: number;
  propertyExpenses: number;
  unitExpenses: number;
  capitalImprovements: number;
  hoaExpenses: number;
  taxExpenses: number;
  insuranceExpenses: number;
  maintenanceExpenses: number;
  totalExpenses: number;
  /** Net Operating Income: totalIncome minus operating expenses (before
   *  capital improvements and mortgage principal). */
  noi: number;
  /** Net Profit: totalIncome minus ALL expenses. */
  netProfit: number;
}

/** Compute profitability for a single property within a date range. */
export function propertyFinancials(
  property: Property,
  leases: Lease[],
  rentPayments: RentPayment[],
  allIncomes: Income[],
  allExpenses: Expense[],
  range?: DateRange,
): PropertyFinancials {
  const pid = property.id;

  // Build a set of lease IDs belonging to this property.
  const propertyLeaseIds = new Set(
    leases.filter(l => l.propertyId === pid).map(l => l.id),
  );

  const grossRentalIncome = rentPayments
    .filter(p => p.status === 'paid' && propertyLeaseIds.has(p.leaseId))
    .filter(p => {
      if (!range) return true;
      const dateStr = `${p.year}-${String(p.month).padStart(2, '0')}-01`;
      return inDateRange(dateStr, range);
    })
    .reduce((sum, p) => sum + p.amount, 0);

  const propIncomes = allIncomes
    .filter(i => i.propertyId === pid && i.source !== 'deposit')
    .filter(i => !range || inDateRange(i.date, range));
  const otherInc = propIncomes.reduce((sum, i) => sum + i.amount, 0);
  const propTotalIncome = grossRentalIncome + otherInc;

  const propExpenses = allExpenses
    .filter(e => e.propertyId === pid)
    .filter(e => !range || inDateRange(e.date, range));

  const byTier = expensesByTier(propExpenses);
  const capitalImprovements = sumExpenses(propExpenses, e => e.category === 'capital_improvements');
  const hoaExpenses = sumExpenses(propExpenses, e => e.category === 'hoa');
  const taxExpenses = sumExpenses(propExpenses, e => e.category === 'taxes');
  const insuranceExpenses = sumExpenses(propExpenses, e => e.category === 'insurance');
  const maintenanceExpenses = sumExpenses(propExpenses, e =>
    e.category === 'maintenance' || e.category === 'unit_maintenance'
  );
  const propTotalExpenses = propExpenses.reduce((sum, e) => sum + e.amount, 0);

  // NOI excludes capital improvements and mortgage principal.
  const operatingExpenses = propTotalExpenses - capitalImprovements
    - sumExpenses(propExpenses, e => e.category === 'mortgage');
  const noi = propTotalIncome - operatingExpenses;

  return {
    propertyId: pid,
    propertyName: property.name,
    grossRentalIncome,
    otherIncome: otherInc,
    totalIncome: propTotalIncome,
    propertyExpenses: byTier.property,
    unitExpenses: byTier.unit,
    capitalImprovements,
    hoaExpenses,
    taxExpenses,
    insuranceExpenses,
    maintenanceExpenses,
    totalExpenses: propTotalExpenses,
    noi,
    netProfit: propTotalIncome - propTotalExpenses,
  };
}

// ── Maintenance cost analysis ─────────────────────────────────────────

export interface MaintenanceCostSummary {
  totalCost: number;
  byProperty: Record<string, number>;
  byVendor: Record<string, number>;
  byCategory: Record<string, number>;
}

export function maintenanceCosts(
  requests: MaintenanceRequest[],
  range?: DateRange,
): MaintenanceCostSummary {
  const filtered = requests.filter(r => {
    if (r.status === 'cancelled') return false;
    if (!r.cost || r.cost <= 0) return false;
    const dateStr = r.resolvedDate || r.reportedDate;
    if (!dateStr || !range) return !range;
    return inDateRange(dateStr, range);
  });

  const totalCost = filtered.reduce((sum, r) => sum + (r.cost || 0), 0);
  const byProperty: Record<string, number> = {};
  const byVendor: Record<string, number> = {};
  const byCategory: Record<string, number> = {};

  for (const r of filtered) {
    const pid = r.propertyId || 'unassigned';
    byProperty[pid] = (byProperty[pid] || 0) + (r.cost || 0);
    const vendor = r.vendor || 'Unknown';
    byVendor[vendor] = (byVendor[vendor] || 0) + (r.cost || 0);
    const cat = r.category || 'general';
    byCategory[cat] = (byCategory[cat] || 0) + (r.cost || 0);
  }

  return { totalCost, byProperty, byVendor, byCategory };
}

// ── Monthly / yearly breakdown ────────────────────────────────────────

export interface MonthlyFinancials {
  month: number;
  year: number;
  label: string;
  income: number;
  expenses: number;
  net: number;
}

/** Build 12 months of financial data for a given year. */
export function monthlyBreakdown(
  year: number,
  rentPayments: RentPayment[],
  incomes: Income[],
  expenses: Expense[],
): MonthlyFinancials[] {
  const months = Array.from({ length: 12 }, (_, i) => i + 1);
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  return months.map(month => {
    const rent = rentPayments
      .filter(p => p.status === 'paid' && p.month === month && p.year === year)
      .reduce((sum, p) => sum + p.amount, 0);
    const other = incomes
      .filter(i => monthOf(i.date) === month && yearOf(i.date) === year)
      .reduce((sum, i) => sum + i.amount, 0);
    const monthIncome = rent + other;
    const monthExpenses = expenses
      .filter(e => monthOf(e.date) === month && yearOf(e.date) === year)
      .reduce((sum, e) => sum + e.amount, 0);

    return {
      month,
      year,
      label: monthNames[month - 1],
      income: monthIncome,
      expenses: monthExpenses,
      net: monthIncome - monthExpenses,
    };
  });
}

// ── Reconciliation / data integrity ───────────────────────────────────

export interface ReconciliationIssue {
  type: 'duplicate' | 'missing_category' | 'unassigned_property' | 'missing_receipt' | 'inconsistency';
  severity: 'warning' | 'error';
  message: string;
  entityType: 'expense' | 'income';
  entityId: string;
}

/** Scan financial data for common issues. */
export function reconcile(
  expenses: Expense[],
  incomes: Income[],
): ReconciliationIssue[] {
  const issues: ReconciliationIssue[] = [];

  // Duplicate detection: same property + amount + date + description.
  const expenseKeys = new Map<string, Expense>();
  for (const e of expenses) {
    const key = `${e.propertyId}|${e.amount}|${e.date}|${e.description?.toLowerCase()}`;
    const existing = expenseKeys.get(key);
    if (existing) {
      issues.push({
        type: 'duplicate',
        severity: 'warning',
        message: `Possible duplicate: "${e.description}" for ${e.amount} on ${e.date}`,
        entityType: 'expense',
        entityId: e.id,
      });
    } else {
      expenseKeys.set(key, e);
    }
  }

  // Expenses without a property assignment.
  for (const e of expenses) {
    if (!e.propertyId) {
      issues.push({
        type: 'unassigned_property',
        severity: 'warning',
        message: `Expense "${e.description}" (${e.date}) has no property assigned`,
        entityType: 'expense',
        entityId: e.id,
      });
    }
  }

  // Incomes without a property assignment.
  for (const i of incomes) {
    if (!i.propertyId) {
      issues.push({
        type: 'unassigned_property',
        severity: 'warning',
        message: `Income "${i.description}" (${i.date}) has no property assigned`,
        entityType: 'income',
        entityId: i.id,
      });
    }
  }

  // Expenses with unrecognized categories.
  for (const e of expenses) {
    if (!EXPENSE_CATEGORIES[e.category as ExpenseCategory]) {
      issues.push({
        type: 'missing_category',
        severity: 'error',
        message: `Expense "${e.description}" has unrecognized category "${e.category}"`,
        entityType: 'expense',
        entityId: e.id,
      });
    }
  }

  return issues;
}
