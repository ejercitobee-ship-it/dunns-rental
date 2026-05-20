import React, { createContext, useContext, useReducer, useEffect, type ReactNode } from 'react';
import type { Property, Unit, Tenant, RentPayment, Expense, Income } from '../types';
import { properties as initialProperties, units as initialUnits, tenants as initialTenants, rentPayments as initialRentPayments, expenses as initialExpenses, incomes as initialIncomes } from '../data/mockData';

interface AppState {
  properties: Property[];
  units: Unit[];
  tenants: Tenant[];
  rentPayments: RentPayment[];
  expenses: Expense[];
  incomes: Income[];
}

type Action =
  | { type: 'SET_STATE'; payload: AppState }
  | { type: 'ADD_PROPERTY'; payload: Property }
  | { type: 'UPDATE_PROPERTY'; payload: Property }
  | { type: 'DELETE_PROPERTY'; payload: string }
  | { type: 'ADD_UNIT'; payload: Unit }
  | { type: 'UPDATE_UNIT'; payload: Unit }
  | { type: 'DELETE_UNIT'; payload: string }
  | { type: 'ADD_TENANT'; payload: Tenant }
  | { type: 'UPDATE_TENANT'; payload: Tenant }
  | { type: 'DELETE_TENANT'; payload: string }
  | { type: 'ADD_EXPENSE'; payload: Expense }
  | { type: 'UPDATE_EXPENSE'; payload: Expense }
  | { type: 'DELETE_EXPENSE'; payload: string }
  | { type: 'ADD_INCOME'; payload: Income }
  | { type: 'ADD_RENT_PAYMENT'; payload: RentPayment }
  | { type: 'UPDATE_PAYMENT_STATUS'; payload: { id: string; status: RentPayment['status']; paidDate?: string; receivedDate?: string; paymentMethod?: RentPayment['paymentMethod']; uploadedBy?: string; uploadedAt?: string } };

const STORAGE_KEY = 'rentmaster-data-v2';

function getInitialState(): AppState {
  if (typeof window !== 'undefined') {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        // Validate that it has the expected shape
        if (parsed && Array.isArray(parsed.properties)) {
          return parsed;
        }
      } catch (e) {
        console.error('Failed to parse saved data:', e);
      }
    }
  }
  return {
    properties: initialProperties,
    units: initialUnits,
    tenants: initialTenants,
    rentPayments: initialRentPayments,
    expenses: initialExpenses,
    incomes: initialIncomes,
  };
}

const initialState: AppState = getInitialState();

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'SET_STATE':
      return action.payload;
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
        tenants: state.tenants.filter(t => t.unitId !== action.payload),
      };
    case 'ADD_TENANT':
      return {
        ...state,
        tenants: [...state.tenants, action.payload],
        units: state.units.map(u =>
          u.id === action.payload.unitId ? { ...u, status: 'occupied' as const } : u
        ),
      };
    case 'UPDATE_TENANT':
      return {
        ...state,
        tenants: state.tenants.map(t => t.id === action.payload.id ? action.payload : t),
      };
    case 'DELETE_TENANT':
      const tenant = state.tenants.find(t => t.id === action.payload);
      return {
        ...state,
        tenants: state.tenants.filter(t => t.id !== action.payload),
        units: tenant
          ? state.units.map(u =>
              u.id === tenant.unitId ? { ...u, status: 'vacant' as const } : u
            )
          : state.units,
      };
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
          p.id === action.payload.id
            ? { ...p, status: action.payload.status, paidDate: action.payload.paidDate, receivedDate: action.payload.receivedDate, paymentMethod: action.payload.paymentMethod, uploadedBy: action.payload.uploadedBy, uploadedAt: action.payload.uploadedAt }
            : p
        ),
      };
    default:
      return state;
  }
}

