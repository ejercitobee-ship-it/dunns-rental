import { describe, it, expect } from 'vitest';
import { describeAction } from './activity';

describe('describeAction', () => {
  it('recognises recording a rent payment', () => {
    expect(describeAction('POST', '/api/payments')).toMatchObject({ action: 'Recorded a rent payment', targetType: 'payments' });
  });

  it('captures the target id from the path', () => {
    const id = '11111111-2222-3333-4444-555555555555';
    const r = describeAction('PUT', `/api/tenants/${id}`);
    expect(r).toMatchObject({ action: 'Updated a tenant', targetType: 'tenants', targetId: id });
  });

  it('reads /api/admin/users as the users resource', () => {
    expect(describeAction('DELETE', '/api/admin/users/abc')?.action).toBe('Deleted a team member');
  });

  it('labels sub-actions like invite, pay, and assign', () => {
    expect(describeAction('POST', '/api/handymen/x/invite')?.action).toBe('Sent an invite to a handyman');
    expect(describeAction('POST', '/api/maintenance/x/pay')?.action).toBe('Recorded payment for a maintenance request');
    expect(describeAction('POST', '/api/maintenance/x/assign')?.action).toBe('Assigned a maintenance request');
  });

  it('labels settings and own-profile edits', () => {
    expect(describeAction('PUT', '/api/settings')?.action).toBe('Updated settings');
    expect(describeAction('PUT', '/api/me')?.action).toBe('Updated their own profile');
  });

  it('falls back to a generic action for unknown resources', () => {
    expect(describeAction('POST', '/api/widgets')?.action).toBe('Added a widgets');
  });

  it('does not log auth flows or the activity log itself', () => {
    expect(describeAction('POST', '/api/auth/sign-in/email')).toBeNull();
    expect(describeAction('GET', '/api/activity')).toBeNull();
  });
});
