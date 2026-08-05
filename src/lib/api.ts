import type { Property, Unit, Tenant, Lease, LeaseStatus, RentPayment, Expense, Income, MaintenanceRequest, PortalPayment, Handyman, UtilityAccount, CalendarEvent, LeaseAuditEntry, LeaseNotification, PropertyProfile, PropertyNote, NoteAttachment, ExpenseImport, ExpenseImportDetail, CapitalProject, CapitalProjectDetail } from '../types';

const API_BASE = '/api';

async function apiRequest(endpoint: string, options: RequestInit = {}) {
  const url = `${API_BASE}${endpoint}`;
  
  const response = await fetch(url, {
    ...options,
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  
  if (response.status === 401) {
    // Don't redirect automatically - let the component handle it
    throw new Error('Unauthorized');
  }
  
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Unknown error' }));
    throw new Error(error.error || `HTTP ${response.status}`);
  }
  
  const data = await response.json();
  
  // If the response has a data property, return that (API format)
  // Otherwise return the whole response (for custom endpoints)
  return data.data !== undefined ? data.data : data;
}

// Auth API
export const authApi = {
  signUp: (email: string, password: string, name: string) =>
    apiRequest('/auth/sign-up/email', {
      method: 'POST',
      body: JSON.stringify({ email, password, name }),
    }),
  
  signIn: (email: string, password: string, code?: string, rememberDevice?: boolean) =>
    apiRequest('/auth/sign-in/email', {
      method: 'POST',
      body: JSON.stringify({ email, password, code, rememberDevice }),
    }),

  // Two-factor authentication (TOTP) for the signed-in user's own account.
  twoFactorSetup: (): Promise<{ secret: string; otpauthUrl: string }> =>
    apiRequest('/auth/2fa/setup', { method: 'POST' }),
  twoFactorEnable: (code: string): Promise<{ backupCodes: string[] }> =>
    apiRequest('/auth/2fa/enable', { method: 'POST', body: JSON.stringify({ code }) }),
  twoFactorDisable: (code: string): Promise<{ success: boolean }> =>
    apiRequest('/auth/2fa/disable', { method: 'POST', body: JSON.stringify({ code }) }),
  
  signOut: () =>
    apiRequest('/auth/sign-out', { method: 'POST' }),
  
  getSession: () =>
    apiRequest('/auth/session'),

  // Self-service profile: any signed-in user edits their own name, phone, photo.
  updateMe: (data: { firstName: string; lastName?: string; phone?: string }): Promise<{ firstName: string; lastName: string; phone?: string }> =>
    apiRequest('/me', { method: 'PUT', body: JSON.stringify(data) }),
  uploadMyPhoto: (file: Blob): Promise<{ photoUrl: string }> => postPhoto('/me/photo', file),
  removeMyPhoto: (): Promise<{ success: boolean }> => apiRequest('/me/photo', { method: 'DELETE' }),

  forgotPassword: (email: string) =>
    apiRequest('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  
  resetPassword: (userId: string, newPassword: string, currentPassword?: string) =>
    apiRequest('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ userId, newPassword, currentPassword }),
    }),

  resetPasswordWithToken: (token: string, newPassword: string) =>
    apiRequest('/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ token, newPassword }),
    }),
};

// Admin (users) API
export interface ApiUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  department?: string;
  roleId: string;
  isActive: boolean;
  createdAt: string;
  photoUrl?: string | null;
}

export const adminApi = {
  listUsers: (): Promise<ApiUser[]> => apiRequest('/admin/users'),
  createUser: (data: {
    firstName: string; lastName: string; email: string; roleId: string;
    phone?: string; department?: string;
  }): Promise<{ success: boolean; user: unknown; emailed?: boolean; tempPassword?: string; message?: string }> =>
    apiRequest('/admin/users', { method: 'POST', body: JSON.stringify(data) }),
  updateUser: (id: string, data: {
    firstName: string; lastName: string; phone?: string; department?: string;
    isActive: boolean; roleId: string;
  }): Promise<ApiUser> =>
    apiRequest(`/admin/users/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteUser: (id: string) =>
    apiRequest(`/admin/users/${id}`, { method: 'DELETE' }),
  resetUserPassword: (userId: string): Promise<{ tempPassword: string; message: string }> =>
    apiRequest('/admin/reset-user-password', { method: 'POST', body: JSON.stringify({ userId }) }),
  // One-time: nest documents into Property/Unit -> Tenant folders.
  migrateDocFolders: (): Promise<{ moved: number; foldersNested: number }> =>
    apiRequest('/admin/migrate-doc-folders', { method: 'POST' }),
  // Per-user permission overrides
  getUserPermissions: (userId: string): Promise<{ permission: string; grantedBy: string; grantedAt: number }[]> =>
    apiRequest(`/admin/users/${userId}/permissions`),
  grantPermissions: (userId: string, permissions: string[]): Promise<{ granted: number }> =>
    apiRequest(`/admin/users/${userId}/permissions`, { method: 'POST', body: JSON.stringify({ permissions }) }),
  revokePermissions: (userId: string, permissions: string[]): Promise<{ revoked: number }> =>
    apiRequest(`/admin/users/${userId}/permissions`, { method: 'DELETE', body: JSON.stringify({ permissions }) }),
  // Permission audit log
  getPermissionAudit: (params?: { userId?: string; limit?: number; offset?: number }): Promise<{
    id: string; targetUserId: string; targetName: string; targetEmail: string;
    changedById: string; changedByName: string; action: string;
    permission?: string; oldRole?: string; newRole?: string; createdAt: number;
  }[]> => {
    const search = new URLSearchParams();
    if (params?.userId) search.set('userId', params.userId);
    if (params?.limit) search.set('limit', String(params.limit));
    if (params?.offset) search.set('offset', String(params.offset));
    const qs = search.toString();
    return apiRequest(`/admin/permission-audit${qs ? '?' + qs : ''}`);
  },
};

// Roles API
export interface ApiRole {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  isSystem: boolean;
}

export const rolesApi = {
  getAll: (): Promise<ApiRole[]> => apiRequest('/roles'),
  create: (data: { name: string; description: string; permissions: string[] }): Promise<ApiRole> =>
    apiRequest('/roles', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: { name?: string; description?: string; permissions: string[] }): Promise<ApiRole> =>
    apiRequest(`/roles/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) =>
    apiRequest(`/roles/${id}`, { method: 'DELETE' }),
};

