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
      default: 'bg-gradient-to-r from-blue-600 to-indigo-600 text-white hover:from-blue-700 hover:to-indigo-700 shadow-lg shadow-blue-500/25',
      destructive: 'bg-gradient-to-r from-red-500 to-rose-600 text-white hover:from-red-600 hover:to-rose-700 shadow-lg shadow-red-500/25',
      outline: 'border-2 border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300',
      secondary: 'bg-slate-100 text-slate-700 hover:bg-slate-200',
      ghost: 'text-slate-600 hover:bg-slate-100 hover:text-slate-900',
      link: 'text-blue-600 underline-offset-4 hover:underline hover:text-blue-700',
    };

    const sizes = {
      default: 'h-11 px-6 py-2',
      sm: 'h-9 rounded-lg px-4 text-xs',
      lg: 'h-12 rounded-xl px-8 text-base',
      icon: 'h-10 w-10 rounded-lg',
    };

    return (
      <button
        className={cn(
          'inline-flex items-center justify-center whitespace-nowrap rounded-xl text-sm font-semibold',
          'transition-all duration-200 ease-out',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2',
          'disabled:pointer-events-none disabled:opacity-50',
          'active:scale-[0.98]',
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
