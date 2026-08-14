import { useEffect, useRef, useState } from 'react';
import { FileText, Upload } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { portalApi, type AppDocument } from '../../lib/api';
import { useToast } from '../../context/ToastContext';

// This app has had a React #310 white screen from a useMemo called after an
// early return, so every hook below runs unconditionally before the
// loading/error branches at the bottom of the component.

export function TenantDocuments() {
  const { showToast } = useToast();
  const [docs, setDocs] = useState<AppDocument[]>([]);
  const [tenantId, setTenantId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  // Synchronous re-entry guard: `uploading` (state) only disables the Upload
  // button after a render, so a fast double file-pick could fire the upload
  // twice before that render lands. The ref blocks the second call immediately.
  const uploadingRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let cancelled = false;
    // me() gives the tenant their own tenant.id, which is the tenantId the
    // upload has to send; documents() lists what's already on file.
    Promise.all([portalApi.me(), portalApi.documents()])
      .then(([me, list]) => {
        if (cancelled) return;
        setTenantId(me.tenant.id);
        setDocs(list);
      })
      .catch((err) => {
        if (cancelled) return;
        setError((err as Error).message || 'Could not load your documents.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !tenantId || uploadingRef.current) return;
    uploadingRef.current = true;
    setUploading(true);
    try {
      await portalApi.uploadDocument(file, tenantId);
      setDocs(await portalApi.documents());
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
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-3 animate-in fade-in duration-200">
        <FileText className="h-8 w-8 text-faint animate-pulse" />
        <p className="text-sm text-muted">Loading your documents</p>
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-sm text-danger">{error}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Your files</p>
        <h1 className="font-display text-[26px] text-ink mt-1">Documents</h1>
        <p className="text-sm text-muted mt-1">
          Documents you upload can be seen by the realtor who placed you, for the first 30 days of your tenancy.
        </p>
      </div>

      <Card>
        <CardContent className="p-5 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold text-ink flex items-center gap-2">
              <FileText className="h-4 w-4 text-faint" /> Your documents
            </h3>
            <input ref={fileInputRef} type="file" className="hidden" onChange={handleUpload} disabled={!tenantId} />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={uploading || !tenantId}
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-4 w-4 mr-2" />
              {uploading ? 'Uploading...' : 'Upload'}
            </Button>
          </div>

          {docs.length === 0 ? (
            <p className="text-sm text-muted">No documents yet. Upload a lease, ID, or receipt.</p>
          ) : (
            <div className="space-y-2">
              {docs.map((doc) => (
                <a
                  key={doc.id}
                  href={portalApi.downloadUrl(doc.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-3 px-3 py-2.5 border border-line rounded-xl hover:border-primary/30 hover:bg-primary-soft/30 transition-colors"
                >
                  <span className="w-9 h-9 rounded-lg bg-primary-soft text-primary grid place-items-center flex-shrink-0">
                    <FileText className="h-[18px] w-[18px]" strokeWidth={1.8} />
                  </span>
                  <span className="text-sm text-ink truncate flex-1 min-w-0">{doc.name}</span>
                </a>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
