import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Bell, CheckCheck, ListChecks, Wrench, Users, DollarSign, ClipboardList,
  FolderKanban, FileText, ShieldCheck, Settings as SettingsIcon,
  ChevronLeft, ChevronRight, Eye, EyeOff, Trash2, SlidersHorizontal,
  type LucideIcon,
} from 'lucide-react';
import { mgmtNotificationsApi, type MgmtNotification } from '../lib/api';
import { useToast } from '../context/ToastContext';
import { cn } from '../lib/utils';

const TYPE_ICON: Record<string, LucideIcon> = {
  task: ListChecks,
  project: FolderKanban,
  maintenance: Wrench,
  tenant: Users,
  lease: FileText,
  payment: DollarSign,
  expense: ClipboardList,
  vendor: Users,
  inspection: ClipboardList,
  approval: ShieldCheck,
  system: SettingsIcon,
};

const PRIORITY_LABEL: Record<string, { text: string; cls: string }> = {
  urgent: { text: 'Urgent', cls: 'bg-red-50 text-red-700' },
  important: { text: 'Important', cls: 'bg-amber-50 text-amber-700' },
  normal: { text: '', cls: '' },
  informational: { text: '', cls: '' },
};

const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'unread', label: 'Unread' },
  { value: 'task', label: 'Tasks' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'tenant', label: 'Tenants' },
  { value: 'payment', label: 'Payments' },
  { value: 'lease', label: 'Leases' },
  { value: 'expense', label: 'Expenses' },
  { value: 'inspection', label: 'Inspections' },
  { value: 'approval', label: 'Approvals' },
  { value: 'system', label: 'System' },
];

const CATEGORY_LABELS: Record<string, { label: string; group: string }> = {
  task_assigned: { label: 'Task assigned to you', group: 'Tasks' },
  task_completed: { label: 'Task completed', group: 'Tasks' },
  task_comment: { label: 'New comment on task', group: 'Tasks' },
  project_created: { label: 'Project ownership assigned', group: 'Tasks' },
  maintenance_new: { label: 'New maintenance request', group: 'Maintenance' },
  maintenance_completed: { label: 'Maintenance completed', group: 'Maintenance' },
  maintenance_paid: { label: 'Maintenance marked paid', group: 'Maintenance' },
  vendor_assigned: { label: 'Handyman assigned', group: 'Maintenance' },
  tenant_message: { label: 'Tenant portal message', group: 'Tenants' },
  tenant_created: { label: 'New tenant added', group: 'Tenants' },
  tenant_converted: { label: 'Applicant converted to tenant', group: 'Tenants' },
  notice_created: { label: 'Notice created', group: 'Tenants' },
  lease_created: { label: 'New lease created', group: 'Leases' },
  lease_renewal: { label: 'Lease renewal generated', group: 'Leases' },
  lease_renewal_approved: { label: 'Lease renewal approved', group: 'Leases' },
  lease_renewal_rejected: { label: 'Lease renewal rejected', group: 'Leases' },
  lease_status_changed: { label: 'Lease paused, resumed, or terminated', group: 'Leases' },
  payment_received: { label: 'Rent payment recorded', group: 'Payments' },
  payment_autopay: { label: 'Autopay payment received', group: 'Payments' },
  expense_created: { label: 'Expense recorded ($500+)', group: 'Finances' },
  deposit_return_created: { label: 'Deposit return initiated', group: 'Finances' },
  late_fee_assessed: { label: 'Late fee assessed', group: 'Finances' },
  inspection_scheduled: { label: 'Inspection scheduled', group: 'Inspections' },
  inspection_updated: { label: 'Inspection status changed', group: 'Inspections' },
  invoice_approved: { label: 'Invoice approved', group: 'Approvals' },
  invoice_rejected: { label: 'Invoice rejected or revision requested', group: 'Approvals' },
  approval_requested: { label: 'Invoice needs approval', group: 'Approvals' },
};

