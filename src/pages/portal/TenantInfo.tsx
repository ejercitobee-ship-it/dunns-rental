import { useEffect, useRef, useState } from 'react';
import { User, ShieldAlert } from 'lucide-react';
import { Card, CardContent } from '../../components/ui/Card';
import { Avatar } from '../../components/ui/Avatar';
import { portalApi, photoApi } from '../../lib/api';
import { resizeImage } from '../../lib/image';
import { useToast } from '../../context/ToastContext';

// This app has had a React #310 white screen from a useMemo called after an
// early return, so every hook below runs unconditionally before the
// loading/error branches at the bottom of the component.

interface InfoForm {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  emergencyName: string;
  emergencyPhone: string;
  emergencyRelationship: string;
}

const EMPTY_FORM: InfoForm = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  emergencyName: '',
  emergencyPhone: '',
  emergencyRelationship: '',
};

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-sm font-medium text-ink mb-1.5">{label}</p>
      <p className="text-sm text-muted">{value || 'Not on file'}</p>
    </div>
  );
}

export function TenantInfo() {
  const [form, setForm] = useState<InfoForm>(EMPTY_FORM);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { showToast } = useToast();

  useEffect(() => {
    let cancelled = false;
    portalApi
      .me()
      .then((res) => {
        if (cancelled) return;
        const t = res.tenant;
        setForm({
          firstName: t.firstName || '',
          lastName: t.lastName || '',
          email: t.email || '',
          phone: t.phone || '',
          emergencyName: t.emergencyContact?.name || '',
          emergencyPhone: t.emergencyContact?.phone || '',
          emergencyRelationship: t.emergencyContact?.relationship || '',
        });
        setPhotoUrl(t.photoUrl ?? null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError((err as Error).message || 'Could not load your information.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const handlePhotoPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || photoBusy) return;
    setPhotoBusy(true);
    try {
      const blob = await resizeImage(file);
      const { photoUrl: newUrl } = await photoApi.uploadSelf(blob);
      setPhotoUrl(`${newUrl}?t=${Date.now()}`);
      showToast('Photo updated.', 'success');
    } catch (err) {
      showToast((err as Error).message || 'Could not update your photo.', 'error');
    } finally {
      setPhotoBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handlePhotoRemove = async () => {
    if (photoBusy) return;
    setPhotoBusy(true);
    try {
      await photoApi.removeSelf();
      setPhotoUrl(null);
      showToast('Photo removed.', 'success');
    } catch (err) {
      showToast((err as Error).message || 'Could not remove your photo.', 'error');
    } finally {
      setPhotoBusy(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-muted">Loading your information.</p>;
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
    <div className="space-y-6 max-w-2xl">
      <div>
        <p className="eyebrow">Your details</p>
        <h1 className="font-display text-2xl text-ink mt-1">My information</h1>
        <p className="text-sm text-muted mt-1">
          This is the information we have on file for you.
        </p>
      </div>

      <div className="flex items-center gap-4">
        <Avatar
          photoUrl={photoUrl}
          initials={`${form.firstName?.[0] ?? ''}${form.lastName?.[0] ?? ''}`}
          className="w-16 h-16 flex-shrink-0"
        />
        <div className="flex items-center gap-3">
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handlePhotoPick}
          />
          <button
            type="button"
            disabled={photoBusy}
            onClick={() => fileInputRef.current?.click()}
            className="text-sm font-medium text-primary hover:text-primary-hover disabled:opacity-50"
          >
            {photoUrl ? 'Change photo' : 'Add photo'}
          </button>
          {photoUrl && (
            <button
              type="button"
              disabled={photoBusy}
              onClick={handlePhotoRemove}
              className="text-sm font-medium text-muted hover:text-danger disabled:opacity-50"
            >
              Remove
            </button>
          )}
        </div>
      </div>

      <div className="space-y-6">
        <Card>
          <CardContent className="p-5 space-y-4">
            <p className="text-sm text-muted">To update your details, please contact us.</p>
            <h3 className="font-semibold text-ink flex items-center gap-2">
              <User className="h-4 w-4 text-faint" /> Contact
            </h3>
            <div className="grid grid-cols-2 gap-4">
              <Field label="First name" value={form.firstName} />
              <Field label="Last name" value={form.lastName} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Email" value={form.email} />
              <Field label="Phone" value={form.phone} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-5 space-y-4">
            <h3 className="font-semibold text-ink flex items-center gap-2">
              <ShieldAlert className="h-4 w-4 text-faint" /> Emergency contact
            </h3>
            <Field label="Name" value={form.emergencyName} />
            <div className="grid grid-cols-2 gap-4">
              <Field label="Phone" value={form.emergencyPhone} />
              <Field label="Relationship" value={form.emergencyRelationship} />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
