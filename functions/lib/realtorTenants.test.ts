import { describe, it, expect } from 'vitest';
import { validateTenantContact, validateLeaseDates, MAX_CONTACT_FIELD } from './realtorTenants';

// A complete, valid input. Realtors must supply every field.
const full = {
  firstName: 'Jane',
  lastName: 'Doe',
  email: 'jane@example.com',
  phone: '555',
  emergencyName: 'Bob',
  emergencyPhone: '556',
  emergencyRelationship: 'Spouse',
};

describe('validateTenantContact', () => {
  it('accepts a complete record and trims every field', () => {
    const r = validateTenantContact({
      firstName: '  Jane ', lastName: 'Doe ', email: ' jane@example.com ', phone: ' 555 ',
      emergencyName: '  Bob  ', emergencyPhone: ' 556 ', emergencyRelationship: ' Spouse ',
    });
    expect(r).toEqual({ ok: true, value: full });
  });

  it('requires both first and last name', () => {
    expect(validateTenantContact({ ...full, firstName: '' })).toEqual({ ok: false, error: 'First and last name are required' });
    expect(validateTenantContact({ ...full, lastName: '' })).toEqual({ ok: false, error: 'First and last name are required' });
  });

  it('requires email and phone', () => {
    expect(validateTenantContact({ ...full, email: '' })).toEqual({ ok: false, error: 'Email is required' });
    expect(validateTenantContact({ ...full, phone: '' })).toEqual({ ok: false, error: 'Phone is required' });
  });

  it('allows a blank emergency contact (optional), nulling the empty fields', () => {
    const r = validateTenantContact({
      firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com', phone: '555',
    });
    expect(r).toEqual({
      ok: true,
      value: { firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com', phone: '555',
        emergencyName: null, emergencyPhone: null, emergencyRelationship: null },
    });
  });

  it('rejects an over-long field', () => {
    const long = 'x'.repeat(MAX_CONTACT_FIELD + 1);
    expect(validateTenantContact({ ...full, firstName: long })).toEqual({ ok: false, error: 'A field is too long' });
  });
});

describe('validateLeaseDates', () => {
  it('requires a start date', () => {
    expect(validateLeaseDates('', '')).toEqual({ ok: false, error: 'A lease start date is required' });
  });

  it('defaults the expiration to one year after the start', () => {
    expect(validateLeaseDates('2026-04-01', '')).toEqual({
      ok: true, value: { startDate: '2026-04-01', endDate: '2027-04-01' },
    });
  });

  it('keeps an explicit expiration after the start', () => {
    expect(validateLeaseDates('2026-01-15', '2026-12-31')).toEqual({
      ok: true, value: { startDate: '2026-01-15', endDate: '2026-12-31' },
    });
  });

  it('rejects an expiration on or before the start', () => {
    expect(validateLeaseDates('2026-06-01', '2026-06-01')).toEqual({ ok: false, error: 'Lease expiration must be after the start date' });
    expect(validateLeaseDates('2026-06-01', '2026-05-01')).toEqual({ ok: false, error: 'Lease expiration must be after the start date' });
  });

  it('rejects a malformed date', () => {
    expect(validateLeaseDates('06/01/2026', '')).toEqual({ ok: false, error: 'Lease start date must be a valid date' });
    expect(validateLeaseDates('2026-06-01', 'soon')).toEqual({ ok: false, error: 'Lease expiration must be a valid date' });
  });
});
