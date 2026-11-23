import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  Search, ChevronRight, Scale, Calendar, DollarSign, AlertTriangle,
} from 'lucide-react';
import { Card, CardContent } from '../components/ui/Card';
import { PageHeader } from '../components/ui/PageHeader';
import { StatCard } from '../components/ui/StatCard';
import { Badge } from '../components/ui/Badge';
import { SelectInput, TextInput } from '../components/ui/FormField';
import { formatCurrency, formatDate } from '../lib/utils';
import { evictionsApi } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import type { Eviction, EvictionStatus } from '../types';

const STATUS_LABEL: Record<EvictionStatus, string> = {
  notice_served: 'Notice Served',
  filed_with_lawyer: 'Filed with Lawyer',
  court_date_set: 'Court Date Set',
  judgment: 'Judgment',
  completed: 'Completed',
  dismissed: 'Dismissed',
};

const STATUS_BADGE: Record<EvictionStatus, 'warning' | 'destructive' | 'secondary' | 'success' | 'default'> = {
  notice_served: 'warning',
  filed_with_lawyer: 'destructive',
  court_date_set: 'destructive',
  judgment: 'secondary',
  completed: 'success',
  dismissed: 'default',
};

export function Evictions() {
  const { hasPermission } = useAuth();
  const canView = hasPermission('evictions_view');

  const [evictions, setEvictions] = useState<Eviction[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');

  const load = useCallback(async () => {
    if (!canView) return;
    try {
      const params: Record<string, string> = {};
      if (statusFilter !== 'all') params.status = statusFilter;
      const data = await evictionsApi.getAll(params);
      setEvictions(data);
    } catch { /* ignore */ }
    setLoading(false);
  }, [canView, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return evictions;
    const q = searchQuery.toLowerCase();
    return evictions.filter(e =>
      (e.tenantName || '').toLowerCase().includes(q) ||
      (e.propertyName || '').toLowerCase().includes(q) ||
      (e.caseNumber || '').toLowerCase().includes(q) ||
      (e.lawyerName || '').toLowerCase().includes(q)
    );
  }, [evictions, searchQuery]);

  const active = evictions.filter(e => !['completed', 'dismissed'].includes(e.status));
  const totalCosts = evictions.reduce((sum, e) => sum + (e.totalCosts || 0), 0);
  const withCourtDate = active.filter(e => e.courtDate);

  if (!canView) return null;

  return (
    <div className="space-y-5">
      <PageHeader title="Evictions" />

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard title="Active Cases" value={active.length} icon={<AlertTriangle className="h-5 w-5" />} />
        <StatCard title="Upcoming Court Dates" value={withCourtDate.length} icon={<Calendar className="h-5 w-5" />} />
        <StatCard title="Total Costs" value={formatCurrency(totalCosts)} icon={<DollarSign className="h-5 w-5" />} />
        <StatCard title="Total Cases" value={evictions.length} icon={<Scale className="h-5 w-5" />} />
      </div>

      <Card>
        <CardContent className="p-4 sm:p-5">
          <div className="flex flex-col sm:flex-row gap-3 mb-4">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-faint" />
              <TextInput
                name="evSearch"
                placeholder="Search by tenant, property, case#, lawyer..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="w-full sm:w-48">
              <SelectInput name="evStatusFilter" value={statusFilter}
                onChange={e => setStatusFilter(e.target.value)}>
                <option value="all">All Statuses</option>
                {Object.entries(STATUS_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>{v}</option>
                ))}
              </SelectInput>
            </div>
          </div>

          {loading ? (
            <p className="text-sm text-muted py-8 text-center">Loading eviction cases...</p>
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted py-8 text-center">
              {evictions.length === 0 ? 'No eviction cases yet.' : 'No cases match your filters.'}
            </p>
          ) : (
            <div className="divide-y divide-line">
              {filtered.map(ev => (
                <Link
                  key={ev.id}
                  to={`/tenants/${ev.tenantId}`}
                  className="flex items-center gap-3 py-3 px-2 -mx-2 rounded-lg hover:bg-canvas/50 transition-colors group"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant={STATUS_BADGE[ev.status]} className="shrink-0">
                        {STATUS_LABEL[ev.status]}
                      </Badge>
                      <span className="text-sm font-medium text-ink truncate">
                        {ev.tenantName || 'Unknown Tenant'}
                      </span>
                    </div>
                    <div className="flex items-center gap-3 mt-1 text-xs text-muted flex-wrap">
                      {ev.propertyName && (
                        <span>{ev.propertyName}{ev.unitNumber ? ` #${ev.unitNumber}` : ''}</span>
                      )}
                      {ev.lawyerName && <span>Lawyer: {ev.lawyerName}</span>}
                      {ev.caseNumber && <span>Case: {ev.caseNumber}</span>}
                      {ev.courtDate && <span>Court: {formatDate(ev.courtDate)}</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    {ev.totalCosts != null && ev.totalCosts > 0 && (
                      <span className="text-sm font-medium text-ink">{formatCurrency(ev.totalCosts)}</span>
                    )}
                    <ChevronRight className="h-4 w-4 text-faint group-hover:text-muted transition-colors" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