interface AppContextType extends AppState {
  dispatch: React.Dispatch<Action>;
  getPropertyUnits: (propertyId: string) => Unit[];
  getUnitTenant: (unitId: string) => Tenant | undefined;
  getPropertyTenants: (propertyId: string) => Tenant[];
  getAvailableUnits: (propertyId?: string) => Unit[];
  addProperty: (property: Omit<Property, 'id'>) => void;
  updateProperty: (property: Property) => void;
  deleteProperty: (id: string) => void;
  addUnit: (unit: Omit<Unit, 'id'>) => void;
  updateUnit: (unit: Unit) => void;
  deleteUnit: (id: string) => void;
  addTenant: (tenant: Omit<Tenant, 'id'>) => void;
  updateTenant: (id: string, updates: Partial<Tenant>) => void;
  deleteTenant: (id: string) => void;
  addExpense: (expense: Omit<Expense, 'id'>) => void;
  addIncome: (income: Omit<Income, 'id'>) => void;
  addRentPayment: (payment: Omit<RentPayment, 'id'>) => void;
  updatePaymentStatus: (id: string, status: RentPayment['status'], paymentDetails?: { receivedDate?: string; paymentMethod?: RentPayment['paymentMethod']; uploadedBy?: string }) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  // Save to localStorage on every state change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const getPropertyUnits = (propertyId: string) =>
    state.units.filter(u => u.propertyId === propertyId);

  const getUnitTenant = (unitId: string) =>
    state.tenants.find(t => t.unitId === unitId && t.status === 'active');

  const getPropertyTenants = (propertyId: string) =>
    state.tenants.filter(t => t.propertyId === propertyId && t.status === 'active');

  const getAvailableUnits = (propertyId?: string) =>
    state.units.filter(u =>
      u.status === 'vacant' && (!propertyId || u.propertyId === propertyId)
    );

  const generateId = () => Math.random().toString(36).substr(2, 9);

  const addProperty = (property: Omit<Property, 'id'>) => {
    dispatch({ type: 'ADD_PROPERTY', payload: { ...property, id: generateId() } });
  };

  const updateProperty = (property: Property) => {
    dispatch({ type: 'UPDATE_PROPERTY', payload: property });
  };

  const deleteProperty = (id: string) => {
    dispatch({ type: 'DELETE_PROPERTY', payload: id });
  };

  const addUnit = (unit: Omit<Unit, 'id'>) => {
    dispatch({ type: 'ADD_UNIT', payload: { ...unit, id: generateId() } });
  };

  const updateUnit = (unit: Unit) => {
    dispatch({ type: 'UPDATE_UNIT', payload: unit });
  };

  const deleteUnit = (id: string) => {
    dispatch({ type: 'DELETE_UNIT', payload: id });
  };

  const addTenant = (tenant: Omit<Tenant, 'id'>) => {
    dispatch({ type: 'ADD_TENANT', payload: { ...tenant, id: generateId() } });
  };

  const updateTenant = (id: string, updates: Partial<Tenant>) => {
    const tenant = state.tenants.find(t => t.id === id);
    if (tenant) {
      dispatch({ type: 'UPDATE_TENANT', payload: { ...tenant, ...updates } });
    }
  };

  const deleteTenant = (id: string) => {
    dispatch({ type: 'DELETE_TENANT', payload: id });
  };

  const addExpense = (expense: Omit<Expense, 'id'>) => {
    dispatch({ type: 'ADD_EXPENSE', payload: { ...expense, id: generateId() } });
  };

  const addIncome = (income: Omit<Income, 'id'>) => {
    dispatch({ type: 'ADD_INCOME', payload: { ...income, id: generateId() } });
  };

  const addRentPayment = (payment: Omit<RentPayment, 'id'>) => {
    dispatch({ type: 'ADD_RENT_PAYMENT', payload: { ...payment, id: generateId() } });
  };

  const updatePaymentStatus = (id: string, status: RentPayment['status'], paymentDetails?: { receivedDate?: string; paymentMethod?: RentPayment['paymentMethod']; uploadedBy?: string }) => {
    const paidDate = status === 'paid' ? new Date().toISOString().split('T')[0] : undefined;
    dispatch({
      type: 'UPDATE_PAYMENT_STATUS',
      payload: {
        id,
        status,
        paidDate,
        receivedDate: paymentDetails?.receivedDate,
        paymentMethod: paymentDetails?.paymentMethod,
        uploadedBy: paymentDetails?.uploadedBy,
        uploadedAt: new Date().toISOString(),
      }
    });
  };

  return (
    <AppContext.Provider
      value={{
        ...state,
        dispatch,
        getPropertyUnits,
        getUnitTenant,
        getPropertyTenants,
        getAvailableUnits,
        addProperty,
        updateProperty,
        deleteProperty,
        addUnit,
        updateUnit,
        deleteUnit,
        addTenant,
        updateTenant,
        deleteTenant,
        addExpense,
        addIncome,
        addRentPayment,
        updatePaymentStatus,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (!context) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
