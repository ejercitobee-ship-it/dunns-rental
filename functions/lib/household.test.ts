import { describe, it, expect } from 'vitest';
import { validateHouseholdInput, MAX_HOUSEHOLD_FIELD } from './household';

describe('validateHouseholdInput', () => {
  it('accepts a name and trims, nulls blank optional fields', () => {
    const r = validateHouseholdInput({ name: '  Jane Doe  ', phone: '', relationship: ' spouse ' });
    expect(r).toEqual({ ok: true, value: { name: 'Jane Doe', phone: null, relationship: 'spouse' } });
  });

  it('rejects a missing or blank name', () => {
    expect(validateHouseholdInput({ name: '   ' })).toEqual({ ok: false, error: 'A name is required' });
    expect(validateHouseholdInput({})).toEqual({ ok: false, error: 'A name is required' });
  });

  it('rejects an over-long field', () => {
    const long = 'x'.repeat(MAX_HOUSEHOLD_FIELD + 1);
    expect(validateHouseholdInput({ name: long })).toEqual({ ok: false, error: 'Name is too long' });
  });

  it('rejects an over-long phone or relationship', () => {
    const long = 'x'.repeat(MAX_HOUSEHOLD_FIELD + 1);
    expect(validateHouseholdInput({ name: 'Jane', phone: long })).toEqual({ ok: false, error: 'Phone is too long' });
    expect(validateHouseholdInput({ name: 'Jane', relationship: long })).toEqual({ ok: false, error: 'Relationship is too long' });
  });

  it('retains a valid non-blank phone and relationship', () => {
    const r = validateHouseholdInput({ name: 'Jane', phone: '555-1234', relationship: 'child' });
    expect(r).toEqual({ ok: true, value: { name: 'Jane', phone: '555-1234', relationship: 'child' } });
  });
});
