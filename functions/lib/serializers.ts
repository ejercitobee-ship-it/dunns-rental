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
    landValue: r.land_value ?? undefined,
    driveFolderId: r.drive_folder_id ?? undefined,
  };
}

export function serializeUtilityAccount(r: Row) {
  return {
    id: r.id,
    propertyId: r.property_id,
    unitId: r.unit_id ?? undefined,
    type: r.type,
    provider: r.provider ?? undefined,
    accountNumber: r.account_number ?? undefined,
    loginUrl: r.login_url ?? undefined,
    notes: r.notes ?? undefined,
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
    photoUrl: r.photo_drive_id ? `/api/photo/${r.photo_drive_id}` : null,
    // Whether this tenant already has a portal login (drives Invite vs Resend).
    hasLogin: !!r.user_id,
    // Whether they have actually signed in at least once (the "Verified" badge).
    verified: !!r.last_login_at,
  };
}

export function serializeHouseholdMember(r: Row) {
  return {
    id: r.id,
    leaseId: r.lease_id,
    name: r.name,
    phone: r.phone ?? null,
    relationship: r.relationship ?? null,
    createdAt: r.created_at,
  };
}

/**
 * A tenant as the portal may see them. Identical to serializeTenant minus
 * `notes`, which is Belle's private note about the person and is never shown
 * to the tenant or to a realtor.
 */
export function serializePortalTenant(r: Row) {
  // An ALLOWLIST, deliberately, not `serializeTenant` minus notes. Stripping one
  // field fails open: the day someone adds a field to serializeTenant, it would
  // appear in the portal for tenants and realtors without anyone deciding that.
  // Naming what may be shown means a new field stays private until someone
  // chooses otherwise. `notes` is the owner's private note and is absent here.
  const full = serializeTenant(r) as Record<string, unknown>;
  return {
    id: full.id,
    firstName: full.firstName,
    lastName: full.lastName,
    email: full.email,
    phone: full.phone,
    emergencyContact: full.emergencyContact,
    photoUrl: r.photo_drive_id ? `/api/photo/${r.photo_drive_id}` : null,
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
    // Null (column absent / never set) is treated as paid, matching the DB default.
    moveInFeePaid: r.move_in_fee_paid !== 0,
    moveInFeePaidDate: r.move_in_fee_paid_date ?? undefined,
    moveInFeeMethod: r.move_in_fee_method ?? undefined,
    moveInFeeReceiptDocumentId: r.move_in_fee_receipt_document_id ?? undefined,
    status: r.status ?? 'active',
    needsReview: !!r.needs_review,
    notes: r.notes ?? undefined,
    // Why the tenancy ended (recorded when the office terminates it).
    endReason: r.end_reason ?? undefined,
    // Where they lived, snapshotted at termination so history survives even if
    // the unit is later renamed or deleted.
    endedPropertyLabel: r.ended_property_label ?? undefined,
    endedUnitLabel: r.ended_unit_label ?? undefined,
    // Filled in by the leases endpoints, which join lease_tenants.
    tenantIds: (r.tenantIds as string[]) ?? [],
    // Filled in by the leases endpoints, which join lease_pauses.
    pauses: (r.pauses as { pausedAt: string; resumedAt?: string }[]) ?? [],
    rentDueDay: r.rent_due_day != null ? Number(r.rent_due_day) : undefined,
    renewedFromLeaseId: r.renewed_from_lease_id ?? undefined,
    renewalGeneratedAt: r.renewal_generated_at ?? undefined,
    previousRent: r.previous_rent != null ? Number(r.previous_rent) : undefined,
    renewalStatus: (r.renewal_status as string) ?? 'approved',
  };
}

/**
 * A lease as the portal may see it. An ALLOWLIST, like serializePortalTenant:
 * `notes` is the owner's private note about the tenancy (late history, eviction
 * commentary) and is never shown to the tenant or a realtor. Naming the shown
 * fields means a new column on serializeLease stays private until someone
 * chooses to expose it.
 */
