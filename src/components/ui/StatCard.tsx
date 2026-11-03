import { Card } from './Card';
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
    <Card
      className={cn(
        'cursor-pointer hover:border-line-strong hover:shadow-[0_2px_12px_rgba(27,26,23,0.07)] transition-all',
        className
      )}
      onClick={onClick}
    >
      <div className="p-5">
        <div className="flex items-center justify-between mb-1">
          <span className="eyebrow">{title}</span>
          <span
            className={cn(
              'w-[34px] h-[34px] rounded-[10px] grid place-items-center',
              '[&_svg]:h-[18px] [&_svg]:w-[18px]',
              iconBg
            )}
          >
            {icon}
          </span>
        </div>
        <div className="mt-3 flex items-end gap-2">
          <span className={cn('font-display text-[24px] leading-none font-medium tnum', valueColor)}>
            {value}
          </span>
        </div>
        {subtitle && <p className="mt-1.5 text-[12px] text-muted">{subtitle}</p>}
      </div>
    </Card>
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
    <Card
      className={cn('cursor-pointer hover:border-line-strong transition-all', className)}
      onClick={onClick}
    >
      <div className="p-3 flex items-center gap-2.5">
        <span className="w-[34px] h-[34px] rounded-[10px] bg-canvas text-muted grid place-items-center flex-shrink-0 [&_svg]:h-[18px] [&_svg]:w-[18px]">
          {icon}
        </span>
        <div className="min-w-0">
          <p className="eyebrow !text-[10px]">{label}</p>
          <p className="text-[17px] font-medium text-ink mt-0.5">{value}</p>
        </div>
      </div>
    </Card>
  );
}
