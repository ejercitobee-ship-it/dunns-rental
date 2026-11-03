import * as React from 'react';
import { cn } from '../../lib/utils';

const inputBase =
  'w-full px-3 py-2 border border-line rounded-lg bg-surface text-ink text-sm' +
  ' placeholder:text-faint' +
  ' focus:outline-none focus:border-primary-line focus:ring-2 focus:ring-primary/10' +
  ' disabled:opacity-50 disabled:cursor-not-allowed' +
  ' transition-[border-color,box-shadow] duration-150';

/* ── TextInput ──────────────────────────────────────────────────── */

export interface TextInputProps
  extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
}

const TextInput = React.forwardRef<HTMLInputElement, TextInputProps>(
  ({ className, label, hint, error, id, ...props }, ref) => {
    const inputId = id || props.name;
    return (
      <div>
        {label && (
          <label htmlFor={inputId} className="block text-sm font-medium text-ink mb-1.5">
            {label}
            {props.required && <span className="text-danger ml-0.5">*</span>}
          </label>
        )}
        <input
          ref={ref}
          id={inputId}
          className={cn(inputBase, error && 'border-danger focus:ring-danger/10', className)}
          {...props}
        />
        {error && <p className="mt-1 text-xs text-danger">{error}</p>}
        {hint && !error && <p className="mt-1 text-xs text-muted">{hint}</p>}
      </div>
    );
  }
);
TextInput.displayName = 'TextInput';

/* ── SelectInput ────────────────────────────────────────────────── */

export interface SelectInputProps
  extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  hint?: string;
  error?: string;
}

const SelectInput = React.forwardRef<HTMLSelectElement, SelectInputProps>(
  ({ className, label, hint, error, id, children, ...props }, ref) => {
    const selectId = id || props.name;
    return (
      <div>
        {label && (
          <label htmlFor={selectId} className="block text-sm font-medium text-ink mb-1.5">
            {label}
            {props.required && <span className="text-danger ml-0.5">*</span>}
          </label>
        )}
        <select
          ref={ref}
          id={selectId}
          className={cn(inputBase, 'pr-8', error && 'border-danger focus:ring-danger/10', className)}
          {...props}
        >
          {children}
        </select>
        {error && <p className="mt-1 text-xs text-danger">{error}</p>}
        {hint && !error && <p className="mt-1 text-xs text-muted">{hint}</p>}
      </div>
    );
  }
);
SelectInput.displayName = 'SelectInput';

/* ── TextareaInput ──────────────────────────────────────────────── */

export interface TextareaInputProps
  extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
}

const TextareaInput = React.forwardRef<HTMLTextAreaElement, TextareaInputProps>(
  ({ className, label, hint, error, id, ...props }, ref) => {
    const textareaId = id || props.name;
    return (
      <div>
        {label && (
          <label htmlFor={textareaId} className="block text-sm font-medium text-ink mb-1.5">
            {label}
            {props.required && <span className="text-danger ml-0.5">*</span>}
          </label>
        )}
        <textarea
          ref={ref}
          id={textareaId}
          className={cn(inputBase, 'resize-y', error && 'border-danger focus:ring-danger/10', className)}
          {...props}
        />
        {error && <p className="mt-1 text-xs text-danger">{error}</p>}
        {hint && !error && <p className="mt-1 text-xs text-muted">{hint}</p>}
      </div>
    );
  }
);
TextareaInput.displayName = 'TextareaInput';

/* ── Checkbox ───────────────────────────────────────────────────── */

export interface CheckboxProps
  extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label: string;
}

const Checkbox = React.forwardRef<HTMLInputElement, CheckboxProps>(
  ({ className, label, id, ...props }, ref) => {
    const checkId = id || props.name;
    return (
      <label htmlFor={checkId} className="flex items-center gap-2 cursor-pointer select-none">
        <input
          ref={ref}
          id={checkId}
          type="checkbox"
          className={cn(
            'h-4 w-4 rounded border-line-strong text-primary',
            'focus:ring-2 focus:ring-primary/10 focus:ring-offset-0',
            className
          )}
          {...props}
        />
        <span className="text-sm text-ink">{label}</span>
      </label>
    );
  }
);
Checkbox.displayName = 'Checkbox';

/* ── inputClass export for gradual migration ────────────────────── */
export const inputClass = inputBase;

export { TextInput, SelectInput, TextareaInput, Checkbox };
