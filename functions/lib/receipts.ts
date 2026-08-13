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

/** "2026-07-01" -> "July 1, 2026"; leaves anything unexpected as-is. */
function prettyDate(dateStr: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
  if (!m) return dateStr;
  return `${MONTHS[Number(m[2]) - 1] ?? ''} ${Number(m[3])}, ${m[1]}`.trim();
}

export interface ReceiptEmailData {
  companyName: string;
  contact: string;
  receiptNumber: string;
  firstName: string;
  tenantName: string;
  location: string;
  period: string;
  amount: string;
  method: string;
  datePaid: string;
  /** Optional notes to show on the email receipt. */
  notes?: string;
  /** Override the heading, e.g. "Rent credit" instead of "Rent receipt". */
  heading?: string;
  /** Override the badge label, e.g. "CREDIT" instead of "PAID". */
  badgeLabel?: string;
  /** Override the amount label, e.g. "CREDIT AMOUNT" instead of "AMOUNT PAID". */
  amountLabel?: string;
  /** Override the confirmation text shown to the tenant. */
  confirmationText?: string;
}

/** A branded, receipt-styled HTML email (inline styles, table layout for email clients). */
export function receiptEmailHtml(d: ReceiptEmailData): string {
  const row = (label: string, value: string) =>
    `<tr><td style="padding:7px 0;color:#75726b;font-size:13px;">${label}</td>` +
    `<td style="padding:7px 0;text-align:right;font-size:13px;color:#1c1a17;font-weight:500;">${value || '—'}</td></tr>`;
  return `
<div style="background:#f4f5f3;padding:24px 12px;font-family:Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
    <table role="presentation" width="520" cellpadding="0" cellspacing="0" style="max-width:520px;width:100%;background:#ffffff;border:1px solid #e2e0d8;border-radius:12px;">
      <tr><td style="padding:28px 32px 18px;border-bottom:1px solid #eeece6;">
        <div style="font-size:20px;font-weight:bold;color:#24503f;">${d.companyName}</div>
        ${d.contact ? `<div style="font-size:12px;color:#8a887f;margin-top:6px;">${d.contact}</div>` : ''}
      </td></tr>
      <tr><td style="padding:24px 32px 4px;">
        <div style="font-size:16px;font-weight:bold;color:#1c1a17;">${d.heading || 'Rent receipt'}</div>
        <div style="font-size:12px;color:#8a887f;margin-top:4px;">No. ${d.receiptNumber}${d.datePaid ? ` &nbsp;&middot;&nbsp; ${d.datePaid}` : ''}</div>
        <p style="font-size:14px;color:#1c1a17;line-height:1.6;margin:16px 0 4px;">${d.confirmationText || `Hi ${d.firstName}, we've received your rent payment${d.period ? ` for ${d.period}` : ''}. Thank you.`}</p>
      </td></tr>
      <tr><td style="padding:8px 32px 0;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
          ${row('Received from', d.tenantName)}
          ${row('Property', d.location)}
          ${row('Rent period', d.period)}
          ${row('Payment method', d.method)}
          ${d.notes ? row('Notes', d.notes) : ''}
        </table>
      </td></tr>
      <tr><td style="padding:16px 32px 4px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f5f6f4;border:1px solid #e7e5dd;border-radius:8px;"><tr>
          <td style="padding:16px 18px;">
            <div style="font-size:11px;letter-spacing:0.08em;color:#8a887f;font-weight:bold;">${d.amountLabel || 'AMOUNT PAID'}</div>
            <div style="font-size:22px;font-weight:bold;color:#1c1a17;margin-top:2px;">${d.amount}</div>
          </td>
          <td style="padding:16px 18px;text-align:right;font-size:16px;font-weight:bold;color:#2b7a59;">${d.badgeLabel || 'PAID'}</td>
        </tr></table>
      </td></tr>
      <tr><td style="padding:16px 32px 24px;">
        <p style="font-size:13px;color:#75726b;line-height:1.6;margin:0;">You can view and download this receipt anytime in your tenant portal, under <strong>Payments</strong>.</p>
      </td></tr>
      <tr><td style="padding:14px 32px;border-top:1px solid #eeece6;font-size:11px;color:#8a887f;">
        ${d.companyName}${d.contact ? ` &nbsp;&middot;&nbsp; ${d.contact}` : ''}
      </td></tr>
    </table>
  </td></tr></table>
</div>`.trim();
}

/** Plain-text fallback for the receipt email. */
export function receiptEmailText(d: ReceiptEmailData): string {
  const heading = d.heading || 'Rent receipt';
  const badge = d.badgeLabel || 'PAID';
  const amtLabel = d.amountLabel || 'Amount paid';
  const lines = [
    `${d.companyName} — ${heading}`,
    `No. ${d.receiptNumber}${d.datePaid ? ` · ${d.datePaid}` : ''}`,
    '',
    d.confirmationText || `Hi ${d.firstName}, we've received your rent payment${d.period ? ` for ${d.period}` : ''}. Thank you.`,
    '',
    `Received from: ${d.tenantName}`,
    `Property: ${d.location}`,
    `Rent period: ${d.period}`,
    `Payment method: ${d.method}`,
  ];
  if (d.notes) lines.push(`Notes: ${d.notes}`);
  lines.push(`${amtLabel}: ${d.amount} (${badge})`);
  lines.push('', 'You can view and download this receipt anytime in your tenant portal, under Payments.');
  return lines.join('\n');
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
  /** Heading, e.g. "RENT RECEIPT" (default) or "MOVE-IN FEE RECEIPT". */
  title?: string;
  /** Label for the period row, e.g. "For rent period" (default) or "Payment for". */
  periodFieldLabel?: string;
  /** Optional notes to display on the receipt (e.g. credit reason). */
  notes?: string;
  /** Badge label shown in the green box, e.g. "PAID" (default) or "CREDIT". */
  badgeLabel?: string;
  /** Label for the amount row, e.g. "AMOUNT PAID" (default) or "CREDIT AMOUNT". */
  amountLabel?: string;
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
  const heading = (data.title || 'RENT RECEIPT').toUpperCase();
  text(heading, right - bold.widthOfTextAtSize(heading, 16), 740, 16, bold);
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
  field(data.periodFieldLabel || 'For rent period', data.period);
  field('Payment method', data.method);
  if (data.notes) field('Notes', data.notes);

  // Amount box
  y -= 6;
  const boxTop = y;
  const boxH = 56;
  page.drawRectangle({
    x: left, y: boxTop - boxH, width: right - left, height: boxH,
    color: rgb(0.96, 0.965, 0.955), borderColor: line, borderWidth: 1,
  });
  const amtLabel = (data.amountLabel || 'AMOUNT PAID').toUpperCase();
  text(amtLabel, left + 18, boxTop - 22, 9, bold, muted);
  text(data.amount, left + 18, boxTop - 44, 22, bold, ink);
  const badge = (data.badgeLabel || 'PAID').toUpperCase();
  text(badge, right - 18 - bold.widthOfTextAtSize(badge, 22), boxTop - 40, 22, bold, green);

  // Footer
  text('Thank you for your payment.', left, 96, 11, font, muted);
  text(
    'This receipt was generated automatically by the property management system.',
    left, 78, 9, font, muted
  );

  return pdf.save();
}

