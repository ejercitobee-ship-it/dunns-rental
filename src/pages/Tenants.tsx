import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Search, Users, UserCheck, Home, DoorOpen, Mail, Phone, Calendar, DollarSign } from 'lucide-react';
import { Card, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { formatCurrency, formatDate } from '../lib/utils';
import { useApp } from '../context/AppContext';
import { monthlyRevenue } from '../lib/rent';
import type { Lease, LeaseStatus } from '../types';

const leaseStatusBadge: Record<LeaseStatus, 'success' | 'warning' | 'secondary'> = {
  active: 'success',
  paused: 'warning',
  ended: 'secondary',
};

const leaseStatusLabel: Record<LeaseStatus, string> = {
  active: 'Active',
  paused: 'Paused',
  ended: 'Ended',
};

const DAY_MS = 1000 * 60 * 60 * 24;

export function Tenants() {
  const { tenants, properties, units, leases, getLeaseTenants, getTenantLeases } = useApp();
  const navigate = useNavigate();
  const [searchTerm, setSearchTerm] = useState('');

  const rows = useMemo(() => {
    return tenants.map(tenant => {
      const lease: Lease | undefined = getTenantLeases(tenant.id).find(l => l.status !== 'ended');
      const property = lease?.propertyId ? properties.find(p => p.id === lease.propertyId) : undefined;
      const unit = lease?.unitId ? units.find(u => u.id === lease.unitId) : undefined;
      const housemates = lease ? getLeaseTenants(lease.id).filter(h => h.id !== tenant.id) : [];
      return { tenant, lease, property, unit, housemates };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenants, leases, properties, units]);

  const filteredRows = useMemo(() => {
    const q = searchTerm.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(({ tenant }) => {
      const fullName = `${tenant.firstName} ${tenant.lastName}`.toLowerCase();
      return (
        fullName.includes(q) ||
        (tenant.email || '').toLowerCase().includes(q) ||
        (tenant.phone || '').toLowerCase().includes(q)
      );
    });
  }, [rows, searchTerm]);

  const stats = useMemo(() => {
    const totalPeople = tenants.length;
    const housed = rows.filter(r => r.lease?.status === 'active').length;
    const today = new Date();
    const expiringSoon = leases.filter(l => {
      if (l.status !== 'active' || !l.endDate) return false;
      const daysUntilEnd = Math.ceil((new Date(l.endDate).getTime() - today.getTime()) / DAY_MS);
      return daysUntilEnd > 0 && daysUntilEnd <= 60;
    }).length;
    return {
      totalPeople,
      housed,
      expiringSoon,
      revenue: monthlyRevenue(leases),
    };
  }, [tenants, rows, leases]);

  const statCards = [
    { label: 'Total People', value: stats.totalPeople, icon: <Users /> },
    { label: 'Housed', value: stats.housed, icon: <UserCheck /> },
    { label: 'Expiring Soon', value: stats.expiringSoon, icon: <Calendar /> },
    { label: 'Monthly Revenue', value: formatCurrency(stats.revenue), icon: <DollarSign /> },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-[26px] sm:text-[32px] font-medium text-ink">Tenants</h1>
          <p className="text-muted mt-1 text-sm">People, their households and where they live.</p>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 sm:gap-6 grid-cols-2 lg:grid-cols-4">
        {statCards.map(s => (
          <Card key={s.label}>
            <div className="p-5">
              <div className="flex items-center justify-between">
                <span className="eyebrow">{s.label}</span>
                <span className="text-faint [&_svg]:h-[18px] [&_svg]:w-[18px]">{s.icon}</span>
              </div>
              <div className="mt-3 font-display text-[27px] leading-none font-medium text-ink tnum">{s.value}</div>
            </div>
          </Card>
        ))}
      </div>

      {/* Search */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-faint" />
          <input
            type="text"
            placeholder="Search by name, email, or phone..."
            className="w-full pl-10 pr-4 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
        </div>
      </div>

      {/* People table */}
      <Card>
        <CardContent className="p-0">
          <div className="overflow-x-auto sm:overflow-visible">
            <table className="w-full min-w-[860px] sm:min-w-0">
              <thead>
                <tr className="border-b border-line bg-canvas">
                  <th className="text-left py-3 px-4 font-semibold text-ink text-sm">Person</th>
                  <th className="text-left py-3 px-4 font-semibold text-ink text-sm">Property &amp; Unit</th>
                  <th className="text-left py-3 px-4 font-semibold text-ink text-sm">Contact</th>
                  <th className="text-left py-3 px-4 font-semibold text-ink text-sm">Lease Term</th>
                  <th className="text-right py-3 px-4 font-semibold text-ink text-sm">Rent</th>
                  <th className="text-center py-3 px-4 font-semibold text-ink text-sm">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredRows.map(({ tenant, lease, property, unit, housemates }) => (
                  <tr
                    key={tenant.id}
                    onClick={() => navigate(`/tenants/${tenant.id}`)}
                    className="border-b border-line last:border-0 hover:bg-black/[0.02] cursor-pointer"
                  >
                    <td className="py-4 px-4">
                      <Link
                        to={`/tenants/${tenant.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="flex items-center gap-3"
                      >
                        <div className="w-10 h-10 rounded-full bg-primary-soft flex items-center justify-center flex-shrink-0">
                          <span className="font-semibold text-primary text-sm">
                            {tenant.firstName[0]}{tenant.lastName[0]}
                          </span>
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-ink truncate">{tenant.firstName} {tenant.lastName}</p>
                          {housemates.length > 0 && (
                            <p className="text-xs text-muted truncate">
                              with {housemates.map(h => `${h.firstName} ${h.lastName}`).join(', ')}
                            </p>
                          )}
                        </div>
                      </Link>
                    </td>

                    <td className="py-4 px-4">
                      {property || unit ? (
                        <div className="space-y-1">
                          <div className="flex items-center gap-2 text-sm text-ink">
                            <Home className="h-3.5 w-3.5 text-faint" />
                            <span>{property?.name || '—'}</span>
                          </div>
                          <div className="flex items-center gap-2 text-sm text-muted">
                            <DoorOpen className="h-3.5 w-3.5 text-faint" />
                            <span>{unit ? `Unit ${unit.unitNumber}` : '—'}</span>
                          </div>
                        </div>
                      ) : (
                        <span className="text-sm text-faint">—</span>
                      )}
                    </td>

                    <td className="py-4 px-4">
                      <div className="space-y-1">
                        <div className="flex items-center gap-2 text-sm text-muted">
                          <Mail className="h-3 w-3 text-faint" />
                          <span className="truncate">{tenant.email || '—'}</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-muted">
                          <Phone className="h-3 w-3 text-faint" />
                          <span>{tenant.phone || '—'}</span>
                        </div>
                      </div>
                    </td>

                    <td className="py-4 px-4">
                      {lease?.startDate || lease?.endDate ? (
                        <span className="text-sm text-ink">
                          {lease?.startDate ? formatDate(lease.startDate) : '—'} to {lease?.endDate ? formatDate(lease.endDate) : '—'}
                        </span>
                      ) : (
                        <span className="text-sm text-faint">—</span>
                      )}
                    </td>

                    <td className="py-4 px-4 text-right">
                      {lease ? (
                        <p className="font-semibold text-ink tnum">{formatCurrency(lease.monthlyRent)}</p>
                      ) : (
                        <span className="text-sm text-faint">—</span>
                      )}
                    </td>

                    <td className="py-4 px-4 text-center">
                      {lease ? (
                        <Badge variant={leaseStatusBadge[lease.status]}>{leaseStatusLabel[lease.status]}</Badge>
                      ) : (
                        <Badge variant="outline">No tenancy</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {filteredRows.length === 0 && (
            <div className="text-center py-16">
              <Users className="h-10 w-10 mx-auto text-faint mb-3" />
              <h3 className="font-medium text-ink">No people found</h3>
              <p className="text-sm text-muted mt-1">Try adjusting your search.</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
