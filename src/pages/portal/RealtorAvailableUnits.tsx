import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, MapPin, DoorOpen, AlertCircle } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/Card';
import { Badge } from '../../components/ui/Badge';
import { portalApi, type AvailableUnit } from '../../lib/api';
import { formatCurrency } from '../../lib/utils';

/** The full address for a unit, used to group units under one address. */
function addressOf(u: AvailableUnit): string {
  return [u.address, u.city, [u.state, u.zipCode].filter(Boolean).join(' ')]
    .filter(Boolean).join(', ') || 'Address not set';
}

function specsOf(u: AvailableUnit): string {
  return [
    u.bedrooms != null ? `${u.bedrooms} bed` : null,
    u.bathrooms != null ? `${u.bathrooms} bath` : null,
    u.squareFeet ? `${u.squareFeet} sq ft` : null,
  ].filter(Boolean).join(' · ');
}

export function RealtorAvailableUnits() {
  const [units, setUnits] = useState<AvailableUnit[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancelled = false;
    portalApi.availableUnits()
      .then((u) => {
        if (cancelled) return;
        setUnits(u);
        // Open by default when everything is at one address (still collapsible);
        // multiple addresses start collapsed until opened.
        const addresses = [...new Set(u.map(addressOf))];
        if (u.length > 0 && addresses.length === 1) setExpanded(new Set(addresses));
      })
      .catch(() => { if (!cancelled) setUnits([]); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // One group per address, so a realtor scans by building and opens the one
  // they want. Ready for multiple addresses.
  const groups = useMemo(() => {
    const map = new Map<string, AvailableUnit[]>();
    for (const u of units) {
      const key = addressOf(u);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(u);
    }
    return [...map.entries()]
      .map(([address, list]) => ({ address, units: list }))
      .sort((a, b) => a.address.localeCompare(b.address));
  }, [units]);

  const toggle = (address: string) =>
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(address)) next.delete(address);
      else next.add(address);
      return next;
    });
  // Purely driven by the expanded set, so every header toggles reliably (a
  // single address is pre-opened above but can still be collapsed).
  const isOpen = (address: string) => expanded.has(address);

  if (loading) return <p className="text-sm text-muted">Loading available units.</p>;

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Marketing</p>
        <h1 className="font-display text-2xl text-ink mt-1">Available Units</h1>
        <p className="text-sm text-muted mt-1">Vacant units you can market, by address. Place a tenant from the New Tenant form.</p>
      </div>

      {groups.length === 0 ? (
        <Card>
          <CardContent className="py-14 text-center">
            <div className="w-12 h-12 rounded-full bg-warning-soft flex items-center justify-center mx-auto mb-4">
              <AlertCircle className="h-6 w-6 text-warning" />
            </div>
            <h2 className="font-display text-lg font-medium text-ink">No units available right now</h2>
            <p className="text-sm text-muted mt-1 max-w-sm mx-auto">
              There are no vacancies at the moment. Please check back soon — new units are added here as they become available.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {groups.map(({ address, units: addressUnits }) => {
            const open = isOpen(address);
            return (
              <Card key={address}>
                <CardContent className="p-0">
                  <button
                    type="button"
                    onClick={() => toggle(address)}
                    aria-expanded={open}
                    className="flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-black/[0.02]"
                  >
                    <MapPin className="h-4 w-4 text-faint flex-shrink-0" />
                    <span className="flex-1 min-w-0">
                      <span className="block font-medium text-ink truncate">{address}</span>
                      <span className="block text-xs text-muted">
                        {addressUnits.length} {addressUnits.length === 1 ? 'unit' : 'units'} available
                      </span>
                    </span>
                    {open
                      ? <ChevronDown className="h-4 w-4 text-faint flex-shrink-0" />
                      : <ChevronRight className="h-4 w-4 text-faint flex-shrink-0" />}
                  </button>

                  {open && (
                    <div className="border-t border-line divide-y divide-line">
                      {addressUnits.map((u) => {
                        const specs = specsOf(u);
                        return (
                          <div key={u.id} className="px-5 py-4 sm:pl-12">
                            <div className="flex items-start justify-between gap-4">
                              <div className="min-w-0">
                                <div className="flex items-center gap-2">
                                  <DoorOpen className="h-3.5 w-3.5 text-faint" />
                                  <span className="font-medium text-ink">Unit {u.unitNumber}</span>
                                </div>
                                {specs && <p className="text-sm text-muted mt-1">{specs}</p>}
                                {u.description && <p className="text-sm text-muted mt-1">{u.description}</p>}
                              </div>
                              <Badge variant="success" className="flex-shrink-0 tnum">
                                {formatCurrency(u.monthlyRent)}/mo
                              </Badge>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
