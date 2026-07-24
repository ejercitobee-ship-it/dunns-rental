import { useEffect, useMemo, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { AlertCircle, Lock, Mail, Eye, EyeOff, User } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { useToast } from '../context/ToastContext';
import { signupApi, type SignupUnit } from '../lib/api';
import logo from '../assets/mh-dunn-logo.png';

/**
 * PUBLIC tenant self sign-up. A tenant the office already added picks their
 * property and unit, confirms their first name, proves it is them with their
 * last name, then sets the email + password they will sign in with. Only units
 * whose tenant has no login yet appear.
 */
export function Signup() {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [units, setUnits] = useState<SignupUnit[]>([]);
  const [loadingUnits, setLoadingUnits] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [propertyId, setPropertyId] = useState('');
  const [unitId, setUnitId] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    signupApi
      .units()
      .then((list) => {
        if (!cancelled) setUnits(list);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      })
      .finally(() => {
        if (!cancelled) setLoadingUnits(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const properties = useMemo(() => {
    const map = new Map<string, string>();
    units.forEach((u) => map.set(u.propertyId, u.propertyName));
    return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [units]);

  const propertyUnits = useMemo(
    () => units.filter((u) => u.propertyId === propertyId).sort((a, b) => a.unitNumber.localeCompare(b.unitNumber)),
    [units, propertyId]
  );
  const selectedUnit = useMemo(() => units.find((u) => u.unitId === unitId), [units, unitId]);

  const canSubmit =
    !!unitId && !!lastName.trim() && !!email.trim() && password.length >= 8 && password === confirm && !submitting;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!unitId) return;
    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirm) {
      setError('Passwords do not match.');
      return;
    }
    setSubmitting(true);
    try {
      await signupApi.claim({ unitId, lastName: lastName.trim(), email: email.trim(), password });
      showToast('Your account is ready. Please sign in.', 'success');
      navigate('/login');
    } catch (err) {
      setError((err as Error).message || 'Could not complete sign up.');
    } finally {
      setSubmitting(false);
    }
  };

  const inputBase =
    'w-full px-4 py-3 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25 focus:border-primary/40';

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center p-6 sm:p-10">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <img src={logo} alt="MH Dunn Property" className="mx-auto w-56 h-auto" />
        </div>

        <div className="bg-surface rounded-2xl border border-line shadow-[0_2px_12px_rgba(27,26,23,0.05)] p-8">
          <h2 className="text-lg font-semibold text-ink mb-1">Set up your tenant account</h2>
          <p className="text-sm text-muted mb-6">Find your home below and confirm who you are.</p>

          {error && (
            <div className="mb-4 p-4 bg-danger-soft border border-[#e8cdc8] rounded-xl flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-danger flex-shrink-0 mt-0.5" />
              <p className="text-sm text-danger">{error}</p>
            </div>
          )}

          {loadingUnits ? (
            <p className="text-sm text-muted">Loading…</p>
          ) : loadError ? (
            <p className="text-sm text-danger">Could not load sign-up options. Please try again later.</p>
          ) : units.length === 0 ? (
            <div className="text-sm text-muted">
              There are no accounts to set up right now. If you are a tenant, please contact the office.
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-ink mb-2">Property</label>
                <select
                  className={inputBase}
                  value={propertyId}
                  onChange={(e) => {
                    setPropertyId(e.target.value);
                    setUnitId('');
                  }}
                >
                  <option value="">Select your property</option>
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-ink mb-2">Unit</label>
                <select
                  className={inputBase}
                  value={unitId}
                  onChange={(e) => setUnitId(e.target.value)}
                  disabled={!propertyId}
                >
                  <option value="">{propertyId ? 'Select your unit' : 'Choose a property first'}</option>
                  {propertyUnits.map((u) => (
                    <option key={u.unitId} value={u.unitId}>Unit {u.unitNumber}</option>
                  ))}
                </select>
              </div>

              {selectedUnit && (
                <div className="rounded-xl border border-line bg-canvas p-4 flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-primary-soft flex items-center justify-center flex-shrink-0">
                    <User className="h-4 w-4 text-primary" />
                  </div>
                  <p className="text-sm text-ink">
                    We have <span className="font-semibold">{selectedUnit.firstName}</span> on file for this unit. Enter
                    the last name to confirm it is you.
                  </p>
                </div>
              )}

              <div>
                <label className="block text-sm font-medium text-ink mb-2">Last name</label>
                <input
                  className={inputBase}
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  placeholder="Your last name"
                  autoComplete="family-name"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-ink mb-2">Email</label>
                <div className="relative">
                  <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-faint" />
                  <input
                    type="email"
                    className={`${inputBase} pl-10`}
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                  />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-ink mb-2">Password</label>
                <div className="relative">
                  <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-faint" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    className={`${inputBase} pl-10 pr-12`}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="At least 8 characters"
                    autoComplete="new-password"
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
                <label className="block text-sm font-medium text-ink mb-2">Confirm password</label>
                <input
                  type={showPassword ? 'text' : 'password'}
                  className={inputBase}
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="Re-enter your password"
                  autoComplete="new-password"
                />
              </div>

              <Button type="submit" className="w-full py-3" disabled={!canSubmit}>
                {submitting ? 'Setting up…' : 'Create my account'}
              </Button>
            </form>
          )}
        </div>

        <p className="text-center text-sm text-muted mt-6">
          Already have an account?{' '}
          <Link to="/login" className="text-primary hover:text-primary-hover font-medium">Sign in</Link>
        </p>
      </div>
    </div>
  );
}
