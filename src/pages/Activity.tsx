import { useEffect, useMemo, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Search, ScrollText } from 'lucide-react';
import { Card, CardContent } from '../components/ui/Card';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { activityApi, type ActivityEntry } from '../lib/api';

const PAGE = 100;

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

/** A real instant (unix seconds), so toLocaleString is correct here. */
function formatWhen(createdAt: number): string {
  return new Date(createdAt * 1000).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

export function Activity() {
  const { user, users } = useAuth();
  const { tenants, properties, units } = useApp();
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const [hasMore, setHasMore] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);

  const canView = user?.roleId === 'super_admin' || user?.roleId === 'admin';

  useEffect(() => {
    if (!canView) return;
    activityApi
      .list(PAGE, 0)
      .then((rows) => {
        setEntries(rows);
        setHasMore(rows.length === PAGE);
        setOffset(rows.length);
      })
      .catch((err) => setError((err as Error).message || 'Could not load the activity log.'))
      .finally(() => setLoading(false));
  }, [canView]);

  const loadMore = () => {
    setLoadingMore(true);
    activityApi
      .list(PAGE, offset)
      .then((rows) => {
        setEntries((prev) => [...prev, ...rows]);
        setHasMore(rows.length === PAGE);
        setOffset((o) => o + rows.length);
      })
      .catch(() => {})
      .finally(() => setLoadingMore(false));
  };

  // Resolve the target of an action to a friendly name where we can.
  const targetName = (e: ActivityEntry): string | null => {
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return entries;
    return entries.filter(
      (e) =>
        (e.userName || '').toLowerCase().includes(q) ||
        e.action.toLowerCase().includes(q) ||
        (targetName(e) || '').toLowerCase().includes(q)
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entries, search, tenants, properties, units, users]);

  if (!canView) return <Navigate to="/" replace />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-[26px] sm:text-[32px] font-medium text-ink">Activity log</h1>
        <p className="text-muted mt-1 text-sm">A record of who did what, across the whole app. Newest first.</p>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-faint" />
        <input
          type="text"
          placeholder="Search by person, action, or record..."
          className="w-full pl-10 pr-4 py-2 border border-line rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/30 bg-surface"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <p className="text-sm text-muted p-6">Loading activity.</p>
          ) : error ? (
            <p className="text-sm text-danger p-6">{error}</p>
          ) : filtered.length === 0 ? (
            <div className="text-center py-16">
              <ScrollText className="h-10 w-10 mx-auto text-faint mb-3" />
              <h3 className="font-medium text-ink">No activity yet</h3>
              <p className="text-sm text-muted mt-1">Actions will show up here as your team uses the app.</p>
            </div>
          ) : (
            <div className="divide-y divide-line">
              {filtered.map((e) => {
                const name = e.userName || 'Someone';
                const initials = name.split(' ').map((p) => p[0]).slice(0, 2).join('');
                const target = targetName(e);
                return (
                  <div key={e.id} className="flex items-start gap-3 px-5 py-3.5">
                    <div className="w-8 h-8 rounded-full bg-primary-soft flex items-center justify-center text-primary text-xs font-medium flex-shrink-0">
                      {initials.toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-ink">{name}</span>
                        {e.userRole && <Badge variant={roleBadge[e.userRole] ?? 'secondary'}>{roleLabel(e.userRole)}</Badge>}
                      </div>
                      <p className="text-sm text-muted mt-0.5">
                        {e.action}
                        {target ? <span className="text-ink">: {target}</span> : null}
                      </p>
                    </div>
                    <span className="text-xs text-faint whitespace-nowrap flex-shrink-0 mt-0.5">{formatWhen(e.createdAt)}</span>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {!loading && !error && hasMore && (
        <div className="text-center">
          <Button variant="secondary" onClick={loadMore} disabled={loadingMore}>
            {loadingMore ? 'Loading.' : 'Load more'}
          </Button>
        </div>
      )}
    </div>
  );
}
