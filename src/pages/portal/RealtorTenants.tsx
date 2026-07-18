import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, DoorOpen, ChevronRight } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { useToast } from '../../context/ToastContext';
import { portalApi, type RealtorTenantSummary } from '../../lib/api';

// This app has had a React #310 white screen from a hook called after an
// early return, so every hook below runs unconditionally before the
// loading/error branches at the bottom of the component.
//
// Mostly read only, like the rest of the realtor side of the portal: this
// page lists and links out to the detail page. The one write path is adding
// a brand new tenant below, which always creates a fresh record.

const emptyForm = { firstName: '', lastName: '', email: '', phone: '' };

export function RealtorTenants() {
  const { showToast } = useToast();
  const [tenants, setTenants] = useState<RealtorTenantSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);

  const loadTenants = () => portalApi.realtorTenants().then(setTenants);

  useEffect(() => {
    let cancelled = false;
    portalApi
      .realtorTenants()
      .then((list) => {
        if (cancelled) return;
        setTenants(list);
      })
      .catch((err) => {
        if (cancelled) return;
        setError((err as Error).message || 'Could not load your tenants.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const submitNewTenant = async () => {
    if (!form.firstName.trim() || !form.lastName.trim() || submitting) return;
    setSubmitting(true);
    try {
      await portalApi.addRealtorTenant({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
      });
      await loadTenants();
      setForm(emptyForm);
      setShowForm(false);
      showToast('Tenant added.', 'success');
    } catch (err) {
      showToast((err as Error).message || 'Could not add tenant.', 'error');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-muted">Loading your tenants.</p>;
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
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Your tenants</p>
          <h1 className="font-display text-2xl text-ink mt-1">My tenants</h1>
          <p className="text-sm text-muted mt-1">
            People you placed, for the first 30 days after they move in.
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => setShowForm((v) => !v)}>
          {showForm ? 'Cancel' : 'New Tenant'}
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardContent className="p-5 space-y-4">
            <h2 className="font-display text-lg font-medium text-ink">New tenant</h2>
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                className="rounded-lg border border-line px-3 py-2 text-sm"
                placeholder="First name"
                value={form.firstName}
                onChange={(e) => setForm({ ...form, firstName: e.target.value })}
              />
              <input
                className="rounded-lg border border-line px-3 py-2 text-sm"
                placeholder="Last name"
                value={form.lastName}
                onChange={(e) => setForm({ ...form, lastName: e.target.value })}
              />
              <input
                className="rounded-lg border border-line px-3 py-2 text-sm"
                placeholder="Email"
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
              />
              <input
                className="rounded-lg border border-line px-3 py-2 text-sm"
                placeholder="Phone"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                disabled={!form.firstName.trim() || !form.lastName.trim() || submitting}
                onClick={submitNewTenant}
              >
                Save tenant
              </Button>
            </div>
            <p className="text-xs text-muted">
              This creates a new person in your list and in the system. If they are already in the system, ask the office to link them instead.
            </p>
          </CardContent>
        </Card>
      )}

      {tenants.length === 0 ? (
        <Card>
          <CardContent className="p-8 text-center">
            <Users className="h-8 w-8 mx-auto text-faint mb-3" />
            <p className="text-sm text-muted">
              No tenants to show. Access to a tenant ends 30 days after they move in.
            </p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y divide-line">
              {tenants.map((t) => (
                <Link
                  key={t.id}
                  to={`/portal/tenants/${t.id}`}
                  className="flex items-center justify-between px-5 py-4 hover:bg-black/[0.03] transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className="w-9 h-9 rounded-full bg-primary-soft flex items-center justify-center flex-shrink-0">
                      <span className="text-xs font-semibold text-primary">
                        {t.firstName[0]}
                        {t.lastName[0]}
                      </span>
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink truncate">
                        {t.firstName} {t.lastName}
                      </p>
                      <p className="text-xs text-muted flex items-center gap-1 mt-0.5">
                        <DoorOpen className="h-3 w-3 text-faint" />
                        {t.unitNumber ? `Unit ${t.unitNumber}` : 'Unit not on file'}
                      </p>
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 text-faint flex-shrink-0" />
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
