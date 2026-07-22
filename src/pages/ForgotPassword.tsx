import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Building2, Mail, ArrowLeft, CheckCircle2, AlertCircle } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { authApi } from '../lib/api';

export function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [emailConfigured, setEmailConfigured] = useState(true);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const res = await authApi.forgotPassword(email);
      if (res && res.emailConfigured === false) setEmailConfigured(false);
    } catch {
      // The endpoint always returns the same generic result. Even on a network
      // hiccup we show the same confirmation so we never hint at which
      // addresses have accounts.
    } finally {
      setIsLoading(false);
      setSent(true);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-canvas p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-primary rounded-2xl ring-1 ring-black/5 mb-4">
            <Building2 className="h-7 w-7 text-[#c9ddd2]" />
          </div>
          <h1 className="text-[26px] font-medium text-ink">MH Dunn Property</h1>
          <p className="text-muted mt-1 text-sm">Property Management</p>
        </div>

        <div className="bg-surface rounded-2xl border border-line shadow-[0_2px_12px_rgba(27,26,23,0.05)] p-8">
          {sent ? (
            <div className="text-center space-y-4">
              {emailConfigured ? (
                <>
                  <div className="inline-flex items-center justify-center w-12 h-12 bg-positive-soft rounded-full">
                    <CheckCircle2 className="h-6 w-6 text-positive" />
                  </div>
                  <h2 className="text-lg font-semibold text-ink">Check your email</h2>
                  <p className="text-sm text-muted leading-relaxed">
                    If an account exists for <span className="text-ink">{email}</span>, we've sent a link to reset
                    your password. It expires in one hour.
                  </p>
                  <p className="text-xs text-muted">
                    Nothing arrived? Check your spam folder, or try again in a minute.
                  </p>
                </>
              ) : (
                <>
                  <div className="inline-flex items-center justify-center w-12 h-12 bg-warning-soft rounded-full">
                    <AlertCircle className="h-6 w-6 text-warning" />
                  </div>
                  <h2 className="text-lg font-semibold text-ink">Reset by email is not set up yet</h2>
                  <p className="text-sm text-muted leading-relaxed">
                    We can't send you a reset link right now. Please contact your administrator, who can set a new
                    password for you from the Team page.
                  </p>
                </>
              )}
              <Link to="/login" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary-hover">
                <ArrowLeft className="h-4 w-4" />
                Back to sign in
              </Link>
            </div>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-ink mb-2">Reset your password</h2>
              <p className="text-sm text-muted mb-6">
                Enter the email you sign in with and we'll send you a link to choose a new password.
              </p>

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-ink mb-2">Email Address</label>
                  <div className="relative">
                    <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-faint" />
                    <input
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      className="w-full pl-10 pr-4 py-3 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary/40"
                      placeholder="you@example.com"
                      required
                    />
                  </div>
                </div>

                <Button type="submit" className="w-full py-3" disabled={isLoading}>
                  {isLoading ? 'Sending...' : 'Send reset link'}
                </Button>
              </form>

              <div className="mt-6 pt-6 border-t border-line text-center">
                <Link to="/login" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary-hover">
                  <ArrowLeft className="h-4 w-4" />
                  Back to sign in
                </Link>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
