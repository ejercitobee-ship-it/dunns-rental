import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Building2, Lock, Eye, EyeOff, AlertCircle, ArrowLeft } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { authApi } from '../lib/api';
import { useToast } from '../context/ToastContext';

export function ResetPassword() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const token = searchParams.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Those passwords do not match.');
      return;
    }

    setIsLoading(true);
    try {
      await authApi.resetPasswordWithToken(token, password);
      showToast('Password updated. You can sign in now.', 'success');
      navigate('/login');
    } catch (err) {
      const raw = (err as Error).message || '';
      if (raw.includes('expired') || raw.includes('Invalid')) {
        setError('This reset link has expired or was already used. Please request a new one from the forgot password page.');
      } else {
        setError('Something went wrong while resetting your password. Please try again.');
      }
    } finally {
      setIsLoading(false);
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
          {!token ? (
            <div className="text-center space-y-4">
              <div className="inline-flex items-center justify-center w-12 h-12 bg-danger-soft rounded-full">
                <AlertCircle className="h-6 w-6 text-danger" />
              </div>
              <h2 className="text-lg font-semibold text-ink">This reset link is no longer valid</h2>
              <p className="text-sm text-muted leading-relaxed">
                Password reset links expire after one hour and can only be used once. Please request a new link to continue.
              </p>
              <Link to="/forgot-password" className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary-hover">
                Request a new reset link
              </Link>
            </div>
          ) : (
            <>
              <h2 className="text-lg font-semibold text-ink mb-2">Choose a new password</h2>
              <p className="text-sm text-muted mb-6">Make it at least 8 characters.</p>

              {error && (
                <div className="mb-4 p-4 bg-danger-soft border border-[#e8cdc8] rounded-xl flex gap-3">
                  <AlertCircle className="h-5 w-5 text-danger flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="text-sm text-danger font-medium">{error}</p>
                    {error.includes('expired') && (
                      <p className="text-xs text-danger/80 mt-1">
                        <Link to="/forgot-password" className="underline font-medium hover:text-danger">
                          Request a new reset link
                        </Link>
                      </p>
                    )}
                  </div>
                </div>
              )}

              <form onSubmit={handleSubmit} className="space-y-5">
                <div>
                  <label className="block text-sm font-medium text-ink mb-2">New password</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-faint" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full pl-10 pr-12 py-3 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary/40"
                      placeholder="At least 8 characters"
                      required
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-black/[0.05] rounded-lg transition-colors"
                    >
                      {showPassword ? <EyeOff className="h-5 w-5 text-faint" /> : <Eye className="h-5 w-5 text-faint" />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-ink mb-2">Confirm new password</label>
                  <div className="relative">
                    <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-faint" />
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      className="w-full pl-10 pr-4 py-3 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary/40"
                      placeholder="Type it again"
                      required
                    />
                  </div>
                </div>

                <Button type="submit" className="w-full py-3" disabled={isLoading}>
                  {isLoading ? 'Updating...' : 'Update password'}
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
