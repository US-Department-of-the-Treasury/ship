import { useState, useEffect } from 'react';
import {
  subscribeToSyncProgress,
  isSyncInProgress,
  triggerManualSync,
  cancelStuckSync,
  getIsOnline,
  subscribeToOnlineStatus,
  getPendingMutations,
  subscribeToPendingMutations,
} from '@/lib/queryClient';

export function ManualSyncButton() {
  const [syncing, setSyncing] = useState(isSyncInProgress());
  const [online, setOnline] = useState(getIsOnline());
  const [pendingCount, setPendingCount] = useState(
    getPendingMutations().filter(m => m.syncStatus !== 'synced').length
  );
  const [syncStartedAt, setSyncStartedAt] = useState<number | null>(null);

  useEffect(() => {
    const unsubSync = subscribeToSyncProgress((inProgress) => {
      setSyncing(inProgress);
      if (inProgress) {
        setSyncStartedAt(Date.now());
      } else {
        setSyncStartedAt(null);
      }
    });

    const unsubOnline = subscribeToOnlineStatus(setOnline);

    const unsubMutations = subscribeToPendingMutations((mutations) => {
      setPendingCount(mutations.filter(m => m.syncStatus !== 'synced').length);
    });

    return () => {
      unsubSync();
      unsubOnline();
      unsubMutations();
    };
  }, []);

  // Check if sync seems stuck (over 30 seconds)
  const isStuck = syncing && syncStartedAt && Date.now() - syncStartedAt > 30000;

  const handleSync = async () => {
    if (syncing) {
      if (isStuck) {
        cancelStuckSync();
      }
      return;
    }
    await triggerManualSync();
  };

  // Don't show if no pending mutations and not syncing
  if (pendingCount === 0 && !syncing) {
    return null;
  }

  return (
    <button
      onClick={handleSync}
      disabled={!online && !isStuck}
      className={`inline-flex items-center gap-2 px-3 py-1 text-sm rounded border ${
        syncing
          ? 'border-blue-300 bg-blue-50 text-blue-700'
          : 'border-gray-300 bg-white text-gray-700 hover:bg-gray-50'
      } disabled:opacity-50 disabled:cursor-not-allowed`}
      data-testid="manual-sync-button"
      aria-live="polite"
    >
      {syncing ? (
        <>
          <svg
            className="animate-spin h-4 w-4"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
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
          {isStuck ? 'Cancel Sync' : 'Syncing...'}
        </>
      ) : (
        <>
          <svg
            className="h-4 w-4"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
            />
          </svg>
          Sync Now
          {pendingCount > 0 && (
            <span className="bg-blue-500 text-white text-xs rounded-full px-2 py-0.5">
              {pendingCount}
            </span>
          )}
        </>
      )}
    </button>
  );
}
