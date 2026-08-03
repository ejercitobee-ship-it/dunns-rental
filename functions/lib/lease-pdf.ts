import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { Env } from './session';
import { getSetting, ensureTenantSubfolder, uploadToDrive } from './google';
import type { CompanySettings } from './receipts';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function money(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount || 0);
}

function prettyDate(dateStr: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
  if (!m) return dateStr;
  return `${MONTHS[Number(m[2]) - 1] ?? ''} ${Number(m[3])}, ${m[1]}`.trim();
}

export interface LeaseTerms {
  tenantNames: string;
  propertyAddress: string;
  unitNumber?: string;
  startDate: string;
  endDate: string;
  monthlyRent: number;
  securityDeposit: number;
  lateFeeAmount: number;
  lateFeeGraceDays: number;
  rentDueDay: number;
  utilities: string;
  petPolicy: string;
  additionalTerms?: string;
  isRenewal?: boolean;
}

export async function buildLeasePdf(
  company: { name: string; lines: string[] },
  terms: LeaseTerms
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const ink = rgb(0.11, 0.1, 0.09);
  const muted = rgb(0.46, 0.45, 0.42);
  const lineColor = rgb(0.85, 0.84, 0.8);
  const green = rgb(0.17, 0.48, 0.35);

  const left = 56;
  const right = 556;
  const pageWidth = right - left;
  let page = pdf.addPage([612, 792]);
  let y = 740;

  const text = (s: string, x: number, yy: number, size: number, f = font, color = ink) =>
    page.drawText(s, { x, y: yy, size, font: f, color });

  const wrapText = (s: string, maxWidth: number, size: number, f = font): string[] => {
    const lines: string[] = [];
    for (const paragraph of s.split('\n')) {
      if (!paragraph.trim()) { lines.push(''); continue; }
      const words = paragraph.split(/\s+/);
      let current = '';
      for (const word of words) {
        const test = current ? `${current} ${word}` : word;
        if (f.widthOfTextAtSize(test, size) > maxWidth) {
          if (current) lines.push(current);
          current = word;
        } else {
          current = test;
        }
      }
      if (current) lines.push(current);
    }
    return lines;
  };

  const ensureSpace = (needed: number) => {
    if (y - needed < 60) {
      page = pdf.addPage([612, 792]);
      y = 740;
    }
  };

  const section = (title: string, body: string) => {
    const bodyLines = wrapText(body, pageWidth, 10.5);
    ensureSpace(30 + bodyLines.length * 14);
    text(title, left, y, 12, bold, green);
    y -= 20;
    for (const line of bodyLines) {
      ensureSpace(16);
      text(line, left, y, 10.5, font, ink);
      y -= 14;
    }
    y -= 12;
  };

  // Header
  text(company.name, left, y, 20, bold);
  y -= 20;
  for (const l of company.lines) {
    if (!l) continue;
    text(l, left, y, 10, font, muted);
    y -= 14;
  }

  const heading = 'RESIDENTIAL LEASE AGREEMENT';
  text(heading, right - bold.widthOfTextAtSize(heading, 14), 740, 14, bold);

  y -= 8;
  page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 1, color: lineColor });
  y -= 28;

  const location = terms.unitNumber
    ? `${terms.propertyAddress}, Unit ${terms.unitNumber}`
    : terms.propertyAddress;

  section('1. PARTIES', `This Residential Lease Agreement ("Agreement") is entered into by and between ${company.name} ("Landlord") and ${terms.tenantNames} ("Tenant") for the rental of the property located at ${location}.`);

  section('2. TERM', `The lease term begins on ${prettyDate(terms.startDate)} and ends on ${prettyDate(terms.endDate)}. This lease will not automatically renew. A new lease or month to month extension requires written agreement from both parties.`);

  section('3. RENT', `Tenant agrees to pay ${money(terms.monthlyRent)} per month in rent, due on the ${ordinal(terms.rentDueDay)} of each month. Rent is payable via Zelle, money order, or cashier's check unless otherwise agreed in writing.`);

  section('4. LATE FEES', `If rent is not received by the ${ordinal(terms.rentDueDay + terms.lateFeeGraceDays)} of the month (${terms.lateFeeGraceDays} day grace period), a late fee of ${money(terms.lateFeeAmount)} will be charged. The Landlord reserves the right to pursue eviction proceedings for nonpayment.`);

  let sectionNum = 5;

  if (!terms.isRenewal) {
    section(`${sectionNum}. MOVE-IN FEE`, `Tenant has paid a non-refundable move-in fee of ${money(terms.securityDeposit)}. This fee covers administrative and preparation costs associated with the tenancy and is not applied toward rent.`);
    sectionNum++;
  }

  section(`${sectionNum}. UTILITIES`, terms.utilities || 'Tenant is responsible for all utilities unless otherwise noted.');
  sectionNum++;

  section(`${sectionNum}. MAINTENANCE AND REPAIRS`, 'Tenant shall maintain the premises in clean and sanitary condition and promptly notify Landlord of any needed repairs. Tenant is responsible for damages caused by misuse or neglect. Landlord will make necessary repairs in a reasonable time after receiving notice.');
  sectionNum++;

  section(`${sectionNum}. PETS`, terms.petPolicy || 'No pets are allowed on the premises without prior written consent from the Landlord.');
  sectionNum++;

  section(`${sectionNum}. ENTRY BY LANDLORD`, 'Landlord or their agents may enter the premises for inspections, repairs, or showings with at least 24 hours written notice, except in cases of emergency.');
  sectionNum++;

  section(`${sectionNum}. TERMINATION`, 'Either party may terminate this lease with at least 30 days written notice before the end of the current term. Early termination by the Tenant without cause may result in liability for rent through the end of the lease term or until a replacement tenant is found.');

  if (terms.additionalTerms) {
    sectionNum++;
    section(`${sectionNum}. ADDITIONAL TERMS`, terms.additionalTerms);
  }

  // Signature section
  ensureSpace(120);
  y -= 10;
  page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 1, color: lineColor });
  y -= 30;

  text('SIGNATURES', left, y, 12, bold, green);
  y -= 30;

  text('Landlord:', left, y, 10, bold, muted);
  page.drawLine({ start: { x: left + 80, y: y - 2 }, end: { x: left + 260, y: y - 2 }, thickness: 0.5, color: lineColor });
  text('Date:', left + 280, y, 10, bold, muted);
  page.drawLine({ start: { x: left + 320, y: y - 2 }, end: { x: right, y: y - 2 }, thickness: 0.5, color: lineColor });
  y -= 30;

  text('Tenant:', left, y, 10, bold, muted);
  page.drawLine({ start: { x: left + 80, y: y - 2 }, end: { x: left + 260, y: y - 2 }, thickness: 0.5, color: lineColor });
  text('Date:', left + 280, y, 10, bold, muted);
  page.drawLine({ start: { x: left + 320, y: y - 2 }, end: { x: right, y: y - 2 }, thickness: 0.5, color: lineColor });

  // Footer on last page
  const lastPage = pdf.getPages()[pdf.getPageCount() - 1];
  lastPage.drawText('This lease was generated by the property management system.', {
    x: left, y: 40, size: 8, font, color: muted,
  });

  return pdf.save();
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

