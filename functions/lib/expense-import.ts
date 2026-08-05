/**
 * Expense import: CSV parsing, column mapping, and row validation.
 *
 * The flow is: upload → parse CSV → map columns → store staged rows →
 * validate against live data → user reviews/edits → merge to expenses.
 */

// ---------------------------------------------------------------------------
// Column mapping: we try common header variations
// ---------------------------------------------------------------------------

const COLUMN_ALIASES: Record<string, string[]> = {
  date:        ['date', 'expense date', 'trans date', 'transaction date', 'payment date', 'paid date'],
  amount:      ['amount', 'cost', 'total', 'price', 'expense amount', 'payment amount'],
  category:    ['category', 'type', 'expense type', 'expense category'],
  description: ['description', 'memo', 'notes', 'details', 'line item', 'item'],
  vendor:      ['vendor', 'payee', 'paid to', 'supplier', 'merchant'],
  property:    ['property', 'property name', 'building', 'address', 'location'],
  unit:        ['unit', 'unit number', 'apt', 'apartment', 'suite', 'unit #'],
  taxCategory: ['tax category', 'tax type', 'deduction category', 'irs category'],
  recurring:   ['recurring', 'is recurring', 'repeat', 'frequency'],
  notes:       ['notes', 'comment', 'comments', 'remark', 'remarks'],
};

/** Build a map from CSV header → our field name. */
export function mapColumns(headers: string[]): Record<number, string> {
  const map: Record<number, string> = {};
  const lower = headers.map(h => h.trim().toLowerCase().replace(/[_\-]/g, ' '));

  for (const [field, aliases] of Object.entries(COLUMN_ALIASES)) {
    for (let i = 0; i < lower.length; i++) {
      if (map[i] !== undefined) continue; // already claimed
      if (aliases.includes(lower[i])) {
        map[i] = field;
        break;
      }
    }
  }
  return map;
}

// ---------------------------------------------------------------------------
// CSV parser (handles quoted fields, newlines inside quotes, etc.)
// ---------------------------------------------------------------------------

export function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === '"') {
        if (i + 1 < text.length && text[i + 1] === '"') {
          field += '"';
          i += 2;
        } else {
          inQuotes = false;
          i++;
        }
      } else {
        field += ch;
        i++;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
        i++;
      } else if (ch === ',') {
        row.push(field.trim());
        field = '';
        i++;
      } else if (ch === '\r' || ch === '\n') {
        row.push(field.trim());
        field = '';
        if (ch === '\r' && i + 1 < text.length && text[i + 1] === '\n') i++;
        i++;
        if (row.some(c => c !== '')) rows.push(row);
        row = [];
      } else {
        field += ch;
        i++;
      }
    }
  }
  // Last field / row
  row.push(field.trim());
  if (row.some(c => c !== '')) rows.push(row);

  return rows;
}

// ---------------------------------------------------------------------------
// Category normalisation
// ---------------------------------------------------------------------------

const VALID_CATEGORIES = new Set([
  'maintenance', 'utilities', 'insurance', 'taxes', 'mortgage',
  'repairs', 'cleaning', 'landscaping', 'management', 'realtor_commission', 'other',
]);

const CATEGORY_ALIASES: Record<string, string> = {
  'repair':          'repairs',
  'fix':             'repairs',
  'electric':        'utilities',
  'gas':             'utilities',
  'water':           'utilities',
  'electricity':     'utilities',
  'utility':         'utilities',
  'lawn':            'landscaping',
  'yard':            'landscaping',
  'landscape':       'landscaping',
  'clean':           'cleaning',
  'janitorial':      'cleaning',
  'insure':          'insurance',
  'tax':             'taxes',
  'property tax':    'taxes',
  'maintain':        'maintenance',
  'maint':           'maintenance',
  'mgmt':            'management',
  'property mgmt':   'management',
  'property management': 'management',
  'commission':      'realtor_commission',
  'realtor':         'realtor_commission',
  'mortgage payment': 'mortgage',
  'loan':            'mortgage',
  'misc':            'other',
  'miscellaneous':   'other',
  'general':         'other',
};

export function normalizeCategory(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const lower = raw.trim().toLowerCase();
  if (VALID_CATEGORIES.has(lower)) return lower;
  return CATEGORY_ALIASES[lower] ?? undefined;
}

// ---------------------------------------------------------------------------
// Date parsing: supports common US formats
// ---------------------------------------------------------------------------

