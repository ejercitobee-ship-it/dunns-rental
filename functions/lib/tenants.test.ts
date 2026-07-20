import { describe, it, expect } from 'vitest';
import { soleOccupantLeaseIds } from './tenants';

describe('soleOccupantLeaseIds', () => {
  it('returns only leases where the tenant is the single occupant', () => {
    const rows = [
      { lease_id: 'solo', tenant_count: 1 },
      { lease_id: 'shared', tenant_count: 2 },
      { lease_id: 'also-solo', tenant_count: 1 },
    ];
    expect(soleOccupantLeaseIds(rows)).toEqual(['solo', 'also-solo']);
  });

  it('never returns a shared lease (roommate safety)', () => {
    const rows = [{ lease_id: 'shared', tenant_count: 3 }];
    expect(soleOccupantLeaseIds(rows)).toEqual([]);
  });

  it('returns nothing for a tenant on no leases', () => {
    expect(soleOccupantLeaseIds([])).toEqual([]);
  });
});