// Settings API
export interface AppSettings {
  company: {
    companyName: string; address: string; city: string; state: string;
    zipCode: string; phone: string; email: string; taxId: string;
  };
  rent: {
    lateFeeAmount: number; lateFeeDay: number; gracePeriod: number;
    defaultLeaseTerm: number; securityDepositMultiplier: number;
    paymentInstructions: string; pastDueMonths: number; rentDueDay: number;
  };
  notifications: {
    emailNotifications: boolean; smsNotifications: boolean; rentReminders: boolean;
    leaseExpiryAlerts: boolean; maintenanceAlerts: boolean; paymentConfirmations: boolean;
  };
}

export const settingsApi = {
  get: (): Promise<AppSettings> => apiRequest('/settings'),
  update: (data: Partial<AppSettings>): Promise<AppSettings> =>
    apiRequest('/settings', { method: 'PUT', body: JSON.stringify(data) }),
};

// Properties API
export const propertiesApi = {
  getAll: (): Promise<Property[]> => apiRequest('/properties'),
  getById: (id: string): Promise<Property> => apiRequest(`/properties/${id}`),
  create: (data: Omit<Property, 'id'>): Promise<Property> =>
    apiRequest('/properties', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Property): Promise<Property> =>
    apiRequest(`/properties/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) =>
    apiRequest(`/properties/${id}`, { method: 'DELETE' }),
  getProfile: (id: string): Promise<PropertyProfile> =>
    apiRequest(`/properties/${id}/profile`),
};

// Property Notes API
export const propertyNotesApi = {
  list: (propertyId: string, opts?: { category?: string; search?: string }): Promise<PropertyNote[]> => {
    const params = new URLSearchParams();
    if (opts?.category) params.set('category', opts.category);
    if (opts?.search) params.set('search', opts.search);
    const qs = params.toString();
    return apiRequest(`/properties/${propertyId}/notes${qs ? `?${qs}` : ''}`);
  },
  create: (propertyId: string, data: { title: string; content: string; category: string; isPinned?: boolean }): Promise<PropertyNote> =>
    apiRequest(`/properties/${propertyId}/notes`, { method: 'POST', body: JSON.stringify(data) }),
  update: (propertyId: string, noteId: string, data: { title?: string; content?: string; category?: string; isPinned?: boolean }): Promise<PropertyNote> =>
    apiRequest(`/properties/${propertyId}/notes/${noteId}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (propertyId: string, noteId: string) =>
    apiRequest(`/properties/${propertyId}/notes/${noteId}`, { method: 'DELETE' }),
  togglePin: (propertyId: string, noteId: string): Promise<{ isPinned: boolean }> =>
    apiRequest(`/properties/${propertyId}/notes/${noteId}/pin`, { method: 'POST' }),
  uploadAttachment: async (propertyId: string, noteId: string, file: File): Promise<NoteAttachment> => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${API_BASE}/properties/${propertyId}/notes/${noteId}/attachments`, {
      method: 'POST', body: fd, credentials: 'include',
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const json = await res.json();
    return json.data !== undefined ? json.data : json;
  },
  deleteAttachment: (propertyId: string, noteId: string, attachmentId: string) =>
    apiRequest(`/properties/${propertyId}/notes/${noteId}/attachments?attachmentId=${attachmentId}`, { method: 'DELETE' }),
};

// Utility accounts API (water/gas/electric the landlord pays, per property)
export const utilityAccountsApi = {
  getAll: (): Promise<UtilityAccount[]> => apiRequest('/utility-accounts'),
  create: (data: Omit<UtilityAccount, 'id'>): Promise<UtilityAccount> =>
    apiRequest('/utility-accounts', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: UtilityAccount): Promise<UtilityAccount> =>
    apiRequest(`/utility-accounts/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) =>
    apiRequest(`/utility-accounts/${id}`, { method: 'DELETE' }),
};

// Units API
export const unitsApi = {
  getAll: (): Promise<Unit[]> => apiRequest('/units'),
  getById: (id: string): Promise<Unit> => apiRequest(`/units/${id}`),
  create: (data: Omit<Unit, 'id'>): Promise<Unit> =>
    apiRequest('/units', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Unit): Promise<Unit> =>
    apiRequest(`/units/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) =>
    apiRequest(`/units/${id}`, { method: 'DELETE' }),
};

// A realtor linked to a tenant, as GET /api/tenants/:id/realtors returns it.
export interface TenantRealtorLink {
  id: string;
  realtorUserId: string;
  name: string;
  email: string;
  linkedOn: string;
  accessEndsOn: string;
}

// Response of POST /api/tenants/:id/invite. When mail isn't configured,
// `inviteUrl` carries the set-password link so Belle can pass it on by hand.
export interface InviteResult {
  emailSent: boolean;
  inviteUrl?: string;
  // True when this re-sent a fresh link to an existing login (vs a first invite).
  resent?: boolean;
}

// Tenants API
/** One logged outbound email from the office to a tenant. createdAt is unix seconds. */
export interface TenantEmail {
  id: string;
  tenantId: string;
  sentByUserId?: string;
  toEmail: string;
  subject: string;
  body: string;
  delivered: boolean;
  createdAt: number;
}

export const tenantsApi = {
  getAll: (): Promise<Tenant[]> => apiRequest('/tenants'),
  getById: (id: string): Promise<Tenant> => apiRequest(`/tenants/${id}`),
  create: (data: Omit<Tenant, 'id'>): Promise<Tenant> =>
    apiRequest('/tenants', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Tenant): Promise<Tenant> =>
    apiRequest(`/tenants/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) =>
    apiRequest(`/tenants/${id}`, { method: 'DELETE' }),
  // Gives the tenant a portal login. 400s with "This tenant already has a
  // login" (or "no email address") when it can't — there is no field on the
  // tenant that says this up front, so the caller shows that message as-is.
  invite: (id: string): Promise<InviteResult> =>
    apiRequest(`/tenants/${id}/invite`, { method: 'POST' }),
  // Reset the tenant's portal login password; returns a one-time temp password
  // to share. 400s with a message if they have no login yet.
  resetPassword: (id: string): Promise<{ tempPassword: string; message: string }> =>
    apiRequest(`/tenants/${id}/reset-password`, { method: 'POST' }),
  // Outbound email to the tenant + the office correspondence log (backend only).
  emails: (id: string): Promise<TenantEmail[]> => apiRequest(`/tenants/${id}/emails`),
  sendEmail: (id: string, subject: string, body: string): Promise<TenantEmail> =>
    apiRequest(`/tenants/${id}/emails`, { method: 'POST', body: JSON.stringify({ subject, body }) }),
  getRealtors: (id: string): Promise<TenantRealtorLink[]> =>
    apiRequest(`/tenants/${id}/realtors`),
  linkRealtor: (id: string, realtorUserId: string) =>
    apiRequest(`/tenants/${id}/realtors`, { method: 'POST', body: JSON.stringify({ realtorUserId }) }),
  // Tenants not linked to any realtor yet, for the admin "link existing" picker.
  listUnlinked: async (): Promise<{ id: string; firstName: string; lastName: string }[]> => {
    const rows = (await apiRequest('/tenants?withoutRealtor=1')) as Tenant[];
    return rows.map(t => ({ id: t.id, firstName: t.firstName, lastName: t.lastName }));
  },
  unlinkRealtor: (id: string, realtorUserId: string) =>
    apiRequest(`/tenants/${id}/realtors?realtorUserId=${encodeURIComponent(realtorUserId)}`, { method: 'DELETE' }),
  // The realtor-role users, for the link picker. Gated on tenants_edit server
  // side, so it works for any staff member who can link a realtor, not only
  // those who also hold users_view.
  listRealtorUsers: (): Promise<RealtorUserOption[]> => apiRequest('/realtors'),
};

