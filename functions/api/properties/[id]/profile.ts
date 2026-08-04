import type { PagesFunction } from '@cloudflare/workers-types';
import { type Env, requirePermission, jsonOk, jsonError, serverError } from '../../../lib/session';

/**
 * GET /api/properties/:id/profile — comprehensive property profile data.
 * Returns property overview, units, financial summary, tenant history,
 * maintenance history, documents, and recent activity. Assembled in one
 * round-trip so the frontend can render everything without multiple fetches.
 */
export const onRequestGet: PagesFunction<Env> = async (context) => {
  const { env, request, params } = context;
  const auth = await requirePermission(env, request, 'properties_view');
  if (auth instanceof Response) return auth;

  try {
    const propertyId = params.id as string;

    // Property basics
    const property = await env.DB.prepare(
      'SELECT * FROM properties WHERE id = ?'
    ).bind(propertyId).first();
    if (!property) return jsonError('Property not found', 404);

    // Units
    const units = await env.DB.prepare(
      'SELECT * FROM units WHERE property_id = ? ORDER BY unit_number'
    ).bind(propertyId).all();

    // All leases for this property (current and historical)
    const leases = await env.DB.prepare(
      `SELECT l.*, u.unit_number,
              GROUP_CONCAT(DISTINCT t.first_name || ' ' || t.last_name) AS tenant_names,
              GROUP_CONCAT(DISTINCT t.id) AS tenant_id_list
       FROM leases l
       LEFT JOIN units u ON u.id = l.unit_id
       LEFT JOIN lease_tenants lt ON lt.lease_id = l.id
       LEFT JOIN tenants t ON t.id = lt.tenant_id
       WHERE l.property_id = ?
       GROUP BY l.id
       ORDER BY l.start_date DESC`
    ).bind(propertyId).all();

    // Rent payments for this property
    const rentPayments = await env.DB.prepare(
      `SELECT rp.*, l.unit_id, u.unit_number
       FROM rent_payments rp
       JOIN leases l ON l.id = rp.lease_id
       LEFT JOIN units u ON u.id = l.unit_id
       WHERE l.property_id = ?
       ORDER BY rp.year DESC, rp.month DESC`
    ).bind(propertyId).all();

    // Expenses for this property
    const expenses = await env.DB.prepare(
      `SELECT * FROM expenses WHERE property_id = ? ORDER BY date DESC LIMIT 200`
    ).bind(propertyId).all();

    // Income for this property
    const incomes = await env.DB.prepare(
      `SELECT * FROM incomes WHERE property_id = ? ORDER BY date DESC LIMIT 200`
    ).bind(propertyId).all();

    // Maintenance requests for this property
    const maintenance = await env.DB.prepare(
      `SELECT mr.*, u.unit_number,
              t.first_name || ' ' || t.last_name AS tenant_name,
              h.first_name || ' ' || h.last_name AS handyman_name
       FROM maintenance_requests mr
       LEFT JOIN units u ON u.id = mr.unit_id
       LEFT JOIN tenants t ON t.id = mr.tenant_id
       LEFT JOIN handymen h ON h.id = mr.handyman_id
       WHERE mr.property_id = ?
       ORDER BY mr.created_at DESC`
    ).bind(propertyId).all();

    // Documents linked to this property
    const documents = await env.DB.prepare(
      `SELECT * FROM documents WHERE property_id = ? ORDER BY created_at DESC`
    ).bind(propertyId).all();

    // Utility accounts for this property
    const utilityAccounts = await env.DB.prepare(
      `SELECT * FROM utility_accounts WHERE property_id = ? ORDER BY utility_type`
    ).bind(propertyId).all();

    // Recent audit log entries for leases on this property
    const auditLog = await env.DB.prepare(
      `SELECT la.* FROM lease_audit_log la
       JOIN leases l ON l.id = la.lease_id
       WHERE l.property_id = ?
       ORDER BY la.created_at DESC
       LIMIT 50`
    ).bind(propertyId).all();

    // Calendar events for this property
    const calendarEvents = await env.DB.prepare(
      `SELECT ce.* FROM calendar_events ce
       JOIN calendar_event_properties cep ON cep.event_id = ce.id
       WHERE cep.property_id = ?
       ORDER BY ce.start_date DESC
       LIMIT 50`
    ).bind(propertyId).all();

    // Build financial summary per year
    const financialYears: Record<string, { income: number; expenses: number; net: number }> = {};

    for (const row of (rentPayments.results || [])) {
      if (row.status !== 'paid') continue;
      const yr = String(row.year);
      if (!financialYears[yr]) financialYears[yr] = { income: 0, expenses: 0, net: 0 };
      financialYears[yr].income += Number(row.amount) || 0;
    }
    for (const row of (incomes.results || [])) {
      const yr = String(row.date).slice(0, 4);
      if (!yr) continue;
      if (!financialYears[yr]) financialYears[yr] = { income: 0, expenses: 0, net: 0 };
      financialYears[yr].income += Number(row.amount) || 0;
    }
    for (const row of (expenses.results || [])) {
      const yr = String(row.date).slice(0, 4);
      if (!yr) continue;
      if (!financialYears[yr]) financialYears[yr] = { income: 0, expenses: 0, net: 0 };
      financialYears[yr].expenses += Number(row.amount) || 0;
    }
    for (const yr of Object.keys(financialYears)) {
      financialYears[yr].net = Math.round((financialYears[yr].income - financialYears[yr].expenses) * 100) / 100;
      financialYears[yr].income = Math.round(financialYears[yr].income * 100) / 100;
      financialYears[yr].expenses = Math.round(financialYears[yr].expenses * 100) / 100;
    }

    return jsonOk({
      success: true,
      data: {
        property: {
          id: property.id,
          name: property.name,
          address: property.address,
          city: property.city,
          state: property.state,
          zipCode: property.zip_code,
          type: property.type,
          description: property.description,
          purchaseDate: property.purchase_date,
          purchasePrice: property.purchase_price,
          landValue: property.land_value,
          createdAt: property.created_at,
        },
        units: (units.results || []).map(u => ({
          id: u.id,
          unitNumber: u.unit_number,
          bedrooms: u.bedrooms,
          bathrooms: u.bathrooms,
          squareFeet: u.square_feet,
          monthlyRent: u.monthly_rent,
        })),
        leases: (leases.results || []).map(l => ({
          id: l.id,
          unitId: l.unit_id,
          unitNumber: l.unit_number,
          status: l.status,
          startDate: l.start_date,
          endDate: l.end_date,
          monthlyRent: l.monthly_rent,
          tenantNames: l.tenant_names,
          tenantIds: l.tenant_id_list ? String(l.tenant_id_list).split(',') : [],
          endReason: l.end_reason,
          renewalStatus: l.renewal_status ?? 'approved',
          moveInFeePaid: !!l.move_in_fee_paid,
          securityDeposit: l.security_deposit,
        })),
        rentPayments: (rentPayments.results || []).map(rp => ({
          id: rp.id,
          leaseId: rp.lease_id,
          unitNumber: rp.unit_number,
          month: rp.month,
          year: rp.year,
          amount: rp.amount,
          status: rp.status,
          paidDate: rp.paid_date,
          paymentMethod: rp.payment_method,
        })),
        expenses: (expenses.results || []).map(e => ({
          id: e.id,
          category: e.category,
          amount: e.amount,
          date: e.date,
          description: e.description,
          vendor: e.vendor,
          unitId: e.unit_id,
        })),
        incomes: (incomes.results || []).map(i => ({
          id: i.id,
          source: i.source,
          amount: i.amount,
          date: i.date,
          description: i.description,
        })),
        maintenance: (maintenance.results || []).map(m => ({
          id: m.id,
          title: m.title,
          description: m.description,
          status: m.status,
          priority: m.priority,
          unitNumber: m.unit_number,
          tenantName: m.tenant_name,
          handymanName: m.handyman_name,
          createdAt: m.created_at,
          completedAt: m.completed_at,
          estimatedCost: m.estimated_cost,
          actualCost: m.actual_cost,
        })),
        documents: (documents.results || []).map(d => ({
          id: d.id,
          name: d.name,
          contentType: d.content_type,
          size: d.size,
          createdAt: d.created_at,
          driveFileId: d.drive_file_id,
        })),
        utilityAccounts: (utilityAccounts.results || []).map(ua => ({
          id: ua.id,
          utilityType: ua.utility_type,
          provider: ua.provider,
          accountNumber: ua.account_number,
          notes: ua.notes,
        })),
        financialSummary: financialYears,
        auditLog: (auditLog.results || []).map(a => ({
          id: a.id,
          leaseId: a.lease_id,
          action: a.action,
          changedByName: a.changed_by_name,
          previousData: a.previous_data ? JSON.parse(String(a.previous_data)) : null,
          newData: a.new_data ? JSON.parse(String(a.new_data)) : null,
          notes: a.notes,
          createdAt: a.created_at,
        })),
        calendarEvents: (calendarEvents.results || []).map(ce => ({
          id: ce.id,
          title: ce.title,
          startDate: ce.start_date,
          endDate: ce.end_date,
          category: ce.category,
          notes: ce.notes,
        })),
      },
    });
  } catch {
    return serverError();
  }
};
