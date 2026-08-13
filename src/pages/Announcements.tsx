import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Megaphone,
  Send,
  Trash2,
  Edit2,
  Building2,
  CalendarClock,
  Users,
  Check,
  ChevronDown,
  ChevronUp,
  Clock,
  CircleCheck,
  CircleX,
  Filter,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { announcementsApi, type Announcement } from '../lib/api';

// ---------------------------------------------------------------------------
// Grouping: the DB stores one row per property, but the UI shows one card
// per announcement with all tagged properties listed.
// ---------------------------------------------------------------------------

interface GroupedAnnouncement {
  /** All DB row IDs that belong to this logical announcement. */
  ids: string[];
  title: string;
  body: string;
  /** Properties this announcement was sent to. Empty = all properties. */
  properties: { id: string; name: string }[];
  isAllProperties: boolean;
  created_by: string;
  author_name: string | null;
  created_at: number;
  expires_at: string | null;
}

/**
 * Collapse per-property DB rows into one entry per announcement.
 * Rows from the same send share identical title + body + created_by + created_at
 * because they are batch-inserted in a single request.
 */
function groupAnnouncements(raw: Announcement[]): GroupedAnnouncement[] {
  const map = new Map<string, GroupedAnnouncement>();

  for (const a of raw) {
    // Key on the combination that uniquely identifies a single send action.
    const key = `${a.title}\x00${a.body}\x00${a.created_by}\x00${a.created_at}`;

    if (!map.has(key)) {
      map.set(key, {
        ids: [],
        title: a.title,
        body: a.body,
        properties: [],
        isAllProperties: false,
        created_by: a.created_by,
        author_name: a.author_name,
        created_at: a.created_at,
        expires_at: a.expires_at,
      });
    }

    const group = map.get(key)!;
    group.ids.push(a.id);

    if (a.property_id && a.property_name) {
      // Avoid duplicates (shouldn't happen, but defensive).
      if (!group.properties.some(p => p.id === a.property_id)) {
        group.properties.push({ id: a.property_id, name: a.property_name });
      }
    } else {
      group.isAllProperties = true;
    }

    // Keep the latest expiry date across the group.
    if (a.expires_at) {
      if (!group.expires_at || a.expires_at > group.expires_at) {
        group.expires_at = a.expires_at;
      }
    }
  }

  return Array.from(map.values());
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(unixSeconds: number): string {
  const now = Date.now() / 1000;
  const diff = now - unixSeconds;
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return new Date(unixSeconds * 1000).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function Announcements() {
  const { properties, leases, tenants } = useApp();
  const { showToast } = useToast();

  const [rawList, setRawList] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);

  // Form state
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [selectedPropertyIds, setSelectedPropertyIds] = useState<string[]>([]);
  const [expiresAt, setExpiresAt] = useState('');
  const [sending, setSending] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLDivElement>(null);

  // Editing state: when set, the compose form edits an existing announcement.
  const [editingAnnouncement, setEditingAnnouncement] = useState<GroupedAnnouncement | null>(null);

  // Close dropdown on outside click.
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const fetchList = useCallback(async () => {
    try {
      const data = await announcementsApi.list();
      setRawList(data);
    } catch {
      showToast('Could not load announcements.', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const toggleProperty = (id: string) => {
    setSelectedPropertyIds(prev =>
      prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
    );
  };

  const selectAll = () => setSelectedPropertyIds([]);

  /** Label for the dropdown trigger. */
  const selectionLabel = useMemo(() => {
    if (selectedPropertyIds.length === 0) return 'All Properties';
    if (selectedPropertyIds.length === 1) {
      const p = properties.find(pr => pr.id === selectedPropertyIds[0]);
      return p?.name ?? '1 property';
    }
    return `${selectedPropertyIds.length} properties`;
  }, [selectedPropertyIds, properties]);

  /** Count active tenants who will receive the announcement. */
  const recipientCount = useMemo(() => {
    const activeLeases = leases.filter(l => l.status === 'active');
    const tenantIds = new Set<string>();
    for (const lease of activeLeases) {
      if (selectedPropertyIds.length > 0 && (!lease.propertyId || !selectedPropertyIds.includes(lease.propertyId))) continue;
      for (const t of tenants) {
        if ((t as unknown as { leaseId?: string }).leaseId === lease.id) {
          tenantIds.add(t.id);
        }
      }
    }
    return tenantIds.size;
  }, [leases, tenants, selectedPropertyIds]);

  const startEdit = (g: GroupedAnnouncement) => {
    setEditingAnnouncement(g);
    setTitle(g.title);
    setBody(g.body);
    setExpiresAt(g.expires_at || '');
    // Properties can't be changed after send (rows are per-property), so
    // we show them as read-only context but don't let the dropdown change.
    setSelectedPropertyIds(g.properties.map(p => p.id));
    // Scroll to the compose form.
    setTimeout(() => formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 100);
  };

  const cancelEdit = () => {
    setEditingAnnouncement(null);
    setTitle('');
    setBody('');
    setSelectedPropertyIds([]);
    setExpiresAt('');
  };

  const handleSend = async () => {
    if (!title.trim() || !body.trim()) {
      showToast('Title and message are required.', 'error');
      return;
    }
    setSending(true);
    try {
      if (editingAnnouncement) {
        // Update the existing announcement (all rows in the group).
        await announcementsApi.update(editingAnnouncement.ids[0], {
          title: title.trim(),
          body: body.trim(),
          expiresAt: expiresAt || null,
        });
        showToast('Announcement updated.', 'success');
        setEditingAnnouncement(null);
      } else {
        const result = await announcementsApi.create({
          title: title.trim(),
          body: body.trim(),
          propertyIds: selectedPropertyIds.length > 0 ? selectedPropertyIds : undefined,
          expiresAt: expiresAt || undefined,
        });
        showToast(
          `Announcement sent to ${result.recipientCount} tenant${result.recipientCount === 1 ? '' : 's'}.`,
          'success',
        );
      }
      setTitle('');
      setBody('');
      setSelectedPropertyIds([]);
      setExpiresAt('');
      fetchList();
    } catch (err) {
      showToast((err as Error).message || 'Could not send announcement.', 'error');
    } finally {
      setSending(false);
    }
  };

  // --- History section state ---
  const [filter, setFilter] = useState<'all' | 'active' | 'expired'>('all');
  const [propertyFilter, setPropertyFilter] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<GroupedAnnouncement | null>(null);
  const [deleting, setDeleting] = useState(false);

  const toggleExpand = (key: string) => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const isExpired = (a: GroupedAnnouncement) =>
    !!a.expires_at && a.expires_at < new Date().toISOString().slice(0, 10);

  // Group raw rows into logical announcements, then filter.
  const grouped = useMemo(() => groupAnnouncements(rawList), [rawList]);

  const { filtered, activeCount, expiredCount, uniqueProperties } = useMemo(() => {
    let active = 0;
    let expired = 0;
    const propSet = new Map<string, string>(); // id → name

    for (const g of grouped) {
      if (isExpired(g)) expired++;
      else active++;
      for (const p of g.properties) propSet.set(p.id, p.name);
    }

    let result = grouped;
    if (filter === 'active') result = result.filter(g => !isExpired(g));
    if (filter === 'expired') result = result.filter(g => isExpired(g));
    if (propertyFilter) {
      result = result.filter(g =>
        g.isAllProperties || g.properties.some(p => p.id === propertyFilter)
      );
    }

    return {
      filtered: result,
      activeCount: active,
      expiredCount: expired,
      uniqueProperties: Array.from(propSet.entries()).map(([id, name]) => ({ id, name })),
    };
  }, [grouped, filter, propertyFilter]);

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      // Delete all DB rows that belong to this logical announcement.
      await Promise.all(deleteTarget.ids.map(id => announcementsApi.remove(id)));
      setRawList(prev => prev.filter(a => !deleteTarget.ids.includes(a.id)));
      showToast('Announcement deleted.', 'success');
    } catch {
      showToast('Could not delete the announcement.', 'error');
    } finally {
      setDeleting(false);
      setDeleteTarget(null);
    }
  };

  /** Body text truncation threshold (characters). */
  const TRUNCATE_AT = 160;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <p className="eyebrow">Communication</p>
        <h1 className="font-display text-[28px] sm:text-[34px] text-ink mt-1">Announcements</h1>
      </div>

      {/* Compose card */}
      <Card ref={formRef}>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-lg flex items-center gap-2">
              {editingAnnouncement ? <Edit2 className="h-4 w-4" /> : <Send className="h-4 w-4" />}
              {editingAnnouncement ? 'Edit Announcement' : 'New Announcement'}
            </CardTitle>
            {editingAnnouncement && (
              <Button variant="outline" size="sm" onClick={cancelEdit}>Cancel editing</Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Title */}
          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 block">
              Title
            </label>
            <input
              type="text"
              value={title}
              onChange={e => setTitle(e.target.value)}
              placeholder="e.g. Water shutoff on Friday"
              className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
            />
          </div>

          {/* Body */}
          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 block">
              Message
            </label>
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              placeholder="Write your announcement here..."
              rows={4}
              className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary resize-y"
            />
          </div>

          {/* Property + Expiration row */}
          <div className="flex flex-col sm:flex-row gap-4">
            <div className="flex-1" ref={dropdownRef}>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 block">
                <Building2 className="inline h-3.5 w-3.5 mr-1 -mt-0.5" />
                Properties
              </label>
              <div className="relative">
                <button
                  type="button"
                  onClick={() => !editingAnnouncement && setDropdownOpen(o => !o)}
                  disabled={!!editingAnnouncement}
                  className={`w-full flex items-center justify-between rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm text-left focus:outline-none focus:ring-2 focus:ring-primary ${editingAnnouncement ? 'opacity-60 cursor-not-allowed' : ''}`}
                >
                  <span className={selectedPropertyIds.length === 0 ? 'text-gray-500 dark:text-gray-400' : ''}>
                    {editingAnnouncement
                      ? (editingAnnouncement.isAllProperties ? 'All Properties' : selectionLabel)
                      : selectionLabel}
                  </span>
                  <ChevronDown className={`h-4 w-4 text-gray-400 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`} />
                </button>

                {dropdownOpen && (
                  <div className="absolute z-20 mt-1 w-full rounded-md border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-800 shadow-lg max-h-60 overflow-y-auto">
                    {/* All Properties option */}
                    <button
                      type="button"
                      onClick={selectAll}
                      className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 text-left"
                    >
                      <span className={`flex items-center justify-center w-4 h-4 rounded border ${
                        selectedPropertyIds.length === 0
                          ? 'bg-primary border-primary text-white'
                          : 'border-gray-300 dark:border-gray-500'
                      }`}>
                        {selectedPropertyIds.length === 0 && <Check className="h-3 w-3" />}
                      </span>
                      All Properties
                    </button>

                    <div className="border-t border-gray-100 dark:border-gray-700" />

                    {properties.map(p => {
                      const checked = selectedPropertyIds.includes(p.id);
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => toggleProperty(p.id)}
                          className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 text-left"
                        >
                          <span className={`flex items-center justify-center w-4 h-4 rounded border ${
                            checked
                              ? 'bg-primary border-primary text-white'
                              : 'border-gray-300 dark:border-gray-500'
                          }`}>
                            {checked && <Check className="h-3 w-3" />}
                          </span>
                          {p.name}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="flex-1">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 block">
                <CalendarClock className="inline h-3.5 w-3.5 mr-1 -mt-0.5" />
                Expires On (optional)
              </label>
              <input
                type="date"
                value={expiresAt}
                onChange={e => setExpiresAt(e.target.value)}
                className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>

          {/* Selected property badges */}
          {selectedPropertyIds.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {selectedPropertyIds.map(pid => {
                const p = properties.find(pr => pr.id === pid);
                return (
                  <Badge
                    key={pid}
                    variant="secondary"
                    className="cursor-pointer hover:opacity-70"
                    onClick={() => toggleProperty(pid)}
                  >
                    {p?.name ?? pid} ✕
                  </Badge>
                );
              })}
            </div>
          )}

          {/* Recipient count + Send / Save */}
          <div className="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-gray-700">
            {editingAnnouncement ? (
              <span className="text-sm text-muted">
                Editing will update the announcement for all recipients.
              </span>
            ) : (
              <span className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
                <Users className="h-4 w-4" />
                Will be sent to <strong>{recipientCount}</strong> active tenant{recipientCount === 1 ? '' : 's'}
              </span>
            )}
            <Button onClick={handleSend} disabled={sending || !title.trim() || !body.trim()}>
              {sending
                ? (editingAnnouncement ? 'Saving...' : 'Sending...')
                : (editingAnnouncement ? 'Save Changes' : 'Send Announcement')}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Announcement history */}
      <Card>
        <CardHeader>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <CardTitle className="text-lg">Announcements</CardTitle>
            {grouped.length > 0 && (
              <span className="text-xs text-muted">
                {grouped.length} total · {activeCount} active · {expiredCount} expired
              </span>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-muted">Loading...</p>
          ) : grouped.length === 0 ? (
            <div className="text-center py-8">
              <Megaphone className="h-10 w-10 text-faint mx-auto mb-3" />
              <p className="text-sm text-muted">No announcements have been sent yet.</p>
              <p className="text-xs text-faint mt-1">Compose one above to get started.</p>
            </div>
          ) : (
            <div className="space-y-4">
              {/* Filter bar */}
              <div className="flex flex-col sm:flex-row gap-3">
                {/* Status tabs */}
                <div className="flex gap-1 bg-canvas rounded-lg p-1 border border-line">
                  {([
                    { key: 'all' as const, label: 'All', count: grouped.length, icon: null },
                    { key: 'active' as const, label: 'Active', count: activeCount, icon: CircleCheck },
                    { key: 'expired' as const, label: 'Expired', count: expiredCount, icon: CircleX },
                  ] as const).map(tab => {
                    const isActive = filter === tab.key;
                    const TabIcon = tab.icon;
                    return (
                      <button
                        key={tab.key}
                        onClick={() => setFilter(tab.key)}
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                          isActive
                            ? 'bg-surface shadow-sm text-ink border border-line'
                            : 'text-muted hover:text-ink'
                        }`}
                      >
                        {TabIcon && <TabIcon className="h-3 w-3" />}
                        {tab.label}
                        <span className={`text-[10px] px-1.5 py-px rounded-full ${
                          isActive ? 'bg-primary-soft text-primary' : 'bg-canvas text-faint'
                        }`}>
                          {tab.count}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Property filter */}
                {uniqueProperties.length > 1 && (
                  <div className="flex items-center gap-2 flex-wrap">
                    <Filter className="h-3.5 w-3.5 text-muted flex-shrink-0" />
                    <button
                      onClick={() => setPropertyFilter(null)}
                      className={`px-2.5 py-1 rounded-full text-xs transition-colors ${
                        !propertyFilter
                          ? 'bg-primary-soft text-primary font-medium'
                          : 'text-muted hover:bg-canvas'
                      }`}
                    >
                      All
                    </button>
                    {uniqueProperties.map(p => (
                      <button
                        key={p.id}
                        onClick={() => setPropertyFilter(p.id === propertyFilter ? null : p.id)}
                        className={`px-2.5 py-1 rounded-full text-xs transition-colors ${
                          propertyFilter === p.id
                            ? 'bg-primary-soft text-primary font-medium'
                            : 'text-muted hover:bg-canvas'
                        }`}
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Filtered results */}
              {filtered.length === 0 ? (
                <div className="text-center py-6">
                  <p className="text-sm text-muted">
                    No {filter === 'active' ? 'active' : filter === 'expired' ? 'expired' : ''} announcements
                    {propertyFilter ? ' for this property' : ''}.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {filtered.map(g => {
                    const expired = isExpired(g);
                    const isLong = g.body.length > TRUNCATE_AT;
                    // Use the first ID as a stable key for expand/collapse.
                    const expandKey = g.ids[0];
                    const isExpanded = expandedIds.has(expandKey);
                    const displayBody = isLong && !isExpanded
                      ? g.body.slice(0, TRUNCATE_AT).trimEnd() + '...'
                      : g.body;

                    return (
                      <div
                        key={expandKey}
                        className={`relative border rounded-xl p-4 transition-all ${
                          expired
                            ? 'border-line bg-canvas/50'
                            : 'border-line hover:border-primary-line bg-surface'
                        }`}
                      >
                        {/* Status indicator bar */}
                        <div className={`absolute left-0 top-3 bottom-3 w-[3px] rounded-r-full ${
                          expired ? 'bg-faint' : 'bg-positive'
                        }`} />

                        <div className="flex items-start justify-between gap-3 pl-2">
                          <div className="flex-1 min-w-0">
                            {/* Title row */}
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className={`font-semibold text-sm ${expired ? 'text-muted' : 'text-ink'}`}>
                                {g.title}
                              </span>
                              {expired ? (
                                <Badge variant="warning">Expired</Badge>
                              ) : (
                                g.expires_at && (
                                  <span className="flex items-center gap-1 text-[10px] text-muted">
                                    <Clock className="h-3 w-3" />
                                    Expires {g.expires_at}
                                  </span>
                                )
                              )}
                            </div>

                            {/* Property badges */}
                            <div className="flex flex-wrap gap-1.5 mt-1.5">
                              {g.isAllProperties ? (
                                <Badge variant="default">All Properties</Badge>
                              ) : (
                                g.properties.map(p => (
                                  <Badge key={p.id} variant="secondary">{p.name}</Badge>
                                ))
                              )}
                            </div>

                            {/* Body with truncation */}
                            <p className={`text-sm mt-2 whitespace-pre-line leading-relaxed ${
                              expired ? 'text-faint' : 'text-muted'
                            }`}>
                              {displayBody}
                            </p>
                            {isLong && (
                              <button
                                onClick={() => toggleExpand(expandKey)}
                                className="flex items-center gap-1 mt-1 text-xs text-primary hover:text-primary/80 font-medium transition-colors"
                              >
                                {isExpanded ? (
                                  <>Show less <ChevronUp className="h-3 w-3" /></>
                                ) : (
                                  <>Show more <ChevronDown className="h-3 w-3" /></>
                                )}
                              </button>
                            )}

                            {/* Metadata */}
                            <div className="text-xs text-faint mt-2 flex items-center gap-2 flex-wrap">
                              <span className="flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {relativeTime(g.created_at)}
                              </span>
                              {g.author_name && (
                                <>
                                  <span className="text-line">·</span>
                                  <span>{g.author_name}</span>
                                </>
                              )}
                            </div>
                          </div>

                          {/* Edit + Delete buttons */}
                          <div className="flex items-center gap-1 flex-shrink-0">
                            <button
                              onClick={() => startEdit(g)}
                              className="text-faint hover:text-primary transition-colors p-1.5 rounded-lg hover:bg-primary-soft"
                              title="Edit announcement"
                            >
                              <Edit2 className="h-4 w-4" />
                            </button>
                            <button
                              onClick={() => setDeleteTarget(g)}
                              className="text-faint hover:text-danger transition-colors p-1.5 rounded-lg hover:bg-danger-soft"
                              title="Delete announcement"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Delete confirmation */}
      <ConfirmDialog
        isOpen={!!deleteTarget}
        onClose={() => { if (!deleting) setDeleteTarget(null); }}
        onConfirm={handleDelete}
        title="Delete Announcement"
        message={`This will permanently remove "${deleteTarget?.title ?? ''}". Tenants who already received it will keep their copy, but it will no longer appear in the portal.`}
        confirmText="Delete"
        variant="danger"
        loading={deleting}
      />
    </div>
  );
}
