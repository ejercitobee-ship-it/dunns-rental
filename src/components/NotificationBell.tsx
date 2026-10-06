import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck, ListChecks, Wrench, Users, DollarSign, ClipboardList, FolderKanban, FileText, ShieldCheck, Settings as SettingsIcon, X, type LucideIcon } from 'lucide-react';
import { mgmtNotificationsApi, type MgmtNotification } from '../lib/api';
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

const PRIORITY_ACCENT: Record<string, string> = {
  urgent: 'border-l-red-500',
  important: 'border-l-amber-500',
  normal: 'border-l-transparent',
  informational: 'border-l-transparent',
};

function timeAgo(unixTs: number): string {
  const diff = Math.floor(Date.now() / 1000) - unixTs;
  if (diff < 60) return 'Just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
  return new Date(unixTs * 1000).toLocaleDateString();
}

interface Props {
  collapsed?: boolean;
}

export function NotificationBell({ collapsed }: Props) {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState(0);
  const [notifications, setNotifications] = useState<MgmtNotification[]>([]);
  const [loading, setLoading] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const loadCount = () => {
    mgmtNotificationsApi.unreadCount()
      .then(r => setCount(r.count))
      .catch(() => {});
  };

  useEffect(() => {
    loadCount();
    const id = window.setInterval(() => {
      if (document.visibilityState === 'visible') loadCount();
    }, 30000);
    window.addEventListener('focus', loadCount);
    return () => {
      window.clearInterval(id);
      window.removeEventListener('focus', loadCount);
    };
  }, []);

  const loadRecent = async () => {
    setLoading(true);
    try {
      const data = await mgmtNotificationsApi.list('all', 1, 15);
      setNotifications(data.notifications);
    } catch { /* silent */ }
    setLoading(false);
  };

  const toggle = () => {
    if (!open) loadRecent();
    setOpen(prev => !prev);
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const handleClick = async (n: MgmtNotification) => {
    if (!n.is_read) {
      mgmtNotificationsApi.markRead(n.id).then(loadCount).catch(() => {});
      setNotifications(prev => prev.map(x => x.id === n.id ? { ...x, is_read: 1 } : x));
    }
    setOpen(false);
    if (n.route) navigate(n.route);
  };

  const handleMarkAllRead = async () => {
    try {
      await mgmtNotificationsApi.markAllRead();
      setNotifications(prev => prev.map(x => ({ ...x, is_read: 1 })));
      setCount(0);
    } catch { /* silent */ }
  };

  return (
    <div ref={panelRef} className="relative">
      {/* Bell button */}
      <button
        onClick={toggle}
        title="Notifications"
        aria-label={count > 0 ? `${count} unread notifications` : 'Notifications'}
        className={cn(
          'relative flex items-center justify-center rounded-lg transition-colors',
          collapsed ? 'p-2' : 'gap-2 px-2 py-1.5',
          open
            ? 'bg-white/[0.1] text-white'
            : 'text-sidebar-muted hover:bg-white/[0.04] hover:text-white'
        )}
      >
        <Bell className="h-[18px] w-[18px]" />
        {!collapsed && <span className="text-sm">Notifications</span>}
        {count > 0 && (
          <span className={cn(
            'flex items-center justify-center rounded-full bg-[#8fbba8] text-sidebar font-semibold',
            collapsed
              ? 'absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 text-[10px]'
              : 'min-w-5 h-5 px-1.5 text-xs ml-auto'
          )}>
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className={cn(
          'absolute z-50 bg-surface border border-line rounded-xl shadow-[0_16px_48px_-8px_rgba(27,26,23,0.25)] overflow-hidden',
          collapsed
            ? 'left-full ml-2 top-0 w-[360px]'
            : 'left-0 bottom-full mb-2 w-[360px]'
        )}>
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-line">
            <h3 className="text-sm font-semibold text-ink">Notifications</h3>
            <div className="flex items-center gap-1">
              {count > 0 && (
                <button
                  onClick={handleMarkAllRead}
                  className="flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium text-primary hover:bg-primary/5 transition-colors"
                >
                  <CheckCheck className="w-3 h-3" /> Mark all read
                </button>
              )}
              <button
                onClick={() => setOpen(false)}
                className="p-1 rounded-md text-muted hover:text-ink hover:bg-canvas transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* List */}
          <div className="max-h-[400px] overflow-y-auto">
            {loading ? (
              <div className="py-8 text-center text-xs text-muted">Loading...</div>
            ) : notifications.length === 0 ? (
              <div className="py-10 text-center">
                <Bell className="w-8 h-8 text-line mx-auto mb-2" />
                <p className="text-sm text-muted">You're all caught up.</p>
                <p className="text-xs text-faint mt-0.5">No new notifications.</p>
              </div>
            ) : (
              notifications.map(n => {
                const Icon = TYPE_ICON[n.type] || Bell;
                return (
                  <button
                    key={n.id}
                    onClick={() => handleClick(n)}
                    className={cn(
                      'w-full text-left flex gap-3 px-4 py-3 border-b border-line last:border-b-0 transition-colors border-l-2',
                      n.is_read
                        ? 'bg-surface hover:bg-canvas border-l-transparent'
                        : cn('bg-primary/[0.03] hover:bg-primary/[0.06]', PRIORITY_ACCENT[n.priority] || 'border-l-primary/30')
                    )}
                  >
                    <div className={cn(
                      'flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center mt-0.5',
                      n.is_read ? 'bg-canvas text-muted' : 'bg-primary/10 text-primary'
                    )}>
                      <Icon className="w-4 h-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className={cn('text-xs font-medium truncate', n.is_read ? 'text-muted' : 'text-ink')}>
                          {n.title}
                        </p>
                        {!n.is_read && <span className="flex-shrink-0 w-1.5 h-1.5 rounded-full bg-primary mt-1.5" />}
                      </div>
                      {n.message && (
                        <p className="text-[11px] text-muted mt-0.5 line-clamp-2 leading-relaxed">{n.message}</p>
                      )}
                      <p className="text-[10px] text-faint mt-1">{timeAgo(n.created_at)}</p>
                    </div>
                  </button>
                );
              })
            )}
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div className="border-t border-line">
              <button
                onClick={() => { setOpen(false); navigate('/notifications'); }}
                className="w-full px-4 py-2.5 text-xs font-medium text-primary hover:bg-primary/5 transition-colors text-center"
              >
                View All Notifications
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
