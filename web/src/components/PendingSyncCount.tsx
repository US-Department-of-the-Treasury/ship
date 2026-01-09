import { useState, useEffect } from 'react';
import { getPendingMutations, subscribeToPendingMutations, PendingMutation, retryFailedMutations, MAX_RETRY_COUNT, removePendingMutation } from '@/lib/queryClient';

export function PendingSyncCount() {
  const [pendingMutations, setPendingMutations] = useState<PendingMutation[]>(getPendingMutations());

  useEffect(() => {
    return subscribeToPendingMutations((mutations) => {
      console.log('[PendingSyncCount] Received mutations update:', mutations.length, 'mutations', mutations.map(m => ({ id: m.id.slice(0, 8), status: m.syncStatus })));
      setPendingMutations(mutations);
    });
  }, []);

  // Separate pending (still retrying) from failed (max retries exceeded) and conflicts
  const conflictMutations = pendingMutations.filter(m => m.syncStatus === 'conflict');
  console.log('[PendingSyncCount] Rendering with', conflictMutations.length, 'conflicts,', pendingMutations.length, 'total');
  const pendingCount = pendingMutations.filter(m => m.syncStatus !== 'conflict' && m.retryCount < MAX_RETRY_COUNT).length;
  const failedCount = pendingMutations.filter(m => m.syncStatus !== 'conflict' && m.retryCount >= MAX_RETRY_COUNT).length;
  const totalCount = pendingMutations.length;

  // Handle retry button click
  const handleRetry = () => {
    retryFailedMutations();
  };

  // Handle dismiss conflict
  const handleDismissConflict = (id: string) => {
    removePendingMutation(id);
  };

  // Show conflict resolution UI if any mutations have conflicts (409 errors)
  if (conflictMutations.length > 0) {
    return (
      <div
        data-testid="pending-sync-count"
        className="px-3 py-2 text-xs border-t border-border"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-label={`${conflictMutations.length} version ${conflictMutations.length === 1 ? 'conflict' : 'conflicts'}`}
      >
        <div className="text-destructive font-medium" data-testid="conflict-message">
          Version conflict detected
        </div>
        <div className="text-muted-foreground mt-1">
          Your changes conflict with recent updates from another user.
        </div>
        <div className="flex gap-2 mt-2">
          <button
            onClick={() => conflictMutations.forEach(m => handleDismissConflict(m.id))}
            className="text-primary underline hover:no-underline"
            data-testid="dismiss-conflict-button"
          >
            Dismiss
          </button>
          <button
            onClick={() => window.location.reload()}
            className="text-primary underline hover:no-underline"
            data-testid="reload-page-button"
          >
            Reload page
          </button>
        </div>
        {pendingCount > 0 && (
          <div className="text-muted mt-1">{pendingCount} other changes still syncing...</div>
        )}
      </div>
    );
  }

  // Handle discard all failed mutations
  const handleDiscardFailed = () => {
    const failedMutations = pendingMutations.filter(m => m.syncStatus !== 'conflict' && m.retryCount >= MAX_RETRY_COUNT);
    failedMutations.forEach(m => removePendingMutation(m.id));
  };

  // Show failed message if any mutations have exceeded max retries
  if (failedCount > 0) {
    return (
      <div
        data-testid="pending-sync-count"
        className="px-3 py-2 text-xs border-t border-border"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        aria-label={`${failedCount} ${failedCount === 1 ? 'change' : 'changes'} failed to sync`}
      >
        <div className="text-destructive">
          <span data-testid="sync-error-message">Failed to sync {failedCount} {failedCount === 1 ? 'change' : 'changes'}</span>
        </div>
        <div className="flex gap-2 mt-1">
          <button
            onClick={handleRetry}
            className="text-primary underline hover:no-underline"
            data-testid="retry-sync-button"
          >
            Retry
          </button>
          <button
            onClick={handleDiscardFailed}
            className="text-muted-foreground underline hover:no-underline"
            data-testid="discard-failed-button"
          >
            Discard
          </button>
        </div>
        {pendingCount > 0 && (
          <div className="text-muted mt-1">{pendingCount} still syncing...</div>
        )}
      </div>
    );
  }

  return (
    <div
      data-testid="pending-sync-count"
      className="px-3 py-2 text-xs text-muted border-t border-border"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label={totalCount === 0 ? 'All changes synced' : `${totalCount} pending ${totalCount === 1 ? 'change' : 'changes'} to sync`}
    >
      {totalCount}
    </div>
  );
}