export interface RealtorUserOption {
  id: string;
  name: string;
  email: string;
}

// Realtors API (staff side: acting on a realtor's behalf).
export const realtorsApi = {
  // Staff create a brand new tenant and link it to this realtor in one step.
  addTenant: (realtorUserId: string, data: { firstName: string; lastName: string; email?: string; phone?: string }): Promise<Tenant> =>
    apiRequest(`/realtors/${realtorUserId}/tenants`, { method: 'POST', body: JSON.stringify(data) }),
  // Add a realtor: creates their portal login with the realtor role and invites them.
  create: (data: { firstName: string; lastName: string; email: string; phone?: string }): Promise<{ userId: string; emailSent: boolean; inviteUrl?: string }> =>
    apiRequest('/realtors', { method: 'POST', body: JSON.stringify(data) }),
  // Resend the set-password invite to an existing realtor.
  resendInvite: (userId: string): Promise<{ emailSent: boolean; inviteUrl?: string }> =>
    apiRequest(`/realtors/${userId}/invite`, { method: 'POST' }),
  // Edit a realtor's own details (never changes their role).
  update: (userId: string, data: { firstName: string; lastName: string; email: string; phone?: string }): Promise<unknown> =>
    apiRequest(`/realtors/${userId}`, { method: 'PUT', body: JSON.stringify(data) }),
};

// Household API (admin side: household members for a given tenant's lease).
// Mirrors portalApi.household, but scoped by tenantId and gated on
// tenants_edit server side, since only staff with edit rights should be able
// to add, change, or remove someone's household.
export const householdApi = {
  list: (tenantId: string): Promise<HouseholdMember[]> =>
    apiRequest(`/household?tenantId=${encodeURIComponent(tenantId)}`),
  add: (tenantId: string, data: HouseholdInput): Promise<HouseholdMember> =>
    apiRequest('/household', { method: 'POST', body: JSON.stringify({ tenantId, ...data }) }),
  update: (id: string, data: HouseholdInput): Promise<HouseholdMember> =>
    apiRequest(`/household/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  remove: (id: string): Promise<{ success: boolean }> =>
    apiRequest(`/household/${id}`, { method: 'DELETE' }),
};

// Leases API
export const leasesApi = {
  getAll: (): Promise<Lease[]> => apiRequest('/leases'),
  getById: (id: string): Promise<Lease> => apiRequest(`/leases/${id}`),
  // `pausedAt` is not part of the Lease shape (the server owns `pauses` and
  // stamps it from status transitions); it exists only so the CSV importer
  // can ask the POST to open an interval for an imported paused lease.
  create: (data: Omit<Lease, 'id'> & { pausedAt?: string }): Promise<Lease> =>
    apiRequest('/leases', { method: 'POST', body: JSON.stringify(data) }),
  // `statusChangedOn` (YYYY-MM-DD, the OWNER's local day) tells the server
  // which day to stamp a pause/resume interval on, since the server has no
  // timezone of its own to derive "today" from.
  update: (id: string, data: Lease & { statusChangedOn?: string }): Promise<Lease> =>
    apiRequest(`/leases/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) => apiRequest(`/leases/${id}`, { method: 'DELETE' }),
  recordMoveInFee: (id: string, data: { amount: number; paidDate: string; method?: string }): Promise<{ moveInFeePaid: boolean; moveInFeePaidDate: string; moveInFeeMethod?: string; securityDeposit: number; receiptDocumentId: string | null }> =>
    apiRequest(`/leases/${id}/move-in-fee`, { method: 'POST', body: JSON.stringify(data) }),
  editMoveInFee: (id: string, data: { paidDate?: string; amount?: number; method?: string; reason?: string }): Promise<{ success: boolean }> =>
    apiRequest(`/leases/${id}/move-in-fee`, { method: 'PUT', body: JSON.stringify(data) }),
  approveRenewal: (id: string, action: 'approve' | 'reject'): Promise<{ status: string; newLeaseId?: string }> =>
    apiRequest(`/leases/${id}/approve-renewal`, { method: 'POST', body: JSON.stringify({ action }) }),
  getAuditHistory: (id: string): Promise<LeaseAuditEntry[]> =>
    apiRequest(`/leases/${id}/audit`),
  getNotifications: (id: string): Promise<LeaseNotification[]> =>
    apiRequest(`/leases/${id}/notifications`),
  resendNotification: (id: string): Promise<void> =>
    apiRequest(`/leases/${id}/notifications`, { method: 'POST' }),
};