export function serializePortalLease(r: Row) {
  const full = serializeLease(r) as Record<string, unknown>;
  return {
    id: full.id,
    unitId: full.unitId,
    propertyId: full.propertyId,
    startDate: full.startDate,
    endDate: full.endDate,
    monthlyRent: full.monthlyRent,
    securityDeposit: full.securityDeposit,
    status: full.status,
    // The tenant's own pause history, not private: without it the portal would
    // show a month the owner paused as unpaid. The endpoint fills r.pauses in.
    pauses: full.pauses,
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
    receiptDocumentId: r.receipt_document_id ?? undefined,
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
    // Deductible interest portion of a mortgage payment (principal is not).
    interestAmount: r.interest_amount ?? undefined,
    // Receipt image (served from Drive via the photo route), null when none.
    receiptUrl: r.receipt_drive_id ? `/api/photo/${r.receipt_drive_id}` : null,
    capitalProjectId: r.capital_project_id ?? undefined,
    tier: r.tier ?? undefined,
    paymentAccount: r.payment_account ?? undefined,
  };
}

export function serializeCapitalProject(r: Row, totalCost = 0, expenseCount = 0) {
  return {
    id: r.id,
    name: r.name,
    propertyId: r.property_id,
    unitId: r.unit_id ?? undefined,
    description: r.description ?? undefined,
    status: r.status,
    startDate: r.start_date ?? undefined,
    completionDate: r.completion_date ?? undefined,
    budget: r.budget ?? undefined,
    driveFolderId: r.drive_folder_id ?? undefined,
    createdBy: r.created_by ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    totalCost,
    expenseCount,
  };
}

/** Parse a JSON text column into an array, tolerating null and bad data. */
function parseJsonArray<T>(value: unknown): T[] {
  if (typeof value !== 'string' || value.trim() === '') return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? (parsed as T[]) : [];
  } catch {
    return [];
  }
}

export type AvailabilityWindow = { date: string; start: string; end: string };

export function serializeMaintenance(r: Row) {
  return {
    id: r.id,
    propertyId: r.property_id ?? undefined,
    unitId: r.unit_id ?? undefined,
    tenantId: r.tenant_id ?? undefined,
    title: r.title as string,
    description: r.description ?? undefined,
    category: r.category ?? undefined,
    priority: r.priority ?? 'medium',
    status: r.status ?? 'submitted',
    cost: r.cost ?? 0,
    vendor: r.vendor ?? undefined,
    reportedDate: r.reported_date ?? undefined,
    resolvedDate: r.resolved_date ?? undefined,
    notes: r.notes ?? undefined,
    // Maintenance portal fields.
    assignedHandymanId: r.assigned_handyman_id ?? undefined,
    scheduledFor: r.scheduled_for ?? undefined,
    availability: parseJsonArray<AvailabilityWindow>(r.availability),
    paidAt: r.paid_at ?? undefined,
    createdBy: r.created_by ?? undefined,
    photoUrl: r.photo_drive_id ? `/api/photo/${r.photo_drive_id}` : null,
    needsApproval: !!r.needs_approval,
    approvedAt: r.approved_at ?? undefined,
    reportedCost: r.reported_cost ?? undefined,
    completionPhotoUrl: r.completion_photo_drive_id ? `/api/photo/${r.completion_photo_drive_id}` : null,
    workReportDriveId: r.work_report_drive_id ?? undefined,
    workReportUrl: r.work_report_drive_id ? `/api/documents/download/${r.work_report_drive_id}` : null,
    // Invoice workflow fields.
    invoiceNumber: r.invoice_number ?? undefined,
    invoiceDate: r.invoice_date ?? undefined,
    invoiceLaborAmount: r.invoice_labor_amount ?? undefined,
    invoiceMaterialAmount: r.invoice_material_amount ?? undefined,
    invoiceTotalAmount: r.invoice_total_amount ?? undefined,
    invoiceNotes: r.invoice_notes ?? undefined,
    invoiceDriveIds: parseJsonArray<{ id: string; name: string; contentType: string }>(r.invoice_drive_ids),
    invoiceSubmittedAt: r.invoice_submitted_at ?? undefined,
    invoiceApprovedAt: r.invoice_approved_at ?? undefined,
    invoiceApprovedBy: r.invoice_approved_by ?? undefined,
    invoiceRejectionReason: r.invoice_rejection_reason ?? undefined,
    // Timestamps (unix epoch).
    createdAt: r.created_at ?? undefined,
  };
}

