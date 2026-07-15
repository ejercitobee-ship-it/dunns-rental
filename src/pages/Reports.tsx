import { useMemo } from 'react';
import { Download, ClipboardList, AlertTriangle } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { formatCurrency, formatDate } from '../lib/utils';
import { useApp } from '../context/AppContext';

export function Reports() {
  const { tenants, properties, units, rentPayments } = useApp();

  const propertyName = (id?: string) => properties.find(p => p.id === id)?.name || '—';
  const unitNumber = (id?: string) => units.find(u => u.id === id)?.unitNumber || '—';

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  // Rent roll: one row per active tenant, with this month's payment status.
  const rentRoll = useMemo(() => {
    return tenants
      .filter(t => t.status === 'active')
      .map(t => {
        const thisMonth = rentPayments.find(
          p => p.tenantId === t.id && p.month === currentMonth && p.year === currentYear
        );
        const status = thisMonth?.status || 'not_recorded';
        return {
          tenant: t,
          property: propertyName(t.propertyId),
          unit: unitNumber(t.unitId),
          rent: t.monthlyRent || 0,
          leaseEnd: t.leaseEnd,
          status,
        };
      })
      .sort((a, b) => a.property.localeCompare(b.property));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenants, rentPayments, properties, units, currentMonth, currentYear]);

  const totals = useMemo(() => {
    const scheduled = rentRoll.reduce((s, r) => s + r.rent, 0);
    const collected = rentPayments
      .filter(p => p.status === 'paid' && p.month === currentMonth && p.year === currentYear)
      .reduce((s, p) => s + p.amount, 0);
    const outstanding = rentPayments
      .filter(p => p.status === 'overdue' || p.status === 'pending')
      .reduce((s, p) => s + p.amount, 0);
    return { scheduled, collected, outstanding };
  }, [rentRoll, rentPayments, currentMonth, currentYear]);

  // Delinquency: every unpaid (overdue/pending) payment.
  const delinquencies = useMemo(() => {
    return rentPayments
      .filter(p => p.status === 'overdue' || p.status === 'pending')
      .map(p => {
        const t = tenants.find(x => x.id === p.tenantId);
        return {
          payment: p,
          name: t ? `${t.firstName} ${t.lastName}` : 'Unknown tenant',
          property: propertyName(p.propertyId),
        };
      })
      .sort((a, b) => b.payment.amount - a.payment.amount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rentPayments, tenants, properties]);

  const statusView = (status: string) => {
    switch (status) {
      case 'paid': return <Badge variant="success">Paid</Badge>;
      case 'overdue': return <Badge variant="destructive">Overdue</Badge>;
      case 'pending': return <Badge variant="warning">Pending</Badge>;
      case 'partial': return <Badge variant="secondary">Partial</Badge>;
      default: return <Badge variant="secondary">Not recorded</Badge>;
    }
  };

  const exportRentRoll = () => {
    const headers = ['Property', 'Unit', 'Tenant', 'Monthly Rent', 'Lease End', 'This Month'];
    const rows = rentRoll.map(r => [
      r.property,
      r.unit,
      `${r.tenant.firstName} ${r.tenant.lastName}`,
      r.rent,
      r.leaseEnd || '',
      r.status,
    ]);
    const csv = [headers, ...rows].map(row => row.map(c => `"${String(c ?? '')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `rent-roll-${currentYear}-${String(currentMonth).padStart(2, '0')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-[26px] sm:text-[32px] font-medium text-ink">Reports</h1>
          <p className="text-muted mt-1 text-sm">Rent roll and outstanding balances for {now.toLocaleString('en-US', { month: 'long', year: 'numeric' })}.</p>
        </div>
        <Button variant="outline" onClick={exportRentRoll}>
          <Download className="h-4 w-4 mr-2" />
          Export Rent Roll
        </Button>
      </div>

      {/* Totals */}
      <div className="grid gap-4 sm:gap-6 grid-cols-1 sm:grid-cols-3">
        {[
          { label: 'Scheduled Rent', value: formatCurrency(totals.scheduled), sub: 'Active leases, monthly' },
          { label: 'Collected This Month', value: formatCurrency(totals.collected), sub: 'Marked paid' },
          { label: 'Outstanding', value: formatCurrency(totals.outstanding), sub: 'Overdue + pending' },
        ].map(s => (
          <Card key={s.label}>
            <div className="p-5">
              <span className="eyebrow">{s.label}</span>
              <div className="mt-3 font-display text-[27px] leading-none font-medium text-ink tnum">{s.value}</div>
              <p className="mt-1.5 text-[13px] text-muted">{s.sub}</p>
            </div>
          </Card>
        ))}
      </div>

      {/* Rent Roll */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <div className="p-2 bg-primary-soft rounded-lg">
              <ClipboardList className="h-5 w-5 text-primary" />
            </div>
            Rent Roll
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto sm:overflow-visible">
            <table className="w-full min-w-[720px] sm:min-w-0">
              <thead>
                <tr className="border-b border-line bg-canvas">
                  <th className="text-left py-3 px-4 font-semibold text-ink text-sm">Property & Unit</th>
                  <th className="text-left py-3 px-4 font-semibold text-ink text-sm">Tenant</th>
                  <th className="text-right py-3 px-4 font-semibold text-ink text-sm">Monthly Rent</th>
                  <th className="text-left py-3 px-4 font-semibold text-ink text-sm">Lease Ends</th>
                  <th className="text-center py-3 px-4 font-semibold text-ink text-sm">This Month</th>
                </tr>
              </thead>
              <tbody>
                {rentRoll.map(r => (
                  <tr key={r.tenant.id} className="border-b border-line last:border-0 hover:bg-black/[0.02]">
                    <td className="py-3 px-4 text-sm">
                      <span className="text-ink">{r.property}</span>
                      <span className="text-faint"> · {r.unit}</span>
                    </td>
                    <td className="py-3 px-4 text-sm text-ink">{r.tenant.firstName} {r.tenant.lastName}</td>
                    <td className="py-3 px-4 text-right text-sm text-ink tnum">{formatCurrency(r.rent)}</td>
                    <td className="py-3 px-4 text-sm text-muted">{r.leaseEnd ? formatDate(r.leaseEnd) : '—'}</td>
                    <td className="py-3 px-4 text-center">{statusView(r.status)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rentRoll.length === 0 && (
            <div className="text-center py-14 text-sm text-muted">No active leases to report yet.</div>
          )}
        </CardContent>
      </Card>

      {/* Delinquency */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <div className="p-2 bg-danger-soft rounded-lg">
              <AlertTriangle className="h-5 w-5 text-danger" />
            </div>
            Outstanding Balances ({delinquencies.length})
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {delinquencies.length === 0 ? (
            <div className="text-center py-14 text-sm text-muted">Nothing outstanding. Every recorded payment is settled.</div>
          ) : (
            <div className="overflow-x-auto sm:overflow-visible">
              <table className="w-full min-w-[640px] sm:min-w-0">
                <thead>
                  <tr className="border-b border-line bg-canvas">
                    <th className="text-left py-3 px-4 font-semibold text-ink text-sm">Tenant</th>
                    <th className="text-left py-3 px-4 font-semibold text-ink text-sm">Property</th>
                    <th className="text-left py-3 px-4 font-semibold text-ink text-sm">Due</th>
                    <th className="text-right py-3 px-4 font-semibold text-ink text-sm">Amount</th>
                    <th className="text-center py-3 px-4 font-semibold text-ink text-sm">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {delinquencies.map(d => (
                    <tr key={d.payment.id} className="border-b border-line last:border-0 hover:bg-black/[0.02]">
                      <td className="py-3 px-4 text-sm text-ink">{d.name}</td>
                      <td className="py-3 px-4 text-sm text-muted">{d.property}</td>
                      <td className="py-3 px-4 text-sm text-muted">{d.payment.dueDate ? formatDate(d.payment.dueDate) : '—'}</td>
                      <td className="py-3 px-4 text-right text-sm text-danger font-medium tnum">{formatCurrency(d.payment.amount)}</td>
                      <td className="py-3 px-4 text-center">{statusView(d.payment.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
