import type { Property, Unit, Tenant, RentPayment, Expense, Income } from '../types';

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
