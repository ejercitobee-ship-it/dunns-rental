import { useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import { FileText, Upload, CheckCircle2, ExternalLink, Check } from 'lucide-react';
import logo from '../assets/mh-dunn-logo.png';
import { Button } from '../components/ui/Button';
import { useToast } from '../context/ToastContext';
import { signingApi, type SigningInfo } from '../lib/api';

export function SigningPage() {
  const { token } = useParams<{ token: string }>();
  const { showToast } = useToast();
  const [info, setInfo] = useState<SigningInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const uploadingRef = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  const load = () => {
    if (!token) return;
    signingApi.info(token)
      .then(setInfo)
      .catch((err) => setError((err as Error).message || 'This link is not valid.'))
      .finally(() => setLoading(false));
  };
  useEffect(load, [token]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !token || uploadingRef.current) return;
    uploadingRef.current = true;
    setUploading(true);
    try {
      await signingApi.upload(token, file);
      showToast('File uploaded.', 'success');
      setInfo(await signingApi.info(token));
    } catch (err) {
      showToast((err as Error).message || 'Upload failed.', 'error');
    } finally {
      uploadingRef.current = false;
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const submit = async () => {
    if (!token || submitting) return;
    setSubmitting(true);
    try {
      await signingApi.complete(token);
      setDone(true);
    } catch (err) {
      showToast((err as Error).message || 'Could not submit.', 'error');
      setSubmitting(false);
    }
  };

  const shell = (children: React.ReactNode) => (
    <div className="min-h-screen bg-canvas flex flex-col items-center px-4 py-10">
      <img src={logo} alt="MH Dunn Property" className="h-12 w-auto mb-8" />
      <div className="w-full max-w-lg">{children}</div>
    </div>
  );

  if (loading) return shell(<p className="text-center text-sm text-muted">Loading your documents.</p>);

  if (error) {
    return shell(
      <div className="rounded-2xl border border-line bg-surface p-8 text-center shadow-sm">
        <h1 className="font-display text-xl text-ink">This link is not valid</h1>
        <p className="text-sm text-muted mt-2">{error} Please contact the office for a new link.</p>
      </div>
    );
  }

  const alreadyDone = done || info?.status === 'signed' || info?.status === 'converted';
  if (alreadyDone) {
    return shell(
      <div className="rounded-2xl border border-line bg-surface p-8 text-center shadow-sm">
        <CheckCircle2 className="h-12 w-12 text-primary mx-auto mb-3" />
        <h1 className="font-display text-2xl text-ink">Thank you{info?.firstName ? `, ${info.firstName}` : ''}</h1>
        <p className="text-sm text-muted mt-2">
          We have received your documents. Our office will review them and be in touch about your move-in.
        </p>
      </div>
    );
  }

  return shell(
    <div className="space-y-5">
      <div className="text-center">
        <p className="eyebrow">MH Dunn Property</p>
        <h1 className="font-display text-2xl text-ink mt-1">Documents for {info?.firstName}</h1>
        <p className="text-sm text-muted mt-2">
          Please review each document below, sign it, and upload your signed copy. When everything is uploaded, tap Submit.
        </p>
      </div>

      <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm space-y-3">
        <h2 className="font-semibold text-ink text-sm">Documents to sign</h2>
        {info && info.documents.length > 0 ? (
          <div className="space-y-2">
            {info.documents.map((d) => (
              <a
                key={d.id}
                href={signingApi.documentUrl(token!, d.id)}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-3 px-3 py-2.5 border border-line rounded-xl hover:border-primary/40 transition-colors"
              >
                <span className="w-9 h-9 rounded-lg bg-primary-soft text-primary grid place-items-center flex-shrink-0">
                  <FileText className="h-[18px] w-[18px]" />
                </span>
                <span className="text-sm text-ink truncate flex-1 min-w-0">{d.name}</span>
                <ExternalLink className="h-4 w-4 text-faint flex-shrink-0" />
              </a>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">No documents have been added yet. Please check back, or contact the office.</p>
        )}
      </div>

      <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm space-y-3">
        <h2 className="font-semibold text-ink text-sm">Upload your signed copies</h2>
        <p className="text-xs text-muted">Sign the documents above, then upload a photo or PDF of each signed copy. You can upload more than one.</p>
        <input ref={fileRef} type="file" className="hidden" onChange={handleUpload} />
        <Button variant="outline" className="w-full" disabled={uploading} onClick={() => fileRef.current?.click()}>
          <Upload className="h-4 w-4 mr-2" /> {uploading ? 'Uploading...' : 'Upload a signed document'}
        </Button>

        {info && info.uploaded.length > 0 && (
          <div className="pt-2 border-t border-line space-y-2">
            <p className="text-xs font-medium text-ink">You have uploaded {info.uploaded.length} {info.uploaded.length === 1 ? 'document' : 'documents'}</p>
            {info.uploaded.map((d) => (
              <div key={d.id} className="flex items-center gap-2.5 text-sm text-muted">
                <span className="w-6 h-6 rounded-full bg-primary-soft text-primary grid place-items-center flex-shrink-0">
                  <Check className="h-3.5 w-3.5" />
                </span>
                <a href={signingApi.documentUrl(token!, d.id)} target="_blank" rel="noopener noreferrer" className="truncate hover:text-ink">
                  {d.name.replace(/^Signed - /, '')}
                </a>
              </div>
            ))}
          </div>
        )}
      </div>

      <Button className="w-full py-3" disabled={submitting} onClick={submit}>
        {submitting ? 'Submitting...' : 'Submit signed documents'}
      </Button>
      <p className="text-center text-xs text-faint">By submitting, you confirm these documents are signed and correct.</p>
    </div>
  );
}