// Payments API
export const paymentsApi = {
  getAll: (): Promise<RentPayment[]> => apiRequest('/payments'),
  getById: (id: string): Promise<RentPayment> => apiRequest(`/payments/${id}`),
  // deferSheetSync lets a bulk import skip the per-row master-spreadsheet
  // rebuild and trigger a single rebuild once, at the end.
  create: (data: Omit<RentPayment, 'id'>, opts?: { deferSheetSync?: boolean }): Promise<RentPayment> =>
    apiRequest(`/payments${opts?.deferSheetSync ? '?deferSheetSync=1' : ''}`, { method: 'POST', body: JSON.stringify(data) }),
  // Generate (or refresh) the PDF receipt for a paid payment; returns its
  // document id so the UI can link to the download.
  generateReceipt: (id: string): Promise<{ receiptDocumentId: string }> =>
    apiRequest(`/payments/${id}/receipt`, { method: 'POST' }),
  update: (id: string, data: RentPayment): Promise<RentPayment> =>
    apiRequest(`/payments/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) =>
    apiRequest(`/payments/${id}`, { method: 'DELETE' }),
};

// Expenses API
export const expensesApi = {
  getAll: (): Promise<Expense[]> => apiRequest('/expenses'),
  getById: (id: string): Promise<Expense> => apiRequest(`/expenses/${id}`),
  create: (data: Omit<Expense, 'id'>): Promise<Expense> =>
    apiRequest('/expenses', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Expense): Promise<Expense> =>
    apiRequest(`/expenses/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) =>
    apiRequest(`/expenses/${id}`, { method: 'DELETE' }),
  // Upload a receipt image for an expense; stored in the unit's Drive folder.
  uploadReceipt: async (id: string, file: File): Promise<Expense> => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${API_BASE}/expenses/${id}/receipt`, { method: 'POST', credentials: 'include', body: fd });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const data = await res.json();
    return data.data !== undefined ? data.data : data;
  },
};

// Incomes API
export const incomesApi = {
  getAll: (): Promise<Income[]> => apiRequest('/incomes'),
  getById: (id: string): Promise<Income> => apiRequest(`/incomes/${id}`),
  create: (data: Omit<Income, 'id'>): Promise<Income> =>
    apiRequest('/incomes', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Income): Promise<Income> =>
    apiRequest(`/incomes/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) =>
    apiRequest(`/incomes/${id}`, { method: 'DELETE' }),
};

// Documents API (files stored in R2)
export interface AppDocument {
  id: string;
  name: string;
  contentType?: string;
  size: number;
  propertyId?: string;
  tenantId?: string;
  createdAt: number;
  /** Office user who uploaded it, or null when the applicant uploaded a signed
   * copy themselves through the public signing link. */
  uploadedBy?: string | null;
}

export const documentsApi = {
  list: (tenantId?: string): Promise<AppDocument[]> =>
    apiRequest(`/documents${tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : ''}`),
  upload: async (file: File, opts: { tenantId?: string; propertyId?: string; officeOnly?: boolean } = {}): Promise<AppDocument> => {
    const fd = new FormData();
    fd.append('file', file);
    if (opts.tenantId) fd.append('tenantId', opts.tenantId);
    if (opts.propertyId) fd.append('propertyId', opts.propertyId);
    if (opts.officeOnly) fd.append('officeOnly', '1');
    // Note: no Content-Type header — the browser sets the multipart boundary.
    const res = await fetch(`${API_BASE}/documents`, { method: 'POST', credentials: 'include', body: fd });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const data = await res.json();
    return data.data !== undefined ? data.data : data;
  },
  delete: (id: string) => apiRequest(`/documents/${id}`, { method: 'DELETE' }),
  downloadUrl: (id: string) => `${API_BASE}/documents/${id}`,
};

// Google Drive API (document storage connection)
export interface GoogleStatus {
  connected: boolean;
}

export const googleApi = {
  // Note: apiRequest already prefixes with API_BASE ('/api'), so these paths
  // must not repeat it (unlike the raw fetch to /api/google/connect below,
  // which is a full page redirect and never goes through apiRequest).
  status: (): Promise<GoogleStatus> => apiRequest('/google/status'),
  disconnect: () => apiRequest('/google/disconnect', { method: 'POST' }),
};

// Master rent spreadsheet (a Google Sheet in Drive that mirrors tenants/payments)
export const rentSheetApi = {
  // connected = Drive linked; url = the sheet's link, null until it exists yet
  get: (): Promise<{ connected: boolean; url: string | null }> => apiRequest('/rent-sheet'),
  // Forces creation (if needed) + a full rebuild; returns the sheet's link
  sync: (): Promise<{ url: string }> => apiRequest('/rent-sheet/sync', { method: 'POST' }),
};

// Portal API (tenant and realtor self-service)
// Note: apiRequest already prefixes with API_BASE ('/api'), so these paths
// must not repeat it: pass '/portal/...', not '/api/portal/...'.

/**
 * A lease as the portal serializer returns it (serializePortalLease): an
 * allowlist that omits `notes` and `tenantIds`, unlike the full `Lease` shape
 * the management app uses. It DOES carry `pauses`, so the tenant's pages can
 * gate months with `leasesOwingMonth` and agree with the owner's Rent
 * Management about which months were owed. `tenantIds` is filled with an empty
 * default by callers that build a full `Lease`.
 */
export interface PortalLease {
  id: string;
  unitId?: string;
  propertyId?: string;
  startDate?: string;
  endDate?: string;
  monthlyRent: number;
  securityDeposit?: number;
  status: LeaseStatus;
  pauses: { pausedAt: string; resumedAt?: string }[];
}

export interface PortalMeResponse {
  tenant: Tenant;
  lease: PortalLease | null;
  unit: Unit | null;
  property: Property | null;
  // The owner's "how to pay" text from Settings; the portal adds the memo.
  paymentInstructions?: string;
  // The past-due threshold (months) from Settings; defaults to 2.
  pastDueMonths?: number;
  // The day of the month rent is due, from Settings; defaults to 1.
  rentDueDay?: number;
}

export interface PortalMoveInFee {
  amount: number;
  paidDate?: string;
  method?: string;
  receiptDocumentId?: string;
}

export interface PortalPaymentsResponse {
  lease: PortalLease | null;
  payments: PortalPayment[];
  moveInFee?: PortalMoveInFee | null;
}

/**
 * A tenant as the portal's allowlist serializer returns it
 * (serializePortalTenant): same shape as `Tenant` minus `notes`, which is the
 * owner's private note and never travels to a tenant or realtor session.
 */
/** Where a tenant lives: their unit number and the property's exact address,
 * resolved server side from their most recent lease. */
export interface TenantUnit {
  unitNumber?: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
}

