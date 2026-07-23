import React, { createContext, useContext, useReducer, useEffect, useCallback, type ReactNode } from 'react';
import type { Property, Unit, Tenant, Lease, RentPayment, Expense, Income, MaintenanceRequest } from '../types';
import {
  propertiesApi,
  unitsApi,
  tenantsApi,
  leasesApi,
  paymentsApi,
  expensesApi,
  incomesApi,
  maintenanceApi,
} from '../lib/api';
import { useAuth } from './AuthContext';
import { todayLocalDate } from '../lib/utils';

interface AppState {
  properties: Property[];
  units: Unit[];
  tenants: Tenant[];
  leases: Lease[];
  rentPayments: RentPayment[];
  expenses: Expense[];
  incomes: Income[];
  maintenance: MaintenanceRequest[];
  isLoading: boolean;
  error: string | null;
}

type Action =
  | { type: 'SET_STATE'; payload: Partial<AppState> }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'ADD_PROPERTY'; payload: Property }
  | { type: 'UPDATE_PROPERTY'; payload: Property }
  | { type: 'DELETE_PROPERTY'; payload: string }
  | { type: 'ADD_UNIT'; payload: Unit }
  | { type: 'UPDATE_UNIT'; payload: Unit }
  | { type: 'DELETE_UNIT'; payload: string }
  | { type: 'ADD_TENANT'; payload: Tenant }
  | { type: 'UPDATE_TENANT'; payload: Tenant }
  | { type: 'DELETE_TENANT'; payload: string }
  | { type: 'ADD_LEASE'; payload: Lease }
  | { type: 'UPDATE_LEASE'; payload: Lease }
  | { type: 'DELETE_LEASE'; payload: string }
  | { type: 'ADD_EXPENSE'; payload: Expense }
  | { type: 'UPDATE_EXPENSE'; payload: Expense }
  | { type: 'DELETE_EXPENSE'; payload: string }
  | { type: 'ADD_INCOME'; payload: Income }
  | { type: 'ADD_RENT_PAYMENT'; payload: RentPayment }
  | { type: 'UPDATE_PAYMENT_STATUS'; payload: RentPayment }
  | { type: 'DELETE_RENT_PAYMENT'; payload: string }
  | { type: 'ADD_MAINTENANCE'; payload: MaintenanceRequest }
  | { type: 'UPDATE_MAINTENANCE'; payload: MaintenanceRequest }
  | { type: 'DELETE_MAINTENANCE'; payload: string };

