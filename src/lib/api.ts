import type { Property, Unit, Tenant, Lease, LeaseStatus, RentPayment, Expense, Income, MaintenanceRequest, PortalPayment } from '../types';

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
  
  signIn: (email: string, password: string) =>
    apiRequest('/auth/sign-in/email', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  
  signOut: () =>
    apiRequest('/auth/sign-out', { method: 'POST' }),
  
  getSession: () =>
    apiRequest('/auth/session'),
  
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
}

export const adminApi = {
  listUsers: (): Promise<ApiUser[]> => apiRequest('/admin/users'),
  createUser: (data: {
    firstName: string; lastName: string; email: string; roleId: string;
    phone?: string; department?: string;
  }) => apiRequest('/admin/users', { method: 'POST', body: JSON.stringify(data) }),
  updateUser: (id: string, data: {
    firstName: string; lastName: string; phone?: string; department?: string;
    isActive: boolean; roleId: string;
  }): Promise<ApiUser> =>
    apiRequest(`/admin/users/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
  deleteUser: (id: string) =>
    apiRequest(`/admin/users/${id}`, { method: 'DELETE' }),
  resetUserPassword: (userId: string): Promise<{ tempPassword: string; message: string }> =>
    apiRequest('/admin/reset-user-password', { method: 'POST', body: JSON.stringify({ userId }) }),
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
}

// Tenants API
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
  getRealtors: (id: string): Promise<TenantRealtorLink[]> =>
    apiRequest(`/tenants/${id}/realtors`),
  linkRealtor: (id: string, realtorUserId: string) =>
    apiRequest(`/tenants/${id}/realtors`, { method: 'POST', body: JSON.stringify({ realtorUserId }) }),
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
};

// Payments API
export const paymentsApi = {
  getAll: (): Promise<RentPayment[]> => apiRequest('/payments'),
  getById: (id: string): Promise<RentPayment> => apiRequest(`/payments/${id}`),
  create: (data: Omit<RentPayment, 'id'>): Promise<RentPayment> =>
    apiRequest('/payments', { method: 'POST', body: JSON.stringify(data) }),
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
}

export const documentsApi = {
  list: (tenantId?: string): Promise<AppDocument[]> =>
    apiRequest(`/documents${tenantId ? `?tenantId=${encodeURIComponent(tenantId)}` : ''}`),
  upload: async (file: File, opts: { tenantId?: string; propertyId?: string } = {}): Promise<AppDocument> => {
    const fd = new FormData();
    fd.append('file', file);
    if (opts.tenantId) fd.append('tenantId', opts.tenantId);
    if (opts.propertyId) fd.append('propertyId', opts.propertyId);
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
}

export interface PortalPaymentsResponse {
  lease: PortalLease | null;
  payments: PortalPayment[];
}

/**
 * A tenant as the portal's allowlist serializer returns it
 * (serializePortalTenant): same shape as `Tenant` minus `notes`, which is the
 * owner's private note and never travels to a tenant or realtor session.
 */
export interface PortalPerson {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  emergencyContact?: { name: string; phone: string; relationship: string };
}

/** A tenant as a realtor's list sees them: the allowlisted person plus the
 * unit they were placed in (joined server side from their most recent lease). */
export interface RealtorTenantSummary extends PortalPerson {
  unitNumber?: string;
}

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

export const portalApi = {
  me: (): Promise<PortalMeResponse> => apiRequest('/portal/me'),
  updateMe: (data: unknown): Promise<Tenant> =>
    apiRequest('/portal/me', { method: 'PUT', body: JSON.stringify(data) }),
  // { lease, payments }, not a bare array: see PortalPaymentsResponse. No
  // payer field travels on any payment row (Belle's decision: on a shared
  // lease a tenant never sees who paid what).
  payments: (): Promise<PortalPaymentsResponse> => apiRequest('/portal/payments'),
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
  household: {
    list: (): Promise<HouseholdMember[]> => apiRequest('/portal/household'),
    add: (data: HouseholdInput): Promise<HouseholdMember> =>
      apiRequest('/portal/household', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: string, data: HouseholdInput): Promise<HouseholdMember> =>
      apiRequest(`/portal/household/${id}`, { method: 'PUT', body: JSON.stringify(data) }),
    remove: (id: string): Promise<{ success: boolean }> =>
      apiRequest(`/portal/household/${id}`, { method: 'DELETE' }),
  },
};

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
};
