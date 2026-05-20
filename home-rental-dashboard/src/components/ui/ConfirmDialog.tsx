import { AlertTriangle } from 'lucide-react';
import { Button } from './Button';
import { cn } from '../../lib/utils';

interface ConfirmDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  variant?: 'danger' | 'warning' | 'info';
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
}: ConfirmDialogProps) {
  if (!isOpen) return null;

  const variants = {
    danger: {
      icon: 'bg-red-100 text-red-600',
      button: 'bg-red-600 hover:bg-red-700',
    },
    warning: {
      icon: 'bg-amber-100 text-amber-600',
      button: 'bg-amber-600 hover:bg-amber-700',
    },
    info: {
      icon: 'bg-blue-100 text-blue-600',
      button: 'bg-blue-600 hover:bg-blue-700',
    },
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div 
        className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm transition-opacity"
        onClick={onClose}
      />
      
      <div className={cn(
        'relative z-50 w-full max-w-md mx-4 bg-white rounded-2xl shadow-2xl',
        'transform transition-all duration-300 ease-out scale-100'
      )}>
        <div className="p-6">
          <div className="flex items-start gap-4">
            <div className={cn('p-3 rounded-xl', variants[variant].icon)}>
              <AlertTriangle className="h-6 w-6" />
            </div>
            
            <div className="flex-1">
              <h3 className="text-lg font-bold text-slate-800 mb-2">{title}</h3>
              <p className="text-slate-600">{message}</p>
            </div>
          </div>
          
          <div className="flex gap-3 mt-6 justify-end">
            <Button variant="outline" onClick={onClose}>
              {cancelText}
            </Button>
            <Button 
              onClick={() => {
                onConfirm();
                onClose();
              }}
              className={variants[variant].button}
            >
              {confirmText}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