export function serializeHandyman(r: Row) {
  return {
    id: r.id,
    userId: r.user_id ?? undefined,
    name: r.name,
    companyName: r.company_name ?? undefined,
    phone: r.phone ?? undefined,
    email: r.email ?? undefined,
    address: r.address ?? undefined,
    city: r.city ?? undefined,
    state: r.state ?? undefined,
    zipCode: r.zip_code ?? undefined,
    trades: parseJsonArray<string>(r.trades),
    isActive: !!r.is_active,
    // Whether this handyman already has a portal login (Invite vs Resend).
    hasLogin: !!r.user_id,
    // Present only when the query joins user.image (the handyman "me" endpoint
    // and the admin roster do; the plain roster serialize leaves it null).
    photoUrl: r.image ? `/api/photo/${r.image}` : null,
  };
}

export function serializeDocument(r: Row) {
  return {
    id: r.id,
    name: r.name,
    contentType: r.content_type ?? undefined,
    size: r.size ?? 0,
    propertyId: r.property_id ?? undefined,
    tenantId: r.tenant_id ?? undefined,
    driveFileId: r.drive_file_id,
    createdAt: r.created_at,
  };
}

export function serializeIncome(r: Row) {
  return {
    id: r.id,
    propertyId: r.property_id,
    unitId: r.unit_id ?? undefined,
    tenantId: r.tenant_id ?? undefined,
    source: r.source,
    amount: r.amount,
    date: r.date,
    description: r.description,
    paymentMethod: r.payment_method ?? undefined,
    relatedPaymentId: r.related_payment_id ?? undefined,
  };
}

export function serializeDepositReturn(r: Row) {
  return {
    id: r.id,
    leaseId: r.lease_id,
    tenantId: r.tenant_id ?? undefined,
    propertyId: r.property_id ?? undefined,
    unitId: r.unit_id ?? undefined,
    depositAmount: r.deposit_amount,
    moveOutDate: r.move_out_date,
    deadlineDate: r.deadline_date,
    status: r.status,
    totalDeductions: r.total_deductions,
    refundAmount: r.refund_amount,
    refundDate: r.refund_date ?? undefined,
    refundMethod: r.refund_method ?? undefined,
    notes: r.notes ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function serializeDepositDeduction(r: Row) {
  return {
    id: r.id,
    depositReturnId: r.deposit_return_id,
    category: r.category,
    description: r.description,
    amount: r.amount,
    createdAt: r.created_at,
  };
}

export function serializeInspection(r: Row) {
  return {
    id: r.id,
    propertyId: r.property_id ?? undefined,
    unitId: r.unit_id ?? undefined,
    leaseId: r.lease_id ?? undefined,
    tenantId: r.tenant_id ?? undefined,
    type: r.type,
    inspectionDate: r.inspection_date,
    inspectorName: r.inspector_name ?? undefined,
    status: r.status,
    notes: r.notes ?? undefined,
    driveFileId: r.drive_file_id ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export function serializeInspectionItem(r: Row) {
  return {
    id: r.id,
    inspectionId: r.inspection_id,
    room: r.room,
    item: r.item,
    condition: r.condition,
    notes: r.notes ?? undefined,
    photoDriveId: r.photo_drive_id ?? undefined,
    createdAt: r.created_at,
  };
}

export function serializeNotice(r: Row) {
  return {
    id: r.id,
    propertyId: r.property_id ?? undefined,
    unitId: r.unit_id ?? undefined,
    leaseId: r.lease_id ?? undefined,
    tenantId: r.tenant_id ?? undefined,
    type: r.type,
    title: r.title,
    body: r.body,
    noticeDate: r.notice_date,
    deliveryMethod: r.delivery_method ?? undefined,
    deliveredAt: r.delivered_at ?? undefined,
    status: r.status,
    driveFileId: r.drive_file_id ?? undefined,
    createdBy: r.created_by ?? undefined,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}
