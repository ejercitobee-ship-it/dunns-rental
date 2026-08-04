import { Skeleton } from './Skeleton';

/**
 * A branded loading indicator used as a page-level placeholder. Shows a
 * pulsing logo-colored bar and optional status text. Much more polished than
 * bare "Loading..." text, but lighter than a full skeleton screen.
 */
export function LoadingState({ message }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-20 gap-4 animate-in fade-in duration-200">
      <div className="relative w-12 h-12">
        <div className="absolute inset-0 rounded-full border-2 border-line" />
        <div className="absolute inset-0 rounded-full border-2 border-primary border-t-transparent animate-spin" />
      </div>
      {message && <p className="text-sm text-muted">{message}</p>}
    </div>
  );
}

/**
 * Inline skeleton suitable for portal pages: a simple card-shaped loading
 * placeholder. More visual than text, less complex than a custom skeleton.
 */
export function PortalLoadingState() {
  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <div>
        <Skeleton className="h-7 w-40" />
        <Skeleton className="mt-1 h-4 w-56" />
      </div>
      {Array.from({ length: 3 }).map((_, i) => (
        <div key={i} className="rounded-xl border border-line bg-surface p-5 space-y-3">
          <div className="flex items-center justify-between">
            <Skeleton className="h-4 w-28" />
            <Skeleton className="h-5 w-14 rounded-full" />
          </div>
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      ))}
    </div>
  );
}