export interface PortalPerson {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  emergencyContact?: { name: string; phone: string; relationship: string };
  unit?: TenantUnit;
  photoUrl?: string | null;
  // Approval state of this tenant's placement, for the realtor's view:
  // 'under_review' (draft with the office), 'approved' (active), or 'none'.
  approval?: 'under_review' | 'approved' | 'none';
}

/** A tenant as a realtor's list sees them: the allowlisted person plus their
 * unit and address (via PortalPerson.unit). */
export type RealtorTenantSummary = PortalPerson;

export interface HouseholdMember {
  id: string;
  leaseId: string;
  name: string;
  phone: string | null;
  relationship: string | null;
  createdAt: number;
}
export interface HouseholdInput {
  name: string;
  phone?: string;
  relationship?: string;
}

export interface RealtorContact {
  name: string | null;
  email: string;
  phone: string | null;
}
export interface RealtorMe {
  profile: RealtorContact & { photoUrl: string | null };
  tenantsPlaced: number;
  tenantsInWindow: number;
}

/** A vacant unit as a realtor sees it for marketing: no tenant/lease data,
 * just the unit's own specs, the asking rent, and the property's address. */
export interface AvailableUnit {
  id: string;
  unitNumber: string;
  bedrooms?: number;
  bathrooms?: number;
  squareFeet?: number;
  monthlyRent: number;
  description?: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
}

/** A maintenance request as a portal user sees it: the base request plus the
 * few contact fields the endpoint attaches (handyman for tenants; tenant and
 * location for handymen). */
export interface PortalMaintenanceRequest extends MaintenanceRequest {
  handymanName?: string;
  handymanPhone?: string;
  tenantName?: string;
  tenantPhone?: string;
  locationLabel?: string;
}

/** A handyman's portal view: open jobs matching their trades, plus their own. */
export interface HandymanJobsResponse {
  available: PortalMaintenanceRequest[];
  mine: PortalMaintenanceRequest[];
}

/** One message in a tenant/office thread. createdAt is unix seconds. */
export interface Message {
  id: string;
  tenantId: string;
  senderRole: 'tenant' | 'office';
  body: string;
  createdAt: number;
  attachmentUrl?: string;
  attachmentName?: string;
  attachmentType?: string;
}

/** One message in an office<->handyman (vendor) thread. */
export interface VendorMessage {
  id: string;
  handymanId: string;
  senderRole: 'office' | 'handyman';
  body: string;
  createdAt: number;
  attachmentUrl?: string;
  attachmentName?: string;
  attachmentType?: string;
}

/** A row in the office's vendor inbox: one handyman's thread summary. */
export interface VendorThread {
  handymanId: string;
  name: string;
  phone: string | null;
  lastBody: string | null;
  lastSender: 'office' | 'handyman' | null;
  lastAt: number | null;
  unread: number;
}

/** A row in the office inbox: one tenant's thread summary. */
export interface MessageThread {
  tenantId: string;
  firstName: string;
  lastName: string;
  propertyName: string | null;
  propertyAddress: string | null;
  unitNumber: string | null;
  lastBody: string | null;
  lastSender: 'tenant' | 'office' | null;
  lastAt: number;
  unread: number;
}

/** "Maple Court, Unit 2" style label from a property/unit, or '' when unknown. */
export function placeLabel(
  p: { propertyName?: string | null; propertyAddress?: string | null; unitNumber?: string | null }
): string {
  const prop = p.propertyName || p.propertyAddress || '';
  const unit = p.unitNumber ? `Unit ${p.unitNumber}` : '';
  return [prop, unit].filter(Boolean).join(', ');
}

