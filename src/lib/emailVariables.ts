// Personalization variables available in the email template editor.
// Mirrors functions/lib/personalize.ts (the two bundles build separately).

export interface EmailVariable {
  token: string;
  label: string;
  group: 'Tenant' | 'Property' | 'Financial' | 'Lease' | 'Maintenance' | 'Company';
}

export const EMAIL_VARIABLES: EmailVariable[] = [
  { token: 'tenant_name', label: 'Full name', group: 'Tenant' },
  { token: 'first_name', label: 'First name', group: 'Tenant' },
  { token: 'last_name', label: 'Last name', group: 'Tenant' },
  { token: 'property_name', label: 'Property name', group: 'Property' },
  { token: 'property_address', label: 'Property address', group: 'Property' },
  { token: 'unit_number', label: 'Unit number', group: 'Property' },
  { token: 'rent_amount', label: 'Monthly rent', group: 'Financial' },
  { token: 'balance_due', label: 'Balance due', group: 'Financial' },
  { token: 'late_fee_amount', label: 'Late fee amount', group: 'Financial' },
  { token: 'payment_due_date', label: 'Payment due date', group: 'Financial' },
  { token: 'lease_start_date', label: 'Lease start date', group: 'Lease' },
  { token: 'lease_end_date', label: 'Lease end date', group: 'Lease' },
  { token: 'maintenance_request_number', label: 'Maintenance #', group: 'Maintenance' },
  { token: 'maintenance_status', label: 'Maintenance status', group: 'Maintenance' },
  { token: 'maintenance_description', label: 'Maintenance description', group: 'Maintenance' },
  { token: 'management_company_name', label: 'Company name', group: 'Company' },
  { token: 'management_email', label: 'Company email', group: 'Company' },
  { token: 'management_phone', label: 'Company phone', group: 'Company' },
  { token: 'tenant_portal_link', label: 'Tenant portal link', group: 'Company' },
];

export const TEMPLATE_CATEGORIES: { value: string; label: string }[] = [
  { value: 'rent', label: 'Rent & Financial' },
  { value: 'late_fee', label: 'Late Payment' },
  { value: 'payment', label: 'Payment Confirmation' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'inspection', label: 'Inspection' },
  { value: 'lease', label: 'Lease & Renewal' },
  { value: 'welcome', label: 'Move-in / Welcome' },
  { value: 'general', label: 'General Announcement' },
  { value: 'emergency', label: 'Emergency' },
  { value: 'custom', label: 'Custom' },
];

export function categoryLabel(value: string): string {
  return TEMPLATE_CATEGORIES.find((c) => c.value === value)?.label ?? value;
}
