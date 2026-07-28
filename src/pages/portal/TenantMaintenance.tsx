import { useEffect, useState } from 'react';
import { Wrench, Plus, Trash2, Calendar, User, Phone } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { portalApi, type PortalMaintenanceRequest } from '../../lib/api';
import { useToast } from '../../context/ToastContext';
import { MAINTENANCE_TRADES } from '../../types';
import { STATUS_BADGE, STATUS_LABEL, tradeLabel } from '../../lib/maintenance';
import { formatDate } from '../../lib/utils';
import { resizeImage } from '../../lib/image';

const inputClass =
  'w-full px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25';

interface Window {
  date: string;
  start: string;
  end: string;
}

/** 'YYYY-MM-DD HH:MM' -> 'Jul 22, 2026 at 9:00 AM' ish, without a UTC Date. */
function formatSchedule(s?: string): string {
  if (!s) return '';
  const [datePart, timePart] = s.split(/[ T]/);
  const day = formatDate(datePart);
  return timePart ? `${day} at ${timePart}` : day;
}

function windowText(w: Window): string {
  const day = w.date ? formatDate(w.date) : '';
  const time = [w.start, w.end].filter(Boolean).join(' to ');
  return [day, time].filter(Boolean).join(', ');
}

export function TenantMaintenance() {
  const { showToast } = useToast();
  const [requests, setRequests] = useState<PortalMaintenanceRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState('general');
  const [description, setDescription] = useState('');
  const [windows, setWindows] = useState<Window[]>([]);
  const [photoFile, setPhotoFile] = useState<File | null>(null);

  const load = () => {
    portalApi
      .maintenance()
      .then((list) => setRequests(list))
      .catch((err) => setError((err as Error).message || 'Could not load your requests.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();

  }, []);

  const resetForm = () => {
    setTitle('');
    setCategory('general');
    setDescription('');
    setWindows([]);
    setPhotoFile(null);
  };

  const openForm = () => {
    resetForm();
    setOpen(true);
  };

  const addWindow = () => setWindows((w) => [...w, { date: '', start: '', end: '' }]);
  const removeWindow = (i: number) => setWindows((w) => w.filter((_, idx) => idx !== i));
  const setWindow = (i: number, patch: Partial<Window>) =>
    setWindows((w) => w.map((win, idx) => (idx === i ? { ...win, ...patch } : win)));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || saving) return;
    setSaving(true);
    portalApi
      .createMaintenance({
        title: title.trim(),
        category,
        description: description.trim() || undefined,
        availability: windows.filter((w) => w.date),
      })
      .then(async (created) => {
        // The request exists now; the photo is a best-effort extra so a Drive
        // hiccup never loses the request.
        if (photoFile) {
          try {
            const blob = await resizeImage(photoFile, 1280);
            await portalApi.uploadMaintenancePhoto(created.id, blob);
          } catch (err) {
            showToast((err as Error).message || 'Request sent, but the photo could not attach.', 'info');
          }
        }
        showToast('Request sent. We will be in touch to schedule.', 'success');
        setOpen(false);
        resetForm();
        load();
      })
      .catch((err) => showToast((err as Error).message || 'Could not send your request', 'error'))
      .finally(() => setSaving(false));
  };

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="eyebrow">Maintenance</p>
          <h1 className="font-display text-[26px] text-ink mt-1">Repairs</h1>
          <p className="text-sm text-muted mt-1">Report an issue and tell us when you are home. We will schedule a visit.</p>
        </div>
        <Button onClick={openForm} className="flex-shrink-0">
          <Plus className="h-4 w-4 mr-1.5" />
          <span className="hidden sm:inline">Report an issue</span>
          <span className="sm:hidden">Report</span>
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-muted">Loading your requests.</p>
      ) : error ? (
        <Card><CardContent className="py-8 text-center text-sm text-danger">{error}</CardContent></Card>
      ) : requests.length === 0 ? (
        <Card>
          <CardContent className="py-14 text-center">
            <div className="w-12 h-12 rounded-full bg-primary-soft flex items-center justify-center mx-auto mb-4">
              <Wrench className="h-6 w-6 text-primary" />
            </div>
            <h2 className="font-display text-lg font-medium text-ink">No requests yet</h2>
            <p className="text-sm text-muted mt-1 max-w-sm mx-auto">
              When something needs fixing, report it here and we will take care of it.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {requests.map((r) => (
            <Card key={r.id}>
              <CardContent className="p-5">
                <div className="flex items-start gap-3">
                  <span className="w-10 h-10 rounded-xl bg-primary-soft text-primary grid place-items-center flex-shrink-0">
                    <Wrench className="h-5 w-5" strokeWidth={1.8} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-semibold text-ink">{r.title}</span>
                      <Badge variant={STATUS_BADGE[r.status]}>{STATUS_LABEL[r.status]}</Badge>
                    </div>
                    <p className="text-xs text-muted mt-1">
                      {tradeLabel(r.category)} · reported {r.reportedDate ? formatDate(r.reportedDate) : '—'}
                    </p>
                    {r.description && <p className="text-sm text-muted mt-2">{r.description}</p>}
                  </div>
                  {r.photoUrl && (
                    <a href={r.photoUrl} target="_blank" rel="noreferrer" className="flex-shrink-0">
                      <img src={r.photoUrl} alt="Reported issue" className="w-16 h-16 rounded-lg object-cover border border-line" />
                    </a>
                  )}
                </div>

                {(r.scheduledFor || r.handymanName) && (
                  <div className="mt-3 pt-3 border-t border-line space-y-1.5">
                    {r.scheduledFor && (
                      <p className="text-sm text-ink inline-flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-primary" />
                        Scheduled for {formatSchedule(r.scheduledFor)}
                      </p>
                    )}
                    {r.handymanName && (
                      <p className="text-sm text-muted inline-flex items-center gap-3 flex-wrap">
                        <span className="inline-flex items-center gap-1.5"><User className="h-4 w-4" />{r.handymanName}</span>
                        {r.handymanPhone && (
                          <span className="inline-flex items-center gap-1.5"><Phone className="h-4 w-4" />{r.handymanPhone}</span>
                        )}
                      </p>
                    )}
                  </div>
                )}

                {r.availability && r.availability.length > 0 && !r.scheduledFor && (
                  <p className="text-xs text-faint mt-2">
                    You are available: {r.availability.map(windowText).join('; ')}
                  </p>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Modal isOpen={isOpen} onClose={() => setOpen(false)} title="Report an issue" size="lg">
        <form onSubmit={submit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">What is the issue? *</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Leaking kitchen faucet"
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">Type</label>
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputClass}>
              {MAINTENANCE_TRADES.map((t) => (
                <option key={t} value={t}>{tradeLabel(t)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">Details</label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Anything that helps us come prepared."
              className={inputClass}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">Photo (optional)</label>
            <input
              type="file"
              accept="image/*"
              onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm text-muted file:mr-3 file:py-2 file:px-3 file:rounded-lg file:border file:border-line file:bg-surface file:text-ink file:text-sm file:font-medium hover:file:bg-black/[0.02]"
            />
            <p className="text-xs text-muted mt-1">A picture of the problem helps us come prepared.</p>
          </div>
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-sm font-medium text-ink">When are you home?</label>
              <button type="button" onClick={addWindow} className="text-xs font-medium text-primary hover:text-primary-hover">
                + Add a time
              </button>
            </div>
            {windows.length === 0 ? (
              <p className="text-xs text-muted">Optional, but it helps us schedule faster.</p>
            ) : (
              <div className="space-y-2">
                {windows.map((w, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <input
                      type="date"
                      value={w.date}
                      onChange={(e) => setWindow(i, { date: e.target.value })}
                      className={inputClass}
                    />
                    <input
                      type="time"
                      value={w.start}
                      onChange={(e) => setWindow(i, { start: e.target.value })}
                      className={inputClass}
                      aria-label="From"
                    />
                    <input
                      type="time"
                      value={w.end}
                      onChange={(e) => setWindow(i, { end: e.target.value })}
                      className={inputClass}
                      aria-label="To"
                    />
                    <button
                      type="button"
                      onClick={() => removeWindow(i)}
                      className="p-1.5 text-faint hover:text-danger flex-shrink-0"
                      aria-label="Remove time"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={saving}>{saving ? 'Sending.' : 'Send request'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
