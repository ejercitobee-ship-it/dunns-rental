import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { Env } from './session';
import { getSetting, ensureTenantFolder, uploadToDrive, deleteDriveFile } from './google';
import { sendEmail } from './email';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

/** A short, human-ish receipt number, stable for a given payment. */
export function receiptNumber(paymentId: string, month: number, year: number): string {
  const mm = String(month).padStart(2, '0');
  const suffix = paymentId.replace(/-/g, '').slice(0, 6).toUpperCase();
  return `R-${year}${mm}-${suffix}`;
}

/** "July 2026" for a 1..12 month and a year. Blank month/year degrade gracefully. */
export function periodLabel(month: number, year: number): string {
  const name = MONTHS[month - 1];
  return [name, year || ''].filter(Boolean).join(' ');
}

function money(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount || 0);
}

function prettyMethod(method: string | null | undefined): string {
  if (!method) return 'Not specified';
  return method.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
}

export interface ReceiptData {
  receiptNumber: string;
  datePaid: string;
  company: { name: string; lines: string[] };
  tenantName: string;
  location: string;
  period: string;
  amount: string;
  method: string;
}

/**
 * Lay out a one-page rent receipt as a PDF. Pure (no I/O): standard Helvetica
 * so no fontkit is needed in the Workers runtime.
 */
export async function buildReceiptPdf(data: ReceiptData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]); // US Letter
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const ink = rgb(0.11, 0.1, 0.09);
  const muted = rgb(0.46, 0.45, 0.42);
  const line = rgb(0.85, 0.84, 0.8);
  const green = rgb(0.17, 0.48, 0.35);

  const left = 56;
  const right = 556;
  let y = 740;

  const text = (s: string, x: number, yy: number, size: number, f = font, color = ink) =>
    page.drawText(s, { x, y: yy, size, font: f, color });

  // Company header
  text(data.company.name, left, y, 20, bold);
  y -= 20;
  for (const l of data.company.lines) {
    if (!l) continue;
    text(l, left, y, 10, font, muted);
    y -= 14;
  }

  // Title + receipt meta (right aligned-ish)
  text('RENT RECEIPT', right - bold.widthOfTextAtSize('RENT RECEIPT', 16), 740, 16, bold);
  text(`No. ${data.receiptNumber}`, right - font.widthOfTextAtSize(`No. ${data.receiptNumber}`, 10), 722, 10, font, muted);
  text(`Date paid: ${data.datePaid}`, right - font.widthOfTextAtSize(`Date paid: ${data.datePaid}`, 10), 708, 10, font, muted);

  y -= 8;
  page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 1, color: line });
  y -= 34;

  // Field rows
  const field = (label: string, value: string) => {
    text(label.toUpperCase(), left, y, 9, bold, muted);
    text(value || '—', left, y - 16, 13, font, ink);
    y -= 44;
  };
  field('Received from', data.tenantName);
  field('Property', data.location);
  field('For rent period', data.period);
  field('Payment method', data.method);

  // Amount box
  y -= 6;
  const boxTop = y;
  const boxH = 56;
  page.drawRectangle({
    x: left, y: boxTop - boxH, width: right - left, height: boxH,
    color: rgb(0.96, 0.965, 0.955), borderColor: line, borderWidth: 1,
  });
  text('AMOUNT PAID', left + 18, boxTop - 22, 9, bold, muted);
  text(data.amount, left + 18, boxTop - 44, 22, bold, ink);
  const paid = 'PAID';
  text(paid, right - 18 - bold.widthOfTextAtSize(paid, 22), boxTop - 40, 22, bold, green);

  // Footer
  text('Thank you for your payment.', left, 96, 11, font, muted);
  text(
    'This receipt was generated automatically by the property management system.',
    left, 78, 9, font, muted
  );

  return pdf.save();
}

interface CompanySettings {
  companyName: string;
  address: string;
  city: string;
  state: string;
  zipCode: string;
  phone: string;
  email: string;
}

const COMPANY_DEFAULTS: CompanySettings = {
  companyName: 'MH Dunn Property',
  address: '', city: '', state: '', zipCode: '', phone: '', email: 'info@mhdunnproperty.net',
};

async function companySettings(env: Env): Promise<CompanySettings> {
  const raw = await getSetting(env, 'company');
  if (!raw) return COMPANY_DEFAULTS;
  try {
    return { ...COMPANY_DEFAULTS, ...(JSON.parse(raw) as Partial<CompanySettings>) };
  } catch {
    return COMPANY_DEFAULTS;
  }
}

interface PaymentJoin {
  id: string;
  amount: number;
  month: number;
  year: number;
  paid_date: string | null;
  received_date: string | null;
  payment_method: string | null;
  status: string;
  paid_by_tenant_id: string | null;
  lease_id: string | null;
  property_id: string | null;
  unit_number: string | null;
  property_name: string | null;
  receipt_document_id: string | null;
}