function formatDate(unixTs: number): string {
  const d = new Date(unixTs * 1000);
  const now = new Date();
  const diff = Math.floor((now.getTime() - d.getTime()) / 1000);

  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)} minutes ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} hours ago`;
  if (diff < 172800) return 'Yesterday';
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: d.getFullYear() !== now.getFullYear() ? 'numeric' : undefined });
}

interface GroupedNotification {
  key: string;
  notifications: MgmtNotification[];
  representative: MgmtNotification;
  count: number;
}

function groupNotifications(notifications: MgmtNotification[]): GroupedNotification[] {
  const groups: GroupedNotification[] = [];
  const windowMs = 3600;

  for (const n of notifications) {
    const existing = groups.find(g => {
      if (g.representative.category !== n.category) return false;
      if (g.representative.entity_id === n.entity_id) return false;
      const timeDiff = Math.abs(g.representative.created_at - n.created_at);
      return timeDiff <= windowMs;
    });

    if (existing) {
      existing.notifications.push(n);
      existing.count = existing.notifications.length;
    } else {
      groups.push({
        key: n.id,
        notifications: [n],
        representative: n,
        count: 1,
      });
    }
  }

  return groups;
}

function PreferencesPanel({ onClose }: { onClose: () => void }) {
  const { showToast } = useToast();
  const [prefs, setPrefs] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    mgmtNotificationsApi.getPreferences()
      .then(data => setPrefs(data.preferences))
      .catch(() => showToast('Failed to load preferences', 'error'))
      .finally(() => setLoading(false));
  }, [showToast]);

  const toggle = (category: string) => {
    setPrefs(prev => ({ ...prev, [category]: !prev[category] }));
  };

  const save = async () => {
    setSaving(true);
    try {
      await mgmtNotificationsApi.updatePreferences(prefs);
      showToast('Notification preferences saved', 'success');
      onClose();
    } catch {
      showToast('Failed to save preferences', 'error');
    }
    setSaving(false);
  };

  const enabledCount = Object.values(prefs).filter(Boolean).length;
  const totalCount = Object.keys(prefs).length;

  const toggleAll = () => {
    const allEnabled = enabledCount === totalCount;
    const next: Record<string, boolean> = {};
    for (const key of Object.keys(prefs)) next[key] = !allEnabled;
    setPrefs(next);
  };

  const groupedCategories = Object.entries(CATEGORY_LABELS).reduce<Record<string, string[]>>((acc, [cat, { group }]) => {
    (acc[group] ||= []).push(cat);
    return acc;
  }, {});

  if (loading) {
    return (
      <div className="bg-surface border border-line rounded-xl p-6 mb-6">
        <p className="text-sm text-muted text-center">Loading preferences...</p>
      </div>
    );
  }

  return (
    <div className="bg-surface border border-line rounded-xl mb-6 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-line">
        <div>
          <h2 className="text-sm font-semibold text-ink">Notification Preferences</h2>
          <p className="text-xs text-muted mt-0.5">
            {enabledCount} of {totalCount} categories enabled
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleAll}
            className="text-xs font-medium text-primary hover:text-primary/80 transition-colors"
          >
            {enabledCount === totalCount ? 'Mute all' : 'Enable all'}
          </button>
        </div>
      </div>

      <div className="px-5 py-4 space-y-5">
        {Object.entries(groupedCategories).map(([group, cats]) => (
          <div key={group}>
            <p className="text-[11px] font-semibold text-muted uppercase tracking-wider mb-2">{group}</p>
            <div className="space-y-1">
              {cats.map(cat => {
                const info = CATEGORY_LABELS[cat];
                if (!info) return null;
                const enabled = prefs[cat] ?? true;
                return (
                  <label
                    key={cat}
                    className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-canvas cursor-pointer transition-colors"
                  >
                    <span className={cn('text-sm', enabled ? 'text-ink' : 'text-muted')}>
                      {info.label}
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={enabled}
                      onClick={() => toggle(cat)}
                      className={cn(
                        'relative w-9 h-5 rounded-full transition-colors flex-shrink-0',
                        enabled ? 'bg-primary' : 'bg-line'
                      )}
                    >
                      <span className={cn(
                        'absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow-sm transition-transform',
                        enabled ? 'translate-x-4' : 'translate-x-0'
                      )} />
                    </button>
                  </label>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-line bg-canvas/50">
        <button
          onClick={onClose}
          className="px-3 py-1.5 rounded-lg text-sm font-medium text-muted hover:text-ink transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={save}
          disabled={saving}
          className="px-4 py-1.5 rounded-lg text-sm font-medium bg-primary text-white hover:bg-primary/90 disabled:opacity-50 transition-colors"
        >
          {saving ? 'Saving...' : 'Save preferences'}
        </button>
      </div>
    </div>
  );
}

export function Notifications() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [filter, setFilter] = useState('all');
  const [notifications, setNotifications] = useState<MgmtNotification[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [showPrefs, setShowPrefs] = useState(false);
  const limit = 20;

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await mgmtNotificationsApi.list(filter, page, limit);
      setNotifications(data.notifications);
      setTotal(data.total);
    } catch {
      showToast('Failed to load notifications', 'error');
    }
    setLoading(false);
  }, [filter, page, showToast]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [filter]);

  const totalPages = Math.ceil(total / limit);

  const handleClick = async (n: MgmtNotification) => {
    if (!n.is_read) {
      try {
        await mgmtNotificationsApi.markRead(n.id);
        setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, is_read: 1 } : x));
      } catch { /* silent */ }
    }
    if (n.route) navigate(n.route);
  };

  const toggleRead = async (e: React.MouseEvent, n: MgmtNotification) => {
    e.stopPropagation();
    try {
      await mgmtNotificationsApi.markRead(n.id, !n.is_read);
      setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, is_read: n.is_read ? 0 : 1 } : x));
    } catch { /* silent */ }
  };

  const handleDismiss = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    try {
      await mgmtNotificationsApi.dismiss(id);
      setNotifications(prev => prev.filter(x => x.id !== id));
      setTotal(prev => prev - 1);
    } catch {
      showToast('Failed to dismiss notification', 'error');
    }
  };

  const handleMarkAllRead = async () => {
    try {
      await mgmtNotificationsApi.markAllRead();
      setNotifications(prev => prev.map(x => ({ ...x, is_read: 1 })));
      showToast('All notifications marked as read', 'success');
    } catch {
      showToast('Failed to mark notifications as read', 'error');
    }
  };

  const unreadCount = notifications.filter(n => !n.is_read).length;
  const grouped = groupNotifications(notifications);

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="font-display text-2xl font-semibold text-ink">Notifications</h1>
          <p className="text-sm text-muted mt-1">{total} notification{total !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowPrefs(p => !p)}
            title="Notification preferences"
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border border-line transition-colors',
              showPrefs ? 'bg-primary/5 text-primary' : 'text-muted hover:text-ink hover:bg-canvas'
            )}
          >
            <SlidersHorizontal className="w-4 h-4" /> Preferences
          </button>
          {unreadCount > 0 && (
            <button
              onClick={handleMarkAllRead}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-primary hover:bg-primary/5 border border-line transition-colors"
            >
              <CheckCheck className="w-4 h-4" /> Mark all as read
            </button>
          )}
        </div>
      </div>

      {/* Preferences panel */}
      {showPrefs && <PreferencesPanel onClose={() => setShowPrefs(false)} />}

      {/* Filter tabs */}
      <div className="flex gap-1 overflow-x-auto pb-2 mb-4 -mx-1 px-1">
        {FILTERS.map(f => (
          <button
            key={f.value}
            onClick={() => setFilter(f.value)}
            className={cn(
              'px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors',
              filter === f.value
                ? 'bg-primary text-white'
                : 'text-muted hover:text-ink hover:bg-canvas border border-transparent hover:border-line'
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Notification list */}
      <div className="bg-surface border border-line rounded-xl overflow-hidden">
        {loading ? (
          <div className="py-12 text-center text-sm text-muted">Loading notifications...</div>
        ) : grouped.length === 0 ? (
          <div className="py-16 text-center">
            <Bell className="w-10 h-10 text-line mx-auto mb-3" />
            <p className="text-sm font-medium text-ink">You're all caught up.</p>
            <p className="text-xs text-muted mt-1">No notifications to show.</p>
          </div>
        ) : (
          <div>
            {grouped.map(g => {
              const n = g.representative;
              const Icon = TYPE_ICON[n.type] || Bell;
              const pri = PRIORITY_LABEL[n.priority];
              const hasUnread = g.notifications.some(x => !x.is_read);
              return (
                <button
                  key={g.key}
                  onClick={() => handleClick(n)}
                  className={cn(
                    'w-full text-left flex items-start gap-3 px-4 sm:px-5 py-3.5 border-b border-line last:border-b-0 transition-colors group',
                    hasUnread ? 'bg-primary/[0.02] hover:bg-primary/[0.05]' : 'bg-surface hover:bg-canvas'
                  )}
                >
                  <div className={cn(
                    'flex-shrink-0 w-9 h-9 rounded-lg flex items-center justify-center mt-0.5',
                    hasUnread ? 'bg-primary/10 text-primary' : 'bg-canvas text-muted'
                  )}>
                    <Icon className="w-4.5 h-4.5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <p className={cn('text-sm font-medium', hasUnread ? 'text-ink' : 'text-muted')}>
                            {g.count > 1 ? `${n.title} (+${g.count - 1} more)` : n.title}
                          </p>
                          {hasUnread && <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-primary" />}
                          {g.count > 1 && (
                            <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-canvas text-muted">
                              {g.count}
                            </span>
                          )}
                          {pri?.text && (
                            <span className={cn('text-[10px] font-bold px-1.5 py-0.5 rounded', pri.cls)}>
                              {pri.text}
                            </span>
                          )}
                        </div>
                        {n.message && (
                          <p className="text-xs text-muted mt-0.5 line-clamp-2 leading-relaxed">{n.message}</p>
                        )}
                        <p className="text-[11px] text-faint mt-1">{formatDate(n.created_at)}</p>
                      </div>
                      {g.count === 1 && (
                        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                          <button
                            onClick={(e) => toggleRead(e, n)}
                            title={n.is_read ? 'Mark as unread' : 'Mark as read'}
                            className="p-1.5 rounded-md text-muted hover:text-ink hover:bg-canvas transition-colors"
                          >
                            {n.is_read ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                          </button>
                          <button
                            onClick={(e) => handleDismiss(e, n.id)}
                            title="Dismiss"
                            className="p-1.5 rounded-md text-muted hover:text-danger hover:bg-danger/5 transition-colors"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-line">
            <p className="text-xs text-muted">
              Page {page} of {totalPages}
            </p>
            <div className="flex gap-1">
              <button
                onClick={() => setPage(p => Math.max(1, p - 1))}
                disabled={page <= 1}
                className="p-1.5 rounded-md text-muted hover:text-ink hover:bg-canvas disabled:opacity-30 transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
                className="p-1.5 rounded-md text-muted hover:text-ink hover:bg-canvas disabled:opacity-30 transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