export const portalApi = {
  me: (): Promise<PortalMeResponse> => apiRequest('/portal/me'),
  // The tenant's linked realtor(s), contact info only, always visible.
  myRealtors: (): Promise<RealtorContact[]> => apiRequest('/portal/my-realtors'),
  // The realtor's own profile plus summary counts, for their dashboard.
  realtorMe: (): Promise<RealtorMe> => apiRequest('/portal/realtor/me'),
  // { lease, payments }, not a bare array: see PortalPaymentsResponse. No
  // payer field travels on any payment row (Belle's decision: on a shared
  // lease a tenant never sees who paid what).
  payments: (): Promise<PortalPaymentsResponse> => apiRequest('/portal/payments'),
  // A tenant generates the receipt for one of their own paid payments; returns
  // its document id so the page can link straight to the download.
  generateReceipt: (paymentId: string): Promise<{ receiptDocumentId: string }> =>
    apiRequest(`/portal/payments/${paymentId}/receipt`, { method: 'POST' }),
  // A tenant adds their emergency contact (only allowed when none is on file).
  setEmergencyContact: (data: { name: string; phone: string; relationship: string }): Promise<{ name: string; phone: string; relationship: string }> =>
    apiRequest('/portal/emergency-contact', { method: 'POST', body: JSON.stringify(data) }),
  documents: (tenantId?: string): Promise<AppDocument[]> =>
    apiRequest(`/portal/documents${tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : ''}`),
  // Multipart, like documentsApi.upload: no Content-Type header, so the
  // browser sets the multipart boundary itself.
  uploadDocument: async (file: File, tenantId: string): Promise<AppDocument> => {
    const fd = new FormData();
    fd.append('file', file);
    fd.append('tenantId', tenantId);
    const res = await fetch(`${API_BASE}/portal/documents`, { method: 'POST', credentials: 'include', body: fd });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const data = await res.json();
    return data.data !== undefined ? data.data : data;
  },
  // NOT documentsApi.downloadUrl: that builds /api/documents/:id, the staff
  // route (requirePermission('tenants_view')), which a tenant or realtor
  // session has no permission to hit. This is the portal's own route.
  downloadUrl: (id: string) => `${API_BASE}/portal/documents/${id}`,
  realtorTenants: (): Promise<RealtorTenantSummary[]> => apiRequest('/portal/realtor/tenants'),
  realtorTenant: (id: string): Promise<PortalPerson> => apiRequest(`/portal/realtor/tenants/${id}`),
  addRealtorTenant: (data: {
    firstName: string; lastName: string; email?: string; phone?: string;
    emergencyName?: string; emergencyPhone?: string; emergencyRelationship?: string;
    unitId?: string; monthlyRent?: number; startDate?: string; endDate?: string;
  }): Promise<PortalPerson> =>
    apiRequest('/portal/realtor/tenants', { method: 'POST', body: JSON.stringify(data) }),
  // Vacant units the realtor may market, asking rent included on purpose.
  availableUnits: (): Promise<AvailableUnit[]> => apiRequest('/portal/realtor/available-units'),
  // A tenant's own maintenance requests, with the assigned handyman's name and
  // phone attached when there is one.
  maintenance: (): Promise<PortalMaintenanceRequest[]> => apiRequest('/portal/maintenance'),
  createMaintenance: (data: {
    title: string; category: string; description?: string;
    availability: { date: string; start: string; end: string }[];
  }): Promise<MaintenanceRequest> =>
    apiRequest('/portal/maintenance', { method: 'POST', body: JSON.stringify(data) }),
  // Attach (or replace) a photo on one of the tenant's own requests. Multipart,
  // like the other photo uploads: postPhoto sets the boundary itself.
  uploadMaintenancePhoto: (id: string, file: Blob): Promise<{ photoUrl: string }> =>
    postPhoto(`/portal/maintenance/${id}/photo`, file),
  // A handyman's own profile, and updating their own contact details.
  handymanMe: (): Promise<Handyman> => apiRequest('/portal/handyman/me'),
  updateHandymanMe: (data: {
    name: string; phone?: string; address?: string; city?: string; state?: string; zipCode?: string;
  }): Promise<Handyman> =>
    apiRequest('/portal/handyman/me', { method: 'PUT', body: JSON.stringify(data) }),
  // A handyman's own jobs and the open jobs matching their trades.
  handymanJobs: (): Promise<HandymanJobsResponse> => apiRequest('/portal/handyman/jobs'),
  claimJob: (id: string): Promise<PortalMaintenanceRequest> =>
    apiRequest(`/portal/handyman/jobs/${id}/claim`, { method: 'POST' }),
  scheduleJob: (id: string, scheduledFor: string): Promise<PortalMaintenanceRequest> =>
    apiRequest(`/portal/handyman/jobs/${id}/schedule`, { method: 'POST', body: JSON.stringify({ scheduledFor }) }),
  jobStatus: (id: string, status: 'in_progress' | 'completed'): Promise<PortalMaintenanceRequest> =>
    apiRequest(`/portal/handyman/jobs/${id}/status`, { method: 'POST', body: JSON.stringify({ status }) }),
  // The property + unit list a handyman needs to self-report where they worked.
  handymanPlaces: (): Promise<{ properties: { id: string; name: string; address: string }[]; units: { id: string; propertyId: string; unitNumber: string }[] }> =>
    apiRequest('/portal/handyman/places'),
  // A handyman logs work they did; created as completed + pending admin approval.
  reportWork: (data: { propertyId: string; unitId?: string; title: string; description?: string; category: string; cost: number; date: string }): Promise<PortalMaintenanceRequest> =>
    apiRequest('/portal/handyman/report', { method: 'POST', body: JSON.stringify(data) }),
  // Handyman uploads an invoice for a job approved for invoicing. Multipart form.
  submitInvoice: async (jobId: string, data: {
    files: File[];
    invoiceNumber: string;
    invoiceDate: string;
    laborAmount: number;
    materialAmount: number;
    totalAmount: number;
    notes?: string;
  }): Promise<PortalMaintenanceRequest> => {
    const fd = new FormData();
    for (const f of data.files) fd.append('files[]', f);
    fd.append('invoiceNumber', data.invoiceNumber);
    fd.append('invoiceDate', data.invoiceDate);
    fd.append('laborAmount', String(data.laborAmount));
    fd.append('materialAmount', String(data.materialAmount));
    fd.append('totalAmount', String(data.totalAmount));
    if (data.notes) fd.append('notes', data.notes);
    const res = await fetch(`${API_BASE}/portal/handyman/jobs/${jobId}/invoice`, {
      method: 'POST', credentials: 'include', body: fd,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const json = await res.json();
    return json.data !== undefined ? json.data : json;
  },
  // Web push: register/unregister this device, and send a test to yourself.
  pushSubscribe: (sub: { endpoint?: string | null; keys?: { p256dh?: string; auth?: string } }): Promise<{ success: boolean }> =>
    apiRequest('/portal/push/subscribe', { method: 'POST', body: JSON.stringify(sub) }),
  pushUnsubscribe: (endpoint: string): Promise<{ success: boolean }> =>
    apiRequest('/portal/push/subscribe', { method: 'DELETE', body: JSON.stringify({ endpoint }) }),
  pushTest: (): Promise<{ success: boolean }> => apiRequest('/portal/push/test', { method: 'POST' }),
  household: {
    list: (): Promise<HouseholdMember[]> => apiRequest('/portal/household'),
    add: (data: HouseholdInput): Promise<HouseholdMember> =>
      apiRequest('/portal/household', { method: 'POST', body: JSON.stringify(data) }),
  },
  // The tenant's own thread with the office. Fetching it marks office replies
  // read; count is the cheap unread lookup for the nav badge.
  messages: (): Promise<{ messages: Message[] }> => apiRequest('/portal/messages'),
  messagesUnread: (): Promise<{ count: number }> => apiRequest('/portal/messages?count=1'),
  sendMessage: (body: string, file?: File | null): Promise<Message> =>
    postMessageForm('/portal/messages', body, file),
  // A handyman's own thread with the office (vendor messaging).
  vendorMessages: (): Promise<{ messages: VendorMessage[] }> => apiRequest('/portal/handyman/messages'),
  vendorMessagesUnread: (): Promise<{ count: number }> => apiRequest('/portal/handyman/messages?count=1'),
  sendVendorMessage: (body: string, file?: File | null): Promise<VendorMessage> =>
    postMessageForm('/portal/handyman/messages', body, file),
};

export const photoApi = {
  uploadSelf: (file: Blob): Promise<{ photoUrl: string }> => postPhoto('/portal/photo', file),
  removeSelf: (): Promise<{ success: boolean }> => apiRequest('/portal/photo', { method: 'DELETE' }),
  uploadTenant: (tenantId: string, file: Blob): Promise<{ photoUrl: string }> => postPhoto(`/tenants/${tenantId}/photo`, file),
  removeTenant: (tenantId: string): Promise<{ success: boolean }> => apiRequest(`/tenants/${tenantId}/photo`, { method: 'DELETE' }),
  uploadUser: (userId: string, file: Blob): Promise<{ photoUrl: string }> => postPhoto(`/admin/users/${userId}/photo`, file),
  removeUser: (userId: string): Promise<{ success: boolean }> => apiRequest(`/admin/users/${userId}/photo`, { method: 'DELETE' }),
};

async function postPhoto(path: string, file: Blob): Promise<{ photoUrl: string }> {
  const fd = new FormData();
  fd.append('photo', file, 'photo.jpg');
  const res = await fetch(`${API_BASE}${path}`, { method: 'POST', credentials: 'include', body: fd });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Upload failed' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  const data = await res.json();
  return data.data !== undefined ? data.data : data;
}

/** Send a message (text plus an optional attachment) as multipart form-data. */
async function postMessageForm<T>(path: string, body: string, file?: File | null): Promise<T> {
  const fd = new FormData();
  fd.append('body', body);
  if (file) fd.append('file', file);
  const res = await fetch(`${API_BASE}${path}`, { method: 'POST', credentials: 'include', body: fd });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Failed to send' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  const data = await res.json();
  return (data.data !== undefined ? data.data : data) as T;
}

// Maintenance API
export const maintenanceApi = {
  getAll: (): Promise<MaintenanceRequest[]> => apiRequest('/maintenance'),
  getById: (id: string): Promise<MaintenanceRequest> => apiRequest(`/maintenance/${id}`),
  create: (data: Omit<MaintenanceRequest, 'id'>): Promise<MaintenanceRequest> =>
    apiRequest('/maintenance', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: MaintenanceRequest): Promise<MaintenanceRequest> =>
    apiRequest(`/maintenance/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string) =>
    apiRequest(`/maintenance/${id}`, { method: 'DELETE' }),
  // Assign (or clear, with handymanId null) a handyman. Notifies them + tenant.
  assign: (id: string, handymanId: string | null): Promise<MaintenanceRequest> =>
    apiRequest(`/maintenance/${id}/assign`, { method: 'POST', body: JSON.stringify({ handymanId }) }),
  // Record paying the handyman: sets the cost, stamps paid, counts in Finances.
  pay: (id: string, cost: number): Promise<MaintenanceRequest> =>
    apiRequest(`/maintenance/${id}/pay`, { method: 'POST', body: JSON.stringify({ cost }) }),
  // Approve a handyman-reported job (and its cost). With an assigned handyman
  // this transitions to approved_for_invoicing (no expense yet); without one
  // it writes the expense immediately. Pass skipInvoice:true to force the
  // direct expense path even when a handyman is assigned.
  approve: (id: string, cost: number, skipInvoice?: boolean): Promise<MaintenanceRequest> =>
    apiRequest(`/maintenance/${id}/approve`, {
      method: 'POST',
      body: JSON.stringify({ cost, ...(skipInvoice ? { skipInvoice: true } : {}) }),
    }),
  // Admin reviews a submitted invoice: approve, reject, or request revision.
  invoiceReview: (id: string, action: 'approve' | 'reject' | 'revision', reason?: string): Promise<MaintenanceRequest> =>
    apiRequest(`/maintenance/${id}/invoice-review`, {
      method: 'POST',
      body: JSON.stringify({ action, reason }),
    }),
};

// Handymen roster API (admin side).
export interface HandymanInput {
  name: string;
  companyName?: string;
  phone?: string;
  email?: string;
  trades: string[];
  isActive?: boolean;
}

/** The result of adding or inviting a handyman: the row plus whether mail went out. */
export interface HandymanInviteResult {
  handyman?: Handyman;
  emailSent: boolean;
  inviteUrl?: string;
}

/** One entry in the activity log: who did what, to which record, and when. */
export interface ActivityEntry {
  id: string;
  userId?: string;
  userName?: string;
  userRole?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  method: string;
  statusCode?: number;
  createdAt: number;
}

export const activityApi = {
  list: (limit = 100, offset = 0): Promise<ActivityEntry[]> =>
    apiRequest(`/activity?limit=${limit}&offset=${offset}`),
};

export const handymenApi = {
  getAll: (): Promise<Handyman[]> => apiRequest('/handymen'),
  create: (data: HandymanInput): Promise<HandymanInviteResult> =>
    apiRequest('/handymen', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: HandymanInput): Promise<Handyman> =>
    apiRequest(`/handymen/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  // Hard delete: removes the roster row and their login. Deactivate (a pause)
  // goes through update({ isActive: false }) instead.
  remove: (id: string) =>
    apiRequest(`/handymen/${id}`, { method: 'DELETE' }),
  invite: (id: string): Promise<HandymanInviteResult> =>
    apiRequest(`/handymen/${id}/invite`, { method: 'POST' }),
};

export type ProspectiveStatus = 'applied' | 'docs_sent' | 'signed' | 'converted' | 'rejected';

/** An applicant, before they become an active tenant. No portal login. */
export interface ProspectiveTenant {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  notes?: string;
  status: ProspectiveStatus;
  convertedTenantId?: string;
  createdAt: number;
}

export interface ProspectiveInput {
  firstName: string; lastName: string; email?: string; phone?: string; notes?: string;
}

// Prospective tenants (applicants): records, their files, and conversion.
export const prospectiveApi = {
  list: (): Promise<ProspectiveTenant[]> => apiRequest('/prospective-tenants'),
  get: (id: string): Promise<ProspectiveTenant> => apiRequest(`/prospective-tenants/${id}`),
  create: (data: ProspectiveInput): Promise<ProspectiveTenant> =>
    apiRequest('/prospective-tenants', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: ProspectiveInput & { status?: ProspectiveStatus }): Promise<ProspectiveTenant> =>
    apiRequest(`/prospective-tenants/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  remove: (id: string) => apiRequest(`/prospective-tenants/${id}`, { method: 'DELETE' }),
  documents: (id: string): Promise<AppDocument[]> => apiRequest(`/prospective-tenants/${id}/documents`),
  uploadDocument: async (id: string, file: File): Promise<AppDocument> => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${API_BASE}/prospective-tenants/${id}/documents`, { method: 'POST', credentials: 'include', body: fd });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const data = await res.json();
    return data.data !== undefined ? data.data : data;
  },
  convert: (id: string, data: { unitId: string; monthlyRent: number; moveInFee?: number; moveInFeePaid?: boolean; startDate?: string; endDate?: string }): Promise<{ tenantId: string }> =>
    apiRequest(`/prospective-tenants/${id}/convert`, { method: 'POST', body: JSON.stringify(data) }),
  // Mint (or reuse) the applicant's secure, no-login signing token; emails it to
  // the applicant automatically when they have an email on file.
  signLink: (id: string): Promise<{ token: string; emailedTo?: string | null }> =>
    apiRequest(`/prospective-tenants/${id}/sign-link`, { method: 'POST' }),
};

// PUBLIC signing flow (no login), used by the /sign/:token page.
export interface SigningInfo {
  firstName: string;
  status: ProspectiveStatus;
  /** Documents the office sent for the applicant to sign. */
  documents: { id: string; name: string }[];
  /** Signed copies the applicant has already uploaded. */
  uploaded: { id: string; name: string }[];
}
export const signingApi = {
  info: (token: string): Promise<SigningInfo> => apiRequest(`/sign/${token}`),
  documentUrl: (token: string, docId: string) => `${API_BASE}/sign/${token}/document/${docId}`,
  upload: async (token: string, file: File): Promise<{ id: string; name: string }> => {
    const fd = new FormData();
    fd.append('file', file);
    const res = await fetch(`${API_BASE}/sign/${token}/upload`, { method: 'POST', credentials: 'include', body: fd });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const data = await res.json();
    return data.data !== undefined ? data.data : data;
  },
  complete: (token: string): Promise<{ success: boolean }> =>
    apiRequest(`/sign/${token}/complete`, { method: 'POST' }),
};

// Office side of tenant messaging: the inbox, one tenant's thread, and replies.
export const messagesApi = {
  threads: (): Promise<{ threads: MessageThread[] }> => apiRequest('/messages'),
  unreadCount: (): Promise<{ count: number }> => apiRequest('/messages?count=1'),
  thread: (tenantId: string): Promise<{
    tenantId: string; tenantName: string;
    propertyName: string | null; propertyAddress: string | null; unitNumber: string | null;
    messages: Message[];
  }> =>
    apiRequest(`/messages/${tenantId}`),
  reply: (tenantId: string, body: string, file?: File | null): Promise<Message> =>
    postMessageForm(`/messages/${tenantId}`, body, file),
};

// Office side of vendor (handyman) messaging: the inbox, one thread, and replies.
export const vendorMessagesApi = {
  threads: (): Promise<{ threads: VendorThread[] }> => apiRequest('/handyman-messages'),
  unreadCount: (): Promise<{ count: number }> => apiRequest('/handyman-messages?count=1'),
  thread: (handymanId: string): Promise<{ handymanId: string; handymanName: string; messages: VendorMessage[] }> =>
    apiRequest(`/handyman-messages/${handymanId}`),
  reply: (handymanId: string, body: string, file?: File | null): Promise<VendorMessage> =>
    postMessageForm(`/handyman-messages/${handymanId}`, body, file),
};

export const expenseImportApi = {
  list: (): Promise<ExpenseImport[]> => apiRequest('/expense-imports'),
  upload: async (file: File): Promise<{ id: string; fileName: string; totalRows: number; validRows: number; errorRows: number; duplicateRows: number; columnMapping: Record<string, string> }> => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${API_BASE}/expense-imports`, {
      method: 'POST',
      credentials: 'include',
      body: form,
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(err.error || `HTTP ${res.status}`);
    }
    const json = await res.json();
    return json.data ?? json;
  },
  get: (id: string): Promise<ExpenseImportDetail> => apiRequest(`/expense-imports/${id}`),
  delete: (id: string): Promise<void> => apiRequest(`/expense-imports/${id}`, { method: 'DELETE' }),
  updateRows: (importId: string, rows: Array<{ id: string; [k: string]: unknown }>): Promise<{ updatedCount: number }> =>
    apiRequest(`/expense-imports/${importId}/rows`, { method: 'PUT', body: JSON.stringify({ rows }) }),
  merge: (id: string): Promise<{ mergedRows: number }> =>
    apiRequest(`/expense-imports/${id}/merge`, { method: 'POST' }),
  rollback: (id: string): Promise<{ removedExpenses: number }> =>
    apiRequest(`/expense-imports/${id}/rollback`, { method: 'POST' }),
};

export const calendarApi = {
  list: (): Promise<CalendarEvent[]> => apiRequest('/calendar'),
  get: (id: string): Promise<CalendarEvent> => apiRequest(`/calendar/${id}`),
  create: (event: Partial<CalendarEvent>): Promise<CalendarEvent> =>
    apiRequest('/calendar', { method: 'POST', body: JSON.stringify(event) }),
  update: (id: string, event: Partial<CalendarEvent>): Promise<CalendarEvent> =>
    apiRequest(`/calendar/${id}`, { method: 'PUT', body: JSON.stringify(event) }),
  delete: (id: string): Promise<void> => apiRequest(`/calendar/${id}`, { method: 'DELETE' }),
};

// ---------------------------------------------------------------------------
// Capital Expense Projects
// ---------------------------------------------------------------------------

export const capitalProjectsApi = {
  list: (): Promise<CapitalProject[]> => apiRequest('/capital-projects'),
  get: (id: string): Promise<CapitalProjectDetail> => apiRequest(`/capital-projects/${id}`),
  create: (data: Partial<CapitalProject>): Promise<CapitalProject> =>
    apiRequest('/capital-projects', { method: 'POST', body: JSON.stringify(data) }),
  update: (id: string, data: Partial<CapitalProject>): Promise<CapitalProject> =>
    apiRequest(`/capital-projects/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  delete: (id: string): Promise<void> =>
    apiRequest(`/capital-projects/${id}`, { method: 'DELETE' }),
  linkExpenses: (id: string, expenseIds: string[]): Promise<{ linked: number; totalCost: number; expenseCount: number }> =>
    apiRequest(`/capital-projects/${id}/expenses`, { method: 'POST', body: JSON.stringify({ expenseIds }) }),
  unlinkExpenses: (id: string, expenseIds: string[]): Promise<{ unlinked: number }> =>
    apiRequest(`/capital-projects/${id}/expenses`, { method: 'DELETE', body: JSON.stringify({ expenseIds }) }),
  uploadReceipt: async (id: string, file: File): Promise<{ driveFileId: string; name: string }> => {
    const form = new FormData();
    form.append('file', file);
    const res = await fetch(`${API_BASE}/capital-projects/${id}/receipt`, {
      method: 'POST',
      credentials: 'include',
      body: form,
    });
    const json = await res.json() as { success?: boolean; error?: string; data?: { driveFileId: string; name: string } };
    if (!res.ok || !json.success) throw new Error(json.error || 'Upload failed');
    return json.data!;
  },
};
