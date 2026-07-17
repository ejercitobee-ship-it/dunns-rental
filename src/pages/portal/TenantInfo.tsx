import { useEffect, useRef, useState } from 'react';
import { User, ShieldAlert } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { portalApi } from '../../lib/api';
import { useToast } from '../../context/ToastContext';

// This app has had a React #310 white screen from a useMemo called after an
// early return, so every hook below runs unconditionally before the
// loading/error branches at the bottom of the component.

interface InfoForm {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  emergencyName: string;
  emergencyPhone: string;
  emergencyRelationship: string;
}

const EMPTY_FORM: InfoForm = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  emergencyName: '',
  emergencyPhone: '',
  emergencyRelationship: '',
};

export function TenantInfo() {
  const { showToast } = useToast();
  const [form, setForm] = useState<InfoForm>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Synchronous re-entry guard: `saving` (state) only disables the Save
  // button after a render, so a fast double-click could fire updateMe twice
  // before that render lands and double-submit. The ref blocks it immediately.
  const savingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    portalApi
      .me()
      .then((res) => {
        if (cancelled) return;
        const t = res.tenant;
        setForm({
          firstName: t.firstName || '',
          lastName: t.lastName || '',
          email: t.email || '',
          phone: t.phone || '',
          emergencyName: t.emergencyContact?.name || '',
          emergencyPhone: t.emergencyContact?.phone || '',
          emergencyRelationship: t.emergencyContact?.relationship || '',
        });
      })
      .catch((err) => {
        if (cancelled) return;
        setError((err as Error).message || 'Could not load your information.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const hasEmergencyContact =
        form.emergencyName.trim() || form.emergencyPhone.trim() || form.emergencyRelationship.trim();
      // Only person fields travel here. There is no rent, unit, lease or
      // notes field on this form because the server's PUT /portal/me
      // allowlists columns and would reject or ignore anything else.
      await portalApi.updateMe({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        emergencyContact: hasEmergencyContact
          ? {
              name: form.emergencyName.trim(),
              phone: form.emergencyPhone.trim(),
              relationship: form.emergencyRelationship.trim(),
            }
          : undefined,
      });
      showToast('Information saved.', 'success');
    } catch (err) {
      showToast((err as Error).message || 'Could not save your information.', 'error');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-muted">Loading your information.</p>;
  }

  if (error) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-sm text-danger">{error}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6 max-w-2xl">
      <div>
        <p className="eyebrow">Your details</p>
        <h1 className="font-display text-2xl text-ink mt-1">My information</h1>
        <p className="text-sm text-muted mt-1">
          Keep your contact details current so your property manager can reach you.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        <Card>
          <CardContent className="p-5 space-y-4">
            <h3 className="font-semibold text-ink flex items-center gap-2">
              <User className="h-4 w-4 text-faint" /> Contact
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-ink mb-1.5">First name *</label>
                <input
                  type="text"
                  required
                  className="w-full px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
                  value={form.firstName}
                  onChange={(e) => setForm({ ...form, firstName: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1.5">Last name *</label>
                <input
                  type="text"
                  required
                  className="w-full px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
                  value={form.lastName}
                  onChange={(e) => setForm({ ...form, lastName: e.target.value })}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-ink mb-1.5">Email</label>
                <input
                  type="email"
                  className="w-full px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1.5">Phone</label>
                <input
                  type="tel"
                  className="w-full px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
                  value={form.phone}
                  onChange={(e) => setForm({ ...form, phone: e.target.value })}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 space-y-4">
            <h3 className="font-semibold text-ink flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-faint" /> Emergency contact
            </h3>
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">Name</label>
              <input
                type="text"
                className="w-full px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
                value={form.emergencyName}
                onChange={(e) => setForm({ ...form, emergencyName: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-ink mb-1.5">Phone</label>
                <input
                  type="tel"
                  className="w-full px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
                  value={form.emergencyPhone}
                  onChange={(e) => setForm({ ...form, emergencyPhone: e.target.value })}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-ink mb-1.5">Relationship</label>
                <input
                  type="text"
                  placeholder="e.g. Parent, Sibling"
                  className="w-full px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
                  value={form.emergencyRelationship}
                  onChange={(e) => setForm({ ...form, emergencyRelationship: e.target.value })}
                />
              </div>
            </div>
          </CardContent>
        </Card>

        <Button type="submit" disabled={saving}>
          {saving ? 'Saving...' : 'Save changes'}
        </Button>
      </form>
    </div>
  );
}
