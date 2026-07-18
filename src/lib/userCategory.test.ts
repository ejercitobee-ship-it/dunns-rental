import { describe, it, expect } from 'vitest';
import { userCategory } from './userCategory';

describe('userCategory', () => {
  it('maps the two portal roles', () => {
    expect(userCategory('tenant')).toBe('tenant');
    expect(userCategory('realtor')).toBe('realtor');
  });

  it('treats every other role as internal', () => {
    for (const r of ['super_admin', 'admin', 'manager', 'viewer', 'accountant', 'anything']) {
      expect(userCategory(r)).toBe('internal');
    }
  });
});
