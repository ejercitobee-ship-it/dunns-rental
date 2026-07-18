import { useEffect, useState } from 'react';
import { User, ShieldAlert } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/Card';
import { portalApi } from '../../lib/api';

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

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-sm font-medium text-ink mb-1.5">{label}</p>
      <p className="text-sm text-muted">{value || 'Not on file'}</p>
    </div>
  );
}

export function TenantInfo() {
  const [form, setForm] = useState<InfoForm>(EMPTY_FORM);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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

      <div className="space-y-6">
        <Card>
          <CardContent className="p-5 space-y-4">
            <p className="text-sm text-muted">To update your details, please contact us.</p>
            <h3 className="font-semibold text-ink flex items-center gap-2">
              <User className="h-4 w-4 text-faint" /> Contact
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <Field label="First name" value={form.firstName} />
              <Field label="Last name" value={form.lastName} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Email" value={form.email} />
              <Field label="Phone" value={form.phone} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 space-y-4">
            <h3 className="font-semibold text-ink flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-faint" /> Emergency contact
            </h3>
            <Field label="Name" value={form.emergencyName} />
            <div className="grid grid-cols-2 gap-4">
              <Field label="Phone" value={form.emergencyPhone} />
              <Field label="Relationship" value={form.emergencyRelationship} />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
