import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-canvas">
      <div className="max-w-3xl mx-auto px-5 py-12">
        <Link to="/login" className="inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary-hover mb-8">
          <ArrowLeft className="h-4 w-4" /> Back to login
        </Link>

        <h1 className="font-display text-2xl text-ink mb-2">Data Privacy Policy</h1>
        <p className="text-sm text-muted mb-8">Last updated: October 13, 2026</p>

        <div className="space-y-6 text-sm text-ink leading-relaxed">
          <section>
            <h2 className="font-semibold text-base text-ink mb-2">1. Who We Are</h2>
            <p>
              MH Dunn Property ("we," "us," or "our") manages residential rental properties in the Chicago metropolitan area.
              This policy explains how we collect, use, and protect your personal information when you use our tenant portal,
              website, and related services.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-base text-ink mb-2">2. Information We Collect</h2>
            <p className="mb-2">We collect the following types of information:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>Account information:</strong> name, email address, phone number, and login credentials.</li>
              <li><strong>Lease and tenancy details:</strong> lease terms, unit assignment, move in/out dates, and rental payment history.</li>
              <li><strong>Payment information:</strong> bank account details and card information are collected and stored securely by our payment processor, Stripe. We do not store your full card or bank account numbers on our servers.</li>
              <li><strong>Maintenance requests:</strong> descriptions, photos, and scheduling details you submit through the portal.</li>
              <li><strong>Communications:</strong> messages exchanged through our portal messaging system.</li>
              <li><strong>Device and usage data:</strong> IP address, browser type, and general usage patterns to maintain security and improve our services.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-semibold text-base text-ink mb-2">3. How We Use Your Information</h2>
            <ul className="list-disc pl-5 space-y-1">
              <li>Process rent payments and generate receipts.</li>
              <li>Manage your lease and tenancy.</li>
              <li>Respond to maintenance requests and communicate with you about your unit.</li>
              <li>Send notifications about payments, lease updates, and important property announcements.</li>
              <li>Comply with legal obligations, including tax reporting and fair housing requirements.</li>
              <li>Protect the security of your account and our systems.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-semibold text-base text-ink mb-2">4. How We Share Your Information</h2>
            <p className="mb-2">We do not sell your personal information. We may share your information with:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li><strong>Service providers:</strong> payment processing (Stripe), email delivery, and push notification services that help us operate the portal.</li>
              <li><strong>Authorized personnel:</strong> property managers, maintenance staff, and administrative team members who need access to fulfill their responsibilities.</li>
              <li><strong>Legal compliance:</strong> when required by law, court order, or governmental regulation.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-semibold text-base text-ink mb-2">5. Payment Security</h2>
            <p>
              All payment processing is handled by Stripe, a PCI DSS Level 1 certified payment processor.
              Your card numbers and bank account details are transmitted directly to Stripe using encrypted connections
              and are never stored on our servers. When you enable autopay, we store only a reference token to your
              payment method, not your actual account numbers.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-base text-ink mb-2">6. Data Security</h2>
            <p>
              We use industry standard security measures to protect your information, including encrypted data storage,
              secure login with optional two factor authentication, automatic session timeouts after periods of inactivity,
              and role based access controls that limit who can view your data.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-base text-ink mb-2">7. Data Retention</h2>
            <p>
              We retain your personal information for the duration of your tenancy and for a reasonable period afterward
              as required by applicable law (typically up to seven years for financial records). Maintenance records and
              communications are retained for the duration of your tenancy.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-base text-ink mb-2">8. Your Rights</h2>
            <p className="mb-2">You have the right to:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Access and review the personal information we hold about you.</li>
              <li>Request corrections to inaccurate information.</li>
              <li>Request deletion of your data, subject to legal retention requirements.</li>
              <li>Opt out of non essential notifications through your portal settings.</li>
            </ul>
            <p className="mt-2">
              To exercise any of these rights, contact us using the information below.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-base text-ink mb-2">9. Changes to This Policy</h2>
            <p>
              We may update this policy from time to time. We will notify you of significant changes through the
              tenant portal or by email. Continued use of our services after changes are posted constitutes acceptance
              of the updated policy.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-base text-ink mb-2">10. Contact Us</h2>
            <p>
              If you have questions about this privacy policy or how your data is handled, please reach out:
            </p>
            <ul className="mt-2 space-y-1">
              <li>Email: <a href="mailto:info@mhdunnproperty.net" className="text-primary hover:text-primary-hover font-medium">info@mhdunnproperty.net</a></li>
              <li>Phone: <a href="tel:+17732346422" className="text-primary hover:text-primary-hover font-medium">(773) 234-6422</a></li>
            </ul>
          </section>
        </div>

        <div className="border-t border-line mt-10 pt-6">
          <p className="text-center text-sm text-faint">© 2026 MH Dunn Property. All rights reserved.</p>
        </div>
      </div>
    </div>
  );
}
