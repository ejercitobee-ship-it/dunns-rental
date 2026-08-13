import { useEffect, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';
import { Button } from './Button';
import { cn } from '../../lib/utils';
import { useExitAnimation } from '../../lib/useExitAnimation';

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'info';
  /** Show a loading spinner on the confirm button while an async action runs. */
  loading?: boolean;
}

export function ConfirmDialog({
  isOpen,
  onClose,
  onConfirm,
  title,
  message,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  variant = 'danger',
  loading = false,
}: ConfirmDialogProps) {
  const { mounted, phase } = useExitAnimation(isOpen, 180);
  const confirmRef = useRef<HTMLButtonElement>(null);

  // Close on Escape; auto-focus the confirm button on open.
  useEffect(() => {
    if (!mounted) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    // Focus the confirm button so Enter confirms immediately.
    confirmRef.current?.focus();
    return () => document.removeEventListener('keydown', handler);
  }, [mounted, onClose]);

  if (!mounted) return null;

  const variants = {
    danger: {
      icon: 'bg-danger-soft text-danger',
      button: 'destructive' as const,
    },
    warning: {
      icon: 'bg-warning-soft text-warning',
      button: 'default' as const,
    },
    info: {
      icon: 'bg-primary-soft text-primary',
      button: 'default' as const,
    },
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className={cn(
          'fixed inset-0 bg-ink/40 backdrop-blur-[2px]',
          phase === 'entering' ? 'backdrop-enter' : 'backdrop-exit'
        )}
        onClick={onClose}
      />

      <div className={cn(
        'relative z-50 w-full max-w-md mx-4 bg-surface rounded-2xl border border-line',
        'shadow-[0_24px_60px_-12px_rgba(27,26,23,0.28)]',
        phase === 'entering' ? 'modal-enter' : 'modal-exit'
      )}>
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className={cn('p-3 rounded-xl flex-shrink-0', variants[variant].icon)}>
              <AlertTriangle className="h-6 w-6" />
            </div>

            <div className="flex-1 min-w-0">
              <h3 className="text-lg font-semibold text-ink mb-2">{title}</h3>
              <p className="text-sm text-muted leading-relaxed">{message}</p>
            </div>
          </div>

          <div className="flex gap-3 mt-6 justify-end">
            <Button variant="outline" onClick={onClose} disabled={loading}>
              {cancelText}
            </Button>
            <Button
              ref={confirmRef}
              variant={variants[variant].button}
              disabled={loading}
              onClick={() => {
                onConfirm();
                if (!loading) onClose();
              }}
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  {confirmText}
                </span>
              ) : (
                confirmText
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
