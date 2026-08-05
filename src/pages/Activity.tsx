import { useEffect, useMemo, useState, useCallback } from 'react';
import { Navigate } from 'react-router-dom';
import {
  Search, ScrollText, Building2, Users, FileText, Wrench,
  Calendar, Settings, Shield, DollarSign, ChevronDown, ChevronUp,
  Download, Filter,
} from 'lucide-react';
import { Card, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { activityApi, type ActivityEntry, type ActivityFilter } from '../lib/api';
// formatDate kept for potential future use
// import { formatDate } from '../lib/utils';

const PAGE = 50;

const roleBadge: Record<string, 'destructive' | 'default' | 'success' | 'secondary' | 'warning'> = {
  super_admin: 'destructive',
  admin: 'default',
  manager: 'success',
  accountant: 'secondary',
  viewer: 'secondary',
  tenant: 'warning',
  realtor: 'warning',
  handyman: 'warning',
};

function roleLabel(role?: string): string {
  if (!role) return '';
  return role.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatWhen(createdAt: number): string {
  return new Date(createdAt * 1000).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function fieldLabel(key: string): string {
  return key
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\b\w/g, c => c.toUpperCase());
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return '(empty)';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (typeof v === 'number') return v.toLocaleString();
  return String(v);
}

const MODULE_META: Record<string, { label: string; icon: typeof Building2; color: string }> = {
  properties: { label: 'Properties', icon: Building2, color: 'text-primary' },
  tenants: { label: 'Tenants', icon: Users, color: 'text-blue-600' },
  leases: { label: 'Leases', icon: FileText, color: 'text-violet-600' },
  finances: { label: 'Finances', icon: DollarSign, color: 'text-positive' },
  maintenance: { label: 'Maintenance', icon: Wrench, color: 'text-orange-600' },
  documents: { label: 'Documents', icon: FileText, color: 'text-teal-600' },
  calendar: { label: 'Calendar', icon: Calendar, color: 'text-pink-600' },
  users: { label: 'Users', icon: Shield, color: 'text-red-600' },
  settings: { label: 'Settings', icon: Settings, color: 'text-faint' },
  system: { label: 'System', icon: Settings, color: 'text-faint' },
};

export function Activity() {
  const { users, hasPermission } = useAuth();
  const { tenants, properties, units } = useApp();
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [showFilters, setShowFilters] = useState(false);

  // Filter state.
  const [search, setSearch] = useState('');
  const [moduleFilter, setModuleFilter] = useState('');
  const [userFilter, setUserFilter] = useState('');
  const [propertyFilter, setPropertyFilter] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const canView = hasPermission('activity_view');

  const buildFilter = useCallback((): ActivityFilter => {
    const f: ActivityFilter = { limit: PAGE };
    if (search.trim()) f.search = search.trim();
    if (moduleFilter) f.module = moduleFilter;
    if (userFilter) f.userId = userFilter;
    if (propertyFilter) f.propertyId = propertyFilter;
    if (dateFrom) f.dateFrom = Math.floor(new Date(dateFrom + 'T00:00:00').getTime() / 1000);
    if (dateTo) f.dateTo = Math.floor(new Date(dateTo + 'T23:59:59').getTime() / 1000);
    return f;
  }, [search, moduleFilter, userFilter, propertyFilter, dateFrom, dateTo]);

  const load = useCallback(() => {
    if (!canView) return;
    setLoading(true);
    setError(null);
    activityApi
      .list(buildFilter())
      .then((res) => {
        setEntries(res.data);
        setTotal(res.total);
      })
      .catch((err) => setError((err as Error).message || 'Could not load the activity log.'))
      .finally(() => setLoading(false));
  }, [canView, buildFilter]);

  useEffect(() => { load(); }, [load]);

  const loadMore = () => {
    setLoadingMore(true);
    activityApi
      .list({ ...buildFilter(), offset: entries.length })
      .then((res) => {
        setEntries((prev) => [...prev, ...res.data]);
      })
      .catch(() => {})
      .finally(() => setLoadingMore(false));
  };

  // Resolve the target of an action to a friendly name where we can.
  const targetName = (e: ActivityEntry): string | null => {
    if (e.targetName) return e.targetName;
    if (!e.targetId) return null;
    if (e.targetType === 'tenants') {
      const t = tenants.find((x) => x.id === e.targetId);
      return t ? `${t.firstName} ${t.lastName}` : null;
    }
    if (e.targetType === 'properties') {
      return properties.find((x) => x.id === e.targetId)?.name ?? null;
    }
    if (e.targetType === 'units') {
      const u = units.find((x) => x.id === e.targetId);
      return u ? `Unit ${u.unitNumber}` : null;
    }
    if (e.targetType === 'users') {
      const u = users.find((x) => x.id === e.targetId);
      return u ? `${u.firstName} ${u.lastName}` : null;
    }
    return null;
  };

  const toggleExpand = (id: string) =>
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // Group unique users who appear in logs for the user filter dropdown.
  const logUsers = useMemo(() => {
    const map = new Map<string, string>();
    entries.forEach(e => {
      if (e.userId && e.userName) map.set(e.userId, e.userName);
    });
    // Also include all known admin users.
    users.forEach(u => map.set(u.id, `${u.firstName} ${u.lastName}`));
    return Array.from(map.entries()).sort((a, b) => a[1].localeCompare(b[1]));
  }, [entries, users]);

  const clearFilters = () => {
    setSearch('');
    setModuleFilter('');
    setUserFilter('');
    setPropertyFilter('');
    setDateFrom('');
    setDateTo('');
  };

  const hasActiveFilters = !!(search || moduleFilter || userFilter || propertyFilter || dateFrom || dateTo);

  const exportCsv = () => {
    const header = 'Date,User,Role,Module,Action,Description,Target,Property,Changes\n';
    const rows = entries.map(e => {
      const when = new Date(e.createdAt * 1000).toISOString();
      const target = targetName(e) || '';
      const prop = e.propertyId ? (properties.find(p => p.id === e.propertyId)?.name || '') : '';
      const changes = e.previousValues && e.newValues
        ? Object.keys({ ...e.previousValues, ...e.newValues })
            .filter(k => e.previousValues?.[k] !== e.newValues?.[k])
            .map(k => `${fieldLabel(k)}: ${formatValue(e.previousValues?.[k])} → ${formatValue(e.newValues?.[k])}`)
            .join('; ')
        : '';
      return [when, e.userName || '', e.userRole || '', e.module || '', e.action, e.description || '', target, prop, changes]
        .map(v => `"${String(v).replace(/"/g, '""')}"`)
        .join(',');
    }).join('\n');
    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `activity-log-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!canView) return <Navigate to="/" replace />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-[26px] sm:text-[32px] font-medium text-ink">Activity Log</h1>
          <p className="text-muted mt-1 text-sm">
            A record of who did what, across the whole app.
            {total > 0 && <span className="text-ink"> {total.toLocaleString()} entries total.</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="secondary" onClick={() => setShowFilters(!showFilters)}>
            <Filter className="h-4 w-4 mr-1.5" />
            Filters
            {hasActiveFilters && <span className="ml-1 w-2 h-2 rounded-full bg-primary" />}
          </Button>
          <Button variant="secondary" onClick={exportCsv} disabled={entries.length === 0}>
            <Download className="h-4 w-4 mr-1.5" />
            Export CSV
          </Button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-faint" />
        <input
          type="text"
          placeholder="Search by person, action, description, or record..."
          className="w-full pl-10 pr-4 py-2 border border-line rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 bg-surface"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && load()}
        />
      </div>

      {/* Filter panel */}
      {showFilters && (
        <Card>
          <CardContent className="p-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="block text-xs font-medium text-muted mb-1">Module</label>
                <select
                  value={moduleFilter}
                  onChange={(e) => setModuleFilter(e.target.value)}
                  className="w-full px-3 py-1.5 border border-line rounded-lg bg-surface text-sm"
                >
                  <option value="">All modules</option>
                  {Object.entries(MODULE_META).map(([key, m]) => (
                    <option key={key} value={key}>{m.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted mb-1">User</label>
                <select
                  value={userFilter}
                  onChange={(e) => setUserFilter(e.target.value)}
                  className="w-full px-3 py-1.5 border border-line rounded-lg bg-surface text-sm"
                >
                  <option value="">All users</option>
                  {logUsers.map(([id, name]) => (
                    <option key={id} value={id}>{name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-muted mb-1">Property</label>
                <select
                  value={propertyFilter}
                  onChange={(e) => setPropertyFilter(e.target.value)}
                  className="w-full px-3 py-1.5 border border-line rounded-lg bg-surface text-sm"
                >
                  <option value="">All properties</option>
                  {properties.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-2">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-muted mb-1">From</label>
                  <input
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                    className="w-full px-2 py-1.5 border border-line rounded-lg bg-surface text-sm"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-xs font-medium text-muted mb-1">To</label>
                  <input
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                    className="w-full px-2 py-1.5 border border-line rounded-lg bg-surface text-sm"
                  />
                </div>
              </div>
            </div>
            <div className="flex items-center gap-2 mt-3">
              <Button size="sm" onClick={load}>Apply filters</Button>
              {hasActiveFilters && (
                <Button size="sm" variant="secondary" onClick={() => { clearFilters(); setTimeout(load, 0); }}>
                  Clear all
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Module chips */}
      <div className="flex flex-wrap gap-2">
        {Object.entries(MODULE_META).map(([key, m]) => {
          const Icon = m.icon;
          const isActive = moduleFilter === key;
          return (
            <button
              key={key}
              onClick={() => { setModuleFilter(isActive ? '' : key); setTimeout(load, 0); }}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-colors ${
                isActive
                  ? 'border-primary bg-primary-soft text-primary'
                  : 'border-line text-muted hover:text-ink hover:bg-canvas'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              {m.label}
            </button>
          );
        })}
      </div>

      {/* Results */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <p className="text-sm text-muted p-6">Loading activity.</p>
          ) : error ? (
            <p className="text-sm text-danger p-6">{error}</p>
          ) : entries.length === 0 ? (
            <div className="text-center py-16">
              <ScrollText className="h-10 w-10 mx-auto text-faint mb-3" />
              <h3 className="font-medium text-ink">No activity found</h3>
              <p className="text-sm text-muted mt-1">
                {hasActiveFilters
                  ? 'Try adjusting your filters.'
                  : 'Actions will show up here as your team uses the app.'}
              </p>
            </div>
          ) : (
            <div className="divide-y divide-line">
              {entries.map((e) => {
                const name = e.userName || 'System';
                const initials = name.split(' ').map((p) => p[0]).slice(0, 2).join('');
                const target = targetName(e);
                const mod = e.module ? MODULE_META[e.module] : null;
                const ModIcon = mod?.icon;
                const hasChanges = e.previousValues || e.newValues;
                const isExpanded = expanded.has(e.id);

                return (
                  <div key={e.id} className="flex items-start gap-3 px-5 py-3.5">
                    <div className="w-8 h-8 rounded-full bg-primary-soft flex items-center justify-center text-primary text-xs font-medium flex-shrink-0">
                      {initials.toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-ink">{name}</span>
                        {e.userRole && <Badge variant={roleBadge[e.userRole] ?? 'secondary'}>{roleLabel(e.userRole)}</Badge>}
                        {mod && ModIcon && (
                          <span className={`inline-flex items-center gap-1 text-[11px] ${mod.color}`}>
                            <ModIcon className="h-3 w-3" />
                            {mod.label}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-muted mt-0.5">
                        {e.action}
                        {target ? <span className="text-ink">: {target}</span> : null}
                      </p>
                      {e.description && <p className="text-xs text-muted mt-0.5">{e.description}</p>}
                      {e.propertyId && (
                        <p className="text-xs text-faint mt-0.5">
                          {properties.find(p => p.id === e.propertyId)?.name || 'Property'}
                          {e.unitId && (() => {
                            const u = units.find(x => x.id === e.unitId);
                            return u ? ` · Unit ${u.unitNumber}` : '';
                          })()}
                        </p>
                      )}

                      {/* Change details toggle */}
                      {hasChanges && (
                        <button
                          onClick={() => toggleExpand(e.id)}
                          className="inline-flex items-center gap-0.5 text-xs text-primary hover:text-primary-hover mt-1"
                        >
                          {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                          {isExpanded ? 'Hide changes' : 'Show changes'}
                        </button>
                      )}

                      {isExpanded && hasChanges && (
                        <div className="mt-2 rounded-lg border border-line bg-canvas p-3 text-xs space-y-1.5 overflow-x-auto">
                          {e.previousValues && e.newValues && (
                            Object.keys({ ...e.previousValues, ...e.newValues }).map(key => {
                              const prev = e.previousValues?.[key];
                              const next = e.newValues?.[key];
                              if (prev === next) return null;
                              return (
                                <div key={key} className="flex gap-2 items-baseline flex-wrap">
                                  <span className="font-medium text-ink min-w-[100px]">{fieldLabel(key)}</span>
                                  {prev !== undefined && (
                                    <span className="text-danger line-through">{formatValue(prev)}</span>
                                  )}
                                  {prev !== undefined && next !== undefined && <span className="text-faint">→</span>}
                                  {next !== undefined && (
                                    <span className="text-positive">{formatValue(next)}</span>
                                  )}
                                </div>
                              );
                            })
                          )}
                          {e.newValues && !e.previousValues && (
                            Object.entries(e.newValues).map(([key, val]) => (
                              <div key={key} className="flex gap-2 items-baseline">
                                <span className="font-medium text-ink min-w-[100px]">{fieldLabel(key)}</span>
                                <span className="text-positive">{formatValue(val)}</span>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                    <span className="text-xs text-faint whitespace-nowrap flex-shrink-0 mt-0.5">{formatWhen(e.createdAt)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {!loading && !error && entries.length < total && (
        <div className="text-center">
          <Button variant="secondary" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? 'Loading.' : `Load more (${total - entries.length} remaining)`}
          </Button>
        </div>
      )}
    </div>
  );
}
