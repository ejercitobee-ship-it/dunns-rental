import { useEffect, useRef, useState } from 'react';
import { Card, CardContent } from './ui/Card';
import { Button } from './ui/Button';
import { Avatar } from './ui/Avatar';
import { portalApi, photoApi } from '../lib/api';
import { resizeImage } from '../lib/image';
import { useToast } from '../context/ToastContext';
import { tradeLabel } from '../lib/maintenance';
import type { Handyman } from '../types';

const inputClass =
  'w-full px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25';

type FormState = { name: string; phone: string; address: string; city: string; state: string; zipCode: string };

function toForm(h: Handyman): FormState {
  return {
    name: h.name || '',
    phone: h.phone || '',
    address: h.address || '',
    city: h.city || '',
    state: h.state || '',
    zipCode: h.zipCode || '',
  };
}

/** The handyman's own profile: photo, read-only email + trades, and their
 * editable contact details. Loads and saves through the portal me endpoint. */
export function HandymanProfileCard() {
  const { showToast } = useToast();
  const [me, setMe] = useState<Handyman | null>(null);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [form, setForm] = useState<FormState>({ name: '', phone: '', address: '', city: '', state: '', zipCode: '' });
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    portalApi
      .handymanMe()
      .then((h) => {
        setMe(h);
        setPhotoUrl(h.photoUrl ?? null);
        setForm(toForm(h));
      })
      .catch(() => showToast('Could not load your profile', 'error'))
      .finally(() => setLoading(false));
  }, [showToast]);

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

  const startEdit = () => {
    if (me) setForm(toForm(me));
    setEditing(true);
  };

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || saving) return;
    setSaving(true);
    portalApi
      .updateHandymanMe(form)
      .then((updated) => {
        setMe(updated);
        setForm(toForm(updated));
        setEditing(false);
        showToast('Profile updated.', 'success');
      })
      .catch((err) => showToast((err as Error).message || 'Could not save your profile', 'error'))
      .finally(() => setSaving(false));
  };

  if (loading) return <Card><CardContent className="p-5 text-sm text-muted">Loading your profile.</CardContent></Card>;
  if (!me) return null;

  const addressLine = [me.address, [me.city, me.state].filter(Boolean).join(', '), me.zipCode]
    .filter((s) => s && s.trim())
    .join(' · ');

  return (
    <Card>
      <CardContent className="p-5 space-y-4">
        <div className="flex items-start justify-between gap-4">
          <h2 className="font-display text-lg font-medium text-ink">Your profile</h2>
          {!editing && (
            <button onClick={startEdit} className="text-sm font-medium text-primary hover:text-primary-hover">
              Edit details
            </button>
          )}
        </div>

        <div className="flex items-center gap-4">
          <Avatar
            photoUrl={photoUrl}
            initials={`${me.name?.[0] ?? me.email?.[0] ?? 'H'}`}
            className="w-16 h-16 flex-shrink-0"
            initialsClassName="text-xl"
          />
          <div className="flex items-center gap-3">
            <input ref={fileInputRef} type="file" accept="image/*" className="hidden" onChange={handlePhotoPick} />
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

        {/* Read-only: what the office controls. */}
        <div className="flex flex-wrap items-center gap-1.5">
          {me.trades.length === 0 ? (
            <span className="text-xs text-faint">No trades set. The office assigns these.</span>
          ) : (
            me.trades.map((t) => (
              <span key={t} className="text-[11px] px-1.5 py-0.5 rounded bg-primary-soft text-primary">{tradeLabel(t)}</span>
            ))
          )}
        </div>

        {editing ? (
          <form onSubmit={save} className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Name</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Phone</label>
              <input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inputClass} />
            </div>
            <div>
              <label className="block text-sm font-medium text-ink mb-1">Address</label>
              <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} placeholder="Street address" className={inputClass} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-sm font-medium text-ink mb-1">City</label>
                <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} className={inputClass} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">State</label>
                  <input value={form.state} onChange={(e) => setForm({ ...form, state: e.target.value })} className={inputClass} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-ink mb-1">ZIP</label>
                  <input value={form.zipCode} onChange={(e) => setForm({ ...form, zipCode: e.target.value })} className={inputClass} />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="secondary" onClick={() => setEditing(false)}>Cancel</Button>
              <Button type="submit" disabled={saving}>{saving ? 'Saving.' : 'Save'}</Button>
            </div>
          </form>
        ) : (
          <div className="space-y-1 text-sm">
            <p className="text-ink font-medium">{me.name}</p>
            {me.email && <p className="text-muted">{me.email}</p>}
            {me.phone && <p className="text-muted">{me.phone}</p>}
            {addressLine ? (
              <p className="text-muted">{addressLine}</p>
            ) : (
              <p className="text-faint">No address on file. Add yours with Edit details.</p>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