const initialState: AppState = {
  properties: [],
  units: [],
  tenants: [],
  leases: [],
  rentPayments: [],
  expenses: [],
  incomes: [],
  maintenance: [],
  isLoading: false,
  error: null,
};

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_STATE':
      return { ...state, ...action.payload };
    case 'SET_LOADING':
      return { ...state, isLoading: action.payload };
    case 'SET_ERROR':
      return { ...state, error: action.payload };
    case 'ADD_PROPERTY':
      return { ...state, properties: [...state.properties, action.payload] };
    case 'UPDATE_PROPERTY':
      return {
        ...state,
        properties: state.properties.map(p => p.id === action.payload.id ? action.payload : p),
      };
    case 'DELETE_PROPERTY':
      return {
        ...state,
        properties: state.properties.filter(p => p.id !== action.payload),
        units: state.units.filter(u => u.propertyId !== action.payload),
      };
    case 'ADD_UNIT':
      return { ...state, units: [...state.units, action.payload] };
    case 'UPDATE_UNIT':
      return {
        ...state,
        units: state.units.map(u => u.id === action.payload.id ? action.payload : u),
      };
    case 'DELETE_UNIT':
      return {
        ...state,
        units: state.units.filter(u => u.id !== action.payload),
      };
    case 'ADD_TENANT':
      return { ...state, tenants: [...state.tenants, action.payload] };
    case 'UPDATE_TENANT':
      return {
        ...state,
        tenants: state.tenants.map(t => t.id === action.payload.id ? action.payload : t),
      };
    case 'DELETE_TENANT':
      return {
        ...state,
        tenants: state.tenants.filter(t => t.id !== action.payload),
      };
    case 'ADD_LEASE':
      return { ...state, leases: [action.payload, ...state.leases] };
    case 'UPDATE_LEASE':
      return {
        ...state,
        leases: state.leases.map(l => (l.id === action.payload.id ? action.payload : l)),
      };
    case 'DELETE_LEASE':
      return { ...state, leases: state.leases.filter(l => l.id !== action.payload) };
    case 'ADD_EXPENSE':
      return { ...state, expenses: [...state.expenses, action.payload] };
    case 'UPDATE_EXPENSE':
      return {
        ...state,
        expenses: state.expenses.map(e => e.id === action.payload.id ? action.payload : e),
      };
    case 'DELETE_EXPENSE':
      return {
        ...state,
        expenses: state.expenses.filter(e => e.id !== action.payload),
      };
    case 'ADD_INCOME':
      return { ...state, incomes: [...state.incomes, action.payload] };
    case 'ADD_RENT_PAYMENT':
      return { ...state, rentPayments: [...state.rentPayments, action.payload] };
    case 'UPDATE_PAYMENT_STATUS':
      return {
        ...state,
        rentPayments: state.rentPayments.map(p =>
          p.id === action.payload.id ? action.payload : p
        ),
      };
    case 'DELETE_RENT_PAYMENT':
      return { ...state, rentPayments: state.rentPayments.filter(p => p.id !== action.payload) };
    case 'ADD_MAINTENANCE':
      return { ...state, maintenance: [action.payload, ...state.maintenance] };
    case 'UPDATE_MAINTENANCE':
      return {
        ...state,
        maintenance: state.maintenance.map(m => m.id === action.payload.id ? action.payload : m),
      };
    case 'DELETE_MAINTENANCE':
      // Also drop the derived maintenance expense (id = maint-<requestId>) the
      // "mark paid" step created, so Finances and the Dashboard stop counting it
      // the moment the report is deleted, matching the server-side cleanup.
      return {
        ...state,
        maintenance: state.maintenance.filter(m => m.id !== action.payload),
        expenses: state.expenses.filter(e => e.id !== `maint-${action.payload}`),
      };
    default:
      return state;
  }
}

interface AppContextType extends AppState {
  dispatch: React.Dispatch<Action>;
  refreshData: () => Promise<void>;
  getPropertyUnits: (propertyId: string) => Unit[];
  getUnitLease: (unitId: string) => Lease | undefined;
  getLeaseTenants: (leaseId: string) => Tenant[];
  getTenantLeases: (tenantId: string) => Lease[];
  addProperty: (property: Omit<Property, 'id'>) => Promise<Property>;
  updateProperty: (property: Property) => Promise<void>;
  deleteProperty: (id: string) => Promise<void>;
  addUnit: (unit: Omit<Unit, 'id'>) => Promise<Unit>;
  updateUnit: (unit: Unit) => Promise<void>;
  deleteUnit: (id: string) => Promise<void>;
  addTenant: (tenant: Omit<Tenant, 'id'>) => Promise<Tenant>;
  updateTenant: (tenant: Tenant) => Promise<void>;
  deleteTenant: (id: string) => Promise<void>;
  addLease: (lease: Omit<Lease, 'id'> & { pausedAt?: string }) => Promise<Lease>;
  updateLease: (lease: Lease & { statusChangedOn?: string }) => Promise<void>;
  deleteLease: (id: string) => Promise<void>;
  addExpense: (expense: Omit<Expense, 'id'>) => Promise<void>;
  addIncome: (income: Omit<Income, 'id'>) => Promise<void>;
  addRentPayment: (payment: Omit<RentPayment, 'id'>, opts?: { deferSheetSync?: boolean }) => Promise<void>;
  updatePaymentStatus: (id: string, status: RentPayment['status'], paymentDetails?: { receivedDate?: string; paymentMethod?: RentPayment['paymentMethod']; uploadedBy?: string }) => Promise<void>;
  deleteRentPayment: (id: string) => Promise<void>;
  addMaintenance: (request: Omit<MaintenanceRequest, 'id'>) => Promise<void>;
  updateMaintenance: (request: MaintenanceRequest) => Promise<void>;
  deleteMaintenance: (id: string) => Promise<void>;
  resetData: () => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  const { isAuthenticated } = useAuth();

