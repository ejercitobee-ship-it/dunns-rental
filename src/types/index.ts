export interface Property {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  type: 'apartment' | 'house' | 'condo' | 'townhouse' | 'multi-family';
  description?: string;
  image?: string;
  purchaseDate?: string;
  purchasePrice?: number;
}

export interface Unit {
  id: string;
  propertyId: string;
  unitNumber: string;
  bedrooms: number;
  bathrooms: number;
  squareFeet: number;
  monthlyRent: number;
  status: 'occupied' | 'vacant' | 'maintenance';
  description?: string;
}

export type LeaseStatus = 'active' | 'paused' | 'ended';

export interface Lease {
  id: string;
  /** Cleared if the unit is deleted, so lease and payment history survive. */
  unitId?: string;
  propertyId?: string;
  startDate?: string;
  endDate?: string;
  monthlyRent: number;
  securityDeposit?: number;
  status: LeaseStatus;
  needsReview?: boolean;
  /**
   * Every stretch collection was paused on this lease, oldest first. The
   * server stamps these itself when the status changes to or from 'paused'
   * (off the `statusChangedOn` the client sends), so the client never writes
   * to this list directly and cannot forget to or disagree with the
   * database. An entry with no `resumedAt` is an OPEN pause: rent stays
   * stopped from the month after `pausedAt`, with no upper bound, until a
   * later status change resumes or ends the lease. A lease can carry more
   * than one entry, since it can be paused, resumed, and paused again.
   * Symmetric with `endDate`: the whole month a pause starts or resumes in
   * is still owed in full, no proration; only the months strictly between
   * are excluded.
   */
  pauses: { pausedAt: string; resumedAt?: string }[];
  notes?: string;
  tenantIds: string[];
}

/** A person. Rent and lease dates live on the Lease. */
export interface Tenant {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  notes?: string;
  emergencyContact?: {
    name: string;
    phone: string;
    relationship: string;
  };
  photoUrl?: string | null;
  hasLogin?: boolean;
}

export interface RentPayment {
  id: string;
  leaseId: string;
  paidByTenantId?: string;
  amount: number;
  dueDate?: string;
  paidDate?: string;
  receivedDate?: string;
  status: 'paid' | 'pending' | 'overdue' | 'partial';
  month: number;
  year: number;
  notes?: string;
  paymentMethod?: PaymentMethod;
  uploadedBy?: string;
  uploadedAt?: string;
  receiptDocumentId?: string;
}

export type PaymentMethod =
  | 'check'
  | 'money_order'
  | 'zelle'
  | 'venmo'
  | 'cash'
  | 'other';

export interface Expense {
  id: string;
  propertyId: string;
  unitId?: string;
  category: ExpenseCategory;
  amount: number;
  date: string;
  description: string;
  receipt?: string;
  vendor?: string;
  isRecurring: boolean;
  recurringFrequency?: 'monthly' | 'quarterly' | 'yearly';
  taxDeductible?: boolean;
  taxCategory?: string;
}

export type TaxDeductibleCategory =
  | 'advertising'
  | 'auto_travel'
  | 'cleaning_maintenance'
  | 'commissions'
  | 'insurance'
  | 'legal_professional'
  | 'management_fees'
  | 'mortgage_interest'
  | 'other_interest'
  | 'repairs'
  | 'supplies'
  | 'taxes'
  | 'utilities'
  | 'depreciation'
  | 'other';

export type ExpenseCategory = 
  | 'maintenance'
  | 'utilities'
  | 'insurance'
  | 'taxes'
  | 'mortgage'
  | 'repairs'
  | 'cleaning'
  | 'landscaping'
  | 'management'
  | 'other';

export interface Income {
  id: string;
  propertyId: string;
  unitId?: string;
  source: 'rent' | 'late_fee' | 'deposit' | 'other';
  amount: number;
  date: string;
  description: string;
  relatedPaymentId?: string;
}

// The maintenance job lifecycle:
// submitted -> assigned -> scheduled -> in_progress -> completed -> paid
// (cancelled at any point). scheduled_for is set when a handyman confirms a time.
export type MaintenanceStatus =
  | 'submitted'
  | 'assigned'
  | 'scheduled'
  | 'in_progress'
  | 'completed'
  | 'paid'
  | 'cancelled';
export type MaintenancePriority = 'low' | 'medium' | 'high' | 'urgent';

/** The trade categories a handyman works and a request is filed under. */
export const MAINTENANCE_TRADES = [
  'plumbing',
  'electrical',
  'hvac',
  'appliance',
  'carpentry',
  'general',
  'other',
] as const;
export type MaintenanceTrade = (typeof MAINTENANCE_TRADES)[number];

/** A window when the tenant is home for the work. Local calendar day + times. */
export interface AvailabilityWindow {
  date: string; // YYYY-MM-DD
  start: string; // HH:MM
  end: string; // HH:MM
}

export interface MaintenanceRequest {
  id: string;
  propertyId?: string;
  unitId?: string;
  tenantId?: string;
  title: string;
  description?: string;
  category?: string;
  priority: MaintenancePriority;
  status: MaintenanceStatus;
  cost: number;
  vendor?: string;
  reportedDate?: string;
  resolvedDate?: string;
  notes?: string;
  // Maintenance portal fields.
  assignedHandymanId?: string;
  scheduledFor?: string;
  availability?: AvailabilityWindow[];
  paidAt?: string;
  createdBy?: 'tenant' | 'admin';
  photoUrl?: string | null;
}

export interface Handyman {
  id: string;
  userId?: string;
  name: string;
  phone?: string;
  email?: string;
  address?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  trades: string[];
  isActive: boolean;
  hasLogin: boolean;
  photoUrl?: string | null;
}

export interface DashboardStats {
  totalProperties: number;
  totalUnits: number;
  occupiedUnits: number;
  totalTenants: number;
  monthlyIncome: number;
  monthlyExpenses: number;
  netIncome: number;
  totalOwed: number;
  occupancyRate: number;
  projectedYearlyIncome?: number;
}

export type ViewType = 'dashboard' | 'properties' | 'tenants' | 'rents' | 'expenses' | 'income';

/** Roles that belong in the portal and must never reach the management app. */
export const PORTAL_ROLES = ['tenant', 'realtor', 'handyman'] as const;

export function isPortalRole(roleId?: string): boolean {
  return !!roleId && (PORTAL_ROLES as readonly string[]).includes(roleId);
}

export interface PortalPayment {
  // The payment's own id and receipt, so a tenant can download or generate the
  // receipt for their own rent. Still never the payer (shared-lease privacy).
  id?: string;
  amount: number;
  dueDate?: string;
  paidDate?: string;
  status: 'paid' | 'pending' | 'overdue' | 'partial';
  month: number;
  year: number;
  // How the payment was recorded (cash, check, zelle, ...). The method only:
  // still never who paid, so the shared-lease privacy rule holds.
  paymentMethod?: PaymentMethod;
  receiptDocumentId?: string;
}
