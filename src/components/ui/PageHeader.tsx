import { cn } from '../../lib/utils';

interface PageHeaderProps {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
  className?: string;
}

export function PageHeader({ eyebrow, title, description, actions, className }: PageHeaderProps) {
  return (
    <div className={cn('flex items-start justify-between gap-4', className)}>
      <div className="min-w-0">
        {eyebrow && <p className="eyebrow tracking-[0.12em]">{eyebrow}</p>}
        <h1 className="font-display text-[28px] sm:text-[34px] text-ink mt-1 font-semibold">{title}</h1>
        {description && <p className="text-sm text-muted mt-1.5 leading-relaxed">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 flex-shrink-0">{actions}</div>}
    </div>
  );
}
