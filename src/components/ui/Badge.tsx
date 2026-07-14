import * as React from 'react';
import { cn } from '../../lib/utils';

export interface BadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'default' | 'secondary' | 'destructive' | 'outline' | 'success' | 'warning';
}

function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  const variants = {
    default: 'bg-primary-soft text-primary border-primary-line',
    secondary: 'bg-[#efece5] text-muted border-line',
    destructive: 'bg-danger-soft text-danger border-[#e8cdc8]',
    outline: 'text-muted border-line-strong bg-surface',
    success: 'bg-positive-soft text-positive border-[#cfe4d7]',
    warning: 'bg-warning-soft text-warning border-[#e9dcbe]',
  };

  return (
    <div
      className={cn(
        'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium',
        'transition-colors duration-200',
        variants[variant],
        className
      )}
      {...props}
    />
  );
}

export { Badge };
