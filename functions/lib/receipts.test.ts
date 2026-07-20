import { describe, it, expect } from 'vitest';
import { receiptNumber, periodLabel, buildReceiptPdf } from './receipts';

describe('receiptNumber', () => {
  it('formats as R-YYYYMM-<short id>, uppercased, dashes stripped', () => {
    expect(receiptNumber('abc123de-4567-89ab', 7, 2026)).toBe('R-202607-ABC123');
    expect(receiptNumber('x', 12, 2026)).toBe('R-202612-X');
  });
});

describe('periodLabel', () => {
  it('names the month and year', () => {
    expect(periodLabel(7, 2026)).toBe('July 2026');
    expect(periodLabel(1, 2025)).toBe('January 2025');
  });
});

describe('buildReceiptPdf', () => {
  it('produces a non-empty PDF', async () => {
    const bytes = await buildReceiptPdf({
      receiptNumber: 'R-202607-ABC123',
      datePaid: '2026-07-01',
      company: { name: "DUNN's Rental", lines: ['1 Main St', 'Chicago, IL 60601', '555-1234'] },
      tenantName: 'Pat Payer',
      location: 'Oakwood · Unit 4B',
      period: 'July 2026',
      amount: '$1,325.00',
      method: 'Check',
    });
    expect(bytes.length).toBeGreaterThan(500);
    // Every PDF file starts with the "%PDF" magic bytes.
    expect(String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3])).toBe('%PDF');
  });
});
