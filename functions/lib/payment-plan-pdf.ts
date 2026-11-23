import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';

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

export interface PlanInstallment {
  number: number;
  dueDate: string;
  amount: number;
  status: string;
}

export interface PaymentPlanData {
  planId: string;
  tenantName: string;
  propertyAddress: string;
  unitNumber?: string;
  totalAmount: number;
  reason?: string;
  startDate: string;
  installments: PlanInstallment[];
  companyName: string;
  companyAddress?: string;
  companyPhone?: string;
}

export async function buildPaymentPlanPdf(data: PaymentPlanData): Promise<Uint8Array> {
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

  // Header
  text(data.companyName, left, y, 20, bold);
  y -= 16;
  if (data.companyAddress) {
    text(data.companyAddress, left, y, 9, font, muted);
    y -= 12;
  }
  if (data.companyPhone) {
    text(data.companyPhone, left, y, 9, font, muted);
    y -= 12;
  }

  const heading = 'PAYMENT PLAN AGREEMENT';
  const headW = bold.widthOfTextAtSize(heading, 14);
  text(heading, right - headW, 740, 14, bold);

  y -= 8;
  page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 1, color: lineColor });
  y -= 28;

  // Plan details section
  text('Agreement Details', left, y, 12, bold, green);
  y -= 20;

  const location = data.unitNumber
    ? `${data.propertyAddress}, Unit ${data.unitNumber}`
    : data.propertyAddress;

  const details = [
    ['Tenant:', data.tenantName],
    ['Property:', location],
    ['Total Balance:', money(data.totalAmount)],
    ['Installments:', String(data.installments.length)],
    ['Start Date:', prettyDate(data.startDate)],
  ];

  for (const [label, value] of details) {
    ensureSpace(16);
    text(label, left, y, 10, bold, ink);
    text(value, left + 110, y, 10.5, font, ink);
    y -= 16;
  }
  y -= 12;

  // Reason / notes
  if (data.reason) {
    ensureSpace(40);
    text('Reason for Agreement', left, y, 12, bold, green);
    y -= 18;
    const lines = wrapText(data.reason, pageWidth, 10.5);
    for (const line of lines) {
      ensureSpace(14);
      text(line, left, y, 10.5, font, ink);
      y -= 14;
    }
    y -= 12;
  }

  // Terms
  ensureSpace(80);
  text('Terms and Conditions', left, y, 12, bold, green);
  y -= 18;
  const terms = [
    `1. The Tenant agrees to pay the total outstanding balance of ${money(data.totalAmount)} in ${data.installments.length} installment(s) according to the schedule below.`,
    '2. Each installment must be received by its due date. Failure to make a scheduled payment may result in the plan being declared in default.',
    '3. If this plan is declared in default, the full remaining balance becomes due immediately and normal collection procedures will resume.',
    '4. This agreement does not waive the Landlord\'s right to pursue legal remedies for nonpayment under Illinois law (735 ILCS 5/9-209).',
    '5. Additional late fees will not accrue on installment payments made on time under this plan.',
    '6. This agreement is in addition to, and does not replace, the existing lease.',
  ];

  for (const term of terms) {
    const lines = wrapText(term, pageWidth, 10);
    ensureSpace(lines.length * 13 + 6);
    for (const line of lines) {
      text(line, left, y, 10, font, ink);
      y -= 13;
    }
    y -= 4;
  }
  y -= 8;

  // Installment schedule table
  ensureSpace(50);
  text('Payment Schedule', left, y, 12, bold, green);
  y -= 20;

  // Table header
  const colNum = left;
  const colDate = left + 50;
  const colAmt = left + 240;
  const colStatus = left + 380;

  ensureSpace(20);
  text('#', colNum, y, 9, bold, muted);
  text('Due Date', colDate, y, 9, bold, muted);
  text('Amount', colAmt, y, 9, bold, muted);
  text('Status', colStatus, y, 9, bold, muted);
  y -= 4;
  page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 0.5, color: lineColor });
  y -= 14;

  for (const inst of data.installments) {
    ensureSpace(18);
    text(String(inst.number), colNum, y, 10, font, ink);
    text(prettyDate(inst.dueDate), colDate, y, 10, font, ink);
    text(money(inst.amount), colAmt, y, 10, font, ink);
    const statusLabel = inst.status.charAt(0).toUpperCase() + inst.status.slice(1);
    text(statusLabel, colStatus, y, 10, font, inst.status === 'paid' ? green : ink);
    y -= 16;
  }

  // Total row
  y -= 2;
  page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 0.5, color: lineColor });
  y -= 14;
  text('Total', colDate, y, 10, bold, ink);
  text(money(data.totalAmount), colAmt, y, 10, bold, ink);
  y -= 30;

  // Signature block
  ensureSpace(100);
  text('Signatures', left, y, 12, bold, green);
  y -= 28;

  // Tenant signature
  text('Tenant:', left, y, 10, bold, ink);
  page.drawLine({ start: { x: left + 100, y: y - 2 }, end: { x: left + 300, y: y - 2 }, thickness: 0.5, color: ink });
  text('Date:', left + 320, y, 10, bold, ink);
  page.drawLine({ start: { x: left + 370, y: y - 2 }, end: { x: right, y: y - 2 }, thickness: 0.5, color: ink });
  y -= 14;
  text(data.tenantName, left + 100, y, 9, font, muted);
  y -= 28;

  // Landlord signature
  text('Landlord:', left, y, 10, bold, ink);
  page.drawLine({ start: { x: left + 100, y: y - 2 }, end: { x: left + 300, y: y - 2 }, thickness: 0.5, color: ink });
  text('Date:', left + 320, y, 10, bold, ink);
  page.drawLine({ start: { x: left + 370, y: y - 2 }, end: { x: right, y: y - 2 }, thickness: 0.5, color: ink });
  y -= 14;
  text(data.companyName, left + 100, y, 9, font, muted);

  return pdf.save();
}
