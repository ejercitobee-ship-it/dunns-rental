import { createContext, useContext, useState, useCallback, useRef, type ReactNode } from 'react';
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react';
import { cn } from '../lib/utils';

type ToastType = 'success' | 'error' | 'info' | 'warning';

interface Toast {
  id: string;
  message: string;
  type: ToastType;
  phase: 'entering' | 'exiting';
}

interface ToastContextType {
  showToast: (message: string, type?: ToastType) => void;
}

const ToastContext = createContext<ToastContextType | undefined>(undefined);

const TOAST_DURATION = 4000;
const EXIT_DURATION = 200;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Track timers so we can clean up without stale closure issues.
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const dismissToast = useCallback((id: string) => {
    // Start exit animation.
    setToasts(prev => prev.map(t => t.id === id ? { ...t, phase: 'exiting' as const } : t));
    // Remove from DOM after exit animation completes.
    const exitTimer = setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
      timersRef.current.delete(id);
    }, EXIT_DURATION);
    timersRef.current.set(`${id}-exit`, exitTimer);
  }, []);

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = Math.random().toString(36).substr(2, 9);
    setToasts(prev => [...prev, { id, message, type, phase: 'entering' }]);

    // Auto-dismiss after the display duration.
    const timer = setTimeout(() => dismissToast(id), TOAST_DURATION);
    timersRef.current.set(id, timer);
  }, [dismissToast]);

  const handleDismiss = useCallback((id: string) => {
    // Cancel the auto-dismiss timer if user closes manually.
    const autoTimer = timersRef.current.get(id);
    if (autoTimer) { clearTimeout(autoTimer); timersRef.current.delete(id); }
    dismissToast(id);
  }, [dismissToast]);

  const icons = {
    success: <CheckCircle className="h-5 w-5 text-positive" />,
    error: <AlertCircle className="h-5 w-5 text-danger" />,
    info: <Info className="h-5 w-5 text-primary" />,
    warning: <AlertCircle className="h-5 w-5 text-warning" />,
  };

  const styles = {
    success: 'bg-positive-soft border-positive/20 text-ink',
    error: 'bg-danger-soft border-danger/20 text-ink',
    info: 'bg-primary-soft border-primary-line text-ink',
    warning: 'bg-warning-soft border-warning/20 text-ink',
  };

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed top-4 right-4 z-50 space-y-3">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cn(
              'flex items-center gap-3 px-4 py-3 rounded-xl border shadow-lg min-w-[300px]',
              toast.phase === 'entering' ? 'toast-enter' : 'toast-exit',
              styles[toast.type]
            )}
          >
            {icons[toast.type]}
            <p className="flex-1 text-sm font-medium">{toast.message}</p>
            <button
              onClick={() => handleDismiss(toast.id)}
              className="p-1 hover:bg-black/5 rounded-lg transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

// The hook is co-located with its provider on purpose; splitting it out only to
// satisfy a dev-only fast-refresh rule would churn every import site.
// eslint-disable-next-line react-refresh/only-export-components
export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}
