import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, User, Mail, Phone, ShieldAlert, FileText, Upload, Download } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { portalApi, type AppDocument, type PortalPerson } from '../../lib/api';
import { useToast } from '../../context/ToastContext';

// This app has had a React #310 white screen from a hook called after an
// early return, so every hook below runs unconditionally before the
// loading/error branches at the bottom of the component.
//
// READ ONLY, on purpose: a realtor may view this tenant's details and upload
// a document, and nothing else. There is no edit control anywhere on this
// page, and none should be added.

export function RealtorTenantDetail() {
  const { id } = useParams<{ id: string }>();
  const { showToast } = useToast();
  const [tenant, setTenant] = useState<PortalPerson | null>(null);
  const [docs, setDocs] = useState<AppDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  // Synchronous re-entry guard: `uploading` (state) only disables the Upload
  // button after a render, so a fast double file-pick could fire the upload
  // twice before that render lands. The ref blocks the second call immediately.
  const uploadingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    Promise.all([portalApi.realtorTenant(id), portalApi.documents(id)])
      .then(([t, list]) => {
        if (cancelled) return;
        setTenant(t);
        setDocs(list);
      })
      .catch((err) => {
        if (cancelled) return;
        setError((err as Error).message || 'Could not load this tenant.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !id || uploadingRef.current) return;
    uploadingRef.current = true;
    setUploading(true);
    try {
      await portalApi.uploadDocument(file, id);
      setDocs(await portalApi.documents(id));
      showToast('Document uploaded.', 'success');
    } catch (err) {
      showToast((err as Error).message || 'Upload failed.', 'error');
    } finally {
      uploadingRef.current = false;
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  if (loading) {
    return <p className="text-sm text-muted">Loading this tenant.</p>;
  }

  if (error || !tenant) {
    return (
      <div className="space-y-6">
        <Link
          to="/portal"
          className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:text-primary-hover"
        >
          <ArrowLeft className="h-4 w-4" /> Back to my tenants
        </Link>
        <Card>
          <CardContent className="p-6">
            <p className="text-sm text-danger">{error || 'Tenant not found.'}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Link
        to="/portal"
        className="inline-flex items-center gap-2 text-sm font-medium text-primary hover:text-primary-hover"
      >
        <ArrowLeft className="h-4 w-4" /> Back to my tenants
      </Link>

      <div className="flex items-center gap-4">
        <div className="w-14 h-14 rounded-full bg-primary-soft flex items-center justify-center flex-shrink-0">
          <span className="text-xl font-semibold text-primary">
            {tenant.firstName[0]}
            {tenant.lastName[0]}
          </span>
        </div>
        <div>
          <h1 className="font-display text-[26px] sm:text-[30px] font-medium text-ink leading-tight">
            {tenant.firstName} {tenant.lastName}
          </h1>
          <p className="text-sm text-muted mt-0.5">View only. Contact the property manager to change any details.</p>
        </div>
      </div>

      <Card>
        <CardContent className="p-5 space-y-4">
          <h3 className="font-semibold text-ink flex items-center gap-2">
            <User className="h-4 w-4 text-faint" /> Contact
          </h3>
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2 text-muted">
              <Mail className="h-3.5 w-3.5 text-faint" />
              <span className="truncate">{tenant.email || '—'}</span>
            </div>
            <div className="flex items-center gap-2 text-muted">
              <Phone className="h-3.5 w-3.5 text-faint" />
              <span>{tenant.phone || '—'}</span>
            </div>
          </div>

          {tenant.emergencyContact && (
            <div className="pt-2 border-t border-line">
              <p className="eyebrow mb-2 flex items-center gap-1.5">
                <ShieldAlert className="h-3.5 w-3.5" /> Emergency contact
              </p>
              <div className="text-sm space-y-1">
                <p className="text-ink font-medium">{tenant.emergencyContact.name}</p>
                <p className="text-muted">{tenant.emergencyContact.phone}</p>
                <p className="text-muted capitalize">{tenant.emergencyContact.relationship}</p>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-ink flex items-center gap-2">
              <FileText className="h-4 w-4 text-faint" /> Documents
            </h3>
            <input ref={fileInputRef} type="file" className="hidden" onChange={handleUpload} />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploading}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-4 w-4 mr-2" />
              {uploading ? 'Uploading...' : 'Upload'}
            </Button>
          </div>
          {docs.length === 0 ? (
            <p className="text-sm text-muted">No documents yet.</p>
          ) : (
            <div className="space-y-1.5">
              {docs.map((doc) => (
                <div key={doc.id} className="flex items-center justify-between px-3 py-2 border border-line rounded-lg">
                  <div className="flex items-center gap-2 min-w-0">
                    <FileText className="h-4 w-4 text-faint flex-shrink-0" />
                    <span className="text-sm text-ink truncate">{doc.name}</span>
                  </div>
                  <a
                    href={portalApi.downloadUrl(doc.id)}
                    className="p-1.5 text-faint hover:text-primary hover:bg-primary-soft rounded-md transition-colors flex-shrink-0"
                    title="Download"
                  >
                    <Download className="h-4 w-4" />
                  </a>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
