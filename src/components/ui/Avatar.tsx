interface AvatarProps {
  photoUrl?: string | null;
  initials: string;
  className?: string;
}

/** A person's avatar: their photo when set, else an initials circle. */
export function Avatar({ photoUrl, initials, className = 'w-10 h-10' }: AvatarProps) {
  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt=""
        className={`${className} rounded-full object-cover bg-primary-soft`}
      />
    );
  }
  return (
    <div className={`${className} rounded-full bg-primary-soft flex items-center justify-center`}>
      <span className="text-xs font-semibold text-primary">{initials}</span>
    </div>
  );
}
