import type { Env } from './session';
import { getAccessToken, ensureRootFolder, getSetting, putSetting } from './google';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
const SHEET_MIME = 'application/vnd.google-apps.spreadsheet';
const RENT_SHEET_NAME = 'Rent Records';
const KEY_RENT_SHEET = 'google_rent_sheet_id';
const PAYMENTS_TAB = 'Payments';
const TENANTS_TAB = 'Tenants';

/** The Google Sheets URL for the "Open rent spreadsheet" link. */
export function rentSheetUrl(id: string): string {
  return `https://docs.google.com/spreadsheets/d/${id}/edit`;
}

/** The URL of the already-created rent sheet, or null if none exists yet. */
export async function currentRentSheetUrl(env: Env): Promise<string | null> {
  const id = await getSetting(env, KEY_RENT_SHEET);
  return id ? rentSheetUrl(id) : null;
}

// ---------------------------------------------------------------------------
// Pure row mappers (no I/O), so the projection is unit-testable.
// ---------------------------------------------------------------------------

export const PAYMENTS_HEADER = ['Paid date', 'Tenant', 'Unit', 'Property', 'Amount', 'Method', 'Month', 'Year', 'Status'];
export const TENANTS_HEADER = ['Name', 'Email', 'Phone', 'Unit', 'Property', 'Lease start', 'Monthly rent', 'Status'];

/** Turn a stored method value (bank_transfer) into a readable label. No dashes. */
export function prettyMethod(method: unknown): string {
  if (typeof method !== 'string' || !method) return '';
  return method.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export interface PaymentRow {
  paid_date: string | null;
  first_name: string | null;
  last_name: string | null;
  unit_number: string | null;
  address: string | null;
  amount: number | null;
  payment_method: string | null;
  month: number | null;
  year: number | null;
  status: string | null;
}

export function paymentRow(r: PaymentRow): (string | number)[] {
  const tenant = [r.first_name, r.last_name].filter(Boolean).join(' ');
  return [
    r.paid_date ?? '',
    tenant,
    r.unit_number ?? '',
    r.address ?? '',
    r.amount ?? 0,
    prettyMethod(r.payment_method),
    r.month ?? '',
    r.year ?? '',
    r.status ?? '',
  ];
}

export interface TenantRow {
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  unit_number: string | null;
  address: string | null;
  start_date: string | null;
  monthly_rent: number | null;
  status: string | null;
}

export function tenantRow(r: TenantRow): (string | number)[] {
  return [
    [r.first_name, r.last_name].filter(Boolean).join(' '),
    r.email ?? '',
    r.phone ?? '',
    r.unit_number ?? '',
    r.address ?? '',
    r.start_date ?? '',
    r.monthly_rent ?? '',
    r.status ?? '',
  ];
}

// ---------------------------------------------------------------------------
// Google Sheets / Drive plumbing.
// ---------------------------------------------------------------------------

async function fileGone(env: Env, id: string): Promise<boolean> {
  const token = await getAccessToken(env);
  const res = await fetch(`${DRIVE_API}/files/${id}?fields=id,trashed`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 404) return true;
  if (!res.ok) return false; // transient: do not fork a new sheet
  const data = (await res.json()) as { trashed?: boolean };
  return data.trashed === true;
}

async function sheetsBatchUpdate(env: Env, id: string, requests: unknown[]): Promise<void> {
  const token = await getAccessToken(env);
  const res = await fetch(`${SHEETS_API}/${id}:batchUpdate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests }),
  });
  if (!res.ok) throw new Error(`Sheets batchUpdate failed: ${res.status} ${await res.text()}`);
}

/** Create the master spreadsheet in the app root folder with the two named tabs. */
async function createRentSheet(env: Env, folderId: string): Promise<string> {
  const token = await getAccessToken(env);
  const res = await fetch(`${DRIVE_API}/files?fields=id`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: RENT_SHEET_NAME, mimeType: SHEET_MIME, parents: [folderId] }),
  });
  if (!res.ok) throw new Error(`Rent sheet create failed: ${res.status} ${await res.text()}`);
  const { id } = (await res.json()) as { id: string };
  // The new spreadsheet has one default sheet with sheetId 0. Rename it to
  // Payments and add the Tenants tab.
  await sheetsBatchUpdate(env, id, [
    { updateSheetProperties: { properties: { sheetId: 0, title: PAYMENTS_TAB }, fields: 'title' } },
    { addSheet: { properties: { title: TENANTS_TAB } } },
  ]);
  return id;
}

/** The master rent spreadsheet id, reused unless it is definitely gone. */
export async function ensureRentSheet(env: Env): Promise<string> {
  const existing = await getSetting(env, KEY_RENT_SHEET);
  if (existing && !(await fileGone(env, existing))) return existing;
  const folderId = await ensureRootFolder(env);
  const id = await createRentSheet(env, folderId);
  await putSetting(env, KEY_RENT_SHEET, id);
  return id;
}

async function clearTab(env: Env, id: string, tab: string): Promise<void> {
  const token = await getAccessToken(env);
  const res = await fetch(`${SHEETS_API}/${id}/values/${encodeURIComponent(`${tab}!A:Z`)}:clear`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Sheets clear failed: ${res.status} ${await res.text()}`);
}

async function writeTab(env: Env, id: string, tab: string, values: (string | number)[][]): Promise<void> {
  const token = await getAccessToken(env);
  const res = await fetch(
    `${SHEETS_API}/${id}/values/${encodeURIComponent(`${tab}!A1`)}?valueInputOption=RAW`,
    {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ values }),
    }
  );
  if (!res.ok) throw new Error(`Sheets write failed: ${res.status} ${await res.text()}`);
}

