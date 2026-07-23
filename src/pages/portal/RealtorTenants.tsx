import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, DoorOpen, ChevronRight } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Avatar } from '../../components/ui/Avatar';
import { useToast } from '../../context/ToastContext';
import { portalApi, type RealtorTenantSummary, type AvailableUnit } from '../../lib/api';
import { formatCurrency } from '../../lib/utils';

// This app has had a React #310 white screen from a hook called after an
// early return, so every hook below runs unconditionally before the
// loading/error branches at the bottom of the component.
//
// Mostly read only, like the rest of the realtor side of the portal: this
// page lists and links out to the detail page. The one write path is adding
// a brand new tenant below, which always creates a fresh record.

const emptyForm = {
  firstName: '', lastName: '', email: '', phone: '',
  emergencyName: '', emergencyPhone: '', emergencyRelationship: '',
  unitId: '',
};

export function RealtorTenants() {
  const { showToast } = useToast();
  const [tenants, setTenants] = useState<RealtorTenantSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [submitting, setSubmitting] = useState(false);
  const [units, setUnits] = useState<AvailableUnit[]>([]);
  // Set when the office needs to link an existing record (email already used).
  const [emailFlag, setEmailFlag] = useState(false);

  const allFieldsFilled =
    !!form.firstName.trim() && !!form.lastName.trim() && !!form.email.trim() && !!form.phone.trim() &&
    !!form.emergencyName.trim() && !!form.emergencyPhone.trim() && !!form.emergencyRelationship.trim() && !!form.unitId;

  const loadTenants = () => portalApi.realtorTenants().then(setTenants);
  const loadUnits = () => portalApi.availableUnits().then(setUnits);

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

  const openForm = () => {
    setShowForm((v) => {
      const next = !v;
      if (next) loadUnits();
      return next;
    });
  };

  const submitNewTenant = async () => {
    if (!allFieldsFilled || submitting) return;
    setSubmitting(true);
    setEmailFlag(false);
    try {
      await portalApi.addRealtorTenant({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim(),
        emergencyName: form.emergencyName.trim(),
        emergencyPhone: form.emergencyPhone.trim(),
        emergencyRelationship: form.emergencyRelationship.trim(),
        unitId: form.unitId,
      });
      await Promise.all([loadTenants(), loadUnits()]);
      setForm(emptyForm);
      setShowForm(false);
      showToast('Tenant added.', 'success');
    } catch (err) {
      const msg = (err as Error).message || '';
      // Duplicate email: flag the realtor to call the office instead of showing
      // a transient toast, since it is an action they must take.
      if (/already in the system/i.test(msg)) {
        setEmailFlag(true);
      } else {
        showToast(msg || 'Could not add tenant.', 'error');
      }
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
        <Button size="sm" variant="outline" onClick={openForm}>
          {showForm ? 'Cancel' : 'New Tenant'}
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardContent className="p-5 space-y-4">
            <h2 className="font-display text-lg font-medium text-ink">New tenant</h2>
            <p className="text-xs text-muted">All fields are required.</p>
            <div className="grid gap-2 sm:grid-cols-2">
              <input
                className="rounded-lg border border-line px-3 py-2 text-sm"
                placeholder="First name *"
                value={form.firstName}
                onChange={(e) => setForm({ ...form, firstName: e.target.value })}
              />
              <input
                className="rounded-lg border border-line px-3 py-2 text-sm"
                placeholder="Last name *"
                value={form.lastName}
                onChange={(e) => setForm({ ...form, lastName: e.target.value })}
              />
              <input
                className={`rounded-lg border px-3 py-2 text-sm ${emailFlag ? 'border-danger' : 'border-line'}`}
                placeholder="Email *"
                type="email"
                value={form.email}
                onChange={(e) => { setForm({ ...form, email: e.target.value }); setEmailFlag(false); }}
              />
              <input
                className="rounded-lg border border-line px-3 py-2 text-sm"
                placeholder="Phone *"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
              />
            </div>

            {emailFlag && (
              <div className="rounded-lg border border-danger/40 bg-danger-soft p-3 text-sm text-danger">
                This email is already in the system. Please <span className="font-semibold">call the office</span> to link this tenant instead of creating a new record.
              </div>
            )}

            <div className="grid gap-2 sm:grid-cols-3">
              <input
                className="rounded-lg border border-line px-3 py-2 text-sm"
                placeholder="Emergency contact name *"
                value={form.emergencyName}
                onChange={(e) => setForm({ ...form, emergencyName: e.target.value })}
              />
              <input
                className="rounded-lg border border-line px-3 py-2 text-sm"
                placeholder="Emergency contact phone *"
                value={form.emergencyPhone}
                onChange={(e) => setForm({ ...form, emergencyPhone: e.target.value })}
              />
              <input
                className="rounded-lg border border-line px-3 py-2 text-sm"
                placeholder="Emergency contact relationship *"
                value={form.emergencyRelationship}
                onChange={(e) => setForm({ ...form, emergencyRelationship: e.target.value })}
              />
            </div>
            <div>
              <select
                className="w-full rounded-lg border border-line px-3 py-2 text-sm"
                value={form.unitId}
                onChange={(e) => setForm({ ...form, unitId: e.target.value })}
              >
                <option value="">Select a unit *</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.address ? `${u.address}, ` : ''}Unit {u.unitNumber} ({formatCurrency(u.monthlyRent)})
                  </option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                disabled={!allFieldsFilled || submitting}
                onClick={submitNewTenant}
              >
                Save tenant
              </Button>
            </div>
            <p className="text-xs text-muted">
              This creates a new tenant in your list and in the system. If they are already in the system, ask the office to link them instead.
            </p>
            <p className="text-xs text-muted">
              Choosing a unit places this tenant there as a draft. The office sets the rent and dates.
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
                    <Avatar
                      photoUrl={t.photoUrl}
                      initials={`${t.firstName?.[0] ?? ''}${t.lastName?.[0] ?? ''}`}
                      className="w-9 h-9 flex-shrink-0"
                    />
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-ink truncate">
                        {t.firstName} {t.lastName}
                      </p>
                      <p className="text-xs text-muted flex items-center gap-1 mt-0.5">
                        <DoorOpen className="h-3 w-3 text-faint" />
                        {t.unit?.unitNumber ? `Unit ${t.unit.unitNumber}` : 'Unit not on file'}
                      </p>
                      {(() => {
                        const addr = [
                          t.unit?.address,
                          t.unit?.city,
                          [t.unit?.state, t.unit?.zipCode].filter(Boolean).join(' '),
                        ].filter(Boolean).join(', ');
                        return addr ? <p className="text-xs text-muted truncate mt-0.5">{addr}</p> : null;
                      })()}
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
