import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import type { Env } from './session';
import { getSetting, ensureRootFolder, uploadToDrive } from './google';
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

export interface WorkReportData {
  reportNumber: string;
  company: { name: string; lines: string[] };
  title: string;
  description?: string;
  category: string;
  location: string;
  handymanName: string;
  dateCompleted: string;
  cost: number;
  status: string;
}

export async function buildWorkReportPdf(data: WorkReportData): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([612, 792]);
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

  text(data.company.name, left, y, 20, bold);
  y -= 20;
  for (const l of data.company.lines) {
    if (!l) continue;
    text(l, left, y, 10, font, muted);
    y -= 14;
  }

  const heading = 'WORK REPORT';
  text(heading, right - bold.widthOfTextAtSize(heading, 16), 740, 16, bold);
  text(`No. ${data.reportNumber}`, right - font.widthOfTextAtSize(`No. ${data.reportNumber}`, 10), 722, 10, font, muted);

  y -= 8;
  page.drawLine({ start: { x: left, y }, end: { x: right, y }, thickness: 1, color: line });
  y -= 34;

  const field = (label: string, value: string) => {
    text(label.toUpperCase(), left, y, 9, bold, muted);
    text(value || '—', left, y - 16, 13, font, ink);
    y -= 44;
  };

  field('Job Title', data.title);
  field('Location', data.location);
  field('Category', data.category.split('_').map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' '));
  field('Handyman', data.handymanName);
  field('Date Completed', prettyDate(data.dateCompleted));

  if (data.description) {
    text('DESCRIPTION', left, y, 9, bold, muted);
    y -= 16;
    const words = data.description.split(/\s+/);
    let currentLine = '';
    for (const word of words) {
      const test = currentLine ? `${currentLine} ${word}` : word;
      if (font.widthOfTextAtSize(test, 11) > right - left - 10) {
        text(currentLine, left, y, 11, font, ink);
        y -= 16;
        currentLine = word;
      } else {
        currentLine = test;
      }
    }
    if (currentLine) {
      text(currentLine, left, y, 11, font, ink);
      y -= 16;
    }
    y -= 20;
  }

  const boxTop = y;
  const boxH = 56;
  page.drawRectangle({
    x: left, y: boxTop - boxH, width: right - left, height: boxH,
    color: rgb(0.96, 0.965, 0.955), borderColor: line, borderWidth: 1,
  });
  text('COST', left + 18, boxTop - 22, 9, bold, muted);
  text(money(data.cost), left + 18, boxTop - 44, 22, bold, ink);
  const statusLabel = data.status === 'completed' ? 'COMPLETED' : data.status.toUpperCase();
  text(statusLabel, right - 18 - bold.widthOfTextAtSize(statusLabel, 22), boxTop - 40, 22, bold, green);

  text('This work report was generated automatically by the property management system.', left, 78, 9, font, muted);

  return pdf.save();
}

export function workReportNumber(jobId: string): string {
  const suffix = jobId.replace(/-/g, '').slice(0, 8).toUpperCase();
  return `WR-${suffix}`;
}

export async function generateAndSaveWorkReport(
  env: Env,
  job: Record<string, unknown>,
  handymanName: string,
): Promise<string | null> {
  try {
    const settingsRaw = await getSetting(env, 'company');
    let company: CompanySettings = {
      companyName: 'MH Dunn Property',
      address: '', city: '', state: '', zipCode: '', phone: '', email: '',
    };
    if (settingsRaw) {
      try { company = { ...company, ...JSON.parse(settingsRaw) }; } catch { /* defaults */ }
    }

    const propName = job.property_name as string || '';
    const unitNum = job.unit_number as string || '';
    const location = unitNum ? `${propName}, Unit ${unitNum}` : propName;

    const reportNumber = workReportNumber(job.id as string);
    const pdfBytes = await buildWorkReportPdf({
      reportNumber,
      company: {
        name: company.companyName,
        lines: [
          [company.address, company.city, company.state, company.zipCode].filter(Boolean).join(', '),
          [company.phone, company.email].filter(Boolean).join(' | '),
        ],
      },
      title: job.title as string || 'Maintenance Work',
      description: (job.description as string) || undefined,
      category: job.category as string || 'general',
      location,
      handymanName,
      dateCompleted: job.resolved_date as string || new Date().toISOString().slice(0, 10),
      cost: Number(job.cost) || 0,
      status: job.status as string || 'completed',
    });

    const rootFolder = await ensureRootFolder(env);
    const fileName = `Work Report - ${(job.title as string || 'Job').slice(0, 40)} - ${reportNumber}.pdf`;
    const uploaded = await uploadToDrive(env, rootFolder, fileName, 'application/pdf', new Blob([pdfBytes]));

    await env.DB.prepare('UPDATE maintenance_requests SET work_report_drive_id = ?, updated_at = unixepoch() WHERE id = ?')
      .bind(uploaded.id, job.id as string).run();

    return uploaded.id;
  } catch (err) {
    console.error('Work report generation failed', err);
    return null;
  }
}
