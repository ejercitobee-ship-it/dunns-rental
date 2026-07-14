import * as React from 'react';
import { X } from 'lucide-react';
import { cn } from '../../lib/utils';

interface ModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: 'sm' | 'md' | 'lg' | 'xl';
}

export function Modal({ isOpen, onClose, title, children, size = 'md' }: ModalProps) {
  if (!isOpen) return null;

  const sizeClasses = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-ink/40 backdrop-blur-[2px] transition-opacity"
        onClick={onClose}
      />

      {/* Modal */}
      <div className={cn(
        'relative z-50 w-full mx-0 sm:mx-4 bg-surface border border-line rounded-t-2xl sm:rounded-2xl',
        'shadow-[0_24px_60px_-12px_rgba(27,26,23,0.28)]',
        'transform transition-all duration-300 ease-out',
        'scale-100 opacity-100',
        sizeClasses[size]
      )}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 sm:px-6 py-4 sm:py-5 border-b border-line">
          <h2 className="font-display text-lg sm:text-xl font-medium text-ink">{title}</h2>
          <button
            onClick={onClose}
            className="p-2 -mr-2 hover:bg-black/[0.05] rounded-lg transition-colors group"
          >
            <X className="h-5 w-5 text-faint group-hover:text-ink" />
          </button>
        </div>
        
        {/* Content */}
        <div className="p-4 sm:p-6 max-h-[70vh] overflow-y-auto">
          {children}
        </div>
      </div>
    </div>
  );
}
