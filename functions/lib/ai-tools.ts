/**
 * AI Assistant tool definitions and executors.
 *
 * Each tool is a function the AI model can call to query the D1 database.
 * The tool definitions follow the Anthropic tool-use schema and the
 * executors return structured JSON that the model reasons over.
 *
 * IMPORTANT: rent math must match src/lib/rent.ts (the single source of
 * truth). Key rules replicated here:
 *  - RENT_TRACKING_START: January 2026 (nothing owed before that)
 *  - payment_allocations: when allocations exist for a payment, use them;
 *    legacy payments with no allocations fall back to their own month/year
 *  - credits (type='credit') settle rent but are not income
 *  - leases with needs_review=1 or pending/rejected/draft/cancelled
 *    renewal_status owe nothing
 *  - ended leases still owed rent for the months their dates covered
 *  - paused months (from lease_pauses) are not billed
 */
import type { D1Database } from '@cloudflare/workers-types';

const RENT_TRACKING_START_YEAR = 2026;
const RENT_TRACKING_START_MONTH = 1;
const RENT_TRACKING_START = RENT_TRACKING_START_YEAR * 12 + RENT_TRACKING_START_MONTH;

function ymOrdinal(year: number, month: number): number {
  return year * 12 + month;
}

function ymFromDate(dateStr: string): number {
  const [y, m] = dateStr.split('-').map(Number);
  return y * 12 + m;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// ---------------------------------------------------------------------------
// Tool definitions (sent to the model)
// ---------------------------------------------------------------------------

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

export const AI_TOOLS: ToolDefinition[] = [
  {
    name: 'searchTenants',
    description:
      'Search for tenants by name, email, or phone number. Returns matching tenants with their current property and lease status. Use this first when the user mentions a tenant by name.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search term: a name, email address, or phone number.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'getTenantProfile',
    description:
      'Get a complete profile for a specific tenant including their lease, payment history, payment allocations, and maintenance requests. Use the tenant ID from searchTenants.',
    input_schema: {
      type: 'object',
      properties: {
        tenantId: {
          type: 'string',
          description: 'The tenant UUID.',
        },
      },
      required: ['tenantId'],
    },
  },
  {
    name: 'searchProperties',
    description:
      'Search for properties by name or address. Returns matching properties with basic details.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search term: a property name or address fragment.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'getPropertySummary',
    description:
      'Get a complete summary for a specific property including units, occupancy, active tenants, and recent financial data. Use the property ID from searchProperties.',
    input_schema: {
      type: 'object',
      properties: {
        propertyId: {
          type: 'string',
          description: 'The property UUID.',
        },
      },
      required: ['propertyId'],
    },
  },
  {
    name: 'getRentStatus',
    description:
      'Get rent collection status for a given month. Shows who has paid, who owes, and totals. Includes ended leases that covered the queried month. Uses payment allocations for accuracy. Defaults to the current month if no month/year is specified.',
    input_schema: {
      type: 'object',
      properties: {
        month: {
          type: 'integer',
          description: 'Month number (1-12). Defaults to current month.',
        },
        year: {
          type: 'integer',
          description: 'Four digit year. Defaults to current year.',
        },
        propertyId: {
          type: 'string',
          description: 'Optional: filter to a specific property.',
        },
      },
      required: [],
    },
  },
  {
    name: 'getFinancialSummary',
    description:
      'Get income and expense totals for a date range. Useful for questions about how much was spent, earned, or the net for a period.',
    input_schema: {
      type: 'object',
      properties: {
        startDate: {
          type: 'string',
          description: 'Start date in YYYY-MM-DD format.',
        },
        endDate: {
          type: 'string',
          description: 'End date in YYYY-MM-DD format.',
        },
        propertyId: {
          type: 'string',
          description: 'Optional: filter to a specific property.',
        },
      },
      required: ['startDate', 'endDate'],
    },
  },
  {
    name: 'getMaintenanceRequests',
    description:
      'Get maintenance requests filtered by status, property, or tenant. Returns open requests by default.',
    input_schema: {
      type: 'object',
      properties: {
        status: {
          type: 'string',
          enum: ['open', 'in_progress', 'completed', 'resolved', 'cancelled', 'all'],
          description: 'Filter by status. Defaults to "open".',
        },
        propertyId: {
          type: 'string',
          description: 'Optional: filter to a specific property.',
        },
        tenantId: {
          type: 'string',
          description: 'Optional: filter to a specific tenant.',
        },
        limit: {
          type: 'integer',
          description: 'Max results to return. Defaults to 20.',
        },
      },
      required: [],
    },
  },
  {
    name: 'getRecentActivity',
    description:
      'Get recent activity log entries showing what actions were taken in the system. Useful for "what happened recently" or "what changed today" questions.',
    input_schema: {
      type: 'object',
      properties: {
        limit: {
          type: 'integer',
          description: 'Max entries to return (default 15, max 50).',
        },
        module: {
          type: 'string',
          enum: ['properties', 'tenants', 'leases', 'finances', 'maintenance', 'documents', 'calendar', 'users', 'settings', 'system'],
          description: 'Optional: filter to a specific module.',
        },
      },
      required: [],
    },
  },
  {
    name: 'getLeaseDetails',
    description:
      'Get detailed information about a specific lease including pause intervals, renewal info, and rent payment allocations. Use when you need precise lease or payment allocation data.',
    input_schema: {
      type: 'object',
      properties: {
        leaseId: {
          type: 'string',
          description: 'The lease UUID.',
        },
      },
      required: ['leaseId'],
    },
  },
];

// ---------------------------------------------------------------------------
// Tool executors
// ---------------------------------------------------------------------------

type ToolInput = Record<string, unknown>;

export async function executeTool(
  db: D1Database,
  toolName: string,
  input: ToolInput
): Promise<string> {
  try {
    switch (toolName) {
      case 'searchTenants':
        return await searchTenants(db, input);
      case 'getTenantProfile':
        return await getTenantProfile(db, input);
      case 'searchProperties':
        return await searchProperties(db, input);
      case 'getPropertySummary':
        return await getPropertySummary(db, input);
      case 'getRentStatus':
        return await getRentStatus(db, input);
      case 'getFinancialSummary':
        return await getFinancialSummary(db, input);
      case 'getMaintenanceRequests':
        return await getMaintenanceRequests(db, input);
      case 'getRecentActivity':
        return await getRecentActivity(db, input);
      case 'getLeaseDetails':
        return await getLeaseDetails(db, input);
      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
  } catch (err) {
    console.error(`AI tool ${toolName} failed:`, err);
    return JSON.stringify({ error: `Tool execution failed: ${(err as Error).message}` });
  }
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

interface LeaseRow {
  lease_id: string;
  monthly_rent: number;
  start_date: string | null;
  end_date: string | null;
  status: string;
  needs_review: number;
  renewal_status: string | null;
  renewed_from_lease_id: string | null;
  property_name: string | null;
  unit_number: string | null;
  tenant_names: string | null;
}

interface PauseRow {
  lease_id: string;
  paused_at: string;
  resumed_at: string | null;
}

function monthIsPaused(pause: PauseRow, target: number): boolean {
  const pausedMonth = ymFromDate(pause.paused_at);
  if (target <= pausedMonth) return false;
  if (!pause.resumed_at) return true;
  return target < ymFromDate(pause.resumed_at);
}

function leaseOwesMonth(
  lease: LeaseRow,
  pauses: PauseRow[],
  month: number,
  year: number
): boolean {
  const target = ymOrdinal(year, month);
  if (target < RENT_TRACKING_START) return false;
  if (lease.needs_review) return false;
  const rs = lease.renewal_status;
  if (rs === 'pending' || rs === 'rejected' || rs === 'draft' || rs === 'cancelled') return false;
  if (lease.start_date && target < ymFromDate(lease.start_date)) return false;
  if (lease.end_date && target > ymFromDate(lease.end_date)) return false;
  if (lease.status === 'ended' && !lease.end_date) return false;
  if (lease.status === 'paused' && pauses.length === 0) return false;
  if (pauses.some(p => monthIsPaused(p, target))) return false;
  return true;
}

/**
 * Compute the paid amount for a lease+month using allocations when available,
 * falling back to raw payments. Mirrors allocatedRentForMonth in rent.ts.
 */
function computePaidForMonth(
  leaseId: string,
  allocByLease: Map<string, { amount: number }[]>,
  legacyByLease: Map<string, { amount: number }[]>
): number {
  const fromAlloc = (allocByLease.get(leaseId) || [])
    .reduce((s, a) => s + a.amount, 0);
  const fromLegacy = (legacyByLease.get(leaseId) || [])
    .reduce((s, p) => s + p.amount, 0);
  return round2(fromAlloc + fromLegacy);
}

// ---------------------------------------------------------------------------
// Individual tool implementations
// ---------------------------------------------------------------------------

async function searchTenants(db: D1Database, input: ToolInput): Promise<string> {
  const q = `%${String(input.query || '')}%`;
  const { results } = await db.prepare(
    `SELECT t.id, t.first_name, t.last_name, t.email, t.phone,
            p.name AS property_name, u.unit_number,
            l.status AS lease_status, l.monthly_rent
       FROM tenants t
       LEFT JOIN lease_tenants lt ON lt.tenant_id = t.id
       LEFT JOIN leases l ON l.id = lt.lease_id AND l.status IN ('active', 'paused')
       LEFT JOIN units u ON u.id = l.unit_id
       LEFT JOIN properties p ON p.id = l.property_id
      WHERE t.first_name LIKE ?1 OR t.last_name LIKE ?1
         OR (t.first_name || ' ' || t.last_name) LIKE ?1
         OR t.email LIKE ?1 OR t.phone LIKE ?1
      LIMIT 10`
  ).bind(q).all();

  if (!results || results.length === 0) {
    return JSON.stringify({ message: 'No tenants found matching that search.', results: [] });
  }
  return JSON.stringify({
    message: `Found ${results.length} tenant(s).`,
    results: results.map(r => ({
      id: r.id,
      name: `${r.first_name} ${r.last_name}`,
      email: r.email || null,
      phone: r.phone || null,
      property: r.property_name || null,
      unit: r.unit_number || null,
      leaseStatus: r.lease_status || 'no active lease',
      monthlyRent: r.monthly_rent || null,
    })),
  });
}

async function getTenantProfile(db: D1Database, input: ToolInput): Promise<string> {
  const tenantId = String(input.tenantId);

  const tenant = await db.prepare(
    'SELECT id, first_name, last_name, email, phone, notes, emergency_contact_name, emergency_contact_phone, created_at FROM tenants WHERE id = ?'
  ).bind(tenantId).first();
  if (!tenant) return JSON.stringify({ error: 'Tenant not found.' });

  // All leases (active, paused, AND ended) for historical context
  const { results: leaseRows } = await db.prepare(
    `SELECT l.id, l.start_date, l.end_date, l.monthly_rent, l.security_deposit,
            l.status, l.lease_type, l.renewal_status, l.needs_review,
            p.id AS property_id, p.name AS property_name, p.address AS property_address,
            u.unit_number
       FROM leases l
       JOIN lease_tenants lt ON lt.lease_id = l.id
       LEFT JOIN properties p ON p.id = l.property_id
       LEFT JOIN units u ON u.id = l.unit_id
      WHERE lt.tenant_id = ?
      ORDER BY CASE l.status WHEN 'active' THEN 0 WHEN 'paused' THEN 1 ELSE 2 END,
               l.start_date DESC`
  ).bind(tenantId).all();

  const activeLease = (leaseRows || []).find(l => l.status === 'active' || l.status === 'paused') || null;

  // Recent payments (last 12) with type
  const { results: payments } = await db.prepare(
    `SELECT rp.id, rp.amount, rp.due_date, rp.paid_date, rp.status, rp.payment_method,
            rp.month, rp.year, rp.type
       FROM rent_payments rp
       JOIN leases l ON l.id = rp.lease_id
       JOIN lease_tenants lt ON lt.lease_id = l.id
      WHERE lt.tenant_id = ?
      ORDER BY rp.year DESC, rp.month DESC, rp.due_date DESC
      LIMIT 12`
  ).bind(tenantId).all();

  // Payment allocations for those payments
  const paymentIds = (payments || []).map(p => p.id as string);
  let allocations: Record<string, unknown>[] = [];
  if (paymentIds.length > 0) {
    const placeholders = paymentIds.map(() => '?').join(',');
    const { results: allocRows } = await db.prepare(
      `SELECT payment_id, lease_id, month, year, amount, type
         FROM payment_allocations
        WHERE payment_id IN (${placeholders})`
    ).bind(...paymentIds).all();
    allocations = allocRows || [];
  }

  // Compute current balance for the active lease
  let currentBalance: { month: number; year: number; due: number; paid: number; owed: number } | null = null;
  if (activeLease && !activeLease.needs_review) {
    const now = new Date();
    const curMonth = now.getMonth() + 1;
    const curYear = now.getFullYear();
    const rent = (activeLease.monthly_rent as number) || 0;

    // Get paid amount for current month using allocations
    const allocRow = await db.prepare(
      `SELECT COALESCE(SUM(pa.amount), 0) AS total
         FROM payment_allocations pa
         JOIN rent_payments rp ON rp.id = pa.payment_id
        WHERE pa.lease_id = ? AND pa.month = ? AND pa.year = ?
          AND pa.type = 'rent' AND rp.status = 'paid'`
    ).bind(activeLease.id, curMonth, curYear).first<{ total: number }>();

    const legacyRow = await db.prepare(
      `SELECT COALESCE(SUM(rp.amount), 0) AS total
         FROM rent_payments rp
        WHERE rp.lease_id = ? AND rp.month = ? AND rp.year = ?
          AND rp.status = 'paid'
          AND (rp.type IS NULL OR rp.type != 'credit')
          AND NOT EXISTS (SELECT 1 FROM payment_allocations pa WHERE pa.payment_id = rp.id)`
    ).bind(activeLease.id, curMonth, curYear).first<{ total: number }>();

    const paid = round2((allocRow?.total || 0) + (legacyRow?.total || 0));
    currentBalance = {
      month: curMonth,
      year: curYear,
      due: rent,
      paid,
      owed: round2(Math.max(0, rent - paid)),
    };
  }

  // Recent maintenance
  const { results: maintenance } = await db.prepare(
    `SELECT id, title, status, priority, category, created_at
       FROM maintenance_requests
      WHERE tenant_id = ?
      ORDER BY created_at DESC
      LIMIT 5`
  ).bind(tenantId).all();

  return JSON.stringify({
    tenant: {
      id: tenant.id,
      name: `${tenant.first_name} ${tenant.last_name}`,
      email: tenant.email || null,
      phone: tenant.phone || null,
      notes: tenant.notes || null,
      emergencyContact: tenant.emergency_contact_name
        ? { name: tenant.emergency_contact_name, phone: tenant.emergency_contact_phone }
        : null,
      memberSince: tenant.created_at,
    },
    lease: activeLease
      ? {
          id: activeLease.id,
          property: activeLease.property_name,
          propertyAddress: activeLease.property_address,
          unit: activeLease.unit_number,
          monthlyRent: activeLease.monthly_rent,
          securityDeposit: activeLease.security_deposit,
          startDate: activeLease.start_date,
          endDate: activeLease.end_date,
          status: activeLease.status,
          leaseType: activeLease.lease_type || 'fixed',
          renewalStatus: activeLease.renewal_status,
        }
      : null,
    previousLeases: (leaseRows || [])
      .filter(l => l.status === 'ended')
      .slice(0, 3)
      .map(l => ({
        id: l.id,
        property: l.property_name,
        unit: l.unit_number,
        monthlyRent: l.monthly_rent,
        startDate: l.start_date,
        endDate: l.end_date,
      })),
    currentBalance,
    recentPayments: (payments || []).map(p => ({
      id: p.id,
      amount: p.amount,
      dueDate: p.due_date,
      paidDate: p.paid_date,
      status: p.status,
      method: p.payment_method,
      month: p.month,
      year: p.year,
      type: p.type || 'rent',
    })),
    paymentAllocations: allocations.length > 0
      ? allocations.map(a => ({
          paymentId: a.payment_id,
          leaseId: a.lease_id,
          month: a.month,
          year: a.year,
          amount: a.amount,
          type: a.type,
        }))
      : undefined,
    maintenanceRequests: (maintenance || []).map(m => ({
      id: m.id,
      title: m.title,
      status: m.status,
      priority: m.priority,
      category: m.category,
      createdAt: m.created_at,
    })),
  });
}

async function searchProperties(db: D1Database, input: ToolInput): Promise<string> {
  const q = `%${String(input.query || '')}%`;
  const { results } = await db.prepare(
    `SELECT id, name, address, city, state, type FROM properties
      WHERE name LIKE ?1 OR address LIKE ?1 OR city LIKE ?1
      LIMIT 10`
  ).bind(q).all();

  if (!results || results.length === 0) {
    return JSON.stringify({ message: 'No properties found matching that search.', results: [] });
  }
  return JSON.stringify({
    message: `Found ${results.length} property/properties.`,
    results: results.map(r => ({
      id: r.id,
      name: r.name,
      address: `${r.address}, ${r.city}, ${r.state}`,
      type: r.type,
    })),
  });
}

async function getPropertySummary(db: D1Database, input: ToolInput): Promise<string> {
  const propertyId = String(input.propertyId);

  const prop = await db.prepare(
    'SELECT id, name, address, city, state, zip_code, type, purchase_date, purchase_price FROM properties WHERE id = ?'
  ).bind(propertyId).first();
  if (!prop) return JSON.stringify({ error: 'Property not found.' });

  // Units with lease info
  const { results: units } = await db.prepare(
    `SELECT u.id, u.unit_number, u.bedrooms, u.bathrooms, u.square_feet, u.monthly_rent, u.status,
            l.id AS lease_id, l.monthly_rent AS lease_rent, l.status AS lease_status,
            GROUP_CONCAT(t.first_name || ' ' || t.last_name, ', ') AS tenant_names
       FROM units u
       LEFT JOIN leases l ON l.unit_id = u.id AND l.status IN ('active', 'paused')
       LEFT JOIN lease_tenants lt ON lt.lease_id = l.id
       LEFT JOIN tenants t ON t.id = lt.tenant_id
      WHERE u.property_id = ?
      GROUP BY u.id
      ORDER BY u.unit_number`
  ).bind(propertyId).all();

  const totalUnits = (units || []).length;
  const occupied = (units || []).filter(u => u.lease_status === 'active' || u.lease_status === 'paused').length;

  // Expected rent = sum of active lease monthly_rent (not payment records)
  const expectedRow = await db.prepare(
    `SELECT COALESCE(SUM(l.monthly_rent), 0) AS total
       FROM leases l
      WHERE l.property_id = ? AND l.status IN ('active', 'paused')
        AND l.needs_review = 0
        AND (l.renewal_status IS NULL OR l.renewal_status = 'approved')`
  ).bind(propertyId).first<{ total: number }>();
  const rentExpected = expectedRow?.total || 0;

  // This month's rent collection (allocation-aware)
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();

  const collectRow = await db.prepare(
    `SELECT COALESCE(SUM(pa.amount), 0) AS alloc_total
       FROM payment_allocations pa
       JOIN rent_payments rp ON rp.id = pa.payment_id
       JOIN leases l ON l.id = pa.lease_id
      WHERE l.property_id = ? AND pa.month = ? AND pa.year = ?
        AND pa.type = 'rent' AND rp.status = 'paid'`
  ).bind(propertyId, month, year).first<{ alloc_total: number }>();

  const legacyCollectRow = await db.prepare(
    `SELECT COALESCE(SUM(rp.amount), 0) AS legacy_total
       FROM rent_payments rp
       JOIN leases l ON l.id = rp.lease_id
      WHERE l.property_id = ? AND rp.month = ? AND rp.year = ?
        AND rp.status = 'paid'
        AND (rp.type IS NULL OR rp.type != 'credit')
        AND NOT EXISTS (SELECT 1 FROM payment_allocations pa WHERE pa.payment_id = rp.id)`
  ).bind(propertyId, month, year).first<{ legacy_total: number }>();

  const rentCollected = round2((collectRow?.alloc_total || 0) + (legacyCollectRow?.legacy_total || 0));

  // Recent expenses (last 10)
  const { results: expenses } = await db.prepare(
    `SELECT category, amount, date, description, vendor
       FROM expenses WHERE property_id = ?
      ORDER BY date DESC LIMIT 10`
  ).bind(propertyId).all();

  return JSON.stringify({
    property: {
      id: prop.id,
      name: prop.name,
      address: `${prop.address}, ${prop.city}, ${prop.state} ${prop.zip_code}`,
      type: prop.type,
      purchaseDate: prop.purchase_date,
      purchasePrice: prop.purchase_price,
    },
    occupancy: {
      totalUnits,
      occupied,
      vacant: totalUnits - occupied,
      rate: totalUnits > 0 ? `${Math.round((occupied / totalUnits) * 100)}%` : 'N/A',
    },
    units: (units || []).map(u => ({
      unitNumber: u.unit_number,
      bedrooms: u.bedrooms,
      bathrooms: u.bathrooms,
      sqFt: u.square_feet,
      listRent: u.monthly_rent,
      leaseRent: u.lease_rent,
      status: u.lease_status || 'vacant',
      tenants: u.tenant_names || null,
    })),
    currentMonthRent: {
      month,
      year,
      collected: rentCollected,
      expected: rentExpected,
      collectionRate: rentExpected > 0 ? `${Math.round((rentCollected / rentExpected) * 100)}%` : 'N/A',
    },
    recentExpenses: (expenses || []).map(e => ({
      category: e.category,
      amount: e.amount,
      date: e.date,
      description: e.description,
      vendor: e.vendor,
    })),
  });
}

async function getRentStatus(db: D1Database, input: ToolInput): Promise<string> {
  const now = new Date();
  const month = typeof input.month === 'number' ? input.month : now.getMonth() + 1;
  const year = typeof input.year === 'number' ? input.year : now.getFullYear();
  const target = ymOrdinal(year, month);

  if (target < RENT_TRACKING_START) {
    return JSON.stringify({
      period: { month, year },
      note: 'Rent tracking started in January 2026. No data is available before that.',
      summary: { totalLeases: 0, paid: 0, partial: 0, unpaid: 0, totalExpected: 0, totalCollected: 0, totalOwed: 0 },
      tenants: [],
    });
  }

  const monthPadded = String(month).padStart(2, '0');
  const monthStart = `${year}-${monthPadded}-01`;

  // Step 1: find ALL leases whose date range covers this month (including ended)
  const propFilter = input.propertyId ? 'AND l.property_id = ?' : '';
  const leaseBinds: unknown[] = [monthStart, monthStart];
  if (input.propertyId) leaseBinds.push(String(input.propertyId));

  const { results: rawLeases } = await db.prepare(
    `SELECT l.id AS lease_id, l.monthly_rent, l.start_date, l.end_date,
            l.status, l.needs_review, l.renewal_status, l.renewed_from_lease_id,
            p.name AS property_name, u.unit_number,
            GROUP_CONCAT(t.first_name || ' ' || t.last_name, ', ') AS tenant_names
       FROM leases l
       LEFT JOIN units u ON u.id = l.unit_id
       LEFT JOIN properties p ON p.id = l.property_id
       LEFT JOIN lease_tenants lt ON lt.lease_id = l.id
       LEFT JOIN tenants t ON t.id = lt.tenant_id
      WHERE l.start_date <= ?
        AND (l.end_date IS NULL OR l.end_date >= ?)
        ${propFilter}
      GROUP BY l.id
      ORDER BY p.name, u.unit_number`
  ).bind(...leaseBinds).all();

  const leases = (rawLeases || []) as unknown as LeaseRow[];

  // Step 2: get pause intervals for all candidate leases
  const leaseIds = leases.map(l => l.lease_id);
  let pausesByLease = new Map<string, PauseRow[]>();
  if (leaseIds.length > 0) {
    const ph = leaseIds.map(() => '?').join(',');
    const { results: pauseRows } = await db.prepare(
      `SELECT lease_id, paused_at, resumed_at FROM lease_pauses WHERE lease_id IN (${ph})`
    ).bind(...leaseIds).all();
    for (const p of (pauseRows || []) as unknown as PauseRow[]) {
      if (!pausesByLease.has(p.lease_id)) pausesByLease.set(p.lease_id, []);
      pausesByLease.get(p.lease_id)!.push(p);
    }
  }

  // Step 3: filter to leases that actually OWE rent this month
  let owingLeases = leases.filter(l =>
    leaseOwesMonth(l, pausesByLease.get(l.lease_id) || [], month, year)
  );

  // Renewal overlap de-duplication: when old + renewal both cover the month,
  // keep only the old lease (same logic as rent.ts leasesOwingMonth)
  if (owingLeases.length > 1) {
    owingLeases = owingLeases.filter(renewal => {
      if (!renewal.renewed_from_lease_id) return true;
      return !owingLeases.some(old => old.lease_id === renewal.renewed_from_lease_id);
    });
  }

  // Step 4: get payment allocations for this month
  const allocBinds: unknown[] = [month, year];
  if (input.propertyId) allocBinds.push(String(input.propertyId));

  const { results: allocRows } = await db.prepare(
    `SELECT pa.lease_id, SUM(pa.amount) AS total
       FROM payment_allocations pa
       JOIN rent_payments rp ON rp.id = pa.payment_id
       ${input.propertyId ? 'JOIN leases l ON l.id = pa.lease_id' : ''}
      WHERE pa.month = ? AND pa.year = ? AND pa.type = 'rent' AND rp.status = 'paid'
        ${input.propertyId ? 'AND l.property_id = ?' : ''}
      GROUP BY pa.lease_id`
  ).bind(...allocBinds).all();

  const allocByLease = new Map<string, { amount: number }[]>();
  for (const r of (allocRows || [])) {
    allocByLease.set(r.lease_id as string, [{ amount: (r.total as number) || 0 }]);
  }

  // Step 5: get legacy payments (those with no allocations) for this month
  const legBinds: unknown[] = [month, year];
  if (input.propertyId) legBinds.push(String(input.propertyId));

  const { results: legacyRows } = await db.prepare(
    `SELECT rp.lease_id, SUM(rp.amount) AS total
       FROM rent_payments rp
       ${input.propertyId ? 'JOIN leases l ON l.id = rp.lease_id' : ''}
      WHERE rp.month = ? AND rp.year = ? AND rp.status = 'paid'
        AND (rp.type IS NULL OR rp.type != 'credit')
        AND NOT EXISTS (SELECT 1 FROM payment_allocations pa WHERE pa.payment_id = rp.id)
        ${input.propertyId ? 'AND l.property_id = ?' : ''}
      GROUP BY rp.lease_id`
  ).bind(...legBinds).all();

  const legacyByLease = new Map<string, { amount: number }[]>();
  for (const r of (legacyRows || [])) {
    legacyByLease.set(r.lease_id as string, [{ amount: (r.total as number) || 0 }]);
  }

  // Step 6: also get the most recent paid payment info per lease for display
  const payBinds: unknown[] = [month, year];
  if (input.propertyId) payBinds.push(String(input.propertyId));

  const { results: payInfoRows } = await db.prepare(
    `SELECT rp.lease_id, rp.paid_date, rp.payment_method
       FROM rent_payments rp
       ${input.propertyId ? 'JOIN leases l ON l.id = rp.lease_id' : ''}
      WHERE rp.month = ? AND rp.year = ? AND rp.status = 'paid'
        AND (rp.type IS NULL OR rp.type != 'credit')
        ${input.propertyId ? 'AND l.property_id = ?' : ''}
      ORDER BY rp.paid_date DESC`
  ).bind(...payBinds).all();

  const payInfoByLease = new Map<string, { paid_date: string; payment_method: string }>();
  for (const r of (payInfoRows || [])) {
    const lid = r.lease_id as string;
    if (!payInfoByLease.has(lid)) {
      payInfoByLease.set(lid, {
        paid_date: r.paid_date as string,
        payment_method: r.payment_method as string,
      });
    }
  }

  // Step 7: build the result rows
  interface LeaseRentRow {
    tenantNames: string;
    property: string | null;
    unit: string | null;
    monthlyRent: number;
    amountPaid: number;
    amountOwed: number;
    status: 'paid' | 'partial' | 'unpaid';
    paidDate: string | null;
    method: string | null;
    leaseStatus: string;
  }

  const rows: LeaseRentRow[] = [];
  let totalExpected = 0;
  let totalCollected = 0;
  let paidCount = 0;
  let partialCount = 0;
  let unpaidCount = 0;

  for (const lease of owingLeases) {
    const rent = lease.monthly_rent || 0;
    totalExpected += rent;

    const paid = computePaidForMonth(lease.lease_id, allocByLease, legacyByLease);
    totalCollected += paid;

    let status: 'paid' | 'partial' | 'unpaid';
    if (paid >= rent - 0.005) {
      status = 'paid';
      paidCount++;
    } else if (paid > 0) {
      status = 'partial';
      partialCount++;
    } else {
      status = 'unpaid';
      unpaidCount++;
    }

    const info = payInfoByLease.get(lease.lease_id);
    rows.push({
      tenantNames: lease.tenant_names || 'Unknown',
      property: lease.property_name || null,
      unit: lease.unit_number || null,
      monthlyRent: rent,
      amountPaid: paid,
      amountOwed: round2(Math.max(0, rent - paid)),
      status,
      paidDate: info?.paid_date || null,
      method: info?.payment_method || null,
      leaseStatus: lease.status,
    });
  }

  const statusOrder = { unpaid: 0, partial: 1, paid: 2 };
  rows.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);

  return JSON.stringify({
    period: { month, year },
    summary: {
      totalLeases: owingLeases.length,
      paid: paidCount,
      partial: partialCount,
      unpaid: unpaidCount,
      totalExpected: round2(totalExpected),
      totalCollected: round2(totalCollected),
      totalOwed: round2(Math.max(0, totalExpected - totalCollected)),
      collectionRate: totalExpected > 0 ? `${Math.round((totalCollected / totalExpected) * 100)}%` : 'N/A',
    },
    tenants: rows,
  });
}

async function getFinancialSummary(db: D1Database, input: ToolInput): Promise<string> {
  const startDate = String(input.startDate);
  const endDate = String(input.endDate);
  const propertyId = input.propertyId ? String(input.propertyId) : null;

  // Expenses
  const expClause = propertyId ? 'AND property_id = ?' : '';
  const expBinds: unknown[] = [startDate, endDate];
  if (propertyId) expBinds.push(propertyId);

  const { results: expenseRows } = await db.prepare(
    `SELECT category, SUM(amount) AS total, COUNT(*) AS count
       FROM expenses
      WHERE date >= ? AND date <= ? ${expClause}
      GROUP BY category
      ORDER BY total DESC`
  ).bind(...expBinds).all();

  const totalExpenses = (expenseRows || []).reduce((s, r) => s + (r.total as number), 0);

  // Rent collected: exclude credits (they settle rent but are not income)
  const rentClause = propertyId ? 'AND l.property_id = ?' : '';
  const rentBinds: unknown[] = [startDate, endDate];
  if (propertyId) rentBinds.push(propertyId);

  const rentRow = await db.prepare(
    `SELECT SUM(rp.amount) AS total, COUNT(*) AS count
       FROM rent_payments rp
       JOIN leases l ON l.id = rp.lease_id
      WHERE rp.status = 'paid' AND rp.paid_date >= ? AND rp.paid_date <= ?
        AND (rp.type IS NULL OR rp.type != 'credit')
        ${rentClause}`
  ).bind(...rentBinds).first();

  const totalRentCollected = (rentRow?.total as number) || 0;
  const rentPaymentCount = (rentRow?.count as number) || 0;

  // Other income
  const incBinds: unknown[] = [startDate, endDate];
  const incClause = propertyId ? 'AND property_id = ?' : '';
  if (propertyId) incBinds.push(propertyId);

  const incRow = await db.prepare(
    `SELECT SUM(amount) AS total, COUNT(*) AS count
       FROM incomes
      WHERE date >= ? AND date <= ? ${incClause}`
  ).bind(...incBinds).first();

  const otherIncome = (incRow?.total as number) || 0;
  const totalIncome = totalRentCollected + otherIncome;

  return JSON.stringify({
    period: { startDate, endDate },
    income: {
      rentCollected: round2(totalRentCollected),
      rentPaymentCount,
      otherIncome: round2(otherIncome),
      totalIncome: round2(totalIncome),
    },
    expenses: {
      totalExpenses: round2(totalExpenses),
      byCategory: (expenseRows || []).map(r => ({
        category: r.category,
        total: r.total,
        count: r.count,
      })),
    },
    netIncome: round2(totalIncome - totalExpenses),
  });
}

async function getMaintenanceRequests(db: D1Database, input: ToolInput): Promise<string> {
  const status = String(input.status || 'open');
  const limit = Math.min(Math.max(Number(input.limit) || 20, 1), 50);

  const clauses: string[] = [];
  const binds: unknown[] = [];

  if (status !== 'all') {
    clauses.push('mr.status = ?');
    binds.push(status);
  }
  if (input.propertyId) {
    clauses.push('mr.property_id = ?');
    binds.push(String(input.propertyId));
  }
  if (input.tenantId) {
    clauses.push('mr.tenant_id = ?');
    binds.push(String(input.tenantId));
  }

  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  binds.push(limit);

  const { results } = await db.prepare(
    `SELECT mr.id, mr.title, mr.description, mr.category, mr.priority, mr.status,
            mr.cost, mr.vendor, mr.reported_date, mr.resolved_date,
            p.name AS property_name, u.unit_number,
            t.first_name || ' ' || t.last_name AS tenant_name
       FROM maintenance_requests mr
       LEFT JOIN properties p ON p.id = mr.property_id
       LEFT JOIN units u ON u.id = mr.unit_id
       LEFT JOIN tenants t ON t.id = mr.tenant_id
      ${where}
      ORDER BY mr.created_at DESC
      LIMIT ?`
  ).bind(...binds).all();

  return JSON.stringify({
    count: (results || []).length,
    requests: (results || []).map(r => ({
      id: r.id,
      title: r.title,
      description: r.description,
      category: r.category,
      priority: r.priority,
      status: r.status,
      cost: r.cost,
      vendor: r.vendor,
      reportedDate: r.reported_date,
      resolvedDate: r.resolved_date,
      property: r.property_name,
      unit: r.unit_number,
      tenant: r.tenant_name,
    })),
  });
}

async function getRecentActivity(db: D1Database, input: ToolInput): Promise<string> {
  const limit = Math.min(Math.max(Number(input.limit) || 15, 1), 50);

  const clauses: string[] = [];
  const binds: unknown[] = [];
  if (input.module) {
    clauses.push('module = ?');
    binds.push(String(input.module));
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '';
  binds.push(limit);

  const { results } = await db.prepare(
    `SELECT action, module, description, user_name, target_name, created_at
       FROM activity_log
      ${where}
      ORDER BY created_at DESC
      LIMIT ?`
  ).bind(...binds).all();

  return JSON.stringify({
    count: (results || []).length,
    entries: (results || []).map(r => ({
      action: r.action,
      module: r.module,
      description: r.description,
      userName: r.user_name,
      targetName: r.target_name,
      createdAt: r.created_at,
    })),
  });
}

async function getLeaseDetails(db: D1Database, input: ToolInput): Promise<string> {
  const leaseId = String(input.leaseId);

  const lease = await db.prepare(
    `SELECT l.id, l.start_date, l.end_date, l.monthly_rent, l.security_deposit,
            l.status, l.lease_type, l.renewal_status, l.renewed_from_lease_id,
            l.needs_review, l.rent_due_day,
            p.name AS property_name, p.address AS property_address,
            u.unit_number
       FROM leases l
       LEFT JOIN properties p ON p.id = l.property_id
       LEFT JOIN units u ON u.id = l.unit_id
      WHERE l.id = ?`
  ).bind(leaseId).first();
  if (!lease) return JSON.stringify({ error: 'Lease not found.' });

  // Tenants on this lease
  const { results: tenantRows } = await db.prepare(
    `SELECT t.id, t.first_name, t.last_name
       FROM tenants t
       JOIN lease_tenants lt ON lt.tenant_id = t.id
      WHERE lt.lease_id = ?`
  ).bind(leaseId).all();

  // Pause intervals
  const { results: pauses } = await db.prepare(
    `SELECT paused_at, resumed_at FROM lease_pauses WHERE lease_id = ? ORDER BY paused_at`
  ).bind(leaseId).all();

  // Recent payments
  const { results: payments } = await db.prepare(
    `SELECT rp.id, rp.amount, rp.month, rp.year, rp.status, rp.paid_date,
            rp.payment_method, rp.type
       FROM rent_payments rp
      WHERE rp.lease_id = ?
      ORDER BY rp.year DESC, rp.month DESC
      LIMIT 12`
  ).bind(leaseId).all();

  // Allocations for those payments
  const paymentIds = (payments || []).map(p => p.id as string);
  let allocations: Record<string, unknown>[] = [];
  if (paymentIds.length > 0) {
    const ph = paymentIds.map(() => '?').join(',');
    const { results: allocRows } = await db.prepare(
      `SELECT payment_id, month, year, amount, type
         FROM payment_allocations
        WHERE payment_id IN (${ph})`
    ).bind(...paymentIds).all();
    allocations = allocRows || [];
  }

  return JSON.stringify({
    lease: {
      id: lease.id,
      property: lease.property_name,
      propertyAddress: lease.property_address,
      unit: lease.unit_number,
      monthlyRent: lease.monthly_rent,
      securityDeposit: lease.security_deposit,
      startDate: lease.start_date,
      endDate: lease.end_date,
      status: lease.status,
      leaseType: lease.lease_type || 'fixed',
      renewalStatus: lease.renewal_status,
      renewedFromLeaseId: lease.renewed_from_lease_id,
      needsReview: lease.needs_review,
      rentDueDay: lease.rent_due_day,
    },
    tenants: (tenantRows || []).map(t => ({
      id: t.id,
      name: `${t.first_name} ${t.last_name}`,
    })),
    pauseIntervals: (pauses || []).map(p => ({
      pausedAt: p.paused_at,
      resumedAt: p.resumed_at,
    })),
    recentPayments: (payments || []).map(p => ({
      id: p.id,
      amount: p.amount,
      month: p.month,
      year: p.year,
      status: p.status,
      paidDate: p.paid_date,
      method: p.payment_method,
      type: p.type || 'rent',
    })),
    paymentAllocations: allocations.length > 0
      ? allocations.map(a => ({
          paymentId: a.payment_id,
          month: a.month,
          year: a.year,
          amount: a.amount,
          type: a.type,
        }))
      : undefined,
  });
}
