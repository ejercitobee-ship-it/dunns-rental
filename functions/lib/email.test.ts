import { describe, it, expect } from 'vitest';
import { portalInviteEmail } from './email';

describe('portalInviteEmail', () => {
  const url = 'https://dunns-rental.pages.dev/reset-password?token=abc123';

  it('is a branded HTML email with a set-password link and expiry note', () => {
    const mail = portalInviteEmail(url, 'Pat', { companyName: 'MH Dunn Property', contact: 'info@mhdunnproperty.net' });
    expect(mail.subject).toContain('MH Dunn Property');
    expect(mail.html).toContain('MH Dunn Property');
    expect(mail.html).toContain('Set your password');
    expect(mail.html).toContain(url);
    expect(mail.html).toContain('expires in 7 days');
    expect(mail.text).toContain(url);
  });

  it('uses resend wording when re-sending a link', () => {
    const first = portalInviteEmail(url, 'Pat', {});
    const again = portalInviteEmail(url, 'Pat', { resend: true });
    expect(first.html).toContain('set up your online portal');
    expect(again.html).toContain('fresh link');
    expect(again.subject.toLowerCase()).toContain('set your password');
  });
});
