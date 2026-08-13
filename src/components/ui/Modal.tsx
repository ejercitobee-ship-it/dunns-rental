import * as React from 'react';
import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';
import { useExitAnimation } from '../../lib/useExitAnimation';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Optional footer content rendered below the scroll area with a top border. */
  footer?: React.ReactNode;
}

export function Modal({ isOpen, onClose, title, children, size = 'md', footer }: ModalProps) {
  const { mounted, phase } = useExitAnimation(isOpen, 180);

  // Close on Escape key.
  useEffect(() => {
    if (!mounted) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handler);
    // Prevent body scroll while modal is open.
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handler);
      document.body.style.overflow = prev;
    };
  }, [mounted, onClose]);

  if (!mounted) return null;

  const sizeClasses = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
  };

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      {/* Backdrop */}
      <div
        className={cn(
          'fixed inset-0 bg-ink/40 backdrop-blur-[2px]',
          phase === 'entering' ? 'backdrop-enter' : 'backdrop-exit'
        )}
        onClick={onClose}
      />

      {/* Modal */}
      <div className={cn(
        'relative z-50 w-full mx-0 sm:mx-4 bg-surface border border-line rounded-t-2xl sm:rounded-2xl',
        'shadow-[0_24px_60px_-12px_rgba(27,26,23,0.28)]',
        phase === 'entering' ? 'modal-enter' : 'modal-exit',
        sizeClasses[size]
      )}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 sm:py-5 border-b border-line">
          <h2 className="font-display text-lg sm:text-xl font-medium text-ink">{title}</h2>
          <button
            onClick={onClose}
            className="p-2 -mr-2 hover:bg-black/[0.05] rounded-lg transition-colors group"
            aria-label="Close"
          >
            <X className="h-5 w-5 text-faint group-hover:text-ink" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 sm:p-6 max-h-[70vh] overflow-y-auto">
          {children}
        </div>

        {/* Optional footer */}
        {footer && (
          <div className="px-5 sm:px-6 py-4 border-t border-line">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
