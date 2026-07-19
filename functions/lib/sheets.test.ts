import { describe, it, expect } from 'vitest';
import { paymentRow, tenantRow, prettyMethod, PAYMENTS_HEADER, TENANTS_HEADER } from './sheets';

describe('prettyMethod', () => {
  it('titlecases and de-underscores a method, blank for none', () => {
    expect(prettyMethod('bank_transfer')).toBe('Bank Transfer');
    expect(prettyMethod('zelle')).toBe('Zelle');
    expect(prettyMethod(null)).toBe('');
    expect(prettyMethod('')).toBe('');
  });
});

describe('paymentRow', () => {
  it('maps a payment to the header order, joining payer name', () => {
    const row = paymentRow({
      paid_date: '2026-07-01', first_name: 'Pat', last_name: 'Payer',
      unit_number: '2', address: '12 Oak St', amount: 900, payment_method: 'zelle',
      month: 7, year: 2026, status: 'paid',
    });
    expect(row).toHaveLength(PAYMENTS_HEADER.length);
    expect(row).toEqual(['2026-07-01', 'Pat Payer', '2', '12 Oak St', 900, 'Zelle', 7, 2026, 'paid']);
  });

  it('leaves the tenant blank when the payment is unattributed', () => {
    const row = paymentRow({
      paid_date: null, first_name: null, last_name: null, unit_number: null, address: null,
      amount: null, payment_method: null, month: null, year: null, status: null,
    });
    expect(row[1]).toBe('');
    expect(row[4]).toBe(0);
  });
});

describe('tenantRow', () => {
  it('maps a tenant to the header order', () => {
    const row = tenantRow({
      first_name: 'Jane', last_name: 'Doe', email: 'j@ex.com', phone: '555',
      unit_number: '5', address: '9 Elm', start_date: '2026-01-01', monthly_rent: 1200, status: 'active',
    });
    expect(row).toHaveLength(TENANTS_HEADER.length);
    expect(row).toEqual(['Jane Doe', 'j@ex.com', '555', '5', '9 Elm', '2026-01-01', 1200, 'active']);
  });
});
