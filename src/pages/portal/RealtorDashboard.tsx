import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { portalApi, type RealtorMe } from '../../lib/api';

export function RealtorDashboard() {
  const [data, setData] = useState<RealtorMe | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    portalApi
      .realtorMe()
      .then((d) => { if (!cancelled) setData(d); })
      .catch((err) => { if (!cancelled) setError((err as Error).message || 'Could not load your dashboard.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) return <p className="text-sm text-muted">Loading your dashboard.</p>;
  if (error || !data) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-sm text-muted">{error || 'Could not load your dashboard.'}</p>
        </CardContent>
      </Card>
    );
  }

  const { profile, tenantsPlaced, tenantsInWindow } = data;

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Realtor</p>
        <h1 className="font-display text-2xl text-ink mt-1">Dashboard</h1>
      </div>

      <Card>
        <CardContent className="p-5 space-y-4">
          <h2 className="font-display text-lg font-medium text-ink">Your profile</h2>
          <div className="space-y-1">
            <p className="text-ink font-medium">{profile.name || 'Realtor'}</p>
            <p className="text-muted text-sm">{profile.email}</p>
            {profile.phone && <p className="text-muted text-sm">{profile.phone}</p>}
          </div>
          <p className="text-xs text-muted">To update these details, please contact the office.</p>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="p-5">
            <p className="eyebrow">Tenants placed</p>
            <p className="font-display text-3xl text-ink mt-1 tnum">{tenantsPlaced}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="eyebrow">In your active window</p>
            <p className="font-display text-3xl text-ink mt-1 tnum">{tenantsInWindow}</p>
          </CardContent>
        </Card>
      </div>

      <div>
        <Link to="/portal/tenants">
          <Button variant="outline">View my tenants</Button>
        </Link>
      </div>
    </div>
  );
}
