export type UserRole = 'super_admin' | 'admin' | 'manager' | 'viewer' | 'custom';

export interface Permission {
  id: string;
  name: string;
  description: string;
  module: 'dashboard' | 'properties' | 'tenants' | 'rents' | 'finances' | 'leases' | 'maintenance' | 'documents' | 'reports' | 'users' | 'settings' | 'announcements' | 'ai_assistant';
  /** If true, this permission is only available for granular user grants, not
   * included in the basic role builder. Keeps the role editor clean. */
  advanced?: boolean;
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
  /** YYYY-MM-DD birthdate for calendar birthday events. */
  birthdate?: string;
  photoUrl?: string | null;
  twoFactorEnabled?: boolean;
  /** Merged permissions from the server: role permissions + per-user overrides.
   *  When present, permission checks use this instead of `role.permissions`. */
  effectivePermissions?: string[];
}

export interface AuthState {
  isAuthenticated: boolean;
  user: User | null;
  token: string | null;
}

// System Permissions — the full granular set.
// Permissions marked `advanced: true` only appear in the per-user grant UI,
// not in the basic role permission builder (to keep it manageable).
export const SYSTEM_PERMISSIONS: Permission[] = [
  // Dashboard
  { id: 'dashboard_view', name: 'View Dashboard', description: 'Can view the dashboard overview', module: 'dashboard' },

  // Properties
  { id: 'properties_view', name: 'View Properties', description: 'Can view the properties list', module: 'properties' },
  { id: 'properties_create', name: 'Create Properties', description: 'Can add new properties', module: 'properties' },
  { id: 'properties_edit', name: 'Edit Properties', description: 'Can edit property information', module: 'properties' },
  { id: 'properties_delete', name: 'Delete Properties', description: 'Can delete properties', module: 'properties' },
  { id: 'properties_history', name: 'Edit Property History', description: 'Can edit property notes and historical records', module: 'properties', advanced: true },
  { id: 'units_view', name: 'View Units', description: 'Can view units within properties', module: 'properties' },
  { id: 'units_create', name: 'Create Units', description: 'Can add new units', module: 'properties' },
  { id: 'units_edit', name: 'Edit Units', description: 'Can edit unit details', module: 'properties' },
  { id: 'units_delete', name: 'Delete Units', description: 'Can delete units', module: 'properties' },

  // Tenants
  { id: 'tenants_view', name: 'View Tenants', description: 'Can view the tenant list', module: 'tenants' },
  { id: 'tenants_create', name: 'Create Tenants', description: 'Can add new tenants', module: 'tenants' },
  { id: 'tenants_edit', name: 'Edit Tenants', description: 'Can edit tenant information', module: 'tenants' },
  { id: 'tenants_delete', name: 'Delete Tenants', description: 'Can remove tenants', module: 'tenants' },
  { id: 'tenants_archive', name: 'View Archived Tenants', description: 'Can view archived/terminated tenants', module: 'tenants', advanced: true },

  // Rent Management
  { id: 'rents_view', name: 'View Rents', description: 'Can view rent payments', module: 'rents' },
  { id: 'rents_record', name: 'Record Payments', description: 'Can record rent payments', module: 'rents' },
  { id: 'rents_edit', name: 'Edit Payments', description: 'Can edit payment records', module: 'rents' },
  { id: 'rents_export', name: 'Export Rent Data', description: 'Can export rent reports', module: 'rents' },

  // Finances
  { id: 'finances_view', name: 'View Finances', description: 'Can view financial data', module: 'finances' },
  { id: 'finances_expenses', name: 'Manage Expenses', description: 'Can add and edit expenses', module: 'finances' },
  { id: 'finances_expenses_delete', name: 'Delete Expenses', description: 'Can delete expense records', module: 'finances', advanced: true },
  { id: 'finances_import', name: 'Import Expense Data', description: 'Can upload and stage CSV expense imports', module: 'finances', advanced: true },
  { id: 'finances_import_merge', name: 'Merge Imported Expenses', description: 'Can merge staged imports into production', module: 'finances', advanced: true },
  { id: 'finances_import_rollback', name: 'Roll Back Imported Data', description: 'Can roll back a merged import', module: 'finances', advanced: true },
  { id: 'finances_history', name: 'Edit Financial History', description: 'Can edit historical financial records', module: 'finances', advanced: true },
  { id: 'finances_capital_projects', name: 'Manage Capital Projects', description: 'Can create, edit, and manage capital improvement projects', module: 'finances', advanced: true },
  { id: 'finances_capital_projects_delete', name: 'Delete Capital Projects', description: 'Can permanently delete capital improvement projects', module: 'finances', advanced: true },
  { id: 'finances_income', name: 'Manage Income', description: 'Can add and manage income', module: 'finances' },
  { id: 'finances_export', name: 'Export Financial Reports', description: 'Can export financial reports', module: 'finances' },

  // Leases
  { id: 'leases_generate', name: 'Generate Leases', description: 'Can generate new leases', module: 'leases', advanced: true },
  { id: 'leases_renewals', name: 'Approve/Reject Renewals', description: 'Can approve or reject lease renewals', module: 'leases', advanced: true },
  { id: 'leases_history', name: 'Edit Lease History', description: 'Can edit historical lease records and move in dates', module: 'leases', advanced: true },
  { id: 'leases_move_in', name: 'Edit Move In Fees', description: 'Can edit move in fee amounts and dates', module: 'leases', advanced: true },
  { id: 'leases_terminate', name: 'Terminate Leases', description: 'Can terminate active leases', module: 'leases', advanced: true },
  { id: 'leases_pause', name: 'Pause/Resume Leases', description: 'Can pause and resume rent collection', module: 'leases', advanced: true },

  // Maintenance
  { id: 'maintenance_approve', name: 'Approve Maintenance', description: 'Can approve maintenance requests and costs', module: 'maintenance', advanced: true },
  { id: 'maintenance_close', name: 'Close Maintenance', description: 'Can close and mark maintenance requests complete', module: 'maintenance', advanced: true },
  { id: 'maintenance_history', name: 'Edit Maintenance History', description: 'Can edit historical maintenance records', module: 'maintenance', advanced: true },

  // Documents
  { id: 'documents_upload', name: 'Upload Documents', description: 'Can upload documents and receipts', module: 'documents', advanced: true },
  { id: 'documents_delete', name: 'Delete Documents', description: 'Can delete uploaded documents', module: 'documents', advanced: true },
  { id: 'documents_drive', name: 'Manage Drive Files', description: 'Can manage Google Drive file organization', module: 'documents', advanced: true },

  // Reports
  { id: 'reports_tax', name: 'View Tax Reports', description: 'Can view the tax report', module: 'reports', advanced: true },
  { id: 'reports_export', name: 'Export Reports', description: 'Can export report data', module: 'reports', advanced: true },
  { id: 'reports_edit_data', name: 'Edit Report Data', description: 'Can edit data that feeds into reports', module: 'reports', advanced: true },

  // User Management
  { id: 'users_view', name: 'View Users', description: 'Can view team members', module: 'users' },
  { id: 'users_create', name: 'Create Users', description: 'Can add new team members', module: 'users' },
  { id: 'users_edit', name: 'Edit Users', description: 'Can edit user information', module: 'users' },
  { id: 'users_delete', name: 'Delete Users', description: 'Can remove team members', module: 'users' },
  { id: 'users_roles', name: 'Manage Roles', description: 'Can create and edit roles', module: 'users' },
  { id: 'users_permissions', name: 'Manage Permissions', description: 'Can grant and revoke individual permissions for team members', module: 'users', advanced: true },

  // Settings / Administration
  { id: 'settings_view', name: 'View Settings', description: 'Can view settings', module: 'settings' },
  { id: 'settings_edit', name: 'Edit Settings', description: 'Can modify system settings', module: 'settings' },
  { id: 'activity_view', name: 'Access Audit Logs', description: 'Can view the activity/audit log', module: 'settings', advanced: true },

  // Announcements
  { id: 'announcements_send', name: 'Send Announcements', description: 'Can create and send property announcements to tenants', module: 'announcements' },

  // AI Assistant
  { id: 'ai_assistant_use', name: 'Use AI Assistant', description: 'Can use the AI operations assistant to query property data', module: 'ai_assistant' },
];

/** Permission module labels for the UI. */
export const PERMISSION_MODULES: Record<Permission['module'], string> = {
  dashboard: 'Dashboard',
  properties: 'Property Management',
  tenants: 'Tenant Management',
  rents: 'Rent Management',
  finances: 'Financial Management',
  leases: 'Lease Management',
  maintenance: 'Maintenance',
  documents: 'Documents',
  reports: 'Reports',
  users: 'Administration',
  settings: 'System Settings',
  announcements: 'Announcements',
  ai_assistant: 'AI Assistant',
};

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
