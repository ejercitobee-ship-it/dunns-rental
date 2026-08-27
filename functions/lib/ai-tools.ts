/**
 * AI Assistant tool definitions and executors.
 *
 * Each tool is a function Claude can call to query the D1 database.
 * The tool definitions follow the Anthropic tool-use schema and the
 * executors return structured JSON that Claude reasons over.
 */
import type { D1Database } from '@cloudflare/workers-types';

// ---------------------------------------------------------------------------
// Tool definitions (sent to the Claude API)
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
      'Get a complete profile for a specific tenant including their lease, payment history, and maintenance requests. Use the tenant ID from searchTenants.',
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
      'Get rent collection status for a given month. Shows who has paid, who owes, and totals. Defaults to the current month if no month/year is specified.',
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
          enum: ['open', 'in_progress', 'resolved', 'cancelled', 'all'],
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
      default:
        return JSON.stringify({ error: `Unknown tool: ${toolName}` });
    }
  } catch (err) {
    console.error(`AI tool ${toolName} failed:`, err);
    return JSON.stringify({ error: `Tool execution failed: ${(err as Error).message}` });
  }
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

  // Basic info
  const tenant = await db.prepare(
    'SELECT id, first_name, last_name, email, phone, notes, emergency_contact_name, emergency_contact_phone, created_at FROM tenants WHERE id = ?'
  ).bind(tenantId).first();
  if (!tenant) return JSON.stringify({ error: 'Tenant not found.' });

  // Active lease
  const lease = await db.prepare(
    `SELECT l.id, l.start_date, l.end_date, l.monthly_rent, l.security_deposit, l.status,
            p.id AS property_id, p.name AS property_name, p.address AS property_address,
            u.unit_number
       FROM leases l
       JOIN lease_tenants lt ON lt.lease_id = l.id
       LEFT JOIN properties p ON p.id = l.property_id
       LEFT JOIN units u ON u.id = l.unit_id
      WHERE lt.tenant_id = ? AND l.status IN ('active', 'paused')
      LIMIT 1`
  ).bind(tenantId).first();

  // Recent payments (last 12)
  const { results: payments } = await db.prepare(
    `SELECT rp.amount, rp.due_date, rp.paid_date, rp.status, rp.payment_method, rp.month, rp.year
       FROM rent_payments rp
       JOIN leases l ON l.id = rp.lease_id
       JOIN lease_tenants lt ON lt.lease_id = l.id
      WHERE lt.tenant_id = ?
      ORDER BY rp.year DESC, rp.month DESC, rp.due_date DESC
      LIMIT 12`
  ).bind(tenantId).all();

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
    lease: lease
      ? {
          id: lease.id,
          property: lease.property_name,
          propertyAddress: lease.property_address,
          unit: lease.unit_number,
          monthlyRent: lease.monthly_rent,
          securityDeposit: lease.security_deposit,
          startDate: lease.start_date,
          endDate: lease.end_date,
          status: lease.status,
        }
      : null,
    recentPayments: (payments || []).map(p => ({
      amount: p.amount,
      dueDate: p.due_date,
      paidDate: p.paid_date,
      status: p.status,
      method: p.payment_method,
      month: p.month,
      year: p.year,
    })),
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

  // Property info
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

  // Recent expenses (last 10)
  const { results: expenses } = await db.prepare(
    `SELECT category, amount, date, description, vendor
       FROM expenses WHERE property_id = ?
      ORDER BY date DESC LIMIT 10`
  ).bind(propertyId).all();

  // This month's rent collection
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const { results: rentPayments } = await db.prepare(
    `SELECT rp.status, rp.amount
       FROM rent_payments rp
       JOIN leases l ON l.id = rp.lease_id
      WHERE l.property_id = ? AND rp.month = ? AND rp.year = ?`
  ).bind(propertyId, month, year).all();

  const rentCollected = (rentPayments || [])
    .filter(r => r.status === 'paid')
    .reduce((sum, r) => sum + (r.amount as number), 0);
  const rentExpected = (rentPayments || [])
    .reduce((sum, r) => sum + (r.amount as number), 0);

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

  // Build a date string for the target month to check lease validity.
  const monthPadded = String(month).padStart(2, '0');
  const monthStart = `${year}-${monthPadded}-01`;

  // Step 1: find all active leases that should owe rent for this month.
  const propFilter = input.propertyId ? 'AND l.property_id = ?' : '';
  const leaseBinds: unknown[] = [monthStart, monthStart];
  if (input.propertyId) leaseBinds.push(String(input.propertyId));

  const { results: leases } = await db.prepare(
    `SELECT l.id AS lease_id, l.monthly_rent, l.start_date, l.end_date,
            p.name AS property_name, u.unit_number,
            GROUP_CONCAT(t.first_name || ' ' || t.last_name, ', ') AS tenant_names
       FROM leases l
       LEFT JOIN units u ON u.id = l.unit_id
       LEFT JOIN properties p ON p.id = l.property_id
       LEFT JOIN lease_tenants lt ON lt.lease_id = l.id
       LEFT JOIN tenants t ON t.id = lt.tenant_id
      WHERE l.status IN ('active', 'paused')
        AND l.start_date <= ?
        AND (l.end_date IS NULL OR l.end_date >= ?)
        AND l.needs_review = 0
        ${propFilter}
      GROUP BY l.id
      ORDER BY p.name, u.unit_number`
  ).bind(...leaseBinds).all();

  // Step 2: get all payments for this month.
  const payBinds: unknown[] = [month, year];
  if (input.propertyId) payBinds.push(String(input.propertyId));

  const { results: payments } = await db.prepare(
    `SELECT rp.lease_id, rp.amount, rp.status, rp.paid_date, rp.payment_method, rp.type
       FROM rent_payments rp
       JOIN leases l ON l.id = rp.lease_id
      WHERE rp.month = ? AND rp.year = ?
        ${input.propertyId ? 'AND l.property_id = ?' : ''}
      ORDER BY rp.lease_id`
  ).bind(...payBinds).all();

  // Step 3: match payments to leases.
  const paymentsByLease = new Map<string, typeof payments>();
  for (const p of (payments || [])) {
    const lid = p.lease_id as string;
    if (!paymentsByLease.has(lid)) paymentsByLease.set(lid, []);
    paymentsByLease.get(lid)!.push(p);
  }

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
  }

  const rows: LeaseRentRow[] = [];
  let totalExpected = 0;
  let totalCollected = 0;
  let paidCount = 0;
  let partialCount = 0;
  let unpaidCount = 0;

  for (const lease of (leases || [])) {
    const rent = (lease.monthly_rent as number) || 0;
    totalExpected += rent;

    const lPayments = paymentsByLease.get(lease.lease_id as string) || [];
    const cashPayments = lPayments.filter(p => (p.type as string) !== 'credit');
    const paid = cashPayments
      .filter(p => p.status === 'paid')
      .reduce((s, p) => s + ((p.amount as number) || 0), 0);
    totalCollected += paid;

    let status: 'paid' | 'partial' | 'unpaid';
    if (paid >= rent) {
      status = 'paid';
      paidCount++;
    } else if (paid > 0) {
      status = 'partial';
      partialCount++;
    } else {
      status = 'unpaid';
      unpaidCount++;
    }

    const lastPaid = cashPayments.find(p => p.status === 'paid');
    rows.push({
      tenantNames: (lease.tenant_names as string) || 'Unknown',
      property: (lease.property_name as string) || null,
      unit: (lease.unit_number as string) || null,
      monthlyRent: rent,
      amountPaid: paid,
      amountOwed: Math.max(0, rent - paid),
      status,
      paidDate: (lastPaid?.paid_date as string) || null,
      method: (lastPaid?.payment_method as string) || null,
    });
  }

  // Sort: unpaid first, then partial, then paid.
  const statusOrder = { unpaid: 0, partial: 1, paid: 2 };
  rows.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);

  return JSON.stringify({
    period: { month, year },
    summary: {
      totalLeases: (leases || []).length,
      paid: paidCount,
      partial: partialCount,
      unpaid: unpaidCount,
      totalExpected,
      totalCollected,
      totalOwed: totalExpected - totalCollected,
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

  // Rent collected (paid payments in the date range)
  const rentClause = propertyId ? 'AND l.property_id = ?' : '';
  const rentBinds: unknown[] = [startDate, endDate];
  if (propertyId) rentBinds.push(propertyId);

  const rentRow = await db.prepare(
    `SELECT SUM(rp.amount) AS total, COUNT(*) AS count
       FROM rent_payments rp
       JOIN leases l ON l.id = rp.lease_id
      WHERE rp.status = 'paid' AND rp.paid_date >= ? AND rp.paid_date <= ? ${rentClause}`
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
      rentCollected: totalRentCollected,
      rentPaymentCount,
      otherIncome,
      totalIncome,
    },
    expenses: {
      totalExpenses,
      byCategory: (expenseRows || []).map(r => ({
        category: r.category,
        total: r.total,
        count: r.count,
      })),
    },
    netIncome: totalIncome - totalExpenses,
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
