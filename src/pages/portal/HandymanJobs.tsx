import { useEffect, useState } from 'react';
import { Wrench, MapPin, User, Phone, Calendar, Clock, CheckCircle2 } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Badge } from '../../components/ui/Badge';
import { portalApi, type PortalMaintenanceRequest, type HandymanJobsResponse } from '../../lib/api';
import { useToast } from '../../context/ToastContext';
import { STATUS_BADGE, STATUS_LABEL, tradeLabel } from '../../lib/maintenance';
import { formatDate } from '../../lib/utils';
import { HandymanProfileCard } from '../../components/HandymanProfileCard';

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
              <Badge variant={STATUS_BADGE[job.status]}>{STATUS_LABEL[job.status]}</Badge>
            </div>
            <p className="text-xs text-muted mt-1">
              {tradeLabel(job.category)} · reported {job.reportedDate ? formatDate(job.reportedDate) : '—'}
            </p>
          </div>
        </div>

        {job.description && <p className="text-sm text-muted mt-2">{job.description}</p>}

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
            <p className="text-sm text-muted">{job.status === 'paid' ? 'Paid. Thank you.' : 'Completed. Awaiting payment.'}</p>
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

  const load = () => {
    portalApi
      .handymanJobs()
      .then((d) => setData(d))
      .catch((err) => setError((err as Error).message || 'Could not load your jobs.'))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

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

  if (loading) return <p className="text-sm text-muted">Loading your jobs.</p>;
  if (error) return <Card><CardContent className="py-8 text-center text-sm text-danger">{error}</CardContent></Card>;

  return (
    <div className="space-y-8">
      <div>
        <p className="eyebrow">Maintenance</p>
        <h1 className="font-display text-2xl text-ink mt-1">Jobs</h1>
        <p className="text-sm text-muted mt-1">Claim available jobs in your trades, confirm a time, and update progress.</p>
      </div>

      <HandymanProfileCard />

      <section>
        <h2 className="font-medium text-ink mb-3">My jobs</h2>
        {data.mine.length === 0 ? (
          <Card><CardContent className="py-8 text-center text-sm text-muted">You have no active jobs right now.</CardContent></Card>
        ) : (
          <div className="space-y-3">
            {data.mine.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                mine
                busy={busyId === job.id}
                onClaim={() => {}}
                onSchedule={(when) => run(job.id, portalApi.scheduleJob(job.id, when), 'Time confirmed, the tenant was notified')}
                onStart={() => run(job.id, portalApi.jobStatus(job.id, 'in_progress'), 'Marked in progress')}
                onComplete={() => run(job.id, portalApi.jobStatus(job.id, 'completed'), 'Marked complete')}
              />
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="font-medium text-ink mb-3">Available jobs</h2>
        {data.available.length === 0 ? (
          <Card>
            <CardContent className="py-10 text-center">
              <div className="w-11 h-11 rounded-full bg-primary-soft flex items-center justify-center mx-auto mb-3">
                <Wrench className="h-5 w-5 text-primary" />
              </div>
              <p className="text-sm text-muted">No open jobs in your trades right now. Check back soon.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-3">
            {data.available.map((job) => (
              <JobCard
                key={job.id}
                job={job}
                mine={false}
                busy={busyId === job.id}
                onClaim={() => run(job.id, portalApi.claimJob(job.id), 'Job claimed. It is now in My jobs.')}
                onSchedule={() => {}}
                onStart={() => {}}
                onComplete={() => {}}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
