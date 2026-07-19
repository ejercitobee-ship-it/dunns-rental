export type UserRole = 'super_admin' | 'admin' | 'manager' | 'viewer' | 'custom';

export interface Permission {
  id: string;
  name: string;
  description: string;
  module: 'dashboard' | 'properties' | 'tenants' | 'rents' | 'finances' | 'users' | 'settings';
}

export interface Role {
  id: string;
  name: string;
  description: string;
  permissions: string[]; // Array of permission IDs
  isSystem?: boolean; // Cannot be deleted if true
}

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  avatar?: string;
  roleId: string;
  role: Role;
  isActive: boolean;
  lastLogin?: string;
  createdAt: string;
  phone?: string;
  department?: string;
  photoUrl?: string | null;
}

export interface AuthState {
  isAuthenticated: boolean;
  user: User | null;
  token: string | null;
}

// System Permissions
export const SYSTEM_PERMISSIONS: Permission[] = [
  // Dashboard
  { id: 'dashboard_view', name: 'View Dashboard', description: 'Can view dashboard overview', module: 'dashboard' },
  
  // Properties
  { id: 'properties_view', name: 'View Properties', description: 'Can view properties list', module: 'properties' },
  { id: 'properties_create', name: 'Create Properties', description: 'Can add new properties', module: 'properties' },
  { id: 'properties_edit', name: 'Edit Properties', description: 'Can edit existing properties', module: 'properties' },
  { id: 'properties_delete', name: 'Delete Properties', description: 'Can delete properties', module: 'properties' },
  
  // Units
  { id: 'units_view', name: 'View Units', description: 'Can view units within properties', module: 'properties' },
  { id: 'units_create', name: 'Create Units', description: 'Can add new units', module: 'properties' },
  { id: 'units_edit', name: 'Edit Units', description: 'Can edit unit details', module: 'properties' },
  { id: 'units_delete', name: 'Delete Units', description: 'Can delete units', module: 'properties' },
  
  // Tenants
  { id: 'tenants_view', name: 'View Tenants', description: 'Can view tenant list', module: 'tenants' },
  { id: 'tenants_create', name: 'Create Tenants', description: 'Can add new tenants', module: 'tenants' },
  { id: 'tenants_edit', name: 'Edit Tenants', description: 'Can edit tenant information', module: 'tenants' },
  { id: 'tenants_delete', name: 'Delete Tenants', description: 'Can remove tenants', module: 'tenants' },
  
  // Rent Management
  { id: 'rents_view', name: 'View Rents', description: 'Can view rent payments', module: 'rents' },
  { id: 'rents_record', name: 'Record Payments', description: 'Can record rent payments', module: 'rents' },
  { id: 'rents_edit', name: 'Edit Payments', description: 'Can edit payment records', module: 'rents' },
  { id: 'rents_export', name: 'Export Rent Data', description: 'Can export rent reports', module: 'rents' },
  
  // Finances
  { id: 'finances_view', name: 'View Finances', description: 'Can view financial data', module: 'finances' },
  { id: 'finances_expenses', name: 'Manage Expenses', description: 'Can add and manage expenses', module: 'finances' },
  { id: 'finances_income', name: 'Manage Income', description: 'Can add and manage income', module: 'finances' },
  { id: 'finances_export', name: 'Export Financial Reports', description: 'Can export financial reports', module: 'finances' },
  
  // User Management
  { id: 'users_view', name: 'View Users', description: 'Can view team members', module: 'users' },
  { id: 'users_create', name: 'Create Users', description: 'Can add new team members', module: 'users' },
  { id: 'users_edit', name: 'Edit Users', description: 'Can edit user information', module: 'users' },
  { id: 'users_delete', name: 'Delete Users', description: 'Can remove team members', module: 'users' },
  { id: 'users_roles', name: 'Manage Roles', description: 'Can create and edit roles', module: 'users' },
  
  // Settings
  { id: 'settings_view', name: 'View Settings', description: 'Can view settings', module: 'settings' },
  { id: 'settings_edit', name: 'Edit Settings', description: 'Can modify system settings', module: 'settings' },
];

// Default System Roles
export const DEFAULT_ROLES: Role[] = [
  {
    id: 'super_admin',
    name: 'Super Admin',
    description: 'Full access to all features and settings',
    permissions: SYSTEM_PERMISSIONS.map(p => p.id),
    isSystem: true,
  },
  {
    id: 'admin',
    name: 'Admin',
    description: 'Can manage properties, tenants, and finances but cannot manage users',
    permissions: [
      'dashboard_view',
      'properties_view', 'properties_create', 'properties_edit', 'properties_delete',
      'units_view', 'units_create', 'units_edit', 'units_delete',
      'tenants_view', 'tenants_create', 'tenants_edit', 'tenants_delete',
      'rents_view', 'rents_record', 'rents_edit', 'rents_export',
      'finances_view', 'finances_expenses', 'finances_income', 'finances_export',
      'settings_view',
    ],
    isSystem: true,
  },
  {
    id: 'manager',
    name: 'Property Manager',
    description: 'Can manage day-to-day operations but cannot delete records',
    permissions: [
      'dashboard_view',
      'properties_view', 'properties_create', 'properties_edit',
      'units_view', 'units_create', 'units_edit',
      'tenants_view', 'tenants_create', 'tenants_edit',
      'rents_view', 'rents_record',
      'finances_view', 'finances_expenses', 'finances_income',
    ],
    isSystem: true,
  },
  {
    id: 'viewer',
    name: 'Viewer',
    description: 'Read-only access to view reports and data',
    permissions: [
      'dashboard_view',
      'properties_view',
      'units_view',
      'tenants_view',
      'rents_view',
      'finances_view',
    ],
    isSystem: true,
  },
  {
    id: 'accountant',
    name: 'Accountant',
    description: 'Access to financial data and rent management',
    permissions: [
      'dashboard_view',
      'properties_view',
      'units_view',
      'tenants_view',
      'rents_view', 'rents_record', 'rents_export',
      'finances_view', 'finances_expenses', 'finances_income', 'finances_export',
    ],
    isSystem: true,
  },
];

// Default Super Admin User
export const DEFAULT_SUPER_ADMIN: User = {
  id: '1',
  email: 'admin@mhdunn.com',
  firstName: 'MH',
  lastName: 'DUNN',
  avatar: undefined,
  roleId: 'super_admin',
  role: DEFAULT_ROLES[0],
  isActive: true,
  lastLogin: new Date().toISOString(),
  createdAt: new Date().toISOString(),
  phone: '(555) 123-4567',
  department: 'Management',
};
