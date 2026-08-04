import { useEffect, useState } from 'react';
import { Wrench, MapPin, User, Phone, Calendar, Clock, CheckCircle2, Plus } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { Modal } from '../../components/ui/Modal';
import { portalApi, type PortalMaintenanceRequest, type HandymanJobsResponse } from '../../lib/api';
import { useToast } from '../../context/ToastContext';
import { STATUS_BADGE, STATUS_LABEL, tradeLabel, approvalBadge } from '../../lib/maintenance';
import { formatDate, todayLocalDate } from '../../lib/utils';
import { MAINTENANCE_TRADES } from '../../types';
import { HandymanProfileCard } from '../../components/HandymanProfileCard';

type Places = { properties: { id: string; name: string; address: string }[]; units: { id: string; propertyId: string; unitNumber: string }[] };
const emptyReport = { propertyId: '', unitId: '', title: '', description: '', category: 'general', cost: '', date: todayLocalDate() };

function formatSchedule(s?: string): string {
  if (!s) return '';
  const [datePart, timePart] = s.split(/[ T]/);
  const day = formatDate(datePart);
  return timePart ? `${day} at ${timePart}` : day;
}

function windowText(w: { date: string; start: string; end: string }): string {
  const day = w.date ? formatDate(w.date) : '';
  const time = [w.start, w.end].filter(Boolean).join(' to ');
  return [day, time].filter(Boolean).join(', ');
}

/** A single job card. Available jobs get a Claim button; owned jobs get the
 * confirm-time / start / complete controls for their current status. */
