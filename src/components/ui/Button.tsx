import * as React from 'react';
import { cn } from '../../lib/utils';

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'destructive' | 'outline' | 'secondary' | 'ghost' | 'link';
  size?: 'default' | 'sm' | 'lg' | 'icon';
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'default', size = 'default', ...props }, ref) => {
    const variants = {
      default: 'bg-primary text-white hover:bg-primary-hover shadow-sm',
      destructive: 'bg-danger text-white hover:bg-[#8c2b21] shadow-sm',
      outline: 'border border-line-strong bg-surface text-ink hover:bg-canvas hover:border-faint',
      secondary: 'bg-primary-soft text-primary hover:bg-[#e0e9e2]',
      ghost: 'text-muted hover:bg-black/[0.05] hover:text-ink',
      link: 'text-primary underline-offset-4 hover:underline',
    };

    const sizes = {
      default: 'h-10 px-5 py-2',
      sm: 'h-9 rounded-lg px-3.5 text-xs',
      lg: 'h-12 rounded-xl px-7 text-base',
      icon: 'h-10 w-10 rounded-lg',
    };

    return (
      <button
        className={cn(
          'inline-flex items-center justify-center whitespace-nowrap rounded-lg text-sm font-medium',
          'transition-[transform,background-color,border-color,color,box-shadow] duration-200 ease-out',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/35 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas',
          'disabled:pointer-events-none disabled:opacity-50',
          'active:scale-[0.97] active:duration-75',
          variants[variant],
          sizes[size],
          className
        )}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = 'Button';

export { Button };
