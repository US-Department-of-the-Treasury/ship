import { useState, useEffect } from 'react';
import { subscribeToSyncFailures, SyncFailure } from '@/lib/queryClient';

export function SyncFailureNotification() {
  const [failures, setFailures] = useState<SyncFailure[]>([]);

  useEffect(() => {
    return subscribeToSyncFailures((failure) => {
      setFailures(prev => [...prev, failure]);
      // Auto-dismiss after 8 seconds
      setTimeout(() => {
        setFailures(prev => prev.filter(f => f.timestamp !== failure.timestamp));
      }, 8000);
    });
  }, []);

  const dismissFailure = (timestamp: number) => {
    setFailures(prev => prev.filter(f => f.timestamp !== timestamp));
  };

  if (failures.length === 0) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 max-w-md">
      {failures.map((failure) => (
        <div
          key={failure.timestamp}
          data-testid="sync-failure-notification"
          className="bg-destructive/90 text-destructive-foreground px-4 py-3 rounded-lg shadow-lg"
          role="alert"
          aria-live="assertive"
        >
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="font-medium">Sync Failed</div>
              <div className="text-sm opacity-90">
                {failure.message}
              </div>
            </div>
            <button
              onClick={() => dismissFailure(failure.timestamp)}
              className="text-destructive-foreground/70 hover:text-destructive-foreground"
              aria-label="Dismiss notification"
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
