import { useState, useEffect, useCallback, createContext, useContext, ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface Toast {
  id: string;
  message: string;
  type: 'success' | 'error' | 'info';
  duration?: number;
}

interface ToastContextValue {
  showToast: (message: string, type?: Toast['type'], duration?: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

export function useToast() {
  const context = useContext(ToastContext);
  if (!context) {
    throw new Error('useToast must be used within a ToastProvider');
  }
  return context;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = useCallback((message: string, type: Toast['type'] = 'success', duration = 3000) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [...prev, { id, message, type, duration }]);
  }, []);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      <div className="fixed bottom-20 right-4 z-50 flex flex-col gap-2">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onClose={() => removeToast(toast.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onClose }: { toast: Toast; onClose: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onClose, toast.duration || 3000);
    return () => clearTimeout(timer);
  }, [toast.duration, onClose]);

  return (
    <div
      role="alert"
      aria-live="polite"
      className={cn(
        'px-4 py-2 rounded-lg shadow-lg text-sm animate-in slide-in-from-right-4 fade-in',
        'flex items-center gap-2 min-w-[200px]',
        toast.type === 'success' && 'bg-green-500/90 text-white',
        toast.type === 'error' && 'bg-red-500/90 text-white',
        toast.type === 'info' && 'bg-accent/90 text-white'
      )}
    >
      {toast.type === 'success' && <CheckIcon className="h-4 w-4" />}
      {toast.type === 'error' && <XIcon className="h-4 w-4" />}
      <span>{toast.message}</span>
      <button
        onClick={onClose}
        className="ml-auto text-white/70 hover:text-white"
        aria-label="Dismiss"
      >
        <XIcon className="h-4 w-4" />
      </button>
    </div>
  );
}

function CheckIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  );
}

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}
