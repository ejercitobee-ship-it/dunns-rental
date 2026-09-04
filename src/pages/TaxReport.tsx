import { useState, useEffect, useMemo, useCallback } from 'react';
import {
  FileText, Download, Calculator, TrendingDown, TrendingUp,
  DollarSign, Home, Percent, AlertCircle, ChevronDown, ChevronRight,
  Calendar, Users, Car, BarChart3, CalendarPlus, Check, Loader2
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { formatCurrency, formatDate, yearOf, monthOf, getMonthName, cn } from '../lib/utils';
import { useApp } from '../context/AppContext';
import { rentIncomeForMonths } from '../lib/rent';
import { capitalProjectsApi, calendarApi, settingsApi } from '../lib/api';
import { useToast } from '../context/ToastContext';
import { TransactionDrillDown } from '../components/TransactionDrillDown';
import type { CapitalProject, Expense, Income, RentPayment } from '../types';
import {
  depreciationForYear,
  accumulatedDepreciation,
  depreciableBasis,
  landValueFor,
  canDepreciate,
} from '../lib/depreciation';
import { buildScheduleE, buildScheduleETotals, type ScheduleEProperty } from '../lib/schedule-e';
import JSZip from 'jszip';
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
  LineChart,
  Line,
  Legend,
} from 'recharts';

const COLORS = [
  '#24503f', '#2c7a58', '#97671c', '#b98a5e', '#7e8b83',
  '#5a7d6c', '#a23429', '#c2a878', '#4a7c6b', '#d4a853',
  '#8b5e3c', '#6b8f7f', '#c17832', '#3d6b54', '#9a7b5a',
];

/** Threshold below which pie slices are grouped into "Other". */
const PIE_OTHER_THRESHOLD = 0.03;

// IRS 1099-NEC threshold: vendors paid ≥$600 in a calendar year need a 1099.
const VENDOR_1099_THRESHOLD = 600;

// IRS standard mileage rate for 2025 (cents per mile). Updated annually.
const IRS_MILEAGE_RATE_CENTS = 70;

// Default marginal tax rates for estimated liability (user can adjust).
const DEFAULT_FEDERAL_RATE = 24;
const DEFAULT_STATE_RATE = 4.95; // Illinois flat rate

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
  capitalProjectId?: string;
  capitalProjectName?: string;
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
  hoa: { label: 'HOA Dues', description: 'Homeowners association fees and assessments' },
  depreciation: { label: 'Depreciation', description: 'Property depreciation' },
  other: { label: 'Other', description: 'Other deductible expenses' },
};

// Tax category mapping and capital classification from the central engine.
import { mapToTaxCategory, isCapitalExpense } from '../lib/financials';

