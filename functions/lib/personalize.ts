// Personalization for email templates and campaigns.
//
// Templates contain {{variable}} tokens. At send time, renderTemplate() swaps
// each token for the recipient's real value. A missing or unknown token renders
// as an empty string, never a broken "{{...}}" placeholder, per the spec.
//
// The variable REGISTRY below is the single source of truth for which tokens
// exist and how they are grouped in the editor's variable picker. The frontend
// keeps a matching list in src/lib/emailVariables.ts (the two bundles are
// built separately, like the permissions map).

export interface EmailVariable {
  /** Token name without braces, e.g. "first_name". */
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

const KNOWN_TOKENS = new Set(EMAIL_VARIABLES.map((v) => v.token));

export type PersonalizationContext = Record<string, string | number | null | undefined>;

/**
 * Replace every {{token}} in `html` with its value from `ctx`. A known token
 * with no value, and any unknown token, both render as an empty string so no
 * raw placeholder is ever emailed. Whitespace inside the braces is tolerated.
 */
export function renderTemplate(html: string, ctx: PersonalizationContext): string {
  if (!html) return '';
  return html.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_match, rawToken: string) => {
    const token = rawToken.toLowerCase();
    if (!KNOWN_TOKENS.has(token)) return '';
    const value = ctx[token];
    if (value === null || value === undefined) return '';
    return String(value);
  });
}

/** Sample values for previewing a template before any recipient is resolved. */
export const SAMPLE_CONTEXT: PersonalizationContext = {
  tenant_name: 'Jordan Rivera',
  first_name: 'Jordan',
  last_name: 'Rivera',
  property_name: '5116 N Kolmar',
  property_address: '5116 N Kolmar Ave, Chicago, IL',
  unit_number: 'Unit 2',
  rent_amount: '$1,200.00',
  balance_due: '$1,200.00',
  late_fee_amount: '$50.00',
  payment_due_date: 'the 1st',
  lease_start_date: 'Jan 1, 2026',
  lease_end_date: 'Dec 31, 2026',
  maintenance_request_number: '#1042',
  maintenance_status: 'In progress',
  maintenance_description: 'Kitchen faucet repair',
  management_company_name: 'MH Dunn Property',
  management_email: 'info@mhdunnproperty.net',
  management_phone: '(773) 555-0100',
  tenant_portal_link: 'https://mhdunnproperty.net/portal',
};
