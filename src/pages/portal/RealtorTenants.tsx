import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, DoorOpen, ChevronRight } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/Card';
import { portalApi, type RealtorTenantSummary } from '../../lib/api';

// This app has had a React #310 white screen from a hook called after an
// early return, so every hook below runs unconditionally before the
// loading/error branches at the bottom of the component.
//
// Read only, like the whole realtor side of the portal: this page only lists
// and links out to the detail page. There is nothing here to edit.

export function RealtorTenants() {
  const [tenants, setTenants] = useState<RealtorTenantSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      <div>
        <p className="eyebrow">Your tenants</p>
        <h1 className="font-display text-2xl text-ink mt-1">My tenants</h1>
        <p className="text-sm text-muted mt-1">
          People you placed, for the first 30 days after they move in.
        </p>
      </div>

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
