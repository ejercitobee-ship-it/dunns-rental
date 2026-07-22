import { useRef, useState } from 'react';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { Avatar } from './ui/Avatar';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { authApi } from '../lib/api';
import { resizeImage } from '../lib/image';

const inputClass =
  'w-full px-3 py-2 border border-line rounded-lg bg-surface focus:outline-none focus:ring-2 focus:ring-primary/25';

/** The signed-in team member's own profile: photo, name, phone. Email and role
 * are shown but not editable (email is the login, role is set by an admin).
 * Mounted only while open, so the fields seed fresh from the user each time. */
export function ProfileModal({ onClose }: { onClose: () => void }) {
  const { user, updateCurrentUser } = useAuth();
  const { showToast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [firstName, setFirstName] = useState(user?.firstName || '');
  const [lastName, setLastName] = useState(user?.lastName || '');
  const [phone, setPhone] = useState(user?.phone || '');
  const [saving, setSaving] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);

  const handlePhotoPick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || photoBusy) return;
    setPhotoBusy(true);
    try {
      const blob = await resizeImage(file);
      const { photoUrl } = await authApi.uploadMyPhoto(blob);
      updateCurrentUser({ photoUrl: `${photoUrl}?t=${Date.now()}` });
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
      await authApi.removeMyPhoto();
      updateCurrentUser({ photoUrl: undefined });
      showToast('Photo removed.', 'success');
    } catch (err) {
      showToast((err as Error).message || 'Could not remove your photo.', 'error');
    } finally {
      setPhotoBusy(false);
    }
  };

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    if (!firstName.trim() || saving) return;
    setSaving(true);
    authApi
      .updateMe({ firstName: firstName.trim(), lastName: lastName.trim(), phone: phone.trim() || undefined })
      .then((res) => {
        updateCurrentUser({ firstName: res.firstName, lastName: res.lastName, phone: res.phone });
        showToast('Profile updated.', 'success');
        onClose();
      })
      .catch((err) => showToast((err as Error).message || 'Could not save your profile', 'error'))
      .finally(() => setSaving(false));
  };

  return (
    <Modal isOpen onClose={onClose} title="Your profile">
      <form onSubmit={save} className="space-y-4">
        <div className="flex items-center gap-4">
          <Avatar
            photoUrl={user?.photoUrl}
            initials={`${user?.firstName?.[0] ?? ''}${user?.lastName?.[0] ?? ''}`}
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
              {user?.photoUrl ? 'Change photo' : 'Add photo'}
            </button>
            {user?.photoUrl && (
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

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">First name</label>
            <input value={firstName} onChange={(e) => setFirstName(e.target.value)} required className={inputClass} />
          </div>
          <div>
            <label className="block text-sm font-medium text-ink mb-1.5">Last name</label>
            <input value={lastName} onChange={(e) => setLastName(e.target.value)} className={inputClass} />
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium text-ink mb-1.5">Phone</label>
          <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={inputClass} />
        </div>

        <div className="text-sm text-muted space-y-1 pt-1">
          <p>Email: <span className="text-ink">{user?.email}</span></p>
          <p>Role: <span className="text-ink">{user?.role?.name}</span></p>
        </div>

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="secondary" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={saving}>{saving ? 'Saving.' : 'Save'}</Button>
        </div>
      </form>
    </Modal>
  );
}
