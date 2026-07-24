import { describe, it, expect } from 'vitest';
import { validateTenantContact, MAX_CONTACT_FIELD } from './realtorTenants';

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