export function parseDate(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const s = raw.trim();

  // ISO: 2024-03-15
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // US: 03/15/2024 or 3/15/2024
  const usMatch = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (usMatch) {
    const [, mm, dd, yyyy] = usMatch;
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }

  // US short: 03/15/24
  const usShort = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2})$/);
  if (usShort) {
    const [, mm, dd, yy] = usShort;
    const century = Number(yy) > 50 ? '19' : '20';
    return `${century}${yy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// Amount parsing
// ---------------------------------------------------------------------------

export function parseAmount(raw: string | undefined): number | undefined {
  if (!raw) return undefined;
  // Strip currency symbols, commas, spaces
  const cleaned = raw.replace(/[$€£¥,\s]/g, '').trim();
  // Handle parentheses as negative: (123.45)
  const negative = cleaned.startsWith('(') && cleaned.endsWith(')');
  const numStr = negative ? cleaned.slice(1, -1) : cleaned;
  const num = Number(numStr);
  if (!Number.isFinite(num)) return undefined;
  return negative ? -num : num;
}

// ---------------------------------------------------------------------------
// Build staged row from a parsed CSV row
// ---------------------------------------------------------------------------

export interface StagedRow {
  propertyName?: string;
  unitName?: string;
  category?: string;
  amount?: number;
  date?: string;
  description?: string;
  vendor?: string;
  notes?: string;
  taxCategory?: string;
  isRecurring: boolean;
  originalData: Record<string, string>;
}

export function buildStagedRow(
  cells: string[],
  headers: string[],
  colMap: Record<number, string>,
): StagedRow {
  const original: Record<string, string> = {};
  headers.forEach((h, i) => { original[h] = cells[i] ?? ''; });

  const get = (field: string): string | undefined => {
    for (const [idx, mapped] of Object.entries(colMap)) {
      if (mapped === field) return cells[Number(idx)] || undefined;
    }
    return undefined;
  };

  return {
    propertyName: get('property'),
    unitName: get('unit'),
    category: normalizeCategory(get('category')),
    amount: parseAmount(get('amount')),
    date: parseDate(get('date')),
    description: get('description'),
    vendor: get('vendor'),
    notes: get('notes'),
    taxCategory: get('taxCategory'),
    isRecurring: ['yes', 'true', '1', 'y'].includes((get('recurring') || '').toLowerCase()),
    originalData: original,
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface ValidationError {
  field: string;
  message: string;
}

export function validateRow(
  row: StagedRow,
  propertyNames: Map<string, string>,  // lowercase name → id
  unitsByProperty: Map<string, Map<string, string>>, // propertyId → (lowercase unitNumber → unitId)
): { errors: ValidationError[]; propertyId?: string; unitId?: string } {
  const errors: ValidationError[] = [];
  let propertyId: string | undefined;
  let unitId: string | undefined;

  // Required fields
  if (row.amount === undefined || row.amount === null) {
    errors.push({ field: 'amount', message: 'Amount is missing or not a valid number' });
  } else if (row.amount <= 0) {
    errors.push({ field: 'amount', message: 'Amount must be greater than zero' });
  }

  if (!row.date) {
    errors.push({ field: 'date', message: 'Date is missing or in an unrecognized format' });
  } else {
    // Check date is reasonable (not in the future, not before 2000)
    const y = Number(row.date.slice(0, 4));
    if (y < 2000 || y > new Date().getFullYear() + 1) {
      errors.push({ field: 'date', message: `Date year ${y} seems incorrect` });
    }
    // Check month/day validity
    const d = new Date(row.date + 'T12:00:00');
    if (isNaN(d.getTime())) {
      errors.push({ field: 'date', message: 'Date is invalid' });
    }
  }

  if (!row.description) {
    errors.push({ field: 'description', message: 'Description is missing' });
  }

  // Category
  if (!row.category) {
    errors.push({ field: 'category', message: 'Category is missing or unrecognized' });
  } else if (!VALID_CATEGORIES.has(row.category)) {
    errors.push({ field: 'category', message: `Unknown category "${row.category}"` });
  }

  // Property resolution
  if (row.propertyName) {
    const lower = row.propertyName.trim().toLowerCase();
    propertyId = propertyNames.get(lower);
    if (!propertyId) {
      // Try partial match
      for (const [name, id] of propertyNames) {
        if (name.includes(lower) || lower.includes(name)) {
          propertyId = id;
          break;
        }
      }
      if (!propertyId) {
        errors.push({ field: 'property', message: `Property "${row.propertyName}" not found in the system` });
      }
    }
  } else {
    errors.push({ field: 'property', message: 'Property is missing' });
  }

  // Unit resolution (optional, only if property is resolved)
  if (row.unitName && propertyId) {
    const propUnits = unitsByProperty.get(propertyId);
    if (propUnits) {
      const lower = row.unitName.trim().toLowerCase();
      unitId = propUnits.get(lower);
      if (!unitId) {
        errors.push({ field: 'unit', message: `Unit "${row.unitName}" not found for this property` });
      }
    }
  }

  return { errors, propertyId, unitId };
}

// ---------------------------------------------------------------------------
// Duplicate detection
// ---------------------------------------------------------------------------

export interface DuplicateKey {
  propertyId: string;
  date: string;
  amount: number;
  description: string;
}

export function duplicateKey(row: { propertyId?: string; date?: string; amount?: number; description?: string }): string | null {
  if (!row.propertyId || !row.date || row.amount == null || !row.description) return null;
  return `${row.propertyId}|${row.date}|${row.amount.toFixed(2)}|${row.description.trim().toLowerCase()}`;
}
