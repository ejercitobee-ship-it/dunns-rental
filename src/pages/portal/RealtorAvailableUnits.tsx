import { useEffect, useState } from 'react';
import { Card, CardContent } from '../../components/ui/Card';
import { portalApi, type AvailableUnit } from '../../lib/api';
import { formatCurrency } from '../../lib/utils';

export function RealtorAvailableUnits() {
  const [units, setUnits] = useState<AvailableUnit[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    portalApi.availableUnits()
      .then((u) => { if (!cancelled) setUnits(u); })
      .catch(() => { if (!cancelled) setUnits([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  if (loading) return <p className="text-sm text-muted">Loading available units.</p>;

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Marketing</p>
        <h1 className="font-display text-2xl text-ink mt-1">Available units</h1>
        <p className="text-sm text-muted mt-1">Vacant units you can market. Place a tenant from the New Tenant form.</p>
      </div>

      {units.length === 0 ? (
        <Card><CardContent className="p-6"><p className="text-sm text-muted">No units are available right now.</p></CardContent></Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {units.map((u) => {
            const addr = [u.address, u.city, [u.state, u.zipCode].filter(Boolean).join(' ')].filter(Boolean).join(', ');
            const specs = [
              u.bedrooms != null ? `${u.bedrooms} bed` : null,
              u.bathrooms != null ? `${u.bathrooms} bath` : null,
              u.squareFeet ? `${u.squareFeet} sq ft` : null,
            ].filter(Boolean).join(' · ');
            return (
              <Card key={u.id}>
                <CardContent className="p-5 space-y-2">
                  <p className="font-display text-lg font-medium text-ink">Unit {u.unitNumber}</p>
                  {addr && <p className="text-sm text-muted">{addr}</p>}
                  {specs && <p className="text-sm text-muted">{specs}</p>}
                  <p className="font-display text-xl text-ink tnum">{formatCurrency(u.monthlyRent)} <span className="text-sm text-muted">per month</span></p>
                  {u.description && <p className="text-sm text-muted">{u.description}</p>}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
