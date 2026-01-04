import { useState, useEffect } from 'react';
import { getPendingMutations, subscribeToPendingMutations, PendingMutation } from '@/lib/queryClient';

export function PendingSyncCount() {
  const [pendingMutations, setPendingMutations] = useState<PendingMutation[]>(getPendingMutations());

  useEffect(() => {
    return subscribeToPendingMutations(setPendingMutations);
  }, []);

  const count = pendingMutations.length;

  return (
    <span
      data-testid="pending-sync-count"
      className={`inline-flex items-center justify-center rounded-full px-2 py-0.5 text-xs font-medium ${
        count > 0
          ? 'bg-amber-100 text-amber-800'
          : 'bg-gray-100 text-gray-600'
      }`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label={`${count} pending ${count === 1 ? 'change' : 'changes'} to sync`}
    >
      {count}
    </span>
  );
}
