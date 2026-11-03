import { cn } from '../../lib/utils';

/* ── StatCard ───────────────────────────────────────────────────── */

interface StatCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  iconBg?: string;
  valueColor?: string;
  onClick?: () => void;
  className?: string;
}

export function StatCard({
  title,
  value,
  subtitle,
  icon,
  iconBg = 'bg-primary-soft text-primary',
  valueColor = 'text-ink',
  onClick,
  className,
}: StatCardProps) {
  return (
    <div
      className={cn(
        'stat-card group relative overflow-hidden rounded-xl bg-surface',
        'border border-line/60',
        'shadow-[0_1px_3px_rgba(27,26,23,0.05),0_1px_2px_rgba(27,26,23,0.03)]',
        'hover:shadow-[0_4px_16px_rgba(27,26,23,0.08),0_1px_3px_rgba(27,26,23,0.04)]',
        'hover:border-line-strong',
        'transition-all duration-200 cursor-pointer',
        className
      )}
      onClick={onClick}
    >
      <div className="p-5">
        <div className="flex items-center justify-between mb-2">
          <span className="eyebrow tracking-[0.1em]">{title}</span>
          <span
            className={cn(
              'w-10 h-10 rounded-xl grid place-items-center',
              '[&_svg]:h-[20px] [&_svg]:w-[20px]',
              'shadow-[inset_0_1px_0_rgba(255,255,255,0.5)]',
              iconBg
            )}
          >
            {icon}
          </span>
        </div>
        <div className="mt-2 flex items-end gap-2">
          <span className={cn('font-display text-[28px] leading-none font-semibold tnum', valueColor)}>
            {value}
          </span>
        </div>
        {subtitle && <p className="mt-2 text-[12px] text-muted leading-tight">{subtitle}</p>}
      </div>
      <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-gradient-to-r from-primary/20 via-primary/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300" />
    </div>
  );
}

/* ── ContextCard ─────────────────────────────────────────────────── */

interface ContextCardProps {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  onClick?: () => void;
  className?: string;
}

export function ContextCard({ icon, label, value, onClick, className }: ContextCardProps) {
  return (
    <div
      className={cn(
        'group relative overflow-hidden rounded-xl bg-surface',
        'border border-line/60',
        'shadow-[0_1px_2px_rgba(27,26,23,0.04)]',
        'hover:shadow-[0_2px_8px_rgba(27,26,23,0.06)]',
        'hover:border-line-strong',
        'transition-all duration-200 cursor-pointer',
        className
      )}
      onClick={onClick}
    >
      <div className="p-3.5 flex items-center gap-3">
        <span className="w-10 h-10 rounded-xl bg-canvas text-muted grid place-items-center flex-shrink-0 [&_svg]:h-[18px] [&_svg]:w-[18px] border border-line/40">
          {icon}
        </span>
        <div className="min-w-0">
          <p className="eyebrow !text-[10px] tracking-[0.1em]">{label}</p>
          <p className="text-[18px] font-semibold text-ink mt-0.5 tnum">{value}</p>
        </div>
      </div>
    </div>
  );
}
