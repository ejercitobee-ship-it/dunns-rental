import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export function TermsOfService() {
  return (
    <div className="min-h-screen bg-canvas">
      <div className="max-w-3xl mx-auto px-5 py-12">
        <Link to="/login" className="inline-flex items-center gap-1.5 text-sm text-primary hover:text-primary-hover mb-8">
          <ArrowLeft className="h-4 w-4" /> Back to login
        </Link>

        <h1 className="font-display text-2xl text-ink mb-2">Terms of Service</h1>
        <p className="text-sm text-muted mb-8">Last updated: October 13, 2026</p>

        <div className="space-y-6 text-sm text-ink leading-relaxed">
          <section>
            <h2 className="font-semibold text-base text-ink mb-2">1. Acceptance of Terms</h2>
            <p>
              By accessing or using the MH Dunn Property tenant portal ("the Portal"), you agree to be bound by
              these Terms of Service. If you do not agree, do not use the Portal. These terms supplement, but do
              not replace, the terms of your lease agreement with MH Dunn Property.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-base text-ink mb-2">2. Portal Access</h2>
            <p>
              Access to the Portal is provided to current tenants, authorized property staff, and approved
              service providers (such as maintenance personnel and realtors). Your login credentials are
              personal and must not be shared. You are responsible for all activity under your account. If you
              believe your account has been compromised, contact the office immediately at{' '}
              <a href="mailto:info@mhdunnproperty.net" className="text-primary hover:underline">info@mhdunnproperty.net</a>
              {' '}or{' '}
              <a href="tel:+17732346422" className="text-primary hover:underline">(773) 234-6422</a>.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-base text-ink mb-2">3. Online Rent Payments</h2>
            <p className="mb-2">
              The Portal offers optional online rent payment through Stripe, a third party payment processor.
              By using online payment, you acknowledge and agree:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Online payment is voluntary. You may pay rent by check, money order, Zelle, or other methods accepted by the office.</li>
              <li>Processing fees are charged by the payment processor and are disclosed before each transaction. Card payments incur a 2.9% + $0.30 fee. Bank account (ACH) payments incur a 0.8% fee, capped at $5.00. No fee is charged for Zelle payments.</li>
              <li>Your payment information (card numbers, bank account details) is transmitted directly to and stored by Stripe. MH Dunn Property does not store your full payment credentials.</li>
              <li>Payments may take time to process. Card payments typically confirm within seconds. ACH bank transfers typically take 3 to 5 business days.</li>
              <li>Payment through the Portal does not change the terms of your lease regarding due dates, late fees, or grace periods.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-semibold text-base text-ink mb-2">4. Autopay Authorization</h2>
            <p>
              If you enable autopay, you authorize MH Dunn Property to automatically charge your selected payment
              method on the rent due date each month for the full rent amount plus the applicable processing fee.
              For bank account (ACH) autopay, this constitutes your authorization for recurring electronic debits
              in accordance with NACHA operating rules. You may cancel autopay at any time through the Portal,
              and cancellation takes effect before the next scheduled charge.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-base text-ink mb-2">5. Stripe Terms</h2>
            <p>
              Payment processing is provided by Stripe and is subject to{' '}
              <a href="https://stripe.com/legal/consumer" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                Stripe's Consumer Terms of Service
              </a>
              {' '}and{' '}
              <a href="https://stripe.com/privacy" target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
                Privacy Policy
              </a>.
              By using online payment features, you also agree to Stripe's terms.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-base text-ink mb-2">6. Maintenance Requests</h2>
            <p>
              You may submit maintenance requests through the Portal. Submitting a request does not guarantee
              a specific response time. Emergency maintenance (water leaks, no heat, gas leaks, or safety hazards)
              should be reported by phone immediately, not through the Portal alone.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-base text-ink mb-2">7. Communications</h2>
            <p>
              Messages sent through the Portal are not a substitute for legally required written notices.
              Formal notices (such as lease termination, notice to vacate, or dispute communications) must
              be delivered in accordance with your lease agreement and applicable law.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-base text-ink mb-2">8. Limitation of Liability</h2>
            <p>
              MH Dunn Property is not liable for payment processing failures, delays, or errors caused by
              Stripe, your bank, or your internet connection. If a payment fails or is delayed, you remain
              responsible for paying rent by the due date using an alternative method. MH Dunn Property is
              not liable for any indirect, incidental, or consequential damages arising from your use of the Portal.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-base text-ink mb-2">9. Acceptable Use</h2>
            <p className="mb-2">You agree not to:</p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Share your login credentials with others.</li>
              <li>Attempt to access accounts, data, or areas of the Portal not assigned to you.</li>
              <li>Use the Portal for any unlawful purpose.</li>
              <li>Upload malicious content, files, or code.</li>
              <li>Interfere with or disrupt the operation of the Portal.</li>
            </ul>
          </section>

          <section>
            <h2 className="font-semibold text-base text-ink mb-2">10. Dispute Resolution</h2>
            <p>
              If you have a dispute regarding a payment processed through the Portal, contact the office at{' '}
              <a href="mailto:info@mhdunnproperty.net" className="text-primary hover:underline">info@mhdunnproperty.net</a>.
              Disputes not resolved directly will be handled in accordance with your lease agreement and
              applicable Illinois law, including the Chicago Residential Landlord and Tenant Ordinance where applicable.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-base text-ink mb-2">11. Changes to These Terms</h2>
            <p>
              We may update these terms from time to time. We will notify you of material changes through the
              Portal or by email. Continued use of the Portal after changes are posted constitutes acceptance.
            </p>
          </section>

          <section>
            <h2 className="font-semibold text-base text-ink mb-2">12. Contact</h2>
            <p>For questions about these terms:</p>
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
