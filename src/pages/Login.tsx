import { useState } from 'react';
import { useNavigate, Link, useSearchParams } from 'react-router-dom';
import { Lock, Mail, Eye, EyeOff, AlertCircle } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import logo from '../assets/mh-dunn-logo.png';
import familyPhoto from '../assets/login-family.jpg';

export function Login() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { login } = useAuth();
  const { showToast } = useToast();
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  // Check if user was logged out due to inactivity
  const logoutReason = searchParams.get('reason');
  const inactiveMessage = logoutReason === 'inactive' 
    ? 'You were logged out due to 30 minutes of inactivity. Please log in again.' 
    : null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const result = await login(email, password);
      
      if (result.success) {
        showToast('Welcome back!', 'success');
        navigate('/');
      } else {
        setError(result.error || 'Invalid email or password');
        showToast(result.error || 'Invalid credentials', 'error');
      }
    } catch {
      setError('An error occurred. Please try again.');
      showToast('Login failed', 'error');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-canvas lg:grid lg:grid-cols-[1.05fr_1fr]">
      {/* Image panel, shown on larger screens */}
      <div className="relative hidden lg:block overflow-hidden">
        <img
          src={familyPhoto}
          alt="A family relaxing with their dog in the yard of a home"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#14231c]/80 via-[#14231c]/15 to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-12">
          <p className="font-display text-white text-[30px] leading-snug max-w-md">
            Quality multi family homes, managed with care.
          </p>
          <p className="text-white/75 mt-3 text-sm tracking-wide">MH Dunn Property</p>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center p-6 sm:p-10">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <img src={logo} alt="MH Dunn Property" className="mx-auto w-60 h-auto" />
        </div>

        {/* Login Card */}
        <div className="bg-surface rounded-2xl border border-line shadow-[0_2px_12px_rgba(27,26,23,0.05)] p-8">
          <h2 className="text-lg font-semibold text-ink mb-6">Sign in</h2>

          {error && (
            <div className="mb-4 p-4 bg-danger-soft border border-[#e8cdc8] rounded-xl flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-danger flex-shrink-0" />
              <p className="text-sm text-danger">{error}</p>
            </div>
          )}

          {inactiveMessage && (
            <div className="mb-4 p-4 bg-warning-soft border border-[#e9dcbe] rounded-xl flex items-center gap-3">
              <AlertCircle className="h-5 w-5 text-warning flex-shrink-0" />
              <p className="text-sm text-warning">{inactiveMessage}</p>
            </div>
          )}

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
                  placeholder="Enter your email"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-ink mb-2">Password</label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-faint" />
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-10 pr-12 py-3 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary/40"
                  placeholder="Enter your password"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 p-1 hover:bg-black/[0.05] rounded-lg transition-colors"
                >
                  {showPassword ? (
                    <EyeOff className="h-5 w-5 text-faint" />
                  ) : (
                    <Eye className="h-5 w-5 text-faint" />
                  )}
                </button>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" className="w-4 h-4 rounded border-line-strong text-primary focus:ring-primary/30 accent-[#24503f]" />
                <span className="text-sm text-muted">Remember me</span>
              </label>
              <Link to="/forgot-password" className="text-sm text-primary hover:text-primary-hover font-medium">
                Forgot password?
              </Link>
            </div>

            <Button 
              type="submit" 
              className="w-full py-3"
              disabled={isLoading}
            >
              {isLoading ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Signing in...
                </span>
              ) : (
                'Sign In'
              )}
            </Button>
          </form>
        </div>

        {/* Tenant self sign-up */}
        <p className="text-center text-sm text-muted mt-6">
          New tenant?{' '}
          <Link to="/signup" className="text-primary hover:text-primary-hover font-medium">Set up your account</Link>
        </p>

        {/* Footer */}
        <p className="text-center text-sm text-faint mt-6">
          © 2026 MH Dunn Property. All rights reserved.
        </p>
      </div>
      </div>
    </div>
  );
}