export interface RenewalTerms {
  tenantNames: string;
  propertyAddress: string;
  unitNumber?: string;
  previousStartDate: string;
  previousEndDate: string;
  previousRent: number;
  newStartDate: string;
  newEndDate: string;
  newMonthlyRent: number;
  rentDueDay: number;
  lateFeeAmount: number;
  lateFeeGraceDays: number;
  utilities: string;
  additionalTerms?: string;
}

export async function buildRenewalPdf(
  company: { name: string; lines: string[] },
  terms: RenewalTerms
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);

  const ink = rgb(0.11, 0.1, 0.09);
  const muted = rgb(0.46, 0.45, 0.42);
  const lineColor = rgb(0.85, 0.84, 0.8);
  const green = rgb(0.17, 0.48, 0.35);

  const left = 56;
  const right = 556;
  const pageWidth = right - left;
  let page = pdf.addPage([612, 792]);
  let y = 740;

  const text = (s: string, x: number, yy: number, size: number, f = font, color = ink) =>
    page.drawText(s, { x, y: yy, size, font: f, color });

  const wrapText = (s: string, maxWidth: number, size: number, f = font): string[] => {
    const lines: string[] = [];
    for (const paragraph of s.split('\n')) {
      if (!paragraph.trim()) { lines.push(''); continue; }
      const words = paragraph.split(/\s+/);
      let current = '';
      for (const word of words) {
        const test = current ? `${current} ${word}` : word;
        if (f.widthOfTextAtSize(test, size) > maxWidth) {
          if (current) lines.push(current);
          current = word;
        } else {
          current = test;
        }
      }
      if (current) lines.push(current);
    }
    return lines;
  };

  const ensureSpace = (needed: number) => {
    if (y - needed < 60) {
      page = pdf.addPage([612, 792]);
      y = 740;
    }
  };

  const section = (title: string, body: string) => {
    const bodyLines = wrapText(body, pageWidth, 10.5);
    ensureSpace(30 + bodyLines.length * 14);
    text(title, left, y, 12, bold, green);
    y -= 20;
    for (const line of bodyLines) {
      ensureSpace(16);
      text(line, left, y, 10.5, font, ink);
      y -= 14;
    }
    y -= 12;
  };

  // Header
  text(company.name, left, y, 20, bold);
  y -= 20;
  for (const l of company.lines) {
    if (!l) continue;
    text(l, left, y, 10, font, muted);
    y -= 14;
  }

  const heading = 'LEASE RENEWAL AGREEMENT';
  text(heading, right - bold.widthOfTextAtSize(heading, 14), 740, 14, bold);

  y -= 8;
  page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 1, color: lineColor });
  y -= 28;

  const location = terms.unitNumber
    ? `${terms.propertyAddress}, Unit ${terms.unitNumber}`
    : terms.propertyAddress;

  section('1. PARTIES', `This Lease Renewal Agreement ("Agreement") is entered into by and between ${company.name} ("Landlord") and ${terms.tenantNames} ("Tenant") for the continued rental of the property located at ${location}.`);

  section('2. ORIGINAL LEASE', `This renewal extends the original lease agreement dated ${prettyDate(terms.previousStartDate)} through ${prettyDate(terms.previousEndDate)}. All terms of the original lease remain in effect except as specifically modified below.`);

  const rentChanged = terms.newMonthlyRent !== terms.previousRent;
  const rentNote = rentChanged
    ? `The monthly rent has been adjusted from ${money(terms.previousRent)} to ${money(terms.newMonthlyRent)}, effective ${prettyDate(terms.newStartDate)}.`
    : `The monthly rent of ${money(terms.newMonthlyRent)} remains unchanged.`;

  section('3. RENEWAL TERM', `The renewed lease term begins on ${prettyDate(terms.newStartDate)} and ends on ${prettyDate(terms.newEndDate)}. This renewal will not automatically extend beyond the stated end date. A new renewal or month to month extension requires written agreement from both parties.`);

  section('4. RENT', `${rentNote} Rent is due on the ${ordinal(terms.rentDueDay)} of each month, payable via Zelle, money order, or cashier's check unless otherwise agreed in writing.`);

  section('5. LATE FEES', `If rent is not received by the ${ordinal(terms.rentDueDay + terms.lateFeeGraceDays)} of the month (${terms.lateFeeGraceDays} day grace period), a late fee of ${money(terms.lateFeeAmount)} will be charged. The Landlord reserves the right to pursue eviction proceedings for nonpayment.`);

  section('6. UTILITIES', terms.utilities || 'Tenant is responsible for all utilities unless otherwise noted.');

  section('7. GENERAL PROVISIONS', 'All other terms and conditions of the original lease agreement remain in full force and effect for the duration of this renewal term. In the event of any conflict between this renewal and the original lease, the terms of this renewal shall prevail.');

  if (terms.additionalTerms) {
    section('8. ADDITIONAL RENEWAL TERMS', terms.additionalTerms);
  }

  // Signature section
  ensureSpace(120);
  y -= 10;
  page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 1, color: lineColor });
  y -= 30;

  text('SIGNATURES', left, y, 12, bold, green);
  y -= 30;

  text('Landlord:', left, y, 10, bold, muted);
  page.drawLine({ start: { x: left + 80, y: y - 2 }, end: { x: left + 260, y: y - 2 }, thickness: 0.5, color: lineColor });
  text('Date:', left + 280, y, 10, bold, muted);
  page.drawLine({ start: { x: left + 320, y: y - 2 }, end: { x: right, y: y - 2 }, thickness: 0.5, color: lineColor });
  y -= 30;

  text('Tenant:', left, y, 10, bold, muted);
  page.drawLine({ start: { x: left + 80, y: y - 2 }, end: { x: left + 260, y: y - 2 }, thickness: 0.5, color: lineColor });
  text('Date:', left + 280, y, 10, bold, muted);
  page.drawLine({ start: { x: left + 320, y: y - 2 }, end: { x: right, y: y - 2 }, thickness: 0.5, color: lineColor });

  const lastPage = pdf.getPages()[pdf.getPageCount() - 1];
  lastPage.drawText('This renewal agreement was generated by the property management system.', {
    x: left, y: 40, size: 8, font, color: muted,
  });

  return pdf.save();
}

