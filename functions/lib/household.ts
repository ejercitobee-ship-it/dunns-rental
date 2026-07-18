/** Longest allowed value for a household member's name, phone, or relationship. */
export const MAX_HOUSEHOLD_FIELD = 120;
/** Most household members allowed on one lease, a guard against abuse. */
export const MAX_HOUSEHOLD_MEMBERS = 20;

export interface HouseholdInput {
  name: string;
  phone: string | null;
  relationship: string | null;
}
export type HouseholdValidation =
  | { ok: true; value: HouseholdInput }
  | { ok: false; error: string };

/** Validate and normalise a household member payload. Pure, so it is testable. */
export function validateHouseholdInput(body: {
  name?: unknown;
  phone?: unknown;
  relationship?: unknown;
}): HouseholdValidation {
  const name = typeof body.name === 'string' ? body.name.trim() : '';
  if (!name) return { ok: false, error: 'A name is required' };
  if (name.length > MAX_HOUSEHOLD_FIELD) return { ok: false, error: 'Name is too long' };

  const phone = typeof body.phone === 'string' ? body.phone.trim() : '';
  const relationship = typeof body.relationship === 'string' ? body.relationship.trim() : '';
  if (phone.length > MAX_HOUSEHOLD_FIELD) return { ok: false, error: 'Phone is too long' };
  if (relationship.length > MAX_HOUSEHOLD_FIELD) return { ok: false, error: 'Relationship is too long' };

  return { ok: true, value: { name, phone: phone || null, relationship: relationship || null } };
}
