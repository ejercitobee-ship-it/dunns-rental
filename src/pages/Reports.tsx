import { useMemo, useState } from 'react';
import { Download, ClipboardList, AlertTriangle, Building2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { formatCurrency, formatDate, yearOf } from '../lib/utils';
import { useApp } from '../context/AppContext';
import { activeLeases, monthlyRevenue, settleMonth, leaseCoversMonth, type MonthSettlement } from '../lib/rent';
import type { Lease, Tenant } from '../types';

/** One row of the rent roll: a single active lease and this month's settlement. */
interface RentRollRow {
  lease: Lease;
  property: string;
  unit: string;
  occupants: Tenant[];
  rent: number;
  leaseEnd?: string;
  /** null when the lease's term doesn't cover this month at all, so it owes nothing yet or anymore. */
  settlement: MonthSettlement | null;
}

export function Reports() {
  const { properties, units, leases, rentPayments, expenses, incomes, getLeaseTenants } = useApp();

  const propertyName = (id?: string) => properties.find(p => p.id === id)?.name || '—';
  const unitNumber = (id?: string) => units.find(u => u.id === id)?.unitNumber || '—';

  const now = new Date();
  const currentMonth = now.getMonth() + 1;
  const currentYear = now.getFullYear();

  // Rent roll: one row per active lease, counted once regardless of how many
  // people occupy it, with this month's payment status.
  const rentRoll = useMemo<RentRollRow[]>(() => {
    return activeLeases(leases)
      .map(lease => {
        const covers = leaseCoversMonth(lease, currentMonth, currentYear);
        return {
          lease,
          property: propertyName(lease.propertyId),
          unit: unitNumber(lease.unitId),
          occupants: getLeaseTenants(lease.id),
          rent: lease.monthlyRent || 0,
          leaseEnd: lease.endDate,
          settlement: covers ? settleMonth(lease, rentPayments, currentMonth, currentYear) : null,
        };
      })
      .sort((a, b) => a.property.localeCompare(b.property));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leases, rentPayments, properties, units, getLeaseTenants, currentMonth, currentYear]);

  const totals = useMemo(() => {
    const scheduled = monthlyRevenue(leases);
    const collected = rentPayments
      .filter(p => p.status === 'paid' && p.month === currentMonth && p.year === currentYear)
      .reduce((s, p) => s + p.amount, 0);
    // Only leases whose term actually covers this month can owe anything for
    // it: a lease starting next month is never counted as outstanding today.
    const outstanding = rentRoll.reduce((s, r) => s + (r.settlement?.balance || 0), 0);
    return { scheduled, collected, outstanding };
    // Depends on rentRoll, a manual memo that intentionally excludes unstable
    // context helpers.
  }, [leases, rentPayments, rentRoll, currentMonth, currentYear]);

  // Outstanding balances: every active lease whose current month settled as
  // partial or unpaid.
  const delinquencies = useMemo(() => {
    return rentRoll
      .filter(r => r.settlement && r.settlement.status !== 'paid')
      .sort((a, b) => (b.settlement?.balance || 0) - (a.settlement?.balance || 0));
  }, [rentRoll]);

  // Per-property profit and loss: income (rent collected + other income) minus
  // expenses, for a chosen year or all time. Rent is counted by the month it is
  // for (the payment's own year); manual income and expenses by their date.
  const reportYears = useMemo(() => {
    const s = new Set<number>();
    rentPayments.forEach(p => { if (p.year) s.add(p.year); });
    incomes.forEach(i => { const y = yearOf(i.date); if (y) s.add(y); });
    expenses.forEach(e => { const y = yearOf(e.date); if (y) s.add(y); });
    s.add(currentYear);
    return Array.from(s).sort((a, b) => b - a);
  }, [rentPayments, incomes, expenses, currentYear]);

  const [reportYear, setReportYear] = useState<number | 'all'>(currentYear);

  const leasePropertyId = useMemo(() => {
    const m = new Map<string, string | undefined>();
    leases.forEach(l => m.set(l.id, l.propertyId));
    return m;
  }, [leases]);

  const propertyPnl = useMemo(() => {
    const inYear = (y: number | undefined) => reportYear === 'all' || (!!y && y === reportYear);
    return properties
      .map(p => {
        const rent = rentPayments
          .filter(pm => pm.status === 'paid' && leasePropertyId.get(pm.leaseId) === p.id && inYear(pm.year))
          .reduce((s, pm) => s + (pm.amount || 0), 0);
        const other = incomes
          .filter(i => i.propertyId === p.id && inYear(yearOf(i.date)))
          .reduce((s, i) => s + i.amount, 0);
        const expenseTotal = expenses
          .filter(e => e.propertyId === p.id && inYear(yearOf(e.date)))
          .reduce((s, e) => s + e.amount, 0);
        const income = rent + other;
        return { id: p.id, name: p.name, income, expenses: expenseTotal, net: income - expenseTotal };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [properties, rentPayments, incomes, expenses, leasePropertyId, reportYear]);

  const pnlTotals = useMemo(
    () =>
      propertyPnl.reduce(
        (t, r) => ({ income: t.income + r.income, expenses: t.expenses + r.expenses, net: t.net + r.net }),
        { income: 0, expenses: 0, net: 0 }
      ),
    [propertyPnl]
  );

  const exportPropertyPnl = () => {
    const headers = ['Property', 'Income', 'Expenses', 'Net'];
    const rows = propertyPnl.map(r => [r.name, r.income, r.expenses, r.net]);
    rows.push(['Total', pnlTotals.income, pnlTotals.expenses, pnlTotals.net]);
    const csv = [headers, ...rows].map(row => row.map(c => `"${String(c ?? '')}"`).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `property-pnl-${reportYear === 'all' ? 'all-time' : reportYear}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const statusView = (status: MonthSettlement['status'] | null) => {
    switch (status) {
      case 'paid': return <Badge variant="success">Paid</Badge>;
      case 'partial': return <Badge variant="secondary">Partial</Badge>;
      case 'unpaid': return <Badge variant="destructive">Unpaid</Badge>;
      default: return <Badge variant="secondary">Not due yet</Badge>;
    }
  };

  const exportRentRoll = () => {
    const headers = ['Property', 'Unit', 'Occupants', 'Monthly Rent', 'Lease End', 'This Month'];
    const rows = rentRoll.map(r => [
      r.property,
      r.unit,
      r.occupants.map(t => `${t.firstName} ${t.lastName}`).join(', '),
      r.rent,
      r.leaseEnd || '',
      r.settlement?.status || 'not_due',
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
          <p className="text-muted mt-1 text-sm">Per-property income and expenses, rent roll, and outstanding balances.</p>
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
          { label: 'Outstanding', value: formatCurrency(totals.outstanding), sub: 'Balance due this month' },
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

      {/* Income and Expenses by Property */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <CardTitle className="flex items-center gap-2">
              <div className="p-2 bg-primary-soft rounded-lg">
                <Building2 className="h-5 w-5 text-primary" />
              </div>
              Income &amp; Expenses by Property
            </CardTitle>
            <div className="flex items-center gap-2">
              <select
                value={String(reportYear)}
                onChange={(e) => setReportYear(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                className="px-3 py-2 border border-line rounded-lg text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="all">All time</option>
                {reportYears.map((y) => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
              <Button variant="outline" size="sm" onClick={exportPropertyPnl}>
                <Download className="h-4 w-4 mr-2" />
                Export
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto sm:overflow-visible">
            <table className="w-full min-w-[560px] sm:min-w-0">
              <thead>
                <tr className="border-b border-line bg-canvas">
                  <th className="text-left py-3 px-4 font-semibold text-ink text-sm">Property</th>
                  <th className="text-right py-3 px-4 font-semibold text-ink text-sm">Income</th>
                  <th className="text-right py-3 px-4 font-semibold text-ink text-sm">Expenses</th>
                  <th className="text-right py-3 px-4 font-semibold text-ink text-sm">Net</th>
                </tr>
              </thead>
              <tbody>
                {propertyPnl.map((r) => (
                  <tr key={r.id} className="border-b border-line last:border-0 hover:bg-black/[0.02]">
                    <td className="py-3 px-4 text-sm text-ink">{r.name}</td>
                    <td className="py-3 px-4 text-right text-sm text-positive tnum">{formatCurrency(r.income)}</td>
                    <td className="py-3 px-4 text-right text-sm text-danger tnum">{formatCurrency(r.expenses)}</td>
                    <td className={`py-3 px-4 text-right text-sm font-medium tnum ${r.net >= 0 ? 'text-ink' : 'text-danger'}`}>
                      {formatCurrency(r.net)}
                    </td>
                  </tr>
                ))}
              </tbody>
              {propertyPnl.length > 0 && (
                <tfoot>
                  <tr className="border-t-2 border-line bg-canvas font-semibold">
                    <td className="py-3 px-4 text-sm text-ink">Total</td>
                    <td className="py-3 px-4 text-right text-sm text-positive tnum">{formatCurrency(pnlTotals.income)}</td>
                    <td className="py-3 px-4 text-right text-sm text-danger tnum">{formatCurrency(pnlTotals.expenses)}</td>
                    <td className={`py-3 px-4 text-right text-sm tnum ${pnlTotals.net >= 0 ? 'text-ink' : 'text-danger'}`}>
                      {formatCurrency(pnlTotals.net)}
                    </td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
          {propertyPnl.length === 0 && (
            <div className="text-center py-14 text-sm text-muted">No properties to report yet.</div>
          )}
        </CardContent>
      </Card>

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
                  <th className="text-left py-3 px-4 font-semibold text-ink text-sm">Occupants</th>
                  <th className="text-right py-3 px-4 font-semibold text-ink text-sm">Monthly Rent</th>
                  <th className="text-left py-3 px-4 font-semibold text-ink text-sm">Lease Ends</th>
                  <th className="text-center py-3 px-4 font-semibold text-ink text-sm">This Month</th>
                </tr>
              </thead>
              <tbody>
                {rentRoll.map(r => (
                  <tr key={r.lease.id} className="border-b border-line last:border-0 hover:bg-black/[0.02]">
                    <td className="py-3 px-4 text-sm">
                      <span className="text-ink">{r.property}</span>
                      <span className="text-faint"> · {r.unit}</span>
                    </td>
                    <td className="py-3 px-4 text-sm text-ink">
                      {r.occupants.length > 0 ? r.occupants.map(t => `${t.firstName} ${t.lastName}`).join(', ') : '—'}
                    </td>
                    <td className="py-3 px-4 text-right text-sm text-ink tnum">{formatCurrency(r.rent)}</td>
                    <td className="py-3 px-4 text-sm text-muted">{r.leaseEnd ? formatDate(r.leaseEnd) : '—'}</td>
                    <td className="py-3 px-4 text-center">{statusView(r.settlement?.status ?? null)}</td>
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
            <div className="text-center py-14 text-sm text-muted">Nothing outstanding. Every active lease is settled for this month.</div>
          ) : (
            <div className="overflow-x-auto sm:overflow-visible">
              <table className="w-full min-w-[640px] sm:min-w-0">
                <thead>
                  <tr className="border-b border-line bg-canvas">
                    <th className="text-left py-3 px-4 font-semibold text-ink text-sm">Property & Unit</th>
                    <th className="text-left py-3 px-4 font-semibold text-ink text-sm">Occupants</th>
                    <th className="text-right py-3 px-4 font-semibold text-ink text-sm">Balance</th>
                    <th className="text-center py-3 px-4 font-semibold text-ink text-sm">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {delinquencies.map(r => (
                    <tr key={r.lease.id} className="border-b border-line last:border-0 hover:bg-black/[0.02]">
                      <td className="py-3 px-4 text-sm">
                        <span className="text-ink">{r.property}</span>
                        <span className="text-faint"> · {r.unit}</span>
                      </td>
                      <td className="py-3 px-4 text-sm text-ink">
                        {r.occupants.length > 0 ? r.occupants.map(t => `${t.firstName} ${t.lastName}`).join(', ') : '—'}
                      </td>
                      <td className="py-3 px-4 text-right text-sm text-danger font-medium tnum">{formatCurrency(r.settlement?.balance || 0)}</td>
                      <td className="py-3 px-4 text-center">{statusView(r.settlement?.status ?? null)}</td>
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
