import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Pencil, Trash2, Megaphone } from 'lucide-react';
import { Card, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { SelectInput } from '../components/ui/FormField';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { useToast } from '../context/ToastContext';
import { emailCampaignsApi, type EmailCampaign } from '../lib/api';
import { categoryLabel } from '../lib/emailVariables';

const STATUS_STYLE: Record<string, string> = {
  draft: 'bg-surface-2 text-muted',
  scheduled: 'bg-info/15 text-info',
  processing: 'bg-warning/15 text-warning',
  sent: 'bg-success/15 text-success',
  partially_delivered: 'bg-warning/15 text-warning',
  failed: 'bg-danger/15 text-danger',
  paused: 'bg-surface-2 text-muted',
  canceled: 'bg-surface-2 text-faint',
};

function statusLabel(s: string) {
  return s.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function EmailCampaigns() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const [campaigns, setCampaigns] = useState<EmailCampaign[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [toDelete, setToDelete] = useState<EmailCampaign | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { setCampaigns(await emailCampaignsApi.list()); }
    catch (err) { showToast((err as Error).message || 'Failed to load campaigns', 'error'); }
    finally { setLoading(false); }
  }, [showToast]);
  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return campaigns.filter((c) => {
      if (statusFilter && c.status !== statusFilter) return false;
      if (!q) return true;
      return c.name.toLowerCase().includes(q) || c.subject.toLowerCase().includes(q);
    });
  }, [campaigns, search, statusFilter]);

  async function handleDelete() {
    if (!toDelete) return;
    const c = toDelete; setToDelete(null);
    try { await emailCampaignsApi.remove(c.id); showToast('Campaign deleted', 'success'); await load(); }
    catch (err) { showToast((err as Error).message || 'Failed to delete', 'error'); }
  }

  return (
    <div className="max-w-5xl">
      <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Email &amp; Reminders</div>
      <div className="flex items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="text-3xl font-bold text-ink mb-1">Campaigns</h1>
          <p className="text-sm text-muted">Compose, segment, preview, and test email campaigns to tenants.</p>
        </div>
        <Button onClick={() => navigate('/email/campaigns/new')}><Plus className="w-4 h-4 mr-1.5" /> New Campaign</Button>
      </div>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-faint absolute left-3 top-1/2 -translate-y-1/2" />
          <input className="w-full pl-9 pr-3 py-2 rounded-lg border border-line bg-surface text-sm" placeholder="Search campaigns…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <SelectInput value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          {['draft', 'scheduled', 'sent', 'partially_delivered', 'failed', 'canceled'].map((s) => <option key={s} value={s}>{statusLabel(s)}</option>)}
        </SelectInput>
      </div>

      {loading ? (
        <p className="text-sm text-muted">Loading campaigns…</p>
      ) : filtered.length === 0 ? (
        <Card><CardContent className="p-8 text-center text-muted">
          <Megaphone className="w-8 h-8 mx-auto mb-2 text-faint" />
          No campaigns yet. Create one to get started.
        </CardContent></Card>
      ) : (
        <Card><CardContent className="p-0 divide-y divide-line">
          {filtered.map((c) => (
            <div key={c.id} className="flex items-center gap-3 p-4">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-ink truncate">{c.name}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${STATUS_STYLE[c.status] || 'bg-surface-2 text-muted'}`}>{statusLabel(c.status)}</span>
                </div>
                <div className="text-xs text-muted mt-0.5 truncate">
                  {categoryLabel(c.category)} &middot; {c.subject || 'No subject'} &middot; {c.recipientCount} recipient{c.recipientCount === 1 ? '' : 's'}
                  {c.sentAt ? (
                    <> &middot; <span className="text-success">{c.sentCount} sent</span>{c.failedCount ? <>, <span className="text-danger">{c.failedCount} failed</span></> : null}</>
                  ) : null}
                </div>
              </div>
              {c.status === 'draft' || c.status === 'scheduled' ? (
                <Button variant="ghost" size="sm" onClick={() => navigate(`/email/campaigns/${c.id}`)}><Pencil className="w-3.5 h-3.5 mr-1" /> Edit</Button>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => navigate(`/email/campaigns/${c.id}`)}>View</Button>
              )}
              <Button variant="ghost" size="sm" className="text-danger" onClick={() => setToDelete(c)}><Trash2 className="w-3.5 h-3.5" /></Button>
            </div>
          ))}
        </CardContent></Card>
      )}

      <ConfirmDialog isOpen={!!toDelete} onClose={() => setToDelete(null)} onConfirm={handleDelete} title="Delete campaign?" message={`Delete "${toDelete?.name}"? This cannot be undone.`} confirmText="Delete" />
    </div>
  );
}