/** Rewrite both tabs from the database, so the sheet mirrors the app exactly. */
export async function rebuildRentSheet(env: Env): Promise<string> {
  const id = await ensureRentSheet(env);

  const payments = await env.DB.prepare(
    `SELECT rp.paid_date, rp.amount, rp.payment_method, rp.month, rp.year, rp.status,
            t.first_name, t.last_name, u.unit_number, p.address
       FROM rent_payments rp
       LEFT JOIN tenants t ON t.id = rp.paid_by_tenant_id
       LEFT JOIN leases l ON l.id = rp.lease_id
       LEFT JOIN units u ON u.id = l.unit_id
       LEFT JOIN properties p ON p.id = l.property_id
      ORDER BY rp.year DESC, rp.month DESC, rp.paid_date DESC`
  ).all<PaymentRow>();

  const tenants = await env.DB.prepare(
    `SELECT t.first_name, t.last_name, t.email, t.phone,
            u.unit_number, p.address, l.start_date, l.monthly_rent, l.status
       FROM tenants t
       LEFT JOIN leases l ON l.id = (
         SELECT l2.id FROM leases l2
           JOIN lease_tenants lt ON lt.lease_id = l2.id
          WHERE lt.tenant_id = t.id AND (l2.needs_review IS NULL OR l2.needs_review = 0)
          ORDER BY l2.start_date DESC LIMIT 1)
       LEFT JOIN units u ON u.id = l.unit_id
       LEFT JOIN properties p ON p.id = l.property_id
      ORDER BY t.last_name, t.first_name`
  ).all<TenantRow>();

  await clearTab(env, id, PAYMENTS_TAB);
  await writeTab(env, id, PAYMENTS_TAB, [PAYMENTS_HEADER, ...(payments.results || []).map(paymentRow)]);
  await clearTab(env, id, TENANTS_TAB);
  await writeTab(env, id, TENANTS_TAB, [TENANTS_HEADER, ...(tenants.results || []).map(tenantRow)]);

  return id;
}

/**
 * Fire a rebuild after the current request responds, best-effort. A failed
 * sheet sync must never affect the user's action; the database is the source
 * of truth and the next change or a manual sync reconciles.
 */
export function syncRentSheet(context: { env: Env; waitUntil: (p: Promise<unknown>) => void }): void {
  context.waitUntil(rebuildRentSheet(context.env).catch(() => {}));
}
