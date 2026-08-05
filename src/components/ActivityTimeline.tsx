import { useEffect, useState } from 'react';
import { ScrollText, ChevronDown, ChevronUp } from 'lucide-react';
import { Badge } from './ui/Badge';
import { Button } from './ui/Button';
import { activityApi, type ActivityEntry } from '../lib/api';

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
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

/** Friendly label for a changed field name. */
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

interface Props {
  /** Show only entries for this specific record. */
  targetType?: string;
  targetId?: string;
  /** Show only entries linked to this property. */
  propertyId?: string;
  /** Show only entries linked to this tenant. */
  tenantId?: string;
  /** Max initial entries to show. */
  limit?: number;
  /** Section title. */
  title?: string;
}

/**
 * Reusable activity timeline for embedding in Property Profile, Tenant
 * Detail, Maintenance detail, etc.
 */
export function ActivityTimeline({
  targetType,
  targetId,
  propertyId,
  tenantId,
  limit = 20,
  title = 'Activity',
}: Props) {
  const [entries, setEntries] = useState<ActivityEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [total, setTotal] = useState(0);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    activityApi
      .list({ targetType, targetId, propertyId, tenantId, limit })
      .then((res) => {
        setEntries(res.data);
        setTotal(res.total);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [targetType, targetId, propertyId, tenantId, limit]);

  const loadMore = () => {
    activityApi
      .list({ targetType, targetId, propertyId, tenantId, limit, offset: entries.length })
      .then((res) => {
        setEntries(prev => [...prev, ...res.data]);
      })
      .catch(() => {});
  };

  const toggleExpand = (id: string) =>
    setExpanded(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  if (loading) return <p className="text-sm text-muted py-4">Loading activity.</p>;
  if (entries.length === 0) {
    return (
      <div className="text-center py-8">
        <ScrollText className="h-8 w-8 mx-auto text-faint mb-2" />
        <p className="text-sm text-muted">No activity recorded yet.</p>
      </div>
    );
  }

  return (
    <div>
      {title && <h3 className="font-medium text-ink mb-3">{title}</h3>}
      <div className="relative pl-6 border-l-2 border-line space-y-0">
        {entries.map((e) => {
          const hasChanges = e.previousValues || e.newValues;
          const isExpanded = expanded.has(e.id);
          return (
            <div key={e.id} className="relative pb-4">
              {/* Dot */}
              <div className="absolute -left-[25px] top-1 w-3 h-3 rounded-full bg-primary border-2 border-surface" />
              <div className="ml-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-ink">{e.action}</span>
                  {e.targetName && <span className="text-sm text-muted">: {e.targetName}</span>}
                </div>
                {e.description && <p className="text-xs text-muted mt-0.5">{e.description}</p>}
                <div className="flex items-center gap-2 mt-1 text-xs text-faint flex-wrap">
                  <span>{e.userName || 'System'}</span>
                  {e.userRole && <Badge variant={roleBadge[e.userRole] ?? 'secondary'}>{roleLabel(e.userRole)}</Badge>}
                  <span>·</span>
                  <span>{formatWhen(e.createdAt)}</span>
                  {hasChanges && (
                    <button
                      onClick={() => toggleExpand(e.id)}
                      className="inline-flex items-center gap-0.5 text-primary hover:text-primary-hover"
                    >
                      {isExpanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                      {isExpanded ? 'Hide changes' : 'Show changes'}
                    </button>
                  )}
                </div>
                {isExpanded && hasChanges && (
                  <div className="mt-2 rounded-lg border border-line bg-canvas p-3 text-xs space-y-1.5">
                    {e.previousValues && e.newValues && (
                      Object.keys({ ...e.previousValues, ...e.newValues }).map(key => {
                        const prev = e.previousValues?.[key];
                        const next = e.newValues?.[key];
                        if (prev === next) return null;
                        return (
                          <div key={key} className="flex gap-2">
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
                        <div key={key} className="flex gap-2">
                          <span className="font-medium text-ink min-w-[100px]">{fieldLabel(key)}</span>
                          <span className="text-positive">{formatValue(val)}</span>
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      {entries.length < total && (
        <div className="text-center mt-2">
          <Button variant="secondary" size="sm" onClick={loadMore}>
            Load more ({total - entries.length} remaining)
          </Button>
        </div>
      )}
    </div>
  );
}
