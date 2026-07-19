import { useEffect, useState } from 'react';

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
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [photoUrl]);

  if (photoUrl && !failed) {
    return (
      <img
        src={photoUrl}
        alt=""
        onError={() => setFailed(true)}
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
