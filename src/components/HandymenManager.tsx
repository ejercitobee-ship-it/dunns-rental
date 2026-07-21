import { useEffect, useState } from 'react';
import { Plus, Hammer, Mail, Phone, Edit2, UserX, RotateCcw } from 'lucide-react';
import { Card, CardContent } from './ui/Card';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import { Modal } from './ui/Modal';
import { useToast } from '../context/ToastContext';
import { handymenApi, type HandymanInput } from '../lib/api';
import { MAINTENANCE_TRADES, type Handyman } from '../types';
import { tradeLabel } from '../lib/maintenance';

const inputClass =
  'w-full px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25';

const emptyForm: HandymanInput = { name: '', phone: '', email: '', trades: [], isActive: true };

/** The admin roster of handymen: add, edit trades, invite/resend, deactivate. */
export function HandymenManager() {
  const { showToast } = useToast();
  const [handymen, setHandymen] = useState<Handyman[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<HandymanInput>(emptyForm);
  const [saving, setSaving] = useState(false);

  const load = () => {
    handymenApi
      .getAll()
      .then((list) => setHandymen(list))
      .catch(() => showToast('Could not load handymen', 'error'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openNew = () => {
    setForm(emptyForm);
    setEditingId(null);
    setModalOpen(true);
  };

  const openEdit = (h: Handyman) => {
    setForm({ name: h.name, phone: h.phone || '', email: h.email || '', trades: h.trades, isActive: h.isActive });
    setEditingId(h.id);
    setModalOpen(true);
  };

  const toggleTrade = (trade: string) =>
    setForm((f) => ({
      ...f,
      trades: f.trades.includes(trade) ? f.trades.filter((t) => t !== trade) : [...f.trades, trade],
    }));

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || saving) return;
    setSaving(true);
    const done = () => setSaving(false);
    if (editingId) {
      handymenApi
        .update(editingId, form)
        .then(() => {
          showToast('Handyman updated', 'success');
          setModalOpen(false);
          load();
        })
        .catch((err) => showToast((err as Error).message || 'Could not save', 'error'))
        .finally(done);
    } else {
      handymenApi
        .create(form)
        .then((res) => {
          if (form.email && res.emailSent) showToast('Handyman added, invite emailed', 'success');
          else if (form.email && res.inviteUrl) showToast('Handyman added. Mail is off, copy the invite link from the row.', 'info');
          else showToast('Handyman added', 'success');
          setModalOpen(false);
          load();
        })
        .catch((err) => showToast((err as Error).message || 'Could not add handyman', 'error'))
        .finally(done);
    }
  };

  const handleInvite = (h: Handyman) => {
    handymenApi
      .invite(h.id)
      .then((res) => {
        if (res.emailSent) showToast(h.hasLogin ? 'Invite resent' : 'Invite emailed', 'success');
        else if (res.inviteUrl) showToast('Mail is off. Invite link: ' + res.inviteUrl, 'info');
        else showToast('Invite sent', 'success');
        load();
      })
      .catch((err) => showToast((err as Error).message || 'Could not send invite', 'error'));
  };

  const handleDeactivate = (h: Handyman) => {
    if (h.isActive) {
      if (!confirm(`Deactivate ${h.name}? They stop receiving jobs but their history stays.`)) return;
      handymenApi
        .deactivate(h.id)
        .then(() => {
          showToast('Handyman deactivated', 'success');
          load();
        })
        .catch((err) => showToast((err as Error).message || 'Could not deactivate', 'error'));
    } else {
      handymenApi
        .update(h.id, { name: h.name, phone: h.phone, email: h.email, trades: h.trades, isActive: true })
        .then(() => {
          showToast('Handyman reactivated', 'success');
          load();
        })
        .catch((err) => showToast((err as Error).message || 'Could not reactivate', 'error'));
    }
  };

  return (
    <Card>
      <CardContent className="p-5 sm:p-6">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-2">
            <Hammer className="h-4 w-4 text-faint" />
            <h2 className="font-medium text-ink">Handymen</h2>
            <span className="text-xs text-muted">roster who can take jobs</span>
          </div>
          <Button variant="secondary" onClick={openNew}>
            <Plus className="h-4 w-4 mr-1.5" />
            Add handyman
          </Button>
        </div>

        {loading ? (
          <p className="text-sm text-muted py-4">Loading.</p>
        ) : handymen.length === 0 ? (
          <p className="text-sm text-muted py-4">No handymen yet. Add one so tenant requests can be assigned.</p>
        ) : (
          <div className="divide-y divide-line">
            {handymen.map((h) => (
              <div key={h.id} className="py-3 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`font-medium ${h.isActive ? 'text-ink' : 'text-faint line-through'}`}>{h.name}</span>
                    {!h.isActive && <Badge variant="secondary">Inactive</Badge>}
                    {h.hasLogin ? (
                      <Badge variant="success">Has login</Badge>
                    ) : (
                      <Badge variant="warning">No login</Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted flex-wrap">
                    {h.phone && (
                      <span className="inline-flex items-center gap-1"><Phone className="h-3 w-3" />{h.phone}</span>
                    )}
                    {h.email && (
                      <span className="inline-flex items-center gap-1"><Mail className="h-3 w-3" />{h.email}</span>
                    )}
                  </div>
                  <div className="flex items-center gap-1 mt-1.5 flex-wrap">
                    {h.trades.length === 0 ? (
                      <span className="text-xs text-faint">No trades set</span>
                    ) : (
                      h.trades.map((t) => (
                        <span key={t} className="text-[11px] px-1.5 py-0.5 rounded bg-primary-soft text-primary">
                          {tradeLabel(t)}
                        </span>
                      ))
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  {h.email && (
                    <button
                      onClick={() => handleInvite(h)}
                      className="text-xs font-medium text-primary hover:text-primary-hover px-2 py-1 rounded-md hover:bg-primary-soft transition-colors"
                      title={h.hasLogin ? 'Resend invite' : 'Send invite'}
                    >
                      {h.hasLogin ? 'Resend invite' : 'Invite'}
                    </button>
                  )}
                  <button
                    onClick={() => openEdit(h)}
                    className="p-1.5 text-faint hover:text-ink hover:bg-black/[0.05] rounded-md transition-colors"
                    title="Edit"
                  >
                    <Edit2 className="h-4 w-4" />
                  </button>
                  <button
                    onClick={() => handleDeactivate(h)}
                    className="p-1.5 text-faint hover:text-ink hover:bg-black/[0.05] rounded-md transition-colors"
                    title={h.isActive ? 'Deactivate' : 'Reactivate'}
                  >
                    {h.isActive ? <UserX className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Modal
        isOpen={isModalOpen}
        onClose={() => setModalOpen(false)}
        title={editingId ? 'Edit handyman' : 'Add handyman'}
      >
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">Name *</label>
            <input
              type="text"
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Mike Reyes"
              className={inputClass}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">Phone</label>
              <input
                type="tel"
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                className={inputClass}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">Email</label>
              <input
                type="email"
                value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })}
                placeholder="For their portal login"
                className={inputClass}
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">Trades</label>
            <p className="text-xs text-muted mb-2">They are offered jobs matching these. A General handyman is offered everything.</p>
            <div className="flex flex-wrap gap-2">
              {MAINTENANCE_TRADES.map((t) => {
                const on = form.trades.includes(t);
                return (
                  <button
                    type="button"
                    key={t}
                    onClick={() => toggleTrade(t)}
                    className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${
                      on ? 'border-primary bg-primary-soft text-primary' : 'border-line text-muted hover:text-ink'
                    }`}
                  >
                    {tradeLabel(t)}
                  </button>
                );
              })}
            </div>
          </div>
          {editingId && (
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={form.isActive !== false}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              />
              Active (receives jobs)
            </label>
          )}
          {!editingId && form.email && (
            <p className="text-xs text-muted">An invite to set their password will be emailed when you save.</p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setModalOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? 'Saving.' : editingId ? 'Save' : 'Add handyman'}
            </Button>
          </div>
        </form>
      </Modal>
    </Card>
  );
}