export async function generateAndSaveRenewal(
  env: Env,
  tenantId: string,
  terms: RenewalTerms,
): Promise<{ driveId: string; fileName: string }> {
  const settingsRaw = await getSetting(env, 'company');
  let company: CompanySettings = {
    companyName: 'MH Dunn Property',
    address: '', city: '', state: '', zipCode: '', phone: '', email: '',
  };
  if (settingsRaw) {
    try { company = { ...company, ...JSON.parse(settingsRaw) }; } catch { /* defaults */ }
  }

  const pdfBytes = await buildRenewalPdf(
    {
      name: company.companyName,
      lines: [
        [company.address, company.city, company.state, company.zipCode].filter(Boolean).join(', '),
        [company.phone, company.email].filter(Boolean).join(' | '),
      ],
    },
    terms,
  );

  const leaseFolder = await ensureTenantSubfolder(env, tenantId, 'Lease');
  const fileName = `Lease Renewal - ${terms.tenantNames.slice(0, 30)} - ${terms.newStartDate}.pdf`;
  const uploaded = await uploadToDrive(env, leaseFolder, fileName, 'application/pdf', new Blob([pdfBytes]));

  return { driveId: uploaded.id, fileName };
}

export async function generateAndSaveLease(
  env: Env,
  tenantId: string,
  terms: LeaseTerms,
): Promise<{ driveId: string; fileName: string }> {
  const settingsRaw = await getSetting(env, 'company');
  let company: CompanySettings = {
    companyName: 'MH Dunn Property',
    address: '', city: '', state: '', zipCode: '', phone: '', email: '',
  };
  if (settingsRaw) {
    try { company = { ...company, ...JSON.parse(settingsRaw) }; } catch { /* defaults */ }
  }

  const pdfBytes = await buildLeasePdf(
    {
      name: company.companyName,
      lines: [
        [company.address, company.city, company.state, company.zipCode].filter(Boolean).join(', '),
        [company.phone, company.email].filter(Boolean).join(' | '),
      ],
    },
    terms,
  );

  const leaseFolder = await ensureTenantSubfolder(env, tenantId, 'Lease');
  const fileName = `Lease Agreement - ${terms.tenantNames.slice(0, 30)} - ${terms.startDate}.pdf`;
  const uploaded = await uploadToDrive(env, leaseFolder, fileName, 'application/pdf', new Blob([pdfBytes]));

  return { driveId: uploaded.id, fileName };
}
