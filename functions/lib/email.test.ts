import { describe, it, expect } from 'vitest';
import { portalInviteEmail, rentReminderEmail } from './email';

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

describe('rentReminderEmail', () => {
  it('names the month, greets by name, and includes payment instructions and the portal link', () => {
    const mail = rentReminderEmail({
      monthLabel: 'July 2026',
      portalUrl: 'https://mhdunnproperty.net/portal/payments',
      paymentInstructions: 'Pay by Zelle to 7739917112.',
      name: 'Pat',
    });
    expect(mail.subject).toBe('Your rent for July 2026 is due');
    expect(mail.html).toContain('MH Dunn Property');
    expect(mail.html).toContain('July 2026');
    expect(mail.html).toContain('Hi Pat,');
    expect(mail.html).toContain('Pay by Zelle to 7739917112.');
    expect(mail.html).toContain('https://mhdunnproperty.net/portal/payments');
    expect(mail.text).toContain('July 2026');
  });

  it('works without a name or payment instructions', () => {
    const mail = rentReminderEmail({
      monthLabel: 'August 2026',
      portalUrl: 'https://mhdunnproperty.net/portal/payments',
    });
    expect(mail.html).toContain('Hi,');
    expect(mail.text).toContain('August 2026');
  });
});
