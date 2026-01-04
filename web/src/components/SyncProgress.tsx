import { useState, useEffect } from 'react';
import { getPendingMutations, subscribeToPendingMutations, PendingMutation } from '@/lib/queryClient';

interface SyncProgressProps {
  totalToSync?: number;
}

export function SyncProgress({ totalToSync }: SyncProgressProps) {
  const [pendingMutations, setPendingMutations] = useState<PendingMutation[]>(getPendingMutations());
  const [initialCount, setInitialCount] = useState(0);

  useEffect(() => {
    const unsubscribe = subscribeToPendingMutations((mutations) => {
      setPendingMutations(mutations);
      if (mutations.length > initialCount) {
        setInitialCount(mutations.length);
      }
    });
    return unsubscribe;
  }, [initialCount]);

  const total = totalToSync ?? initialCount;
  const synced = total - pendingMutations.length;

  if (total === 0 || pendingMutations.length === 0) {
    return null;
  }

  return (
    <div
      data-testid="sync-progress"
      className="flex items-center gap-2 text-sm text-gray-600"
      role="status"
      aria-live="polite"
    >
      <svg
        className="h-4 w-4 animate-spin"
        fill="none"
        viewBox="0 0 24 24"
        aria-hidden="true"
      >
        <circle
          className="opacity-25"
          cx="12"
          cy="12"
          r="10"
          stroke="currentColor"
          strokeWidth="4"
        />
        <path
          className="opacity-75"
          fill="currentColor"
          d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
        />
      </svg>
      <span>Syncing {synced} / {total}</span>
    </div>
  );
}