export function TaxReport() {
  const { expenses, incomes, properties, rentPayments, leases } = useApp();
  const { showToast } = useToast();
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
  const [drilldown, setDrilldown] = useState<string | null>(null);

  // Capital projects lookup
  const [capitalProjects, setCapitalProjects] = useState<CapitalProject[]>([]);
  // Configurable capital threshold from Settings (default: IRS de minimis $2,500).
  const [capitalThreshold, setCapitalThreshold] = useState(CAPITAL_THRESHOLD);
  useEffect(() => {
    capitalProjectsApi.list().then(setCapitalProjects).catch(() => {});
    settingsApi.get()
      .then(data => {
        if (data?.finances?.capitalThreshold != null) {
          setCapitalThreshold(data.finances.capitalThreshold);
        }
      })
      .catch(() => {});
  }, []);
  const [drilldownProp, setDrilldownProp] = useState<string | null>(null);
  // TransactionDrillDown modal state
  const [drillModalOpen, setDrillModalOpen] = useState(false);
  const [drillModalTitle, setDrillModalTitle] = useState('');
  const [drillModalExpenses, setDrillModalExpenses] = useState<Expense[]>([]);
  const [drillModalIncomes, setDrillModalIncomes] = useState<Income[]>([]);
  const [drillModalPayments, setDrillModalPayments] = useState<RentPayment[]>([]);
  const [drillModalTab, setDrillModalTab] = useState<'expenses' | 'income' | 'rent' | undefined>(undefined);

  const openDrillModal = (title: string, opts: { expenses?: Expense[]; incomes?: Income[]; payments?: RentPayment[]; tab?: 'expenses' | 'income' | 'rent' }) => {
    setDrillModalTitle(title);
    setDrillModalExpenses(opts.expenses || []);
    setDrillModalIncomes(opts.incomes || []);
    setDrillModalPayments(opts.payments || []);
    setDrillModalTab(opts.tab);
    setDrillModalOpen(true);
  };
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

  // ── Tax Calendar → App Calendar sync ────────────────────────────────
  const [calSyncing, setCalSyncing] = useState(false);
  const [calSynced, setCalSynced] = useState(false);

  const taxDeadlines = useMemo(() => [
    { date: `${year + 1}-01-31`, title: `1099-NEC Due (Tax Year ${year})`, description: `File 1099-NEC for any vendor paid $600+ during ${year}`, category: 'property_tax' as const, priority: 'high' as const },
    { date: `${year + 1}-04-15`, title: `Q1 Estimated Tax Payment (${year + 1})`, description: `Federal + IL estimated payment for Q1 ${year + 1}`, category: 'property_tax' as const, priority: 'high' as const },
    { date: `${year + 1}-04-15`, title: `Annual Tax Return Due (${year})`, description: `File Schedule E with your Form 1040 for ${year}`, category: 'property_tax' as const, priority: 'urgent' as const },
    { date: `${year + 1}-06-15`, title: `Q2 Estimated Tax Payment (${year + 1})`, description: `Federal + IL estimated payment for Q2 ${year + 1}`, category: 'property_tax' as const, priority: 'high' as const },
    { date: `${year + 1}-09-15`, title: `Q3 Estimated Tax Payment (${year + 1})`, description: `Federal + IL estimated payment for Q3 ${year + 1}`, category: 'property_tax' as const, priority: 'high' as const },
    { date: `${year + 1}-10-15`, title: `Extended Return Due (${year})`, description: `If you filed an extension for ${year}`, category: 'property_tax' as const, priority: 'medium' as const },
    { date: `${year + 2}-01-15`, title: `Q4 Estimated Tax Payment (${year + 1})`, description: `Federal + IL estimated payment for Q4 ${year + 1}`, category: 'property_tax' as const, priority: 'high' as const },
  ], [year]);

  const addTaxDeadlinesToCalendar = useCallback(async () => {
    setCalSyncing(true);
    try {
      // Fetch existing events so we don't create duplicates
      const existing = await calendarApi.list();
      const existingTitles = new Set(existing.map(e => e.title));

      let created = 0;
      for (const d of taxDeadlines) {
        if (existingTitles.has(d.title)) continue;
        await calendarApi.create({
          title: d.title,
          description: d.description,
          eventDate: d.date,
          category: d.category,
          priority: d.priority,
          isRecurring: false,
          completed: false,
          visibility: 'shared',
        });
        created++;
      }

      setCalSynced(true);
      if (created > 0) {
        showToast(`Added ${created} tax deadline${created === 1 ? '' : 's'} to your Calendar`, 'success');
      } else {
        showToast('All tax deadlines are already on your Calendar', 'success');
      }
    } catch (err) {
      showToast((err as Error).message || 'Could not add deadlines to calendar', 'error');
    } finally {
      setCalSyncing(false);
    }
  }, [taxDeadlines, showToast]);

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
    const pPaidRent = rentPayments.filter(p => p.status === 'paid' && p.year === y && months.includes(p.month) && p.type !== 'credit');

    // rentIncomeForMonths is the shared definition of taxable rent income, so
    // this matches Rent Management's Tax tab for the same months.
    const rentIncome = rentIncomeForMonths(rentPayments, months, y);
    const lateFeeIncome = pIncome.filter(i => i.source === 'late_fee').reduce((s, i) => s + i.amount, 0);
    const moveInFeeIncome = pIncome.filter(i => i.source === 'move_in_fee').reduce((s, i) => s + i.amount, 0);
    const utilityReimbursement = pIncome.filter(i => i.source === 'utility_reimbursement').reduce((s, i) => s + i.amount, 0);
    const hoaReimbursement = pIncome.filter(i => i.source === 'hoa_reimbursement').reduce((s, i) => s + i.amount, 0);
    const applicationFeeIncome = pIncome.filter(i => i.source === 'application_fee').reduce((s, i) => s + i.amount, 0);
    const petFeeIncome = pIncome.filter(i => i.source === 'pet_fee').reduce((s, i) => s + i.amount, 0);
    const parkingFeeIncome = pIncome.filter(i => i.source === 'parking_fee').reduce((s, i) => s + i.amount, 0);
    const otherIncome = pIncome.filter(i => i.source === 'other').reduce((s, i) => s + i.amount, 0);
    // A refundable security deposit you are holding is a liability you owe back,
    // NOT taxable income. It becomes income only in the year you keep it (record
    // that as "Other" income). So deposits are tracked separately and excluded
    // from the taxable total.
    const depositsReceived = pIncome.filter(i => i.source === 'deposit').reduce((s, i) => s + i.amount, 0);
    const totalIncome = rentIncome + lateFeeIncome + moveInFeeIncome + utilityReimbursement + hoaReimbursement + applicationFeeIncome + petFeeIncome + parkingFeeIncome + otherIncome;

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

      if (deductible > 0) {
        if (isCapitalExpense(e, capitalThreshold)) {
          // Capital improvement: NOT deductible in the current year. It should
          // be capitalized and depreciated over its useful life. Track it
          // separately for reference but do NOT add it to totalDeductibleExpenses.
          capitalExpenses += e.amount;
          const proj = e.capitalProjectId ? capitalProjects.find(cp => cp.id === e.capitalProjectId) : undefined;
          capitalItems.push({
            id: e.id,
            date: e.date,
            amount: e.amount,
            categoryLabel: TAX_CATEGORIES[taxCat]?.label || taxCat,
            description: e.description,
            propertyName: e.propertyId ? propertyNameById.get(e.propertyId) : undefined,
            capitalProjectId: e.capitalProjectId,
            capitalProjectName: proj?.name,
          });
        } else {
          expensesByCategory[taxCat] = (expensesByCategory[taxCat] || 0) + deductible;
          totalDeductibleExpenses += deductible;
          operatingExpenses += deductible;
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
      // Property income excludes deposits (not taxable) and source==='rent' (already in propertyRent via rent_payments).
      const propertyOther = pIncome.filter(i => i.propertyId === p.id && i.source !== 'deposit' && i.source !== 'rent').reduce((s, i) => s + i.amount, 0);
      const propertyIncome = propertyRent + propertyOther;
      return { name: p.name, income: propertyIncome, expenses: propertyExpenses, netIncome: propertyIncome - propertyExpenses };
    });

    // Income/expenses per month across the selected months, for the chart.
    const breakdown = months.map(m => {
      const mRent = pPaidRent.filter(p => p.month === m).reduce((s, p) => s + p.amount, 0);
      // Exclude deposits (non-taxable) and source==='rent' (already in mRent via rent_payments)
      const mOther = pIncome.filter(i => i.source !== 'rent' && i.source !== 'deposit' && monthOf(i.date) === m).reduce((s, i) => s + i.amount, 0);
      const mInc = mRent + mOther;
      // Exclude capital items and non-deductible; use interest-only for mortgage
      const mExp = pExpenses.filter(e => monthOf(e.date) === m).reduce((s, e) => {
        if (e.taxDeductible === false) return s;
        if (isCapitalExpense(e, capitalThreshold)) return s;
        if (e.category === 'mortgage') return s + (e.interestAmount != null ? e.interestAmount : e.amount);
        return s + e.amount;
      }, 0);
      return { name: getMonthName(m), income: mInc, expenses: mExp, netIncome: mInc - mExp };
    });

    // ── 1099 vendor tracker ──────────────────────────────────────────────
    // Aggregate payments per vendor name across service expenses only.
    // Any vendor paid ≥$600 in a calendar year typically needs a 1099-NEC.
    // Categories paid to government entities (property taxes), corporations
    // (insurance, mortgage, utilities, HOA, banks, software) are exempt
    // from 1099 reporting and excluded from this tracker.
    const EXEMPT_1099_CATEGORIES = new Set([
      'taxes', 'insurance', 'mortgage', 'utilities', 'hoa',
      'banking_fees', 'software',
    ]);
    const vendorTotals = new Map<string, number>();
    pExpenses.forEach(e => {
      if (e.vendor && !EXEMPT_1099_CATEGORIES.has(e.category)) {
        vendorTotals.set(e.vendor, (vendorTotals.get(e.vendor) || 0) + e.amount);
      }
    });
    const vendors1099 = [...vendorTotals.entries()]
      .map(([name, total]) => ({ name, total }))
      .sort((a, b) => b.total - a.total);

    // ── Schedule E mapping (per property) ─────────────────────────────
    const depreciationByPropertyMap = new Map(
      properties.map(p => [p.id, depreciationForYear(p, y)])
    );
    const leasePropertyIdMap = new Map(leases.map(l => [l.id, l.propertyId]));
    const scheduleEPerProperty: ScheduleEProperty[] = properties.map(p => {
      const propRent = pPaidRent
        .filter(pmt => leasePropertyIdMap.get(pmt.leaseId) === p.id)
        .reduce((s, pmt) => s + pmt.amount, 0);
      // Add non-rent non-deposit income for this property
      const propOtherInc = pIncome
        .filter(i => i.propertyId === p.id && i.source !== 'deposit' && i.source !== 'rent')
        .reduce((s, i) => s + i.amount, 0);
      const propDepreciation = round2((depreciationByPropertyMap.get(p.id) || 0) * periodFactor);
      return buildScheduleE({
        property: p,
        expenses: pExpenses,
        rentIncome: propRent + propOtherInc,
        depreciation: propDepreciation,
        deductibleAmount,
        capitalThreshold: capitalThreshold,
        isCapital: isCapitalExpense,
      });
    });
    const scheduleETotals = buildScheduleETotals(scheduleEPerProperty);

    return { totalIncome, rentIncome, lateFeeIncome, moveInFeeIncome, utilityReimbursement, hoaReimbursement, applicationFeeIncome, petFeeIncome, parkingFeeIncome, otherIncome, depositsReceived, totalDeductibleExpenses, operatingExpenses, capitalExpenses, capitalItems, depreciation, depreciationSchedule, mortgageInterestDeducted, mortgagePrincipalExcluded, mortgageNeedsSplit, netIncome, expensesByCategory, propertyBreakdown, breakdown, pExpenses, pIncome, pPaidRent, vendors1099, scheduleEPerProperty, scheduleETotals };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expenses, incomes, properties, rentPayments, leases, capitalProjects]);

  const main = useMemo(() => periodData(year, monthsFor(scope, quarter, month)), [periodData, year, scope, quarter, month]);
  const comp = useMemo(() => (compare ? periodData(cYear, monthsFor(scope, cQuarter, cMonth)) : null), [compare, periodData, cYear, scope, cQuarter, cMonth]);
  const mainLabel = periodLabel(scope, year, quarter, month);
  const compLabel = periodLabel(scope, cYear, cQuarter, cMonth);

  const expenseChartData = useMemo(() => {
    const all = Object.entries(main.expensesByCategory)
      .map(([key, value]) => ({ name: TAX_CATEGORIES[key]?.label || key, value }))
      .sort((a, b) => b.value - a.value);
    const total = all.reduce((s, d) => s + d.value, 0);
    if (total === 0) return all;
    // Group slices below the threshold into "Other" so the chart stays readable.
    const major: typeof all = [];
    let otherSum = 0;
    for (const d of all) {
      if (d.value / total < PIE_OTHER_THRESHOLD) otherSum += d.value;
      else major.push(d);
    }
    if (otherSum > 0) major.push({ name: 'Other', value: otherSum });
    return major;
  }, [main.expensesByCategory]);

  // ── Estimated tax liability (configurable rates, persisted in localStorage) ──
  const [fedRate, setFedRate] = useState(() => {
    const saved = localStorage.getItem('tax_fed_rate');
    return saved ? Number(saved) : DEFAULT_FEDERAL_RATE;
  });
  const [stateRate, setStateRate] = useState(() => {
    const saved = localStorage.getItem('tax_state_rate');
    return saved ? Number(saved) : DEFAULT_STATE_RATE;
  });
  useEffect(() => { localStorage.setItem('tax_fed_rate', String(fedRate)); }, [fedRate]);
  useEffect(() => { localStorage.setItem('tax_state_rate', String(stateRate)); }, [stateRate]);

  const estimatedFederal = Math.max(0, main.netIncome * (fedRate / 100));
  const estimatedState = Math.max(0, main.netIncome * (stateRate / 100));
  const estimatedSelfEmployment = 0; // Rental income generally not subject to SE tax
  const estimatedTotal = estimatedFederal + estimatedState + estimatedSelfEmployment;

  // ── Multi-year trend (5 years of data) ────────────────────────────────
  const multiYearData = useMemo(() => {
    const years = Array.from({ length: 5 }, (_, i) => year - 4 + i);
    return years.map(y => {
      const d = periodData(y, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
      return {
        year: String(y),
        income: d.totalIncome,
        expenses: d.totalDeductibleExpenses,
        netIncome: d.netIncome,
      };
    });
  }, [periodData, year]);

  // ── Mileage state (persisted per year in localStorage) ──
  const [mileage, setMileage] = useState(() => {
    const saved = localStorage.getItem(`mileage_${year}`);
    return saved ? Number(saved) : 0;
  });
  useEffect(() => {
    const saved = localStorage.getItem(`mileage_${year}`);
    setMileage(saved ? Number(saved) : 0);
  }, [year]);
  const saveMileage = (val: number) => {
    const clamped = Math.max(0, Math.round(val));
    setMileage(clamped);
    localStorage.setItem(`mileage_${year}`, String(clamped));
  };
  const mileageDeduction = mileage * (IRS_MILEAGE_RATE_CENTS / 100);

  const [exportOpen, setExportOpen] = useState(false);

  const downloadBlob = (content: string, filename: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    window.URL.revokeObjectURL(url);
    setExportOpen(false);
  };

  const csvEscape = (v: string | number | undefined): string => {
    const s = v == null ? '' : String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const exportJSON = () => {
    const report = {
      generatedAt: new Date().toISOString(),
      period: mainLabel,
      income: { total: main.totalIncome, rent: main.rentIncome, lateFees: main.lateFeeIncome, moveInFees: main.moveInFeeIncome, utilityReimbursements: main.utilityReimbursement, hoaReimbursements: main.hoaReimbursement, applicationFees: main.applicationFeeIncome, petFees: main.petFeeIncome, parkingFees: main.parkingFeeIncome, other: main.otherIncome },
      securityDepositsReceived: main.depositsReceived,
      deductibleExpenses: main.expensesByCategory,
      totalDeductibleExpenses: main.totalDeductibleExpenses,
      operatingExpenses: main.operatingExpenses,
      capitalExpenses: main.capitalExpenses,
      capitalItems: main.capitalItems,
      depreciation: main.depreciation,
      depreciationSchedule: main.depreciationSchedule,
      mortgage: { interestDeducted: main.mortgageInterestDeducted, principalExcluded: main.mortgagePrincipalExcluded, entriesNeedingSplit: main.mortgageNeedsSplit },
      netIncome: main.netIncome,
      comparison: comp ? {
        period: compLabel,
        income: { total: comp.totalIncome, rent: comp.rentIncome, lateFees: comp.lateFeeIncome, moveInFees: comp.moveInFeeIncome, utilityReimbursements: comp.utilityReimbursement, hoaReimbursements: comp.hoaReimbursement, applicationFees: comp.applicationFeeIncome, petFees: comp.petFeeIncome, parkingFees: comp.parkingFeeIncome, other: comp.otherIncome },
        deductibleExpenses: comp.expensesByCategory, totalDeductibleExpenses: comp.totalDeductibleExpenses,
        operatingExpenses: comp.operatingExpenses, capitalExpenses: comp.capitalExpenses, netIncome: comp.netIncome,
      } : undefined,
    };
    downloadBlob(JSON.stringify(report, null, 2), `tax-report-${mainLabel.replace(/\s+/g, '-')}.json`, 'application/json');
  };

  const exportExpensesCSV = () => {
    const header = 'Date,Category,Tax Category,Description,Amount,Property,Deductible,Paid From';
    const rows = main.pExpenses
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(e => {
        const taxCat = TAX_CATEGORIES[e.taxCategory || mapToTaxCategory(e.category)]?.label || e.category;
        const propName = properties.find(p => p.id === e.propertyId)?.name || '';
        return [e.date, e.category, taxCat, csvEscape(e.description), e.amount.toFixed(2), csvEscape(propName), e.taxDeductible !== false ? 'Yes' : 'No', e.paymentAccount || ''].join(',');
      });
    downloadBlob([header, ...rows].join('\n'), `expenses-${mainLabel.replace(/\s+/g, '-')}.csv`, 'text/csv');
  };

  const exportPrintPdf = () => {
    setExportOpen(false);
    setTimeout(() => window.print(), 100);
  };

  const exportScheduleECSV = () => {
    // One row per line, columns for each property + totals
    const props = main.scheduleEPerProperty.filter(p => p.lines.some(l => l.amount !== 0));
    const headerCols = ['Line', 'Description', ...props.map(p => csvEscape(p.name)), 'Totals'];
    const header = headerCols.join(',');
    const rows = main.scheduleETotals.lines.map(tl => {
      const perProp = props.map(p => {
        const line = p.lines.find(l => l.line === tl.line);
        return (line?.amount ?? 0).toFixed(2);
      });
      return [tl.line, csvEscape(tl.label), ...perProp, tl.amount.toFixed(2)].join(',');
    });
    downloadBlob([header, ...rows].join('\n'), `schedule-e-${mainLabel.replace(/\s+/g, '-')}.csv`, 'text/csv');
  };

  const exportScheduleEPerPropertyZIP = async () => {
    setExportOpen(false);
    const props = main.scheduleEPerProperty.filter(p => p.lines.some(l => l.amount !== 0));
    if (props.length === 0) return;
    const label = mainLabel.replace(/\s+/g, '-');
    const zip = new JSZip();
    for (const prop of props) {
      const headerCols = ['Line', 'Description', 'Amount'];
      const rows = prop.lines.map(l =>
        [l.line, csvEscape(l.label), l.amount.toFixed(2)].join(',')
      );
      const slug = prop.name.replace(/[^a-zA-Z0-9]+/g, '-').replace(/(^-|-$)/g, '').toLowerCase();
      zip.file(`schedule-e-${slug}-${label}.csv`, [headerCols.join(','), ...rows].join('\n'));
    }
    const blob = await zip.generateAsync({ type: 'blob' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `schedule-e-per-property-${label}.zip`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const export1099CSV = () => {
    const header = 'Vendor,Total Paid,Needs 1099';
    const rows = main.vendors1099.map(v =>
      [csvEscape(v.name), v.total.toFixed(2), v.total >= VENDOR_1099_THRESHOLD ? 'Yes' : 'No'].join(',')
    );
    downloadBlob([header, ...rows].join('\n'), `vendor-1099-tracker-${mainLabel.replace(/\s+/g, '-')}.csv`, 'text/csv');
  };

  const exportTaxPacketZIP = async () => {
    setExportOpen(false);
    const zip = new JSZip();
    const label = mainLabel.replace(/\s+/g, '-');

    // 1) Schedule E summary
    const seProps = main.scheduleEPerProperty.filter(p => p.lines.some(l => l.amount !== 0));
    const seHeaderCols = ['Line', 'Description', ...seProps.map(p => p.name), 'Totals'];
    const seRows = main.scheduleETotals.lines.map(tl => {
      const perProp = seProps.map(p => {
        const line = p.lines.find(l => l.line === tl.line);
        return (line?.amount ?? 0).toFixed(2);
      });
      return [tl.line, tl.label, ...perProp, tl.amount.toFixed(2)].join(',');
    });
    zip.file(`schedule-e-${label}.csv`, [seHeaderCols.join(','), ...seRows].join('\n'));

    // 2) Expenses CSV
    const expHeader = 'Date,Category,Tax Category,Description,Amount,Property,Deductible,Paid From';
    const expRows = main.pExpenses.sort((a, b) => a.date.localeCompare(b.date)).map(e => {
      const taxCat = TAX_CATEGORIES[e.taxCategory || mapToTaxCategory(e.category)]?.label || e.category;
      const propName = properties.find(p => p.id === e.propertyId)?.name || '';
      return [e.date, e.category, taxCat, csvEscape(e.description), e.amount.toFixed(2), csvEscape(propName), e.taxDeductible !== false ? 'Yes' : 'No', e.paymentAccount || ''].join(',');
    });
    zip.file(`expenses-${label}.csv`, [expHeader, ...expRows].join('\n'));

    // 3) Income CSV
    const incHeader = 'Date,Source,Amount,Property';
    const rentRows = main.pPaidRent.map(p => {
      const lease = leases.find(l => l.id === p.leaseId);
      const propName = lease ? properties.find(pr => pr.id === lease.propertyId)?.name || '' : '';
      return [`${p.year}-${String(p.month).padStart(2, '0')}-01`, 'Rent', p.amount.toFixed(2), csvEscape(propName)].join(',');
    });
    const otherRows = main.pIncome.sort((a, b) => a.date.localeCompare(b.date)).map(i => {
      const propName = properties.find(p => p.id === i.propertyId)?.name || '';
      return [i.date, i.source, i.amount.toFixed(2), csvEscape(propName)].join(',');
    });
    zip.file(`income-${label}.csv`, [incHeader, ...rentRows, ...otherRows].join('\n'));

    // 4) Depreciation schedule
    if (main.depreciationSchedule.length > 0) {
      const depHeader = 'Property,Placed In Service,Cost Basis,Land Value,Depreciable Basis,This Year,Accumulated';
      const depRows = main.depreciationSchedule.map(d => [
        csvEscape(d.name), d.placedInService || '', d.purchasePrice.toFixed(2), d.landValue.toFixed(2),
        d.depreciableBasis.toFixed(2), d.currentYear.toFixed(2), d.accumulated.toFixed(2),
      ].join(','));
      zip.file(`depreciation-${label}.csv`, [depHeader, ...depRows].join('\n'));
    }

    // 5) 1099 vendor tracker
    if (main.vendors1099.length > 0) {
      const v1099Header = 'Vendor,Total Paid,Needs 1099';
      const v1099Rows = main.vendors1099.map(v =>
        [csvEscape(v.name), v.total.toFixed(2), v.total >= VENDOR_1099_THRESHOLD ? 'Yes' : 'No'].join(',')
      );
      zip.file(`vendor-1099-tracker-${label}.csv`, [v1099Header, ...v1099Rows].join('\n'));
    }

    // 6) Summary JSON
    const report = {
      generatedAt: new Date().toISOString(),
      period: mainLabel,
      income: { total: main.totalIncome, rent: main.rentIncome, lateFees: main.lateFeeIncome, moveInFees: main.moveInFeeIncome, utilityReimbursements: main.utilityReimbursement, hoaReimbursements: main.hoaReimbursement, applicationFees: main.applicationFeeIncome, petFees: main.petFeeIncome, parkingFees: main.parkingFeeIncome, other: main.otherIncome },
      securityDepositsReceived: main.depositsReceived,
      deductibleExpenses: main.expensesByCategory,
      totalDeductibleExpenses: main.totalDeductibleExpenses,
      operatingExpenses: main.operatingExpenses,
      capitalExpenses: main.capitalExpenses,
      depreciation: main.depreciation,
      mortgage: { interestDeducted: main.mortgageInterestDeducted, principalExcluded: main.mortgagePrincipalExcluded },
      netIncome: main.netIncome,
      estimatedTax: { federal: round2(estimatedFederal), state: round2(estimatedState), total: round2(estimatedTotal), federalRate: fedRate, stateRate: stateRate },
    };
    zip.file(`tax-summary-${label}.json`, JSON.stringify(report, null, 2));

    const blob = await zip.generateAsync({ type: 'blob' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tax-packet-${label}.zip`;
    a.click();
    window.URL.revokeObjectURL(url);
  };

  const exportIncomeCSV = () => {
    const header = 'Date,Source,Amount,Property';
    const rentRows = main.pPaidRent.map(p => {
      const lease = leases.find(l => l.id === p.leaseId);
      const propName = lease ? properties.find(pr => pr.id === lease.propertyId)?.name || '' : '';
      return [`${p.year}-${String(p.month).padStart(2, '0')}-01`, 'Rent', p.amount.toFixed(2), csvEscape(propName)].join(',');
    });
    const otherRows = main.pIncome
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(i => {
        const propName = properties.find(p => p.id === i.propertyId)?.name || '';
        return [i.date, i.source, i.amount.toFixed(2), csvEscape(propName)].join(',');
      });
    downloadBlob([header, ...rentRows, ...otherRows].join('\n'), `income-${mainLabel.replace(/\s+/g, '-')}.csv`, 'text/csv');
  };

  const selectCls = 'px-3 py-2 border border-line rounded-lg bg-surface text-sm text-ink focus:outline-none focus:ring-2 focus:ring-primary/25';
  const YEARS = Array.from({ length: 12 }, (_, i) => now.getFullYear() + 1 - i);
  const MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

  return (
    <div className="space-y-6">
      {/* ── Page header ─────────────────────────────────────────────── */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <p className="eyebrow">Tax preparation</p>
          <h1 className="font-display text-[28px] sm:text-[34px] text-ink mt-1">Tax Report</h1>
          <p className="text-sm text-muted mt-1.5">
            Tax summary and deductible expenses for {mainLabel}{comp ? ` vs ${compLabel}` : ''}.
          </p>
        </div>
        <div className="relative flex-shrink-0">
          <Button variant="outline" onClick={() => setExportOpen(!exportOpen)}>
            <Download className="h-4 w-4 mr-2" />
            Export
            <ChevronDown className="h-3.5 w-3.5 ml-1" />
          </Button>
          {exportOpen && (
            <>
              <div className="fixed inset-0 z-40" onClick={() => setExportOpen(false)} />
              <div className="absolute right-0 mt-1 z-50 w-56 rounded-lg border border-line bg-surface shadow-lg py-1 text-sm">
                <button className="w-full text-left px-4 py-2 hover:bg-canvas font-medium text-primary" onClick={exportTaxPacketZIP}>
                  📦 Tax Packet (ZIP)
                </button>
                <div className="border-t border-line my-1" />
                <button className="w-full text-left px-4 py-2 hover:bg-canvas" onClick={exportPrintPdf}>Print / Save as PDF</button>
                <button className="w-full text-left px-4 py-2 hover:bg-canvas" onClick={exportScheduleECSV}>Schedule E (CSV)</button>
                <button className="w-full text-left px-4 py-2 hover:bg-canvas" onClick={exportScheduleEPerPropertyZIP}>Schedule E Per Property (ZIP)</button>
                <button className="w-full text-left px-4 py-2 hover:bg-canvas" onClick={exportExpensesCSV}>Expenses (CSV)</button>
                <button className="w-full text-left px-4 py-2 hover:bg-canvas" onClick={exportIncomeCSV}>Income (CSV)</button>
                <button className="w-full text-left px-4 py-2 hover:bg-canvas" onClick={export1099CSV}>1099 Vendor (CSV)</button>
                <button className="w-full text-left px-4 py-2 hover:bg-canvas" onClick={exportJSON}>Full Report (JSON)</button>
              </div>
            </>
          )}
        </div>
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
                    <th className="text-left py-3 px-4 font-medium text-muted text-xs uppercase tracking-wider">Metric</th>
                    <th className="text-right py-2.5 px-4 font-medium">{mainLabel}</th>
                    <th className="text-right py-2.5 px-4 font-medium">{compLabel}</th>
                    <th className="text-right py-2.5 px-4 font-medium">Change</th>
                  </tr>
                </thead>
                <tbody>
                  {([
                    ['Total income', main.totalIncome, comp.totalIncome, true],
                    ['Deductible expenses', main.totalDeductibleExpenses, comp.totalDeductibleExpenses, false],
                    ['  Operating', main.operatingExpenses, comp.operatingExpenses, false],
                    ['  Capital Improvements', main.capitalExpenses, comp.capitalExpenses, false],
                    ['  Depreciation', main.depreciation, comp.depreciation, false],
                    ['Net income', main.netIncome, comp.netIncome, true],
                  ] as [string, number, number, boolean][]).map(([label, a, b, higherIsGood]) => {
                    const diff = Math.round((a - b) * 100) / 100;
                    const pct = b !== 0 ? (diff / Math.abs(b)) * 100 : (a !== 0 ? 100 : 0);
                    const good = diff === 0 ? false : (diff > 0) === higherIsGood;
                    const isSubRow = label.startsWith('  ');
                    return (
                      <tr key={label} className="border-b border-line last:border-0">
                        <td className={`py-2.5 px-4 ${isSubRow ? 'pl-8 text-muted' : 'font-medium text-ink'}`}>{isSubRow ? label.trimStart() : label}</td>
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
        {[
          { label: 'Total Income', value: formatCurrency(main.totalIncome), sub: 'Taxable rental income', color: 'text-positive', icon: <TrendingUp />, bg: 'bg-positive-soft text-positive' },
          { label: 'Deductible Expenses', value: formatCurrency(main.totalDeductibleExpenses), sub: 'Includes depreciation', color: 'text-danger', icon: <TrendingDown />, bg: 'bg-danger-soft text-danger' },
          { label: 'Net Income', value: formatCurrency(main.netIncome), sub: 'Income minus deductions', color: main.netIncome >= 0 ? 'text-positive' : 'text-danger', icon: <DollarSign />, bg: 'bg-primary-soft text-primary' },
          { label: 'Expense Ratio', value: `${main.totalIncome > 0 ? ((main.totalDeductibleExpenses / main.totalIncome) * 100).toFixed(1) : 0}%`, sub: 'Expense to income ratio', color: 'text-ink', icon: <Percent />, bg: 'bg-primary-soft text-primary' },
        ].map(s => (
          <Card key={s.label}>
            <div className="p-5">
              <div className="flex items-center justify-between mb-1">
                <span className="eyebrow">{s.label}</span>
                <span className={`w-9 h-9 rounded-xl grid place-items-center [&_svg]:h-[18px] [&_svg]:w-[18px] ${s.bg}`}>{s.icon}</span>
              </div>
              <div className={`mt-3 font-display text-[26px] leading-none font-semibold tnum ${s.color}`}>{s.value}</div>
              <p className="mt-1.5 text-[12px] text-muted">{s.sub}</p>
            </div>
          </Card>
        ))}
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
            {(() => {
              const total = expenseChartData.reduce((s, d) => s + d.value, 0);
              return (
                <div className="flex flex-col items-center gap-4">
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie
                        data={expenseChartData}
                        cx="50%"
                        cy="50%"
                        innerRadius={55}
                        outerRadius={100}
                        paddingAngle={1}
                        dataKey="value"
                        label={false}
                      >
                        {expenseChartData.map((_entry, index) => (
                          <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value) => formatCurrency(Number(value))} />
                    </PieChart>
                  </ResponsiveContainer>
                  <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
                    {expenseChartData.map((d, i) => {
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

      {/* Income Breakdown */}
      <Card>
        <CardHeader className="cursor-pointer select-none" onClick={() => toggle('income')}>
          <CardTitle className="flex items-center gap-2.5">
            <ChevronDown className={cn('h-4 w-4 text-muted transition-transform', collapsed.has('income') && '-rotate-90')} />
            <span className="w-9 h-9 rounded-xl bg-positive-soft text-positive grid place-items-center shrink-0"><FileText className="h-[18px] w-[18px]" /></span>
            Income Breakdown
          </CardTitle>
        </CardHeader>
        {!collapsed.has('income') && <CardContent>
          <div className="space-y-4">
            <button
              className="flex justify-between items-center py-2 border-b w-full text-left hover:bg-black/[0.02] rounded-lg px-2 -mx-2 transition-colors"
              onClick={() => openDrillModal('Rent Income', { payments: main.pPaidRent, tab: 'rent' })}
            >
              <span className="font-medium">Rent Income</span>
              <span className="font-bold tnum">{formatCurrency(main.rentIncome)}</span>
            </button>
            <button
              className="flex justify-between items-center py-2 border-b w-full text-left hover:bg-black/[0.02] rounded-lg px-2 -mx-2 transition-colors"
              onClick={() => openDrillModal('Late Fees', { incomes: main.pIncome.filter(i => i.source === 'late_fee'), tab: 'income' })}
            >
              <span className="font-medium">Late Fees</span>
              <span className="font-bold tnum">{formatCurrency(main.lateFeeIncome)}</span>
            </button>
            {main.moveInFeeIncome > 0 && (
            <button
              className="flex justify-between items-center py-2 border-b w-full text-left hover:bg-black/[0.02] rounded-lg px-2 -mx-2 transition-colors"
              onClick={() => openDrillModal('Move-In Fees', { incomes: main.pIncome.filter(i => i.source === 'move_in_fee'), tab: 'income' })}
            >
              <span className="font-medium">Move-In Fees</span>
              <span className="font-bold tnum">{formatCurrency(main.moveInFeeIncome)}</span>
            </button>
            )}
            {main.utilityReimbursement > 0 && (
            <button
              className="flex justify-between items-center py-2 border-b w-full text-left hover:bg-black/[0.02] rounded-lg px-2 -mx-2 transition-colors"
              onClick={() => openDrillModal('Utility Reimbursements', { incomes: main.pIncome.filter(i => i.source === 'utility_reimbursement'), tab: 'income' })}
            >
              <span className="font-medium">Utility Reimbursements</span>
              <span className="font-bold tnum">{formatCurrency(main.utilityReimbursement)}</span>
            </button>
            )}
            {main.hoaReimbursement > 0 && (
            <button
              className="flex justify-between items-center py-2 border-b w-full text-left hover:bg-black/[0.02] rounded-lg px-2 -mx-2 transition-colors"
              onClick={() => openDrillModal('HOA Reimbursements', { incomes: main.pIncome.filter(i => i.source === 'hoa_reimbursement'), tab: 'income' })}
            >
              <span className="font-medium">HOA Reimbursements</span>
              <span className="font-bold tnum">{formatCurrency(main.hoaReimbursement)}</span>
            </button>
            )}
            {main.applicationFeeIncome > 0 && (
            <button
              className="flex justify-between items-center py-2 border-b w-full text-left hover:bg-black/[0.02] rounded-lg px-2 -mx-2 transition-colors"
              onClick={() => openDrillModal('Application Fees', { incomes: main.pIncome.filter(i => i.source === 'application_fee'), tab: 'income' })}
            >
              <span className="font-medium">Application Fees</span>
              <span className="font-bold tnum">{formatCurrency(main.applicationFeeIncome)}</span>
            </button>
            )}
            {main.petFeeIncome > 0 && (
            <button
              className="flex justify-between items-center py-2 border-b w-full text-left hover:bg-black/[0.02] rounded-lg px-2 -mx-2 transition-colors"
              onClick={() => openDrillModal('Pet Fees', { incomes: main.pIncome.filter(i => i.source === 'pet_fee'), tab: 'income' })}
            >
              <span className="font-medium">Pet Fees</span>
              <span className="font-bold tnum">{formatCurrency(main.petFeeIncome)}</span>
            </button>
            )}
            {main.parkingFeeIncome > 0 && (
            <button
              className="flex justify-between items-center py-2 border-b w-full text-left hover:bg-black/[0.02] rounded-lg px-2 -mx-2 transition-colors"
              onClick={() => openDrillModal('Parking Fees', { incomes: main.pIncome.filter(i => i.source === 'parking_fee'), tab: 'income' })}
            >
              <span className="font-medium">Parking Fees</span>
              <span className="font-bold tnum">{formatCurrency(main.parkingFeeIncome)}</span>
            </button>
            )}
            <button
              className="flex justify-between items-center py-2 border-b w-full text-left hover:bg-black/[0.02] rounded-lg px-2 -mx-2 transition-colors"
              onClick={() => openDrillModal('Other Income', { incomes: main.pIncome.filter(i => i.source === 'other'), tab: 'income' })}
            >
              <span className="font-medium">Other Income</span>
              <span className="font-bold tnum">{formatCurrency(main.otherIncome)}</span>
            </button>
            <div className="flex justify-between items-center py-2 text-lg">
              <span className="font-bold">Taxable Income</span>
              <span className="font-bold text-positive tnum">{formatCurrency(main.totalIncome)}</span>
            </div>
            {main.depositsReceived > 0 && (
              <button
                className="flex justify-between items-center py-2 border-t border-line w-full text-left hover:bg-black/[0.02] rounded-lg px-2 -mx-2 transition-colors"
                onClick={() => openDrillModal('Security Deposits Received', { incomes: main.pIncome.filter(i => i.source === 'deposit'), tab: 'income' })}
              >
                <span className="text-sm text-muted">
                  Security deposits received
                  <span className="block text-xs text-muted">Not included in taxable income (refundable liability).</span>
                </span>
                <span className="text-sm text-muted tnum">{formatCurrency(main.depositsReceived)}</span>
              </button>
            )}
          </div>
        </CardContent>}
      </Card>

      {/* Expense Categories Table */}
      <Card>
        <CardHeader className="cursor-pointer select-none" onClick={() => toggle('expenses')}>
          <CardTitle className="flex items-center gap-2.5">
            <ChevronDown className={cn('h-4 w-4 text-muted transition-transform', collapsed.has('expenses') && '-rotate-90')} />
            <span className="w-9 h-9 rounded-xl bg-danger-soft text-danger grid place-items-center shrink-0"><Calculator className="h-[18px] w-[18px]" /></span>
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
                  .flatMap(([key, value]) => {
                    const open = drilldown === key;
                    const items = open
                      ? main.pExpenses
                          .filter(e => (e.taxCategory || mapToTaxCategory(e.category)) === key)
                          .sort((a, b) => b.amount - a.amount)
                      : [];
                    return [
                      <tr key={key} className="border-b last:border-0 hover:bg-canvas cursor-pointer" onClick={() => setDrilldown(open ? null : key)}>
                        <td className="py-3 px-4 font-medium flex items-center gap-1.5">
                          {key !== 'depreciation' ? (
                            open ? <ChevronDown className="h-3.5 w-3.5 text-muted" /> : <ChevronRight className="h-3.5 w-3.5 text-muted" />
                          ) : <span className="w-3.5" />}
                          {TAX_CATEGORIES[key]?.label || key}
                        </td>
                        <td className="py-3 px-4 text-sm text-muted">
                          {TAX_CATEGORIES[key]?.description || ''}
                        </td>
                        <td className="py-3 px-4 text-right font-semibold">
                          <button
                            className="hover:text-primary transition-colors"
                            onClick={(e) => {
                              e.stopPropagation();
                              openDrillModal(
                                `${TAX_CATEGORIES[key]?.label || key} Expenses`,
                                {
                                  expenses: main.pExpenses.filter(ex => (ex.taxCategory || mapToTaxCategory(ex.category)) === key),
                                  tab: 'expenses',
                                },
                              );
                            }}
                          >
                            {formatCurrency(value)}
                          </button>
                        </td>
                        <td className="py-3 px-4 text-right">
                          <Badge variant="secondary">
                            {main.totalDeductibleExpenses > 0
                              ? ((value / main.totalDeductibleExpenses) * 100).toFixed(1)
                              : 0}%
                          </Badge>
                        </td>
                      </tr>,
                      ...items.map(e => (
                        <tr key={`detail-${e.id}`} className="bg-canvas/50 border-b last:border-0 text-sm">
                          <td className="py-2 px-4 pl-10 text-muted">{formatDate(e.date)}</td>
                          <td className="py-2 px-4 text-muted">{e.description || '—'}</td>
                          <td className="py-2 px-4 text-right tnum">{formatCurrency(e.amount)}</td>
                          <td className="py-2 px-4 text-right text-muted text-xs">
                            {properties.find(p => p.id === e.propertyId)?.name || ''}
                          </td>
                        </tr>
                      )),
                    ];
                  })}
              </tbody>
            </table>
          </div>
        </CardContent>}
      </Card>

      {/* Operating vs Capital Expenses (IRS $2,500 de minimis safe harbor) */}
      <Card>
        <CardHeader className="cursor-pointer select-none" onClick={() => toggle('opVsCap')}>
          <CardTitle className="flex items-center gap-2.5">
            <ChevronDown className={cn('h-4 w-4 text-muted transition-transform', collapsed.has('opVsCap') && '-rotate-90')} />
            <span className="w-9 h-9 rounded-xl bg-warning-soft text-warning grid place-items-center shrink-0"><Calculator className="h-[18px] w-[18px]" /></span>
            Operating vs Capital Expenses
          </CardTitle>
        </CardHeader>
        {!collapsed.has('opVsCap') && <CardContent>
          <p className="text-sm text-muted mb-4">
            Recurring costs (property taxes, insurance, HOA, utilities, management) are always
            operating expenses regardless of amount. Expenses explicitly marked as capital
            projects are shown separately. For legacy expenses without an explicit type,
            amounts over {formatCurrency(capitalThreshold)} per item in eligible categories are
            suggested as capital improvements. Confirm the treatment with your accountant.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <button
              className="rounded-xl border border-line p-4 text-left hover:border-line-strong hover:shadow-sm transition-all"
              onClick={() => openDrillModal('Operating Expenses', {
                expenses: main.pExpenses.filter(e => !isCapitalExpense(e, capitalThreshold) && e.category !== 'mortgage'),
                tab: 'expenses',
              })}
            >
              <div className="flex items-center justify-between">
                <span className="eyebrow">Operating Expenses</span>
                <Badge variant="secondary">Deduct this year</Badge>
              </div>
              <div className="mt-2 text-[24px] leading-none font-semibold text-ink tnum">
                {formatCurrency(main.operatingExpenses)}
              </div>
              <p className="mt-1.5 text-[13px] text-muted">
                Property taxes, insurance, HOA, maintenance, and more.
              </p>
            </button>
            <button
              className="rounded-xl border border-line p-4 text-left hover:border-line-strong hover:shadow-sm transition-all"
              onClick={() => openDrillModal('Capital Improvements', {
                expenses: main.pExpenses.filter(e => isCapitalExpense(e, capitalThreshold)),
                tab: 'expenses',
              })}
            >
              <div className="flex items-center justify-between">
                <span className="eyebrow">Capital Improvements</span>
                <Badge variant="warning">Capitalize / depreciate</Badge>
              </div>
              <div className="mt-2 text-[24px] leading-none font-semibold text-ink tnum">
                {formatCurrency(main.capitalExpenses)}
              </div>
              <p className="mt-1.5 text-[13px] text-muted">
                {main.capitalItems.length > 0
                  ? `${main.capitalItems.length} item${main.capitalItems.length === 1 ? '' : 's'}: improvements that add value or extend useful life.`
                  : 'No capital improvements this period.'}
              </p>
            </button>
          </div>

          {main.capitalItems.length > 0 && (() => {
            // Group items by capital project (null = standalone)
            const projectGroups = new Map<string | null, { name: string; items: typeof main.capitalItems; total: number }>();
            for (const item of main.capitalItems) {
              const key = item.capitalProjectId || null;
              if (!projectGroups.has(key)) {
                projectGroups.set(key, {
                  name: item.capitalProjectName || 'Individual Capital Expenses',
                  items: [],
                  total: 0,
                });
              }
              const g = projectGroups.get(key)!;
              g.items.push(item);
              g.total += item.amount;
            }
            // Projects first, standalone last
            const groups = [...projectGroups.entries()].sort((a, b) => (a[0] ? 0 : 1) - (b[0] ? 0 : 1) || b[1].total - a[1].total);

            return (
              <div className="mt-5 space-y-4">
                {groups.map(([key, group]) => (
                  <div key={key || '__standalone'}>
                    {key && (
                      <div className="flex items-center justify-between mb-2 px-1">
                        <span className="font-medium text-ink">{group.name}</span>
                        <span className="font-semibold tnum">{formatCurrency(group.total)}</span>
                      </div>
                    )}
                    <div className="overflow-x-auto">
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
                          {group.items.map(item => (
                            <tr key={item.id} className="border-b border-line last:border-0">
                              <td className="py-2.5 px-4 whitespace-nowrap">{formatDate(item.date)}</td>
                              <td className="py-2.5 px-4">{item.categoryLabel}</td>
                              <td className="py-2.5 px-4 text-muted">{item.description || '—'}</td>
                              <td className="py-2.5 px-4 text-muted">{item.propertyName || '—'}</td>
                              <td className="py-2.5 px-4 text-right font-semibold tnum">{formatCurrency(item.amount)}</td>
                            </tr>
                          ))}
                          {group.items.length > 1 && (
                            <tr className="bg-canvas font-semibold">
                              <td colSpan={4} className="py-2 px-4 text-right text-xs text-muted uppercase">
                                {key ? 'Project Total' : 'Subtotal'}
                              </td>
                              <td className="py-2 px-4 text-right tnum">{formatCurrency(group.total)}</td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </CardContent>}
      </Card>

      {/* Depreciation schedule */}
      <Card>
        <CardHeader className="cursor-pointer select-none" onClick={() => toggle('depreciation')}>
          <CardTitle className="flex items-center gap-2.5">
            <ChevronDown className={cn('h-4 w-4 text-muted transition-transform', collapsed.has('depreciation') && '-rotate-90')} />
            <span className="w-9 h-9 rounded-xl bg-primary-soft text-primary grid place-items-center shrink-0"><Home className="h-[18px] w-[18px]" /></span>
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
            <CardTitle className="flex items-center gap-2.5">
              <ChevronDown className={cn('h-4 w-4 text-muted transition-transform', collapsed.has('mortgage') && '-rotate-90')} />
              <span className="w-9 h-9 rounded-xl bg-primary-soft text-primary grid place-items-center shrink-0"><FileText className="h-[18px] w-[18px]" /></span>
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
                <div className="mt-2 text-[22px] leading-none font-semibold text-ink tnum">
                  {formatCurrency(main.mortgageInterestDeducted)}
                </div>
              </div>
              <div className="rounded-xl border border-line p-4">
                <span className="eyebrow">Principal (not deductible)</span>
                <div className="mt-2 text-[22px] leading-none font-semibold text-muted tnum">
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
          <CardTitle className="flex items-center gap-2.5">
            <ChevronDown className={cn('h-4 w-4 text-muted transition-transform', collapsed.has('property') && '-rotate-90')} />
            <span className="w-9 h-9 rounded-xl bg-primary-soft text-primary grid place-items-center shrink-0"><Home className="h-[18px] w-[18px]" /></span>
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
                {main.propertyBreakdown.flatMap((p) => {
                  const prop = properties.find(pr => pr.name === p.name);
                  const open = drilldownProp === p.name;
                  const items = open && prop
                    ? main.pExpenses.filter(e => e.propertyId === prop.id).sort((a, b) => a.date.localeCompare(b.date))
                    : [];
                  return [
                    <tr key={p.name} className="border-b last:border-0 hover:bg-canvas cursor-pointer" onClick={() => setDrilldownProp(open ? null : p.name)}>
                      <td className="py-3 px-4 font-medium flex items-center gap-1.5">
                        {open ? <ChevronDown className="h-3.5 w-3.5 text-muted" /> : <ChevronRight className="h-3.5 w-3.5 text-muted" />}
                        {p.name}
                      </td>
                      <td className="py-3 px-4 text-right text-positive">{formatCurrency(p.income)}</td>
                      <td className="py-3 px-4 text-right text-danger">{formatCurrency(p.expenses)}</td>
                      <td className={`py-3 px-4 text-right font-semibold ${p.netIncome >= 0 ? 'text-positive' : 'text-danger'}`}>
                        {formatCurrency(p.netIncome)}
                      </td>
                    </tr>,
                    ...items.map(e => (
                      <tr key={`prop-${e.id}`} className="bg-canvas/50 border-b last:border-0 text-sm">
                        <td className="py-2 px-4 pl-10 text-muted">{formatDate(e.date)}</td>
                        <td className="py-2 px-4 text-muted">{e.description || '—'}</td>
                        <td className="py-2 px-4 text-right tnum">{formatCurrency(e.amount)}</td>
                        <td className="py-2 px-4 text-right text-xs text-muted">
                          {TAX_CATEGORIES[e.taxCategory || mapToTaxCategory(e.category)]?.label || e.category}
                        </td>
                      </tr>
                    )),
                  ];
                })}
              </tbody>
            </table>
          </div>
        </CardContent>}
      </Card>

      {/* Tax Tips */}
      <Card>
        <CardHeader className="cursor-pointer select-none" onClick={() => toggle('tips')}>
          <CardTitle className="flex items-center gap-2.5">
            <ChevronDown className={cn('h-4 w-4 text-muted transition-transform', collapsed.has('tips') && '-rotate-90')} />
            <span className="w-9 h-9 rounded-xl bg-warning-soft text-warning grid place-items-center shrink-0"><AlertCircle className="h-[18px] w-[18px]" /></span>
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
                <li>Move-in fees collected</li>
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

      {/* ── #1: Schedule E Mapping ──────────────────────────────────────── */}
      <Card>
        <CardHeader className="cursor-pointer select-none" onClick={() => toggle('scheduleE')}>
          <CardTitle className="flex items-center gap-2.5">
            <ChevronDown className={cn('h-4 w-4 text-muted transition-transform', collapsed.has('scheduleE') && '-rotate-90')} />
            <span className="w-9 h-9 rounded-xl bg-primary-soft text-primary grid place-items-center shrink-0"><FileText className="h-[18px] w-[18px]" /></span>
            <span className="flex-1">Schedule E (Form 1040)</span>
            <Badge variant="default" className="text-xs">IRS Reference</Badge>
          </CardTitle>
        </CardHeader>
        {!collapsed.has('scheduleE') && <CardContent>
          <p className="text-sm text-muted mb-4">
            Your data mapped to IRS Schedule E, Part I line numbers. Hand this to your accountant
            or use it to fill out your return. Each property gets its own column, matching the
            Schedule E format (Properties A, B, C…).
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-sm" style={{ minWidth: Math.max(600, 200 + main.scheduleEPerProperty.length * 120) }}>
              <thead>
                <tr className="border-b border-line bg-canvas">
                  <th className="text-left py-2.5 px-3 font-medium w-10">Line</th>
                  <th className="text-left py-2.5 px-3 font-medium">Description</th>
                  {main.scheduleEPerProperty.map(p => (
                    <th key={p.name} className="text-right py-2.5 px-3 font-medium whitespace-nowrap">{p.name}</th>
                  ))}
                  <th className="text-right py-2.5 px-3 font-bold">Totals</th>
                </tr>
              </thead>
              <tbody>
                {main.scheduleETotals.lines.map(tl => {
                  const isSummary = tl.line === 3 || tl.line === 20 || tl.line === 21;
                  const cls = isSummary ? 'font-semibold bg-canvas/50' : '';
                  return (
                    <tr key={tl.line} className={cn('border-b border-line last:border-0', cls)}>
                      <td className="py-2 px-3 text-muted">{tl.line}</td>
                      <td className="py-2 px-3">{tl.label}</td>
                      {main.scheduleEPerProperty.map(p => {
                        const line = p.lines.find(l => l.line === tl.line);
                        const amt = line?.amount ?? 0;
                        return (
                          <td key={p.name} className="py-2 px-3 text-right tnum">
                            {amt !== 0 ? formatCurrency(amt) : <span className="text-muted">—</span>}
                          </td>
                        );
                      })}
                      <td className={cn('py-2 px-3 text-right tnum', isSummary && 'font-bold', tl.line === 21 && (tl.amount >= 0 ? 'text-positive' : 'text-danger'))}>
                        {tl.amount !== 0 ? formatCurrency(tl.amount) : <span className="text-muted">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted mt-3">
            Line 19 ("Other") includes HOA dues and miscellaneous expenses. List them individually
            on the actual form. This is a reference mapping; confirm all figures with your tax preparer.
          </p>
        </CardContent>}
      </Card>

      {/* ── #3: Estimated Tax Liability ──────────────────────────────────── */}
      <Card>
        <CardHeader className="cursor-pointer select-none" onClick={() => toggle('estTax')}>
          <CardTitle className="flex items-center gap-2.5">
            <ChevronDown className={cn('h-4 w-4 text-muted transition-transform', collapsed.has('estTax') && '-rotate-90')} />
            <span className="w-9 h-9 rounded-xl bg-danger-soft text-danger grid place-items-center shrink-0"><Calculator className="h-[18px] w-[18px]" /></span>
            Estimated Tax Liability
          </CardTitle>
        </CardHeader>
        {!collapsed.has('estTax') && <CardContent>
          <p className="text-sm text-muted mb-4">
            A rough estimate of the tax you might owe on this rental income. Adjust the rates to
            match your tax bracket. This is NOT tax advice; your actual liability depends on your
            full return, filing status, and other deductions.
          </p>
          <div className="flex flex-wrap gap-4 mb-5">
            <div>
              <label className="block text-xs text-muted mb-1">Federal marginal rate (%)</label>
              <input
                type="number" min={0} max={50} step={0.5}
                value={fedRate}
                onChange={(e) => setFedRate(Math.max(0, Math.min(50, Number(e.target.value))))}
                className="w-28 px-3 py-2 border border-line rounded-lg bg-surface text-sm text-ink tnum focus:outline-none focus:ring-2 focus:ring-primary/25"
              />
            </div>
            <div>
              <label className="block text-xs text-muted mb-1">State rate (%)</label>
              <input
                type="number" min={0} max={20} step={0.1}
                value={stateRate}
                onChange={(e) => setStateRate(Math.max(0, Math.min(20, Number(e.target.value))))}
                className="w-28 px-3 py-2 border border-line rounded-lg bg-surface text-sm text-ink tnum focus:outline-none focus:ring-2 focus:ring-primary/25"
              />
            </div>
          </div>
          {main.netIncome <= 0 ? (
            <div className="rounded-xl border border-line p-4 text-center">
              <p className="text-lg font-semibold text-positive">No estimated tax</p>
              <p className="text-sm text-muted mt-1">
                Your net rental income is {formatCurrency(main.netIncome)}. A net loss may offset
                other income on your return (subject to passive activity rules).
              </p>
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="rounded-xl border border-line p-4">
                <span className="eyebrow">Federal ({fedRate}%)</span>
                <div className="mt-2 text-[22px] leading-none font-semibold text-ink tnum">
                  {formatCurrency(estimatedFederal)}
                </div>
              </div>
              <div className="rounded-xl border border-line p-4">
                <span className="eyebrow">State ({stateRate}%)</span>
                <div className="mt-2 text-[22px] leading-none font-semibold text-ink tnum">
                  {formatCurrency(estimatedState)}
                </div>
              </div>
              <div className="rounded-xl border border-primary/30 bg-primary-soft/30 p-4">
                <span className="eyebrow">Estimated Total</span>
                <div className="mt-2 text-[22px] leading-none font-bold text-primary tnum">
                  {formatCurrency(estimatedTotal)}
                </div>
                <p className="text-xs text-muted mt-1.5">
                  On {formatCurrency(main.netIncome)} net income
                </p>
              </div>
            </div>
          )}
          <p className="text-xs text-muted mt-3">
            Rental income is generally passive and not subject to self-employment tax.
            Your effective rate depends on your total taxable income. These rates are saved
            for your next visit.
          </p>
        </CardContent>}
      </Card>

      {/* ── #4: 1099 Vendor Tracker ──────────────────────────────────────── */}
      {main.vendors1099.length > 0 && (
        <Card>
          <CardHeader className="cursor-pointer select-none" onClick={() => toggle('vendors1099')}>
            <CardTitle className="flex items-center gap-2.5">
              <ChevronDown className={cn('h-4 w-4 text-muted transition-transform', collapsed.has('vendors1099') && '-rotate-90')} />
              <span className="w-9 h-9 rounded-xl bg-warning-soft text-warning grid place-items-center shrink-0"><Users className="h-[18px] w-[18px]" /></span>
              <span className="flex-1">1099 Vendor Tracker</span>
              {main.vendors1099.filter(v => v.total >= VENDOR_1099_THRESHOLD).length > 0 && (
                <Badge variant="warning" className="ml-auto">
                  {main.vendors1099.filter(v => v.total >= VENDOR_1099_THRESHOLD).length} need{main.vendors1099.filter(v => v.total >= VENDOR_1099_THRESHOLD).length === 1 ? 's' : ''} 1099
                </Badge>
              )}
            </CardTitle>
          </CardHeader>
          {!collapsed.has('vendors1099') && <CardContent>
            <p className="text-sm text-muted mb-4">
              Service vendors you paid {formatCurrency(VENDOR_1099_THRESHOLD)} or more in a calendar year may need
              a 1099-NEC by January 31 of the following year. <strong className="text-ink font-medium">LLCs
              and partnerships: yes,</strong> unless the LLC has elected to be taxed as a C-corp or S-corp.
              Sole proprietors and individuals: yes. <strong className="text-ink font-medium">Corporations
              (C-corp/S-corp): generally exempt.</strong> Payments to government entities (property taxes),
              insurance companies, mortgage servicers, utilities, HOA, and banks are excluded automatically. When
              in doubt, request a W-9 from the vendor; Box 3 shows their entity type.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-line bg-canvas">
                    <th className="text-left py-2.5 px-4 font-medium">Vendor</th>
                    <th className="text-right py-2.5 px-4 font-medium">Total Paid</th>
                    <th className="text-center py-2.5 px-4 font-medium">1099 Required?</th>
                  </tr>
                </thead>
                <tbody>
                  {main.vendors1099.map(v => (
                    <tr key={v.name} className="border-b border-line last:border-0">
                      <td className="py-2.5 px-4 font-medium text-ink">{v.name}</td>
                      <td className="py-2.5 px-4 text-right tnum font-semibold">{formatCurrency(v.total)}</td>
                      <td className="py-2.5 px-4 text-center">
                        {v.total >= VENDOR_1099_THRESHOLD ? (
                          <Badge variant="warning">Yes</Badge>
                        ) : (
                          <span className="text-muted text-xs">Under threshold</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-xs text-muted mt-3">
              Based on the vendor name on your expense records. Make sure the same vendor
              uses a consistent name so payments are grouped correctly.
            </p>
          </CardContent>}
        </Card>
      )}

      {/* ── #5: Mileage Deduction Estimator ──────────────────────────────── */}
      <Card>
        <CardHeader className="cursor-pointer select-none" onClick={() => toggle('mileage')}>
          <CardTitle className="flex items-center gap-2.5">
            <ChevronDown className={cn('h-4 w-4 text-muted transition-transform', collapsed.has('mileage') && '-rotate-90')} />
            <span className="w-9 h-9 rounded-xl bg-primary-soft text-primary grid place-items-center shrink-0"><Car className="h-[18px] w-[18px]" /></span>
            Mileage Deduction
          </CardTitle>
        </CardHeader>
        {!collapsed.has('mileage') && <CardContent>
          <p className="text-sm text-muted mb-4">
            Track business miles driven for rental activities (property visits, supply runs, bank trips).
            The IRS standard mileage rate for 2025 is ${(IRS_MILEAGE_RATE_CENTS / 100).toFixed(2)}/mile.
          </p>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <label className="block text-xs text-muted mb-1">Total business miles ({year})</label>
              <input
                type="number" min={0} step={1}
                value={mileage || ''}
                placeholder="Enter miles"
                onChange={(e) => saveMileage(Number(e.target.value) || 0)}
                className="w-full px-3 py-2 border border-line rounded-lg bg-surface text-sm text-ink tnum focus:outline-none focus:ring-2 focus:ring-primary/25"
              />
            </div>
            <div className="rounded-xl border border-line p-4">
              <span className="eyebrow">Rate</span>
              <div className="mt-2 text-[18px] leading-none font-semibold text-ink tnum">
                ${(IRS_MILEAGE_RATE_CENTS / 100).toFixed(2)}/mi
              </div>
              <p className="text-xs text-muted mt-1">IRS standard rate</p>
            </div>
            <div className="rounded-xl border border-line p-4">
              <span className="eyebrow">Estimated deduction</span>
              <div className="mt-2 text-[18px] leading-none font-semibold text-positive tnum">
                {formatCurrency(mileageDeduction)}
              </div>
              <p className="text-xs text-muted mt-1">
                {mileage > 0 ? `${mileage.toLocaleString()} miles × $${(IRS_MILEAGE_RATE_CENTS / 100).toFixed(2)}` : 'Enter miles above'}
              </p>
            </div>
          </div>
          <p className="text-xs text-muted mt-3">
            Keep a log of each trip (date, destination, purpose, miles). You can deduct either
            standard mileage OR actual expenses (gas, maintenance, depreciation) for vehicle use,
            not both. The mileage shown here is not included in the deductible expenses total above.
          </p>
        </CardContent>}
      </Card>

      {/* ── #6: Tax Calendar ─────────────────────────────────────────────── */}
      <Card>
        <CardHeader className="cursor-pointer select-none" onClick={() => toggle('taxCalendar')}>
          <CardTitle className="flex items-center gap-2.5">
            <ChevronDown className={cn('h-4 w-4 text-muted transition-transform', collapsed.has('taxCalendar') && '-rotate-90')} />
            <span className="w-9 h-9 rounded-xl bg-primary-soft text-primary grid place-items-center shrink-0"><Calendar className="h-[18px] w-[18px]" /></span>
            Tax Calendar ({year + 1} Filing)
          </CardTitle>
        </CardHeader>
        {!collapsed.has('taxCalendar') && <CardContent>
          <div className="flex items-center justify-between mb-4">
            <p className="text-sm text-muted">
              Key filing deadlines for tax year {year}. Dates are general guidelines;
              check the IRS website for exact dates, which can shift for weekends and holidays.
            </p>
            <Button
              size="sm"
              variant={calSynced ? 'outline' : 'default'}
              disabled={calSyncing || calSynced}
              onClick={addTaxDeadlinesToCalendar}
              className="ml-4 shrink-0"
            >
              {calSyncing ? (
                <><Loader2 className="h-4 w-4 animate-spin mr-1.5" /> Adding...</>
              ) : calSynced ? (
                <><Check className="h-4 w-4 mr-1.5" /> Added</>
              ) : (
                <><CalendarPlus className="h-4 w-4 mr-1.5" /> Add to Calendar</>
              )}
            </Button>
          </div>
          <div className="space-y-0">
            {[
              { date: `Jan 31, ${year + 1}`, label: '1099-NEC due to vendors/IRS', description: 'File 1099-NEC for any vendor paid $600+', icon: '📄', past: new Date() > new Date(year + 1, 0, 31) },
              { date: `Apr 15, ${year + 1}`, label: 'Q1 estimated tax payment', description: `Federal + IL estimated payment for Q1 ${year + 1}`, icon: '💰', past: new Date() > new Date(year + 1, 3, 15) },
              { date: `Apr 15, ${year + 1}`, label: 'Annual tax return due', description: `File Schedule E with your Form 1040 for ${year}`, icon: '📋', past: new Date() > new Date(year + 1, 3, 15) },
              { date: `Jun 15, ${year + 1}`, label: 'Q2 estimated tax payment', description: `Federal + IL estimated payment for Q2 ${year + 1}`, icon: '💰', past: new Date() > new Date(year + 1, 5, 15) },
              { date: `Sep 15, ${year + 1}`, label: 'Q3 estimated tax payment', description: `Federal + IL estimated payment for Q3 ${year + 1}`, icon: '💰', past: new Date() > new Date(year + 1, 8, 15) },
              { date: `Oct 15, ${year + 1}`, label: 'Extended return due', description: `If you filed an extension for ${year}`, icon: '📋', past: new Date() > new Date(year + 1, 9, 15) },
              { date: `Jan 15, ${year + 2}`, label: 'Q4 estimated tax payment', description: `Federal + IL estimated payment for Q4 ${year + 1}`, icon: '💰', past: new Date() > new Date(year + 2, 0, 15) },
            ].map((item, i) => (
              <div key={i} className={cn('flex items-start gap-3 py-3 border-b border-line last:border-0', item.past && 'opacity-50')}>
                <span className="text-lg mt-0.5">{item.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-ink">{item.label}</span>
                    {item.past && <Badge variant="secondary" className="text-xs">Past</Badge>}
                  </div>
                  <p className="text-sm text-muted">{item.description}</p>
                </div>
                <span className="text-sm font-medium text-ink whitespace-nowrap">{item.date}</span>
              </div>
            ))}
          </div>
        </CardContent>}
      </Card>

      {/* ── #7: Multi-Year Trend ─────────────────────────────────────────── */}
      <Card>
        <CardHeader className="cursor-pointer select-none" onClick={() => toggle('multiYear')}>
          <CardTitle className="flex items-center gap-2.5">
            <ChevronDown className={cn('h-4 w-4 text-muted transition-transform', collapsed.has('multiYear') && '-rotate-90')} />
            <span className="w-9 h-9 rounded-xl bg-primary-soft text-primary grid place-items-center shrink-0"><BarChart3 className="h-[18px] w-[18px]" /></span>
            Multi-Year Trend
          </CardTitle>
        </CardHeader>
        {!collapsed.has('multiYear') && <CardContent>
          <p className="text-sm text-muted mb-4">
            Five-year view of annual income, deductible expenses, and net income.
            Helps you spot trends and plan ahead.
          </p>
          <ResponsiveContainer width="100%" height={320}>
            <LineChart data={multiYearData}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="year" />
              <YAxis tickFormatter={(value) => `$${Number(value) / 1000}k`} />
              <Tooltip formatter={(value) => formatCurrency(Number(value))} />
              <Legend />
              <Line type="monotone" dataKey="income" stroke="#2c7a58" strokeWidth={2} name="Income" dot={{ r: 4 }} />
              <Line type="monotone" dataKey="expenses" stroke="#b98a5e" strokeWidth={2} name="Expenses" dot={{ r: 4 }} />
              <Line type="monotone" dataKey="netIncome" stroke="#24503f" strokeWidth={3} name="Net Income" dot={{ r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
          <div className="overflow-x-auto mt-4">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line bg-canvas">
                  <th className="text-left py-2.5 px-4 font-medium">Year</th>
                  <th className="text-right py-2.5 px-4 font-medium">Income</th>
                  <th className="text-right py-2.5 px-4 font-medium">Expenses</th>
                  <th className="text-right py-2.5 px-4 font-medium">Net Income</th>
                  <th className="text-right py-2.5 px-4 font-medium">Margin</th>
                </tr>
              </thead>
              <tbody>
                {multiYearData.map(d => (
                  <tr key={d.year} className={cn('border-b border-line last:border-0', d.year === String(year) && 'bg-primary-soft/20 font-medium')}>
                    <td className="py-2.5 px-4 font-medium">{d.year}</td>
                    <td className="py-2.5 px-4 text-right tnum text-positive">{formatCurrency(d.income)}</td>
                    <td className="py-2.5 px-4 text-right tnum text-danger">{formatCurrency(d.expenses)}</td>
                    <td className={cn('py-2.5 px-4 text-right tnum font-semibold', d.netIncome >= 0 ? 'text-positive' : 'text-danger')}>
                      {formatCurrency(d.netIncome)}
                    </td>
                    <td className="py-2.5 px-4 text-right tnum text-muted">
                      {d.income > 0 ? `${((d.netIncome / d.income) * 100).toFixed(1)}%` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>}
      </Card>

      {/* Drill-down modal */}
      <TransactionDrillDown
        isOpen={drillModalOpen}
        onClose={() => setDrillModalOpen(false)}
        title={drillModalTitle}
        expenses={drillModalExpenses}
        incomes={drillModalIncomes}
        rentPayments={drillModalPayments}
        properties={properties}
        units={[]}
        forceTab={drillModalTab}
      />
    </div>
  );
}
