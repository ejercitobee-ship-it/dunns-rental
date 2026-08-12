/**
 * schedule-e.ts — IRS Schedule E (Form 1040) Line Mapping
 *
 * Maps rental income and expense data to the exact line numbers on
 * Schedule E (Supplemental Income and Loss), Part I: Income or Loss
 * From Rental Real Estate and Royalties.
 *
 * Reference: 2025 IRS Schedule E (lines 3 through 21).
 */

import type { Expense, Property } from '../types';
import { mapToTaxCategory } from './financials';

/** One line on Schedule E with its IRS line number and label. */
export interface ScheduleELine {
  line: number;
  label: string;
  /** Amount for a single property, or the "Totals" column. */
  amount: number;
}

/** A full Schedule E Part I for one property (or totals). */
export interface ScheduleEProperty {
  name: string;
  /** Physical address (shown on the form). */
  address?: string;
  /** Personal‑use days (line 2): 0 for fully rental properties. */
  personalUseDays: number;
  lines: ScheduleELine[];
}

/** Map a tax category to its Schedule E line number. */
const TAX_CAT_TO_LINE: Record<string, number> = {
  advertising:          5,
  auto_travel:          6,
  cleaning_maintenance: 7,
  commissions:          8,
  insurance:            9,
  legal_professional:  10,
  management_fees:     11,
  mortgage_interest:   12,
  other_interest:      13,
  repairs:             14,
  supplies:            15,
  taxes:               16,
  utilities:           17,
  depreciation:        18,
  hoa:                 19, // "Other" — specify HOA
  other:               19,
};

/** Human‑readable labels matching the Schedule E form. */
const LINE_LABELS: Record<number, string> = {
   3: 'Rents received',
   5: 'Advertising',
   6: 'Auto and travel',
   7: 'Cleaning and maintenance',
   8: 'Commissions',
   9: 'Insurance',
  10: 'Legal and other professional fees',
  11: 'Management fees',
  12: 'Mortgage interest paid to banks, etc.',
  13: 'Other interest',
  14: 'Repairs',
  15: 'Supplies',
  16: 'Taxes',
  17: 'Utilities',
  18: 'Depreciation expense or depletion',
  19: 'Other (list)',
  20: 'Total expenses',
  21: 'Subtract line 20 from line 3',
};

/** All expense line numbers in order. */
const EXPENSE_LINES = [5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19] as const;

export interface ScheduleEInput {
  property: Property;
  expenses: Expense[];
  rentIncome: number;
  depreciation: number;
  /** Interest‑only amount for mortgage expenses (already split). */
  deductibleAmount: (e: Expense) => number;
  capitalThreshold: number;
  isCapital: (e: Expense, threshold: number) => boolean;
}

/**
 * Build the Schedule E Part I line items for a single property.
 */
export function buildScheduleE(input: ScheduleEInput): ScheduleEProperty {
  const { property, expenses, rentIncome, depreciation, deductibleAmount, capitalThreshold, isCapital } = input;

  // Accumulate amounts by line number
  const byLine: Record<number, number> = {};
  for (const ln of EXPENSE_LINES) byLine[ln] = 0;

  for (const e of expenses) {
    if (e.propertyId !== property.id) continue;
    if (e.taxDeductible === false) continue;
    if (isCapital(e, capitalThreshold)) continue; // Capital items are NOT on Schedule E current-year

    const taxCat = e.taxCategory || mapToTaxCategory(e.category);
    const lineNum = TAX_CAT_TO_LINE[taxCat] ?? 19;
    byLine[lineNum] = (byLine[lineNum] || 0) + deductibleAmount(e);
  }

  // Add depreciation (line 18)
  byLine[18] = (byLine[18] || 0) + depreciation;

  const totalExpenses = EXPENSE_LINES.reduce((sum, ln) => sum + (byLine[ln] || 0), 0);

  const lines: ScheduleELine[] = [
    { line: 3, label: LINE_LABELS[3], amount: Math.round(rentIncome * 100) / 100 },
    ...EXPENSE_LINES.map(ln => ({
      line: ln,
      label: LINE_LABELS[ln],
      amount: Math.round((byLine[ln] || 0) * 100) / 100,
    })),
    { line: 20, label: LINE_LABELS[20], amount: Math.round(totalExpenses * 100) / 100 },
    { line: 21, label: LINE_LABELS[21], amount: Math.round((rentIncome - totalExpenses) * 100) / 100 },
  ];

  return {
    name: property.name,
    address: property.address,
    personalUseDays: 0,
    lines,
  };
}

/**
 * Build a totals row that sums across all per‑property Schedule E outputs.
 */
export function buildScheduleETotals(perProperty: ScheduleEProperty[]): ScheduleEProperty {
  const totals: Record<number, number> = {};
  for (const prop of perProperty) {
    for (const line of prop.lines) {
      totals[line.line] = (totals[line.line] || 0) + line.amount;
    }
  }

  const lines: ScheduleELine[] = [
    { line: 3, label: LINE_LABELS[3], amount: Math.round((totals[3] || 0) * 100) / 100 },
    ...EXPENSE_LINES.map(ln => ({
      line: ln,
      label: LINE_LABELS[ln],
      amount: Math.round((totals[ln] || 0) * 100) / 100,
    })),
    { line: 20, label: LINE_LABELS[20], amount: Math.round((totals[20] || 0) * 100) / 100 },
    { line: 21, label: LINE_LABELS[21], amount: Math.round((totals[21] || 0) * 100) / 100 },
  ];

  return {
    name: 'Totals',
    personalUseDays: 0,
    lines,
  };
}

export { LINE_LABELS, EXPENSE_LINES };
