import { useState } from 'react';

interface AvatarProps {
  photoUrl?: string | null;
  initials: string;
  className?: string;
  initialsClassName?: string;
}

/** A person's avatar: their photo when set, else an initials circle. */
export function Avatar({
  photoUrl,
  initials,
  className = 'w-10 h-10',
  initialsClassName = 'text-xs',
}: AvatarProps) {
  // Track which URL failed to load rather than a boolean reset by an effect, so
  // a new photoUrl is tried again automatically (no setState in an effect).
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  if (photoUrl && failedUrl !== photoUrl) {
    return (
      <img
        src={photoUrl}
        alt=""
        onError={() => setFailedUrl(photoUrl)}
        className={`${className} rounded-full object-cover bg-primary-soft`}
      />
    );
  }
  return (
    <div className={`${className} rounded-full bg-primary-soft flex items-center justify-center`}>
      <span className={`${initialsClassName} font-semibold text-primary`}>{initials}</span>
    </div>
  );
}