  const refreshData = useCallback(async () => {
    dispatch({ type: 'SET_LOADING', payload: true });
    dispatch({ type: 'SET_ERROR', payload: null });
    try {
      const [properties, units, tenants, leases, rentPayments, expenses, incomes, maintenance] = await Promise.all([
        propertiesApi.getAll(),
        unitsApi.getAll(),
        tenantsApi.getAll(),
        leasesApi.getAll(),
        paymentsApi.getAll(),
        expensesApi.getAll(),
        incomesApi.getAll(),
        maintenanceApi.getAll(),
      ]);
      dispatch({
        type: 'SET_STATE',
        payload: { properties, units, tenants, leases, rentPayments, expenses, incomes, maintenance, isLoading: false },
      });
    } catch (error) {
      dispatch({ type: 'SET_ERROR', payload: (error as Error).message });
      dispatch({ type: 'SET_LOADING', payload: false });
    }
  }, []);

  // Load data once the user is authenticated. When they sign out, clear it so
  // no stale data lingers and we never fire unauthenticated (401) requests.
  useEffect(() => {
    if (isAuthenticated) {
      refreshData();
    } else {
      dispatch({
        type: 'SET_STATE',
        payload: {
          properties: [], units: [], tenants: [], leases: [], rentPayments: [], expenses: [], incomes: [], maintenance: [],
          isLoading: false, error: null,
        },
      });
    }
  }, [isAuthenticated, refreshData]);

  const getPropertyUnits = useCallback((propertyId: string) =>
    state.units.filter(u => u.propertyId === propertyId), [state.units]);

  const getUnitLease = useCallback(
    (unitId: string) => state.leases.find(l => l.unitId === unitId && l.status !== 'ended'),
    [state.leases]
  );

  const getLeaseTenants = useCallback(
    (leaseId: string) => {
      const lease = state.leases.find(l => l.id === leaseId);
      if (!lease) return [];
      return state.tenants.filter(t => lease.tenantIds.includes(t.id));
    },
    [state.leases, state.tenants]
  );

  const getTenantLeases = useCallback(
    (tenantId: string) => state.leases.filter(l => l.tenantIds.includes(tenantId)),
    [state.leases]
  );

  const addProperty = async (property: Omit<Property, 'id'>) => {
    const newProperty = await propertiesApi.create(property);
    dispatch({ type: 'ADD_PROPERTY', payload: newProperty });
    return newProperty;
  };

  const updateProperty = async (property: Property) => {
    const updated = await propertiesApi.update(property.id, property);
    dispatch({ type: 'UPDATE_PROPERTY', payload: updated });
  };

  const deleteProperty = async (id: string) => {
    await propertiesApi.delete(id);
    dispatch({ type: 'DELETE_PROPERTY', payload: id });
  };

  const addUnit = async (unit: Omit<Unit, 'id'>) => {
    const newUnit = await unitsApi.create(unit);
    dispatch({ type: 'ADD_UNIT', payload: newUnit });
    return newUnit;
  };

  const updateUnit = async (unit: Unit) => {
    const updated = await unitsApi.update(unit.id, unit);
    dispatch({ type: 'UPDATE_UNIT', payload: updated });
  };

  const deleteUnit = async (id: string) => {
    await unitsApi.delete(id);
    dispatch({ type: 'DELETE_UNIT', payload: id });
  };

  const addTenant = async (tenant: Omit<Tenant, 'id'>) => {
    const created = await tenantsApi.create(tenant);
    dispatch({ type: 'ADD_TENANT', payload: created });
    return created;
  };

  const updateTenant = async (tenant: Tenant) => {
    const updated = await tenantsApi.update(tenant.id, tenant);
    dispatch({ type: 'UPDATE_TENANT', payload: updated });
  };