interface TenantRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
}

/**
 * Generate the receipt for a PAID payment: build the PDF, file it in the
 * tenant's Drive folder, record it as a document, link it to the payment, and
 * best-effort email the tenant. Returns the document id, or null when there is
 * nothing to receipt (not paid, no lease, or no tenant to file it under).
 *
 * Best-effort by contract: callers wrap it so a Drive/PDF/email failure never
 * affects recording the payment.
 */
export async function generateReceipt(env: Env, paymentId: string, uploadedBy?: string): Promise<string | null> {
  const p = await env.DB.prepare(
    `SELECT rp.id, rp.amount, rp.month, rp.year, rp.paid_date, rp.received_date,
            rp.payment_method, rp.status, rp.paid_by_tenant_id, rp.lease_id,
            rp.receipt_document_id,
            l.property_id AS property_id, u.unit_number AS unit_number, pr.name AS property_name
       FROM rent_payments rp
       LEFT JOIN leases l ON l.id = rp.lease_id
       LEFT JOIN units u ON u.id = l.unit_id
       LEFT JOIN properties pr ON pr.id = l.property_id
      WHERE rp.id = ?`
  ).bind(paymentId).first<PaymentJoin>();
  if (!p || p.status !== 'paid' || !p.lease_id) return null;

  // The tenant to file under: the recorded payer if there is one, else the
  // lease's first occupant. No tenant means nowhere to file it — skip.
  let tenant: TenantRow | null = null;
  if (p.paid_by_tenant_id) {
    tenant = await env.DB.prepare('SELECT id, first_name, last_name, email FROM tenants WHERE id = ?')
      .bind(p.paid_by_tenant_id).first<TenantRow>();
  }
  if (!tenant) {
    tenant = await env.DB.prepare(
      `SELECT t.id, t.first_name, t.last_name, t.email
         FROM tenants t JOIN lease_tenants lt ON lt.tenant_id = t.id
        WHERE lt.lease_id = ? ORDER BY t.last_name, t.first_name LIMIT 1`
    ).bind(p.lease_id).first<TenantRow>();
  }
  if (!tenant) return null;

  const company = await companySettings(env);
  const tenantName = `${tenant.first_name} ${tenant.last_name}`.trim();
  const period = periodLabel(p.month, p.year);
  const location = [p.property_name, p.unit_number ? `Unit ${p.unit_number}` : null].filter(Boolean).join(' · ') || '—';
  const datePaid = p.paid_date || p.received_date || '';

  const pdfBytes = await buildReceiptPdf({
    receiptNumber: receiptNumber(p.id, p.month, p.year),
    datePaid,
    company: {
      name: company.companyName,
      lines: [
        company.address,
        [company.city, company.state, company.zipCode].filter(Boolean).join(', '),
        [company.phone, company.email].filter(Boolean).join('  ·  '),
      ],
    },
    tenantName,
    location,
    period,
    amount: money(p.amount),
    method: prettyMethod(p.payment_method),
  });

  const name = `Rent receipt - ${period || p.id.slice(0, 6)}.pdf`;
  const folderId = await ensureTenantFolder(env, tenant.id);
  const { id: driveId } = await uploadToDrive(
    env, folderId, name, 'application/pdf', new Blob([pdfBytes], { type: 'application/pdf' })
  );

  const docId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO documents (id, name, drive_file_id, content_type, size, property_id, tenant_id, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(docId, name, driveId, 'application/pdf', pdfBytes.length, p.property_id, tenant.id, uploadedBy ?? null),
    env.DB.prepare('UPDATE rent_payments SET receipt_document_id = ? WHERE id = ?').bind(docId, paymentId),
  ]);

  // Regenerating replaces the receipt: remove the old one so duplicates do not
  // pile up in Drive. Best-effort — the new receipt is already the linked one.
  if (p.receipt_document_id && p.receipt_document_id !== docId) {
    try {
      const old = await env.DB.prepare('SELECT drive_file_id FROM documents WHERE id = ?')
        .bind(p.receipt_document_id).first<{ drive_file_id: string | null }>();
      if (old?.drive_file_id) await deleteDriveFile(env, old.drive_file_id);
      await env.DB.prepare('DELETE FROM documents WHERE id = ?').bind(p.receipt_document_id).run();
    } catch {
      // Leave the old copy if cleanup fails; the Documents list hides it by name.
    }
  }

  if (tenant.email) {
    try {
      const subject = `Your rent receipt${period ? ` for ${period}` : ''}`;
      const body = `Hi ${tenant.first_name}, your payment of ${money(p.amount)}${period ? ` for ${period}` : ''} has been received. You can download your receipt in your tenant portal under Payments.`;
      await sendEmail(env, {
        to: tenant.email,
        subject,
        text: body,
        html: `<p>${body}</p>`,
      });
    } catch {
      // Best-effort: the receipt is already filed regardless of email.
    }
  }

  return docId;
}
