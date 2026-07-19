import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, CardContent } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Avatar } from '../../components/ui/Avatar';
import { portalApi, photoApi, type RealtorMe } from '../../lib/api';
import { resizeImage } from '../../lib/image';
import { useToast } from '../../context/ToastContext';

export function RealtorDashboard() {
  const [data, setData] = useState<RealtorMe | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [photoBusy, setPhotoBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { showToast } = useToast();

  useEffect(() => {
    let cancelled = false;
    portalApi
      .realtorMe()
      .then((d) => { if (!cancelled) { setData(d); setPhotoUrl(d.profile.photoUrl ?? null); } })
      .catch((err) => { if (!cancelled) setError((err as Error).message || 'Could not load your dashboard.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
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

  if (loading) return <p className="text-sm text-muted">Loading your dashboard.</p>;
  if (error || !data) {
    return (
      <Card>
        <CardContent className="p-6">
          <p className="text-sm text-muted">{error || 'Could not load your dashboard.'}</p>
        </CardContent>
      </Card>
    );
  }

  const { profile, tenantsPlaced, tenantsInWindow } = data;

  return (
    <div className="space-y-6">
      <div>
        <p className="eyebrow">Realtor</p>
        <h1 className="font-display text-2xl text-ink mt-1">Dashboard</h1>
      </div>

      <Card>
        <CardContent className="p-5 space-y-4">
          <h2 className="font-display text-lg font-medium text-ink">Your profile</h2>
          <div className="flex items-center gap-4">
            <Avatar
              photoUrl={photoUrl}
              initials={`${profile.name?.[0] ?? profile.email[0] ?? ''}`}
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
          <div className="space-y-1">
            <p className="text-ink font-medium">{profile.name || 'Realtor'}</p>
            <p className="text-muted text-sm">{profile.email}</p>
            {profile.phone && <p className="text-muted text-sm">{profile.phone}</p>}
          </div>
          <p className="text-xs text-muted">To update these details, please contact the office.</p>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="p-5">
            <p className="eyebrow">Tenants placed</p>
            <p className="font-display text-3xl text-ink mt-1 tnum">{tenantsPlaced}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5">
            <p className="eyebrow">In your active window</p>
            <p className="font-display text-3xl text-ink mt-1 tnum">{tenantsInWindow}</p>
          </CardContent>
        </Card>
      </div>

      <div>
        <Link to="/portal/tenants">
          <Button variant="outline">View my tenants</Button>
        </Link>
      </div>
    </div>
  );
}