  const deleteTenant = async (id: string) => {
    await tenantsApi.delete(id);
    dispatch({ type: 'DELETE_TENANT', payload: id });
  };

  const addLease = async (lease: Omit<Lease, 'id'> & { pausedAt?: string }) => {
    const created = await leasesApi.create(lease);
    dispatch({ type: 'ADD_LEASE', payload: created });
    return created;
  };

  const updateLease = async (lease: Lease & { statusChangedOn?: string }) => {
    const updated = await leasesApi.update(lease.id, lease);
    dispatch({ type: 'UPDATE_LEASE', payload: updated });
  };

  const deleteLease = async (id: string) => {
    await leasesApi.delete(id);
    dispatch({ type: 'DELETE_LEASE', payload: id });
  };

  const addExpense = async (expense: Omit<Expense, 'id'>) => {
    const newExpense = await expensesApi.create(expense);
    dispatch({ type: 'ADD_EXPENSE', payload: newExpense });
  };

  const addIncome = async (income: Omit<Income, 'id'>) => {
    const newIncome = await incomesApi.create(income);
    dispatch({ type: 'ADD_INCOME', payload: newIncome });
  };

  const addRentPayment = async (payment: Omit<RentPayment, 'id'>, opts?: { deferSheetSync?: boolean }) => {
    const newPayment = await paymentsApi.create(payment, opts);
    dispatch({ type: 'ADD_RENT_PAYMENT', payload: newPayment });
  };

  const updatePaymentStatus = async (
    id: string,
    status: RentPayment['status'],
    paymentDetails?: { receivedDate?: string; paymentMethod?: RentPayment['paymentMethod']; uploadedBy?: string }
  ) => {
    const payment = state.rentPayments.find(p => p.id === id);
    if (!payment) return;
    const updated = await paymentsApi.update(id, {
      ...payment,
      status,
      paidDate: status === 'paid' ? todayLocalDate() : undefined,
      receivedDate: paymentDetails?.receivedDate,
      paymentMethod: paymentDetails?.paymentMethod,
      uploadedBy: paymentDetails?.uploadedBy,
      uploadedAt: new Date().toISOString(),
    });
    dispatch({ type: 'UPDATE_PAYMENT_STATUS', payload: updated });
  };

  const deleteRentPayment = async (id: string) => {
    await paymentsApi.delete(id);
    dispatch({ type: 'DELETE_RENT_PAYMENT', payload: id });
  };

  const addMaintenance = async (request: Omit<MaintenanceRequest, 'id'>) => {
    const created = await maintenanceApi.create(request);
    dispatch({ type: 'ADD_MAINTENANCE', payload: created });
  };

  const updateMaintenance = async (request: MaintenanceRequest) => {
    const updated = await maintenanceApi.update(request.id, request);
    dispatch({ type: 'UPDATE_MAINTENANCE', payload: updated });
  };

  const deleteMaintenance = async (id: string) => {
    await maintenanceApi.delete(id);
    dispatch({ type: 'DELETE_MAINTENANCE', payload: id });
  };

  const resetData = () => {
    dispatch({ type: 'SET_STATE', payload: initialState });
  };

  return (
    <AppContext.Provider
      value={{
        ...state,
        dispatch,
        refreshData,
        getPropertyUnits,
        getUnitLease,
        getLeaseTenants,
        getTenantLeases,
        addProperty,
        updateProperty,
        deleteProperty,
        addUnit,
        updateUnit,
        deleteUnit,
        addTenant,
        updateTenant,
        deleteTenant,
        addLease,
        updateLease,
        deleteLease,
        addExpense,
        addIncome,
        addRentPayment,
        updatePaymentStatus,
        deleteRentPayment,
        addMaintenance,
        updateMaintenance,
        deleteMaintenance,
        resetData,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

// The hook is co-located with its provider on purpose; splitting it out only to
// satisfy a dev-only fast-refresh rule would churn every import site.
// eslint-disable-next-line react-refresh/only-export-components
export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
