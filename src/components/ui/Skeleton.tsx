import { cn } from '../../lib/utils';

/** A shimmer placeholder that mimics the shape of content while it loads. */
export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'rounded-lg bg-line/60 animate-pulse',
        className
      )}
    />
  );
}

/** A stat card skeleton matching the Dashboard StatCard dimensions. */
export function StatCardSkeleton() {
  return (
    <div className="rounded-xl border border-line bg-surface shadow-[0_1px_2px_rgba(27,26,23,0.04)] p-5">
      <div className="flex items-center justify-between">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-9 w-9 rounded-xl" />
      </div>
      <Skeleton className="mt-4 h-7 w-28" />
      <Skeleton className="mt-2 h-3 w-36" />
    </div>
  );
}

/** A table row skeleton. */
export function TableRowSkeleton({ cols = 5 }: { cols?: number }) {
  return (
    <div className="flex items-center gap-4 px-4 py-3.5 border-b border-line">
      {Array.from({ length: cols }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn('h-4', i === 0 ? 'w-32' : i === cols - 1 ? 'w-16' : 'w-24', 'flex-shrink-0')}
        />
      ))}
    </div>
  );
}

/** Full page skeleton with stat cards + table. */
export function PageSkeleton({ stats = 4, rows = 6 }: { stats?: number; rows?: number }) {
  return (
    <div className="space-y-6 animate-in fade-in duration-200">
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-8 w-40" />
          <Skeleton className="mt-2 h-4 w-56" />
        </div>
        <Skeleton className="h-10 w-28 rounded-lg" />
      </div>
      {stats > 0 && (
        <div className={cn(
          'grid gap-4',
          stats <= 3 ? 'grid-cols-1 sm:grid-cols-3' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-4'
        )}>
          {Array.from({ length: stats }).map((_, i) => <StatCardSkeleton key={i} />)}
        </div>
      )}
      <div className="rounded-xl border border-line bg-surface">
        <div className="p-4 border-b border-line">
          <Skeleton className="h-5 w-32" />
        </div>
        {Array.from({ length: rows }).map((_, i) => <TableRowSkeleton key={i} />)}
      </div>
    </div>
  );
}

/** Card-list skeleton for the tenant portal pages. */
export function CardListSkeleton({ cards = 3 }: { cards?: number }) {
  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <div>
        <Skeleton className="h-7 w-44" />
        <Skeleton className="mt-1 h-4 w-64" />
      </div>
      {Array.from({ length: cards }).map((_, i) => (
        <div key={i} className="rounded-xl border border-line bg-surface p-5 space-y-3">
          <div className="flex items-center justify-between">
            <Skeleton className="h-5 w-36" />
            <Skeleton className="h-6 w-16 rounded-full" />
          </div>
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
      ))}
    </div>
  );
}
