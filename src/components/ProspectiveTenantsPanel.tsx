import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { UserPlus, ChevronRight, ClipboardList } from 'lucide-react';
import { Card, CardContent } from './ui/Card';
import { Button } from './ui/Button';
import { Badge } from './ui/Badge';
import { useToast } from '../context/ToastContext';
import { prospectiveApi, type ProspectiveTenant } from '../lib/api';
import { PROSPECTIVE_STATUS } from '../lib/prospectiveStatus';

const inputClass = 'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25';

export function ProspectiveTenantsPanel({ canCreate }: { canCreate: boolean }) {
  const { showToast } = useToast();
  const [list, setList] = useState<ProspectiveTenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '', notes: '' });
  const [saving, setSaving] = useState(false);

  const load = () => prospectiveApi.list().then(setList).catch(() => {}).finally(() => setLoading(false));
  useEffect(() => { load(); }, []);

  const submit = async () => {
    if (!form.firstName.trim() || !form.lastName.trim() || saving) return;
    setSaving(true);
    try {
      await prospectiveApi.create({
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        notes: form.notes.trim() || undefined,
      });
      setForm({ firstName: '', lastName: '', email: '', phone: '', notes: '' });
      setShowForm(false);
      load();
      showToast('Applicant added.', 'success');
    } catch (err) {
      showToast((err as Error).message || 'Could not add applicant.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-muted max-w-xl">
          Applicants who have not moved in yet. Upload their application and lease to sign, then convert them to a tenant when everything is signed. They get no portal login until then.
        </p>
        {canCreate && (
          <Button onClick={() => setShowForm(v => !v)} className="flex-shrink-0">
            <UserPlus className="h-4 w-4 mr-2" />
            Add applicant
          </Button>
        )}
      </div>

      {showForm && canCreate && (
        <Card>
          <CardContent className="p-5 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <input className={inputClass} placeholder="First name *" value={form.firstName} onChange={e => setForm({ ...form, firstName: e.target.value })} />
              <input className={inputClass} placeholder="Last name *" value={form.lastName} onChange={e => setForm({ ...form, lastName: e.target.value })} />
              <input className={inputClass} placeholder="Email" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
              <input className={inputClass} placeholder="Phone" value={form.phone} onChange={e => setForm({ ...form, phone: e.target.value })} />
            </div>
            <textarea className={inputClass} rows={2} placeholder="Notes (optional)" value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} />
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setShowForm(false)}>Cancel</Button>
              <Button disabled={!form.firstName.trim() || !form.lastName.trim() || saving} onClick={submit}>
                {saving ? 'Adding...' : 'Add applicant'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {loading ? (
        <p className="text-sm text-muted">Loading applicants.</p>
      ) : list.length === 0 ? (
        <Card>
          <CardContent className="p-10 text-center">
            <ClipboardList className="h-9 w-9 mx-auto text-faint mb-3" />
            <h3 className="font-medium text-ink">No applicants yet</h3>
            <p className="text-sm text-muted mt-1">Add a prospective tenant to start their application.</p>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            <div className="divide-y divide-line">
              {list.map(p => {
                const s = PROSPECTIVE_STATUS[p.status];
                return (
                  <Link key={p.id} to={`/prospective/${p.id}`} className="flex items-center gap-3 px-5 py-4 hover:bg-black/[0.02] transition-colors">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-ink truncate">{p.firstName} {p.lastName}</p>
                        <Badge variant={s.variant}>{s.label}</Badge>
                      </div>
                      <p className="text-xs text-muted truncate mt-0.5">
                        {[p.email, p.phone].filter(Boolean).join(' · ') || 'No contact details'}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-faint flex-shrink-0" />
                  </Link>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
