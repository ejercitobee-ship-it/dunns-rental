/**
 * TransactionDrillDown — a modal that shows individual financial
 * transactions behind any clicked total. Used across Dashboard,
 * Reports, PropertyProfile, and TaxReport.
 *
 * Usage:
 *   <TransactionDrillDown
 *     isOpen={!!drilldown}
 *     onClose={() => setDrilldown(null)}
 *     title="Utilities — $4,825"
 *     expenses={filteredExpenses}
 *     incomes={filteredIncomes}
 *     rentPayments={filteredPayments}
 *     properties={properties}
 *     units={units}
 *   />
 */

import { useEffect, useMemo, useState } from 'react';
import { Download, Search } from 'lucide-react';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import { formatCurrency, formatDate } from '../lib/utils';
import { expenseCategoryLabel } from '../lib/financials';
import type { Expense, Income, RentPayment, Property, Unit } from '../types';

export interface DrillDownProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  expenses?: Expense[];
  incomes?: Income[];
  rentPayments?: RentPayment[];
  properties: Property[];
  units: Unit[];
  /** When set, only show this tab. Otherwise show all non-empty tabs. */
  forceTab?: 'expenses' | 'income' | 'rent';
}

export function TransactionDrillDown({
  isOpen, onClose, title,
  expenses = [], incomes = [], rentPayments = [],
  properties, units, forceTab,
}: DrillDownProps) {
  const [search, setSearch] = useState('');

  const propertyName = (id?: string) => properties.find(p => p.id === id)?.name || '—';
  const unitNumber = (id?: string) => units.find(u => u.id === id)?.unitNumber || '';

  const tabs = useMemo(() => {
    const t: ('expenses' | 'income' | 'rent')[] = [];
    if (forceTab) return [forceTab];
    if (expenses.length) t.push('expenses');
    if (incomes.length) t.push('income');
    if (rentPayments.length) t.push('rent');
    return t.length ? t : ['expenses' as const];
  }, [expenses.length, incomes.length, rentPayments.length, forceTab]);

  const [activeTab, setActiveTab] = useState<'expenses' | 'income' | 'rent'>(tabs[0]);

  // Reset the active tab whenever the modal opens or the forced tab changes,
  // so stale state from a previous open doesn't show the wrong table.
  useEffect(() => {
    if (isOpen) setActiveTab(tabs[0]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, forceTab]);

  const filteredExpenses = useMemo(() => {
    if (!search) return expenses;
    const q = search.toLowerCase();
    return expenses.filter(e =>
      e.description?.toLowerCase().includes(q) ||
      e.vendor?.toLowerCase().includes(q) ||
      propertyName(e.propertyId).toLowerCase().includes(q)
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expenses, search]);

  const filteredIncomes = useMemo(() => {
    if (!search) return incomes;
    const q = search.toLowerCase();
    return incomes.filter(i =>
      i.description?.toLowerCase().includes(q) ||
      propertyName(i.propertyId).toLowerCase().includes(q)
    );
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [incomes, search]);

  const filteredPayments = useMemo(() => {
    if (!search) return rentPayments;
    const q = search.toLowerCase();
    return rentPayments.filter(p =>
      String(p.amount).includes(q) ||
      String(p.month).includes(q)
    );
  }, [rentPayments, search]);

  const totalAmount = useMemo(() => {
    if (activeTab === 'expenses') return filteredExpenses.reduce((s, e) => s + e.amount, 0);
    if (activeTab === 'income') return filteredIncomes.reduce((s, i) => s + i.amount, 0);
    return filteredPayments.reduce((s, p) => s + p.amount, 0);
  }, [activeTab, filteredExpenses, filteredIncomes, filteredPayments]);

  const exportCSV = () => {
    let csv = '';
    if (activeTab === 'expenses') {
      csv = 'Date,Property,Unit,Category,Description,Vendor,Amount\n';
      csv += filteredExpenses.map(e =>
        [e.date, propertyName(e.propertyId), unitNumber(e.unitId), expenseCategoryLabel(e.category), e.description, e.vendor || '', e.amount]
          .map(v => `"${String(v ?? '').replace(/"/g, '""')}"`)
          .join(',')
      ).join('\n');
    } else if (activeTab === 'income') {
      csv = 'Date,Property,Source,Description,Amount\n';
      csv += filteredIncomes.map(i =>
        [i.date, propertyName(i.propertyId), i.source, i.description, i.amount]
          .map(v => `"${String(v ?? '').replace(/"/g, '""')}"`)
          .join(',')
      ).join('\n');
    } else {
      csv = 'Month,Year,Amount,Status,Paid Date\n';
      csv += filteredPayments.map(p =>
        [p.month, p.year, p.amount, p.status, p.paidDate || '']
          .map(v => `"${String(v ?? '').replace(/"/g, '""')}"`)
          .join(',')
      ).join('\n');
    }
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `drilldown-${activeTab}-${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={title} size="lg">
      <div className="space-y-4">
        {/* Tabs */}
        {tabs.length > 1 && (
          <div className="flex gap-1 border-b border-line">
            {tabs.map(tab => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted hover:text-ink'
                }`}
              >
                {tab === 'expenses' ? 'Expenses' : tab === 'income' ? 'Income' : 'Rent Payments'}
              </button>
            ))}
          </div>
        )}

        {/* Search + Export */}
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted" />
            <input
              type="text"
              placeholder="Search transactions..."
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full pl-10 pr-4 py-2 border border-line rounded-lg text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>
          <Button variant="outline" size="sm" onClick={exportCSV}>
            <Download className="h-4 w-4 mr-1" />
            CSV
          </Button>
        </div>

        {/* Summary bar */}
        <div className="flex items-center justify-between px-3 py-2 bg-canvas rounded-lg text-sm">
          <span className="text-muted">
            {activeTab === 'expenses' ? filteredExpenses.length :
             activeTab === 'income' ? filteredIncomes.length :
             filteredPayments.length} transactions
          </span>
          <span className="font-semibold text-ink tnum">{formatCurrency(totalAmount)}</span>
        </div>

        {/* Table */}
        <div className="overflow-x-auto max-h-[60vh] overflow-y-auto">
          {activeTab === 'expenses' && (
            <table className="w-full min-w-[640px]">
              <thead className="sticky top-0 bg-surface z-10">
                <tr className="border-b border-line">
                  <th className="text-left py-2 px-3 text-xs font-semibold text-muted">Date</th>
                  <th className="text-left py-2 px-3 text-xs font-semibold text-muted">Property</th>
                  <th className="text-left py-2 px-3 text-xs font-semibold text-muted">Category</th>
                  <th className="text-left py-2 px-3 text-xs font-semibold text-muted">Description</th>
                  <th className="text-left py-2 px-3 text-xs font-semibold text-muted">Vendor</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-muted">Amount</th>
                </tr>
              </thead>
              <tbody>
                {filteredExpenses.map(e => (
                  <tr key={e.id} className="border-b border-line last:border-0 hover:bg-black/[0.02]">
                    <td className="py-2.5 px-3 text-sm text-muted">{formatDate(e.date)}</td>
                    <td className="py-2.5 px-3 text-sm">
                      {propertyName(e.propertyId)}
                      {e.unitId && <span className="text-muted"> · {unitNumber(e.unitId)}</span>}
                    </td>
                    <td className="py-2.5 px-3 text-sm">{expenseCategoryLabel(e.category)}</td>
                    <td className="py-2.5 px-3 text-sm text-muted">{e.description}</td>
                    <td className="py-2.5 px-3 text-sm text-muted">{e.vendor || '—'}</td>
                    <td className="py-2.5 px-3 text-sm text-right font-medium text-danger tnum">
                      {formatCurrency(e.amount)}
                    </td>
                  </tr>
                ))}
                {filteredExpenses.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-8 text-center text-sm text-muted">No transactions found</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}

          {activeTab === 'income' && (
            <table className="w-full min-w-[500px]">
              <thead className="sticky top-0 bg-surface z-10">
                <tr className="border-b border-line">
                  <th className="text-left py-2 px-3 text-xs font-semibold text-muted">Date</th>
                  <th className="text-left py-2 px-3 text-xs font-semibold text-muted">Property</th>
                  <th className="text-left py-2 px-3 text-xs font-semibold text-muted">Source</th>
                  <th className="text-left py-2 px-3 text-xs font-semibold text-muted">Description</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-muted">Amount</th>
                </tr>
              </thead>
              <tbody>
                {filteredIncomes.map(i => (
                  <tr key={i.id} className="border-b border-line last:border-0 hover:bg-black/[0.02]">
                    <td className="py-2.5 px-3 text-sm text-muted">{formatDate(i.date)}</td>
                    <td className="py-2.5 px-3 text-sm">{propertyName(i.propertyId)}</td>
                    <td className="py-2.5 px-3 text-sm">
                      <Badge variant="secondary">{i.source.replace(/_/g, ' ')}</Badge>
                    </td>
                    <td className="py-2.5 px-3 text-sm text-muted">{i.description}</td>
                    <td className="py-2.5 px-3 text-sm text-right font-medium text-positive tnum">
                      {formatCurrency(i.amount)}
                    </td>
                  </tr>
                ))}
                {filteredIncomes.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-8 text-center text-sm text-muted">No transactions found</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}

          {activeTab === 'rent' && (
            <table className="w-full min-w-[400px]">
              <thead className="sticky top-0 bg-surface z-10">
                <tr className="border-b border-line">
                  <th className="text-left py-2 px-3 text-xs font-semibold text-muted">Month</th>
                  <th className="text-center py-2 px-3 text-xs font-semibold text-muted">Status</th>
                  <th className="text-left py-2 px-3 text-xs font-semibold text-muted">Paid Date</th>
                  <th className="text-right py-2 px-3 text-xs font-semibold text-muted">Amount</th>
                </tr>
              </thead>
              <tbody>
                {filteredPayments.map(p => (
                  <tr key={p.id} className="border-b border-line last:border-0 hover:bg-black/[0.02]">
                    <td className="py-2.5 px-3 text-sm">{p.month}/{p.year}</td>
                    <td className="py-2.5 px-3 text-center">
                      <Badge variant={p.status === 'paid' ? 'success' : p.status === 'partial' ? 'secondary' : 'destructive'}>
                        {p.status}
                      </Badge>
                    </td>
                    <td className="py-2.5 px-3 text-sm text-muted">{p.paidDate ? formatDate(p.paidDate) : '—'}</td>
                    <td className="py-2.5 px-3 text-sm text-right font-medium tnum">
                      {formatCurrency(p.amount)}
                    </td>
                  </tr>
                ))}
                {filteredPayments.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-8 text-center text-sm text-muted">No transactions found</td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </Modal>
  );
}
