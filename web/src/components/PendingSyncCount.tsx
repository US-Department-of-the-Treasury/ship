import { useState, useEffect } from 'react';
import { getPendingMutations, subscribeToPendingMutations, PendingMutation } from '@/lib/queryClient';

export function PendingSyncCount() {
  const [pendingMutations, setPendingMutations] = useState<PendingMutation[]>(getPendingMutations());

  useEffect(() => {
    return subscribeToPendingMutations(setPendingMutations);
  }, []);

  const count = pendingMutations.length;

  // Only show when there are pending items
  if (count === 0) {
    return null;
  }

  return (
    <div
      data-testid="pending-sync-count"
      className="px-3 py-2 text-xs text-muted border-t border-border"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label={`${count} pending ${count === 1 ? 'change' : 'changes'} to sync`}
    >
      {count} {count === 1 ? 'change' : 'changes'} waiting to sync
    </div>
  );
}
