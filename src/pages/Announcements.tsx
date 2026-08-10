import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Megaphone,
  Send,
  Trash2,
  Building2,
  CalendarClock,
  Users,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { useApp } from '../context/AppContext';
import { useToast } from '../context/ToastContext';
import { announcementsApi, type Announcement } from '../lib/api';

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

export function Announcements() {
  const { properties, leases, tenants } = useApp();
  const { showToast } = useToast();

  const [list, setList] = useState<Announcement[]>([]);
  const [loading, setLoading] = useState(true);

  // Form state
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [propertyId, setPropertyId] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [sending, setSending] = useState(false);

  const fetchList = useCallback(async () => {
    try {
      const data = await announcementsApi.list();
      setList(data);
    } catch {
      showToast('Could not load announcements.', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { fetchList(); }, [fetchList]);

  /** Count active tenants who will receive the announcement. */
  const recipientCount = useMemo(() => {
    const activeLeases = leases.filter(l => l.status === 'active');
    const tenantIds = new Set<string>();
    for (const lease of activeLeases) {
      if (propertyId && lease.propertyId !== propertyId) continue;
      // Count tenants on this lease.
      for (const t of tenants) {
        // Tenant is on this lease via lease_tenants. In the loaded data, each
        // tenant belongs to its active lease via the leaseId field.
        if ((t as unknown as { leaseId?: string }).leaseId === lease.id) {
          tenantIds.add(t.id);
        }
      }
    }
    return tenantIds.size;
  }, [leases, tenants, propertyId]);

  const handleSend = async () => {
    if (!title.trim() || !body.trim()) {
      showToast('Title and message are required.', 'error');
      return;
    }
    setSending(true);
    try {
      const result = await announcementsApi.create({
        title: title.trim(),
        body: body.trim(),
        propertyId: propertyId || undefined,
        expiresAt: expiresAt || undefined,
      });
      showToast(
        `Announcement sent to ${result.recipientCount} tenant${result.recipientCount === 1 ? '' : 's'}.`,
        'success',
      );
      setTitle('');
      setBody('');
      setPropertyId('');
      setExpiresAt('');
      fetchList();
    } catch (err) {
      showToast((err as Error).message || 'Could not send announcement.', 'error');
    } finally {
      setSending(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await announcementsApi.remove(id);
      setList(prev => prev.filter(a => a.id !== id));
      showToast('Announcement deleted.', 'success');
    } catch {
      showToast('Could not delete the announcement.', 'error');
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Megaphone className="h-7 w-7 text-primary" />
        <h1 className="text-2xl font-bold">Announcements</h1>
      </div>

      {/* Compose card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Send className="h-4 w-4" />
            New Announcement
          </CardTitle>
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
            <div className="flex-1">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-1 block">
                <Building2 className="inline h-3.5 w-3.5 mr-1 -mt-0.5" />
                Property
              </label>
              <select
                value={propertyId}
                onChange={e => setPropertyId(e.target.value)}
                className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary"
              >
                <option value="">All Properties</option>
                {properties.map(p => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
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

          {/* Recipient count + Send */}
          <div className="flex items-center justify-between pt-2 border-t border-gray-100 dark:border-gray-700">
            <span className="text-sm text-gray-500 dark:text-gray-400 flex items-center gap-1.5">
              <Users className="h-4 w-4" />
              Will be sent to <strong>{recipientCount}</strong> active tenant{recipientCount === 1 ? '' : 's'}
            </span>
            <Button onClick={handleSend} disabled={sending || !title.trim() || !body.trim()}>
              {sending ? 'Sending...' : 'Send Announcement'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Past announcements */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Past Announcements</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">Loading...</p>
          ) : list.length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-gray-400">No announcements have been sent yet.</p>
          ) : (
            <div className="space-y-3">
              {list.map(a => {
                const expired = a.expires_at && a.expires_at < new Date().toISOString().slice(0, 10);
                return (
                  <div
                    key={a.id}
                    className={`border rounded-lg p-4 ${expired ? 'opacity-60' : ''} border-gray-200 dark:border-gray-700`}
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-semibold text-sm">{a.title}</span>
                          {a.property_name ? (
                            <Badge variant="secondary">{a.property_name}</Badge>
                          ) : (
                            <Badge variant="default">All Properties</Badge>
                          )}
                          {expired && <Badge variant="warning">Expired</Badge>}
                        </div>
                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 whitespace-pre-line">{a.body}</p>
                        <div className="text-xs text-gray-400 dark:text-gray-500 mt-2 flex items-center gap-3 flex-wrap">
                          <span>Sent {relativeTime(a.created_at)}</span>
                          {a.author_name && <span>by {a.author_name}</span>}
                          {a.expires_at && <span>Expires {a.expires_at}</span>}
                        </div>
                      </div>
                      <button
                        onClick={() => handleDelete(a.id)}
                        className="text-gray-400 hover:text-red-500 transition-colors p-1"
                        title="Delete announcement"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
