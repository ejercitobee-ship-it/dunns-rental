import { describe, it, expect } from 'vitest';
import { validateTenantContact, MAX_CONTACT_FIELD } from './realtorTenants';

describe('validateTenantContact', () => {
  it('accepts first and last name, trims, nulls blank optional fields', () => {
    const r = validateTenantContact({ firstName: '  Jane ', lastName: 'Doe ', email: '', phone: ' 555 ' });
    expect(r).toEqual({
      ok: true,
      value: { firstName: 'Jane', lastName: 'Doe', email: null, phone: '555',
        emergencyName: null, emergencyPhone: null, emergencyRelationship: null },
    });
  });

  it('requires both first and last name', () => {
    expect(validateTenantContact({ firstName: 'Jane' })).toEqual({ ok: false, error: 'First and last name are required' });
    expect(validateTenantContact({ lastName: 'Doe' })).toEqual({ ok: false, error: 'First and last name are required' });
    expect(validateTenantContact({})).toEqual({ ok: false, error: 'First and last name are required' });
  });

  it('rejects an over-long field', () => {
    const long = 'x'.repeat(MAX_CONTACT_FIELD + 1);
    expect(validateTenantContact({ firstName: long, lastName: 'Doe' })).toEqual({ ok: false, error: 'A field is too long' });
  });

  it('keeps trimmed emergency contact fields when present', () => {
    const r = validateTenantContact({
      firstName: 'Jane', lastName: 'Doe',
      emergencyName: '  Bob  ', emergencyPhone: ' 555 ', emergencyRelationship: ' Spouse ',
    });
    expect(r).toEqual({
      ok: true,
      value: { firstName: 'Jane', lastName: 'Doe', email: null, phone: null,
        emergencyName: 'Bob', emergencyPhone: '555', emergencyRelationship: 'Spouse' },
    });
  });
});