function JobCard({
  job,
  mine,
  busy,
  onClaim,
  onSchedule,
  onStart,
  onComplete,
}: {
  job: PortalMaintenanceRequest;
  mine: boolean;
  busy: boolean;
  onClaim: () => void;
  onSchedule: (when: string) => void;
  onStart: () => void;
  onComplete: () => void;
}) {
  const [when, setWhen] = useState('');
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium text-ink">{job.title}</span>
              {(() => {
                const ab = approvalBadge(job);
                return ab
                  ? <Badge variant={ab.variant}>{ab.label}</Badge>
                  : <Badge variant={STATUS_BADGE[job.status]}>{STATUS_LABEL[job.status]}</Badge>;
              })()}
            </div>
            <p className="text-xs text-muted mt-1">
              {tradeLabel(job.category)} · reported {job.reportedDate ? formatDate(job.reportedDate) : '—'}
            </p>
          </div>
        </div>

        {job.description && <p className="text-sm text-muted mt-2">{job.description}</p>}

        {job.photoUrl && (
          <a href={job.photoUrl} target="_blank" rel="noreferrer" className="inline-block mt-2">
            <img src={job.photoUrl} alt="Reported issue" className="w-24 h-24 rounded-lg object-cover border border-line" />
          </a>
        )}

        <div className="mt-3 space-y-1.5 text-sm">
          {job.locationLabel && (
            <p className="text-ink inline-flex items-center gap-2"><MapPin className="h-4 w-4 text-faint" />{job.locationLabel}</p>
          )}
          {mine && job.tenantName && (
            <p className="text-muted inline-flex items-center gap-3 flex-wrap">
              <span className="inline-flex items-center gap-1.5"><User className="h-4 w-4" />{job.tenantName}</span>
              {job.tenantPhone && (
                <span className="inline-flex items-center gap-1.5"><Phone className="h-4 w-4" />{job.tenantPhone}</span>
              )}
            </p>
          )}
          {job.scheduledFor && (
            <p className="text-ink inline-flex items-center gap-2"><Calendar className="h-4 w-4 text-primary" />Scheduled for {formatSchedule(job.scheduledFor)}</p>
          )}
        </div>

        {job.availability && job.availability.length > 0 && (
          <div className="mt-3 text-xs text-muted">
            <span className="inline-flex items-center gap-1.5 text-faint"><Clock className="h-3.5 w-3.5" />Tenant is available</span>
            <ul className="mt-1 list-disc pl-5 space-y-0.5">
              {job.availability.map((w, i) => <li key={i}>{windowText(w)}</li>)}
            </ul>
          </div>
        )}

        {/* Actions */}
        <div className="mt-4">
          {!mine && (
            <Button onClick={onClaim} disabled={busy}>Claim this job</Button>
          )}

          {mine && job.status === 'assigned' && (
            <div className="flex flex-col sm:flex-row sm:items-end gap-2">
              <div>
                <label className="block text-xs font-medium text-muted mb-1">Confirm a time</label>
                <input
                  type="datetime-local"
                  value={when}
                  onChange={(e) => setWhen(e.target.value)}
                  className="px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
                />
              </div>
              <Button onClick={() => onSchedule(when)} disabled={busy || !when}>Confirm time</Button>
              <Button variant="secondary" onClick={onStart} disabled={busy}>Start now</Button>
            </div>
          )}

          {mine && job.status === 'scheduled' && (
            <div className="flex flex-wrap items-center gap-2">
              <Button onClick={onStart} disabled={busy}>Start work</Button>
              <input
                type="datetime-local"
                value={when}
                onChange={(e) => setWhen(e.target.value)}
                className="px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
                aria-label="Change time"
              />
              <Button variant="secondary" onClick={() => onSchedule(when)} disabled={busy || !when}>Change time</Button>
            </div>
          )}

          {mine && job.status === 'in_progress' && (
            <Button onClick={onComplete} disabled={busy}>
              <CheckCircle2 className="h-4 w-4 mr-1.5" />Mark complete
            </Button>
          )}

          {mine && (job.status === 'completed' || job.status === 'paid') && (
            <p className="text-sm text-muted">
              {job.status === 'paid'
                ? 'Paid. Thank you.'
                : job.needsApproval
                  ? 'Reported. Waiting for the office to approve.'
                  : job.approvedAt
                    ? 'Approved. Awaiting payment.'
                    : 'Completed. Awaiting payment.'}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

export function HandymanJobs() {
  const { showToast } = useToast();
  const [data, setData] = useState<HandymanJobsResponse>({ available: [], mine: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [tab, setTab] = useState<'available' | 'in_progress' | 'completed'>('available');
  const [reportOpen, setReportOpen] = useState(false);
  const [reportBusy, setReportBusy] = useState(false);
  const [places, setPlaces] = useState<Places>({ properties: [], units: [] });
  const [report, setReport] = useState(emptyReport);

  const load = () => {
    portalApi
      .handymanJobs()
      .then((d) => setData(d))
      .catch((err) => setError((err as Error).message || 'Could not load your jobs.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
    portalApi.handymanPlaces().then(setPlaces).catch(() => setPlaces({ properties: [], units: [] }));
  }, []);

  const submitReport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (reportBusy) return;
    const cost = Number(report.cost);
    if (!report.title.trim()) { showToast('Add a short title for the work.', 'error'); return; }
    if (!report.propertyId) { showToast('Choose the property.', 'error'); return; }
    if (!Number.isFinite(cost) || cost < 0) { showToast('Enter a valid cost.', 'error'); return; }
    setReportBusy(true);
    try {
      await portalApi.reportWork({
        propertyId: report.propertyId,
        unitId: report.unitId || undefined,
        title: report.title.trim(),
        description: report.description.trim() || undefined,
        category: report.category,
        cost,
        date: report.date,
      });
      showToast('Work logged. The office will review and approve it.', 'success');
      setReportOpen(false);
      setReport(emptyReport);
      setTab('completed');
      load();
    } catch (err) {
      showToast((err as Error).message || 'Could not log the work.', 'error');
    } finally {
      setReportBusy(false);
    }
  };

  const run = (id: string, action: Promise<unknown>, ok: string) => {
    setBusyId(id);
    action
      .then(() => {
        showToast(ok, 'success');
        load();
      })
      .catch((err) => showToast((err as Error).message || 'Could not complete that', 'error'))
      .finally(() => setBusyId(null));
  };

  if (loading) return (
    <div className="flex flex-col items-center justify-center py-20 gap-3 animate-in fade-in duration-200">
      <Wrench className="h-8 w-8 text-faint animate-pulse" />
      <p className="text-sm text-muted">Loading your jobs</p>
    </div>
  );
  if (error) return <Card><CardContent className="py-8 text-center text-sm text-danger">{error}</CardContent></Card>;

  // Their own jobs split into work they are still on versus work they finished.
  const inProgress = data.mine.filter(
    (j) => j.status === 'assigned' || j.status === 'scheduled' || j.status === 'in_progress'
  );
  const completed = data.mine.filter((j) => j.status === 'completed' || j.status === 'paid');

  const TABS = [
    { key: 'available' as const, label: 'Available', jobs: data.available, mine: false, empty: 'No open jobs in your trades right now. Check back soon.' },
    { key: 'in_progress' as const, label: 'In progress', jobs: inProgress, mine: true, empty: 'No jobs in progress. Claim one from Available to get started.' },
    { key: 'completed' as const, label: 'Completed', jobs: completed, mine: true, empty: 'No completed jobs yet.' },
  ];
  const active = TABS.find((t) => t.key === tab) ?? TABS[0];

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Maintenance</p>
          <h1 className="font-display text-[26px] text-ink mt-1">Jobs</h1>
          <p className="text-sm text-muted mt-1">Claim available jobs in your trades, confirm a time, and update progress.</p>
        </div>
        <Button onClick={() => { setReport(emptyReport); setReportOpen(true); }} className="flex-shrink-0">
          <Plus className="h-4 w-4 mr-1.5" /> Report work
        </Button>
      </div>

      <HandymanProfileCard />

      {/* Tabs: the open pool, the work they are on, and what they have finished. */}
      <div className="flex gap-1 border-b border-line">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 transition-colors ${
              tab === t.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted hover:text-ink'
            }`}
          >
            {t.label}
            <span className="ml-1.5 text-xs text-faint tnum">{t.jobs.length}</span>
          </button>
        ))}
      </div>

      {active.jobs.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center">
            <div className="w-11 h-11 rounded-full bg-primary-soft flex items-center justify-center mx-auto mb-3">
              <Wrench className="h-5 w-5 text-primary" />
            </div>
            <p className="text-sm text-muted">{active.empty}</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {active.jobs.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              mine={active.mine}
              busy={busyId === job.id}
              onClaim={() => run(job.id, portalApi.claimJob(job.id), 'Job claimed. It is now in In progress.')}
              onSchedule={(when) => run(job.id, portalApi.scheduleJob(job.id, when), 'Time confirmed, the tenant was notified')}
              onStart={() => run(job.id, portalApi.jobStatus(job.id, 'in_progress'), 'Marked in progress')}
              onComplete={() => run(job.id, portalApi.jobStatus(job.id, 'completed'), 'Marked complete')}
            />
          ))}
        </div>
      )}

      {/* Report work I did (for jobs the tenant never filed). Goes to the office
          for approval before it counts as an expense. */}
      <Modal isOpen={reportOpen} onClose={() => setReportOpen(false)} title="Report work I did" size="md">
        <form onSubmit={submitReport} className="space-y-4">
          <p className="text-sm text-muted">
            Log work you did so the office can approve it. It does not count as an expense until they approve the cost.
          </p>
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">What did you do? *</label>
            <input
              type="text"
              value={report.title}
              onChange={(e) => setReport({ ...report, title: e.target.value })}
              placeholder="e.g. Replaced kitchen faucet"
              className="w-full px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">Property *</label>
              <select
                value={report.propertyId}
                onChange={(e) => setReport({ ...report, propertyId: e.target.value, unitId: '' })}
                className="w-full px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
              >
                <option value="">Select property</option>
                {places.properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">Unit</label>
              <select
                value={report.unitId}
                onChange={(e) => setReport({ ...report, unitId: e.target.value })}
                className="w-full px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
              >
                <option value="">Whole property</option>
                {places.units.filter(u => u.propertyId === report.propertyId).map(u => (
                  <option key={u.id} value={u.id}>Unit {u.unitNumber}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">Trade</label>
              <select
                value={report.category}
                onChange={(e) => setReport({ ...report, category: e.target.value })}
                className="w-full px-3 py-2 border border-line rounded-lg bg-surface capitalize focus:outline-none focus:ring-2 focus:ring-primary/25"
              >
                {MAINTENANCE_TRADES.map(t => <option key={t} value={t} className="capitalize">{tradeLabel(t)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">Date done</label>
              <input
                type="date"
                value={report.date}
                onChange={(e) => setReport({ ...report, date: e.target.value })}
                className="w-full px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">Your cost *</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted">$</span>
              <input
                type="number"
                min="0"
                step="0.01"
                value={report.cost}
                onChange={(e) => setReport({ ...report, cost: e.target.value })}
                placeholder="0.00"
                className="w-full pl-8 pr-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
              />
            </div>
            <p className="text-xs text-muted mt-1">The office reviews and approves the final amount.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">Notes (optional)</label>
            <textarea
              rows={2}
              value={report.description}
              onChange={(e) => setReport({ ...report, description: e.target.value })}
              placeholder="Anything the office should know"
              className="w-full px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25"
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => setReportOpen(false)}>Cancel</Button>
            <Button type="submit" disabled={reportBusy}>{reportBusy ? 'Submitting...' : 'Submit for approval'}</Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
