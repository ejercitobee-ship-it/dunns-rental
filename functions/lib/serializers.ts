// Convert D1 rows (snake_case columns) into the camelCase shapes the React app
// expects. Used by both list and single-record endpoints so the two never
// drift apart.

type Row = Record<string, unknown>;

export function serializeProperty(r: Row) {
  return {
    id: r.id,
    name: r.name,
    address: r.address,
    city: r.city,
    state: r.state,
    zipCode: r.zip_code,
    type: r.type,
    description: r.description ?? undefined,
    purchaseDate: r.purchase_date ?? undefined,
    purchasePrice: r.purchase_price ?? undefined,
  };
}

export function serializeUnit(r: Row) {
  return {
    id: r.id,
    propertyId: r.property_id,
    unitNumber: r.unit_number,
    bedrooms: r.bedrooms,
    bathrooms: r.bathrooms,
    squareFeet: r.square_feet,
    monthlyRent: r.monthly_rent,
    status: r.status,
    description: r.description ?? undefined,
  };
}

export function serializeTenant(r: Row) {
  const hasEmergency =
    r.emergency_contact_name || r.emergency_contact_phone || r.emergency_contact_relationship;
  return {
    id: r.id,
    firstName: r.first_name,
    lastName: r.last_name,
    email: r.email ?? undefined,
    phone: r.phone ?? undefined,
    notes: r.notes ?? undefined,
    emergencyContact: hasEmergency
      ? {
          name: r.emergency_contact_name ?? '',
          phone: r.emergency_contact_phone ?? '',
          relationship: r.emergency_contact_relationship ?? '',
        }
      : undefined,
  };
}

export function serializeLease(r: Row) {
  return {
    id: r.id,
    unitId: r.unit_id ?? undefined,
    propertyId: r.property_id ?? undefined,
    startDate: r.start_date ?? undefined,
    endDate: r.end_date ?? undefined,
    monthlyRent: r.monthly_rent ?? 0,
    securityDeposit: r.security_deposit ?? 0,
    status: r.status ?? 'active',
    notes: r.notes ?? undefined,
    // Filled in by the leases endpoints, which join lease_tenants.
    tenantIds: (r.tenantIds as string[]) ?? [],
  };
}

export function serializePayment(r: Row) {
  return {
    id: r.id,
    leaseId: r.lease_id ?? undefined,
    paidByTenantId: r.paid_by_tenant_id ?? undefined,
    amount: r.amount,
    dueDate: r.due_date,
    paidDate: r.paid_date ?? undefined,
    receivedDate: r.received_date ?? undefined,
    status: r.status,
    month: r.month,
    year: r.year,
    notes: r.notes ?? undefined,
    paymentMethod: r.payment_method ?? undefined,
    uploadedBy: r.uploaded_by ?? undefined,
    uploadedAt: r.uploaded_at ?? undefined,
  };
}

export function serializeExpense(r: Row) {
  return {
    id: r.id,
    propertyId: r.property_id,
    unitId: r.unit_id ?? undefined,
    category: r.category,
    amount: r.amount,
    date: r.date,
    description: r.description,
    vendor: r.vendor ?? undefined,
    isRecurring: !!r.is_recurring,
    recurringFrequency: r.recurring_frequency ?? undefined,
  };
}

export function serializeMaintenance(r: Row) {
  return {
    id: r.id,
    propertyId: r.property_id ?? undefined,
    unitId: r.unit_id ?? undefined,
    tenantId: r.tenant_id ?? undefined,
    title: r.title,
    description: r.description ?? undefined,
    category: r.category ?? undefined,
    priority: r.priority ?? 'medium',
    status: r.status ?? 'open',
    cost: r.cost ?? 0,
    vendor: r.vendor ?? undefined,
    reportedDate: r.reported_date ?? undefined,
    resolvedDate: r.resolved_date ?? undefined,
    notes: r.notes ?? undefined,
  };
}

export function serializeIncome(r: Row) {
  return {
    id: r.id,
    propertyId: r.property_id,
    unitId: r.unit_id ?? undefined,
    source: r.source,
    amount: r.amount,
    date: r.date,
    description: r.description,
    relatedPaymentId: r.related_payment_id ?? undefined,
  };
}
