import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Mail, Phone, FileText, Upload, Download, Trash2, UserCheck, User, Link2, Copy } from 'lucide-react';
import { Card, CardContent } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Modal } from '../components/ui/Modal';
import { ConfirmDialog } from '../components/ui/ConfirmDialog';
import { PROSPECTIVE_STATUS } from '../lib/prospectiveStatus';
import { useApp } from '../context/AppContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { prospectiveApi, documentsApi, type ProspectiveTenant, type ProspectiveStatus } from '../lib/api';
import type { AppDocument } from '../lib/api';
import { formatCurrency } from '../lib/utils';

const inputClass = 'w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary/25';
const STAGE_STATUSES: ProspectiveStatus[] = ['applied', 'docs_sent', 'signed', 'rejected'];

export function ProspectiveTenantDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { hasPermission } = useAuth();
  const { units, properties, getUnitLease, refreshData } = useApp();
  const canEdit = hasPermission('tenants_edit');
  const canConvert = hasPermission('tenants_create');
  const canDelete = hasPermission('tenants_delete');

  const [applicant, setApplicant] = useState<ProspectiveTenant | null>(null);
  const [docs, setDocs] = useState<AppDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const uploadingRef = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [toDelete, setToDelete] = useState(false);
  const [signLink, setSignLink] = useState<string | null>(null);
  const [emailedTo, setEmailedTo] = useState<string | null>(null);
  const [linkBusy, setLinkBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [converting, setConverting] = useState(false);
  const [conv, setConv] = useState({ unitId: '', monthlyRent: '', moveInFee: '', moveInFeePaid: true, startDate: '', endDate: '' });

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    Promise.all([prospectiveApi.get(id), prospectiveApi.documents(id)])
      .then(([a, d]) => { if (!cancelled) { setApplicant(a); setDocs(d); } })
      .catch(err => { if (!cancelled) setError((err as Error).message || 'Could not load this applicant.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  const availableUnits = units
    .filter(u => !getUnitLease(u.id))
    .map(u => ({ unit: u, property: properties.find(p => p.id === u.propertyId) }));

  const setStatus = async (status: ProspectiveStatus) => {
    if (!applicant || !id) return;
    try {
      const updated = await prospectiveApi.update(id, {
        firstName: applicant.firstName, lastName: applicant.lastName,
        email: applicant.email, phone: applicant.phone, notes: applicant.notes, status,
      });
      setApplicant(updated);
    } catch (err) {
      showToast((err as Error).message || 'Could not update the status.', 'error');
    }
  };

  const getSignLink = async () => {
    if (!id || linkBusy) return;
    setLinkBusy(true);
    try {
      const { token, emailedTo: sentTo } = await prospectiveApi.signLink(id);
      setSignLink(`${window.location.origin}/sign/${token}`);
      setEmailedTo(sentTo ?? null);
      if (sentTo) showToast(`Signing link emailed to ${sentTo}.`, 'success');
      // Sending the link moves an untouched applicant to "docs sent".
      setApplicant(prev => (prev && prev.status === 'applied' ? { ...prev, status: 'docs_sent' } : prev));
    } catch (err) {
      showToast((err as Error).message || 'Could not create the link.', 'error');
    } finally {
      setLinkBusy(false);
    }
  };

  const copyLink = async () => {
    if (!signLink) return;
    try {
      await navigator.clipboard.writeText(signLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch { /* clipboard blocked; the link is shown to copy by hand */ }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !id || uploadingRef.current) return;
    uploadingRef.current = true;
    setUploading(true);
    try {
      await prospectiveApi.uploadDocument(id, file);
      setDocs(await prospectiveApi.documents(id));
      showToast('File uploaded.', 'success');
    } catch (err) {
      showToast((err as Error).message || 'Upload failed.', 'error');
    } finally {
      uploadingRef.current = false;
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const openConvert = () => {
    setConv({ unitId: '', monthlyRent: '', moveInFee: '', moveInFeePaid: true, startDate: '', endDate: '' });
    setConvertOpen(true);
  };

  const handleUnit = (unitId: string) => {
    const u = units.find(x => x.id === unitId);
    setConv(prev => ({ ...prev, unitId, monthlyRent: prev.monthlyRent || (u ? String(u.monthlyRent) : '') }));
  };

  const handleConvert = async () => {
    if (!id || converting) return;
    const rent = Number(conv.monthlyRent);
    if (!conv.unitId) { showToast('Choose a unit.', 'error'); return; }
    if (!Number.isFinite(rent) || rent <= 0) { showToast('Enter the monthly rent.', 'error'); return; }
    setConverting(true);
    try {
      const { tenantId } = await prospectiveApi.convert(id, {
        unitId: conv.unitId,
        monthlyRent: rent,
        moveInFee: conv.moveInFee ? Number(conv.moveInFee) : undefined,
        moveInFeePaid: conv.moveInFeePaid,
        startDate: conv.startDate || undefined,
        endDate: conv.endDate || undefined,
      });
      // The tenant + lease were created server-side, so refresh the app data
      // before navigating, otherwise the new profile loads before the tenant is
      // in memory and briefly shows a "not found" screen.
      await refreshData();
      showToast('Applicant is now a tenant.', 'success');
      navigate(`/tenants/${tenantId}`);
    } catch (err) {
      showToast((err as Error).message || 'Could not convert this applicant.', 'error');
      setConverting(false);
    }
  };

  const handleDelete = async () => {
    if (!id) return;
    try {
      await prospectiveApi.remove(id);
      showToast('Applicant removed.', 'success');
      navigate('/tenants');
    } catch (err) {
      showToast((err as Error).message || 'Could not remove this applicant.', 'error');
    }
  };

  if (loading) return <p className="text-sm text-muted">Loading applicant.</p>;
  if (error || !applicant) {
    return (
      <div className="space-y-4">
        <Link to="/tenants" className="text-sm text-primary hover:underline inline-flex items-center gap-1"><ArrowLeft className="h-4 w-4" /> Back to Tenants</Link>
        <Card><CardContent className="p-6"><p className="text-sm text-danger">{error || 'Applicant not found.'}</p></CardContent></Card>
      </div>
    );
  }

  const s = PROSPECTIVE_STATUS[applicant.status];
  const isConverted = applicant.status === 'converted';

  return (
    <div className="space-y-6">
      <Link to="/tenants" className="text-sm text-primary hover:underline inline-flex items-center gap-1"><ArrowLeft className="h-4 w-4" /> Back to Tenants</Link>

      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className="w-12 h-12 rounded-full bg-primary-soft text-primary grid place-items-center flex-shrink-0">
            <User className="h-6 w-6" />
          </span>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-[24px] sm:text-[28px] font-medium text-ink leading-tight">{applicant.firstName} {applicant.lastName}</h1>
              <Badge variant={s.variant}>{s.label}</Badge>
            </div>
            <p className="text-sm text-muted mt-0.5">Prospective tenant</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canConvert && !isConverted && (
            <Button onClick={openConvert}><UserCheck className="h-4 w-4 mr-2" /> Convert to Tenant</Button>
          )}
          {isConverted && applicant.convertedTenantId && (
            <Button variant="outline" onClick={() => navigate(`/tenants/${applicant.convertedTenantId}`)}>View tenant</Button>
          )}
          {canDelete && (
            <Button variant="destructive" onClick={() => setToDelete(true)}><Trash2 className="h-4 w-4 mr-2" /> Delete</Button>
          )}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Contact */}
        <Card>
          <CardContent className="p-5 space-y-3">
            <h3 className="font-semibold text-ink flex items-center gap-2"><User className="h-4 w-4 text-faint" /> Contact</h3>
            <div className="space-y-2 text-sm">
              <div className="flex items-center gap-2 text-muted"><Mail className="h-3.5 w-3.5 text-faint" /><span className="truncate">{applicant.email || '—'}</span></div>
              <div className="flex items-center gap-2 text-muted"><Phone className="h-3.5 w-3.5 text-faint" /><span>{applicant.phone || '—'}</span></div>
            </div>
            {applicant.notes && (
              <div className="pt-2 border-t border-line"><p className="eyebrow mb-1">Notes</p><p className="text-sm text-muted whitespace-pre-wrap">{applicant.notes}</p></div>
            )}
          </CardContent>
        </Card>

        {/* Status stage */}
        <Card className="lg:col-span-2">
          <CardContent className="p-5 space-y-3">
            <h3 className="font-semibold text-ink">Application stage</h3>
            {isConverted ? (
              <p className="text-sm text-muted">This applicant has been converted to an active tenant.</p>
            ) : (
              <>
                <p className="text-sm text-muted">Move them along as their application progresses.</p>
                <div className="flex flex-wrap gap-2">
                  {STAGE_STATUSES.map(st => {
                    const cfg = PROSPECTIVE_STATUS[st];
                    const on = applicant.status === st;
                    return (
                      <button
                        key={st}
                        type="button"
                        disabled={!canEdit || on}
                        onClick={() => setStatus(st)}
                        className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${on ? 'border-primary bg-primary-soft text-primary font-medium' : 'border-line text-muted hover:text-ink hover:border-line-strong disabled:opacity-50'}`}
                      >
                        {cfg.label}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Documents */}
      <Card>
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-ink flex items-center gap-2"><FileText className="h-4 w-4 text-faint" /> Files to sign</h3>
            {canEdit && (
              <>
                <input ref={fileRef} type="file" className="hidden" onChange={handleUpload} />
                <Button variant="outline" size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
                  <Upload className="h-4 w-4 mr-2" /> {uploading ? 'Uploading...' : 'Upload'}
                </Button>
              </>
            )}
          </div>
          <p className="text-xs text-muted">Application, lease, and any documents for this applicant. On conversion these carry over to their tenant record.</p>

          {canEdit && !isConverted && (
            <div className="rounded-xl border border-line bg-canvas p-3.5 space-y-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 text-sm font-medium text-ink">
                  <Link2 className="h-4 w-4 text-primary" /> Secure signing link
                </div>
                <Button size="sm" variant="outline" disabled={linkBusy} onClick={getSignLink}>
                  {linkBusy ? 'Creating...' : signLink ? 'New link' : 'Get link'}
                </Button>
              </div>
              <p className="text-xs text-muted">
                Getting the link emails it to the applicant automatically (when they have an email on file). They can view and upload their signed documents with no login. You can also copy it to send by text.
              </p>
              {signLink && (
                <>
                  <p className="text-xs font-medium">
                    {emailedTo
                      ? <span className="text-primary">Emailed to {emailedTo}.</span>
                      : <span className="text-warning">No email on file, copy the link and send it manually.</span>}
                  </p>
                  <div className="flex items-center gap-2">
                    <input readOnly value={signLink} className="flex-1 min-w-0 rounded-lg border border-line bg-surface px-3 py-2 text-xs text-ink" onFocus={e => e.currentTarget.select()} />
                    <Button size="sm" variant="outline" onClick={copyLink} className="flex-shrink-0">
                      <Copy className="h-4 w-4 mr-1.5" /> {copied ? 'Copied' : 'Copy'}
                    </Button>
                  </div>
                </>
              )}
            </div>
          )}

          {docs.length === 0 ? (
            <p className="text-sm text-muted">No files yet. Upload their application or lease.</p>
          ) : (
            <div className="space-y-2">
              {docs.map(doc => (
                <div key={doc.id} className="flex items-center gap-3 px-3 py-2.5 border border-line rounded-xl">
                  <span className="w-9 h-9 rounded-lg bg-primary-soft text-primary grid place-items-center flex-shrink-0"><FileText className="h-[18px] w-[18px]" /></span>
                  <span className="text-sm text-ink truncate flex-1 min-w-0">{doc.name}</span>
                  <a href={documentsApi.downloadUrl(doc.id)} target="_blank" rel="noopener noreferrer" className="p-2 text-faint hover:text-primary hover:bg-primary-soft rounded-lg transition-colors flex-shrink-0" title="Download"><Download className="h-4 w-4" /></a>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Convert modal */}
      <Modal isOpen={convertOpen} onClose={() => setConvertOpen(false)} title="Convert to Tenant" size="md">
        <div className="space-y-4">
          <p className="text-sm text-muted">This creates an active tenant and their lease. Set where they are moving in and the terms.</p>
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">Unit *</label>
            <select className={inputClass} value={conv.unitId} onChange={e => handleUnit(e.target.value)}>
              <option value="">Select a unit</option>
              {availableUnits.map(({ unit, property }) => (
                <option key={unit.id} value={unit.id}>
                  {property?.name ? `${property.name}, ` : ''}Unit {unit.unitNumber} ({formatCurrency(unit.monthlyRent)})
                </option>
              ))}
            </select>
            {availableUnits.length === 0 && <p className="text-xs text-muted mt-1">No vacant units available.</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">Monthly rent *</label>
              <input type="number" min={0} step="0.01" className={inputClass} value={conv.monthlyRent} onChange={e => setConv({ ...conv, monthlyRent: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">Move-in fee</label>
              <input type="number" min={0} step="0.01" className={inputClass} value={conv.moveInFee} onChange={e => setConv({ ...conv, moveInFee: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">Lease start</label>
              <input type="date" className={inputClass} value={conv.startDate} onChange={e => setConv({ ...conv, startDate: e.target.value })} />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1.5">Lease expires</label>
              <input type="date" min={conv.startDate || undefined} className={inputClass} value={conv.endDate} onChange={e => setConv({ ...conv, endDate: e.target.value })} />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={conv.moveInFeePaid} onChange={e => setConv({ ...conv, moveInFeePaid: e.target.checked })} className="w-4 h-4 accent-[#24503f]" />
            Move-in fee already paid
          </label>
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="outline" onClick={() => setConvertOpen(false)}>Cancel</Button>
            <Button onClick={handleConvert} disabled={converting}>{converting ? 'Converting...' : 'Convert to Tenant'}</Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        isOpen={toDelete}
        onClose={() => setToDelete(false)}
        onConfirm={handleDelete}
        title="Delete applicant"
        message="This removes the prospective tenant and their file list. This cannot be undone."
        confirmText="Delete"
      />
    </div>
  );
}
