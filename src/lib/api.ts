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
  
  return response.json();
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