export interface CompanySettings {
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

/** The company identity from app_settings, for receipts, invites, and emails. */
export async function companySettings(env: Env): Promise<CompanySettings> {
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
  property_address: string | null;
  property_city: string | null;
  property_state: string | null;
  property_zip: string | null;
  receipt_document_id: string | null;
  type: string | null;
  credit_reason: string | null;
  notes: string | null;
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
interface MoveInLeaseRow {
  id: string;
  security_deposit: number | null;
  move_in_fee_paid_date: string | null;
  move_in_fee_method: string | null;
  move_in_fee_receipt_document_id: string | null;
  property_id: string | null;
  unit_number: string | null;
  property_name: string | null;
  property_address: string | null;
  property_city: string | null;
  property_state: string | null;
  property_zip: string | null;
}

/**
 * Generate the receipt for a paid MOVE-IN FEE on a lease: build the PDF, file it
 * in the tenant's Drive folder, record it as a document, link it on the lease,
 * and best-effort email the tenant. Returns the document id, or null when there
 * is nothing to receipt. Best-effort by contract, like generateReceipt.
 */
export async function generateMoveInFeeReceipt(env: Env, leaseId: string, uploadedBy?: string): Promise<string | null> {
  const l = await env.DB.prepare(
    `SELECT l.id, l.security_deposit, l.move_in_fee_paid_date, l.move_in_fee_method,
            l.move_in_fee_receipt_document_id, l.property_id AS property_id,
            u.unit_number AS unit_number,
            pr.name AS property_name, pr.address AS property_address,
            pr.city AS property_city, pr.state AS property_state, pr.zip_code AS property_zip
       FROM leases l
       LEFT JOIN units u ON u.id = l.unit_id
       LEFT JOIN properties pr ON pr.id = l.property_id
      WHERE l.id = ?`
  ).bind(leaseId).first<MoveInLeaseRow>();
  if (!l) return null;

  const tenant = await env.DB.prepare(
    `SELECT t.id, t.first_name, t.last_name, t.email
       FROM tenants t JOIN lease_tenants lt ON lt.tenant_id = t.id
      WHERE lt.lease_id = ? ORDER BY t.last_name, t.first_name LIMIT 1`
  ).bind(leaseId).first<TenantRow>();
  if (!tenant) return null;

  const company = await companySettings(env);
  const tenantName = `${tenant.first_name} ${tenant.last_name}`.trim();
  const cityStateZip = [
    [l.property_city, l.property_state].filter(Boolean).join(', '),
    l.property_zip,
  ].filter(Boolean).join(' ');
  const fullAddress = [l.property_address, cityStateZip].filter(Boolean).join(', ');
  const location = [
    fullAddress || l.property_name,
    l.unit_number ? `Unit ${l.unit_number}` : null,
  ].filter(Boolean).join(' · ') || '—';
  const datePaid = l.move_in_fee_paid_date ? prettyDate(l.move_in_fee_paid_date) : '';
  const rNumber = `MIF-${leaseId.replace(/-/g, '').slice(0, 8).toUpperCase()}`;

  const pdfBytes = await buildReceiptPdf({
    receiptNumber: rNumber,
    datePaid,
    title: 'Move-In Fee Receipt',
    periodFieldLabel: 'Payment for',
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
    period: 'One-time move-in fee (non-refundable)',
    amount: money(l.security_deposit || 0),
    method: prettyMethod(l.move_in_fee_method),
  });

  const name = `Move-in fee receipt - ${tenantName || leaseId.slice(0, 6)}.pdf`;
  const folderId = await ensureTenantFolder(env, tenant.id);
  const { id: driveId } = await uploadToDrive(
    env, folderId, name, 'application/pdf', new Blob([pdfBytes], { type: 'application/pdf' })
  );

  const docId = crypto.randomUUID();
  await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO documents (id, name, drive_file_id, content_type, size, property_id, tenant_id, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(docId, name, driveId, 'application/pdf', pdfBytes.length, l.property_id, tenant.id, uploadedBy ?? null),
    env.DB.prepare('UPDATE leases SET move_in_fee_receipt_document_id = ? WHERE id = ?').bind(docId, leaseId),
  ]);

  // Replace an older move-in fee receipt if regenerating.
  if (l.move_in_fee_receipt_document_id && l.move_in_fee_receipt_document_id !== docId) {
    try {
      const old = await env.DB.prepare('SELECT drive_file_id FROM documents WHERE id = ?')
        .bind(l.move_in_fee_receipt_document_id).first<{ drive_file_id: string | null }>();
      if (old?.drive_file_id) await deleteDriveFile(env, old.drive_file_id);
      await env.DB.prepare('DELETE FROM documents WHERE id = ?').bind(l.move_in_fee_receipt_document_id).run();
    } catch { /* leave the old copy if cleanup fails */ }
  }

  if (tenant.email) {
    try {
      await sendEmail(env, {
        to: tenant.email,
        subject: `Your move-in fee receipt — ${company.companyName}`,
        html: receiptEmailHtml({
          companyName: company.companyName,
          contact: [company.address, [company.city, company.state, company.zipCode].filter(Boolean).join(', '), [company.phone, company.email].filter(Boolean).join(' · ')].filter(Boolean).join(' · '),
          receiptNumber: rNumber, firstName: tenant.first_name, tenantName, location,
          period: 'Move-in fee', amount: money(l.security_deposit || 0), method: prettyMethod(l.move_in_fee_method), datePaid,
        }),
        text: receiptEmailText({
          companyName: company.companyName, contact: '', receiptNumber: rNumber, firstName: tenant.first_name,
          tenantName, location, period: 'Move-in fee', amount: money(l.security_deposit || 0), method: prettyMethod(l.move_in_fee_method), datePaid,
        }),
      });
    } catch { /* best-effort */ }
  }

  return docId;
}

export async function generateReceipt(env: Env, paymentId: string, uploadedBy?: string): Promise<string | null> {
  const p = await env.DB.prepare(
    `SELECT rp.id, rp.amount, rp.month, rp.year, rp.paid_date, rp.received_date,
            rp.payment_method, rp.status, rp.paid_by_tenant_id, rp.lease_id,
            rp.receipt_document_id, rp.type, rp.credit_reason, rp.notes,
            l.property_id AS property_id, u.unit_number AS unit_number,
            pr.name AS property_name, pr.address AS property_address,
            pr.city AS property_city, pr.state AS property_state, pr.zip_code AS property_zip
       FROM rent_payments rp
       LEFT JOIN leases l ON l.id = rp.lease_id
       LEFT JOIN units u ON u.id = l.unit_id
       LEFT JOIN properties pr ON pr.id = l.property_id
      WHERE rp.id = ?`
  ).bind(paymentId).first<PaymentJoin>();
  if (!p || p.status !== 'paid' || !p.lease_id) return null;

  const isCredit = p.type === 'credit';

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
  // The Property line: the complete street address (falling back to the
  // property's name if no address is on file), plus the unit.
  const cityStateZip = [
    [p.property_city, p.property_state].filter(Boolean).join(', '),
    p.property_zip,
  ].filter(Boolean).join(' ');
  const fullAddress = [p.property_address, cityStateZip].filter(Boolean).join(', ');
  const location = [
    fullAddress || p.property_name,
    p.unit_number ? `Unit ${p.unit_number}` : null,
  ].filter(Boolean).join(' · ') || '—';
  const rawDatePaid = p.paid_date || p.received_date || '';
  const datePaid = rawDatePaid ? prettyDate(rawDatePaid) : '';
  const rNumber = receiptNumber(p.id, p.month, p.year);

  // Build a human-readable notes string for credits: combine the reason label
  // with any freeform notes the user entered.
  const creditReasonLabels: Record<string, string> = {
    proration: 'Move-in proration',
    maintenance: 'Repair/Maintenance reimbursement',
    other: 'Other',
  };
  const noteParts: string[] = [];
  if (isCredit && p.credit_reason) noteParts.push(creditReasonLabels[p.credit_reason] || p.credit_reason);
  if (p.notes) noteParts.push(p.notes);
  const receiptNotes = noteParts.length > 0 ? noteParts.join(': ') : undefined;

  const pdfBytes = await buildReceiptPdf({
    receiptNumber: rNumber,
    datePaid,
    title: isCredit ? 'RENT CREDIT' : undefined,
    badgeLabel: isCredit ? 'CREDIT' : undefined,
    amountLabel: isCredit ? 'CREDIT AMOUNT' : undefined,
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
    method: isCredit ? 'Credit' : prettyMethod(p.payment_method),
    notes: receiptNotes,
  });

  const name = isCredit
    ? `Rent credit - ${period || p.id.slice(0, 6)}.pdf`
    : `Rent receipt - ${period || p.id.slice(0, 6)}.pdf`;
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
      const emailData: ReceiptEmailData = {
        companyName: company.companyName,
        contact: [
          company.address,
          [company.city, company.state, company.zipCode].filter(Boolean).join(', '),
          [company.phone, company.email].filter(Boolean).join(' · '),
        ].filter(Boolean).join(' · '),
        receiptNumber: rNumber,
        firstName: tenant.first_name,
        tenantName,
        location,
        period,
        amount: money(p.amount),
        method: isCredit ? 'Credit' : prettyMethod(p.payment_method),
        datePaid,
        notes: receiptNotes,
        heading: isCredit ? 'Rent credit' : undefined,
        badgeLabel: isCredit ? 'CREDIT' : undefined,
        amountLabel: isCredit ? 'CREDIT AMOUNT' : undefined,
        confirmationText: isCredit
          ? `Hi ${tenant.first_name}, a rent credit of ${money(p.amount)} has been applied to your account${period ? ` for ${period}` : ''}.`
          : undefined,
      };
      const subjectKind = isCredit ? 'rent credit' : 'rent receipt';
      await sendEmail(env, {
        to: tenant.email,
        subject: `Your ${subjectKind}${period ? ` for ${period}` : ''} — ${company.companyName}`,
        html: receiptEmailHtml(emailData),
        text: receiptEmailText(emailData),
      });
    } catch {
      // Best-effort: the receipt is already filed regardless of email.
    }
  }

  return docId;
}
