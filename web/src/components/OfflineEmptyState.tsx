import { useState, useEffect } from 'react';
import { getIsOnline, subscribeToOnlineStatus } from '@/lib/queryClient';

interface OfflineEmptyStateProps {
  resourceName: string;
}

export function OfflineEmptyState({ resourceName }: OfflineEmptyStateProps) {
  return (
    <div
      className="flex flex-col items-center justify-center py-16 px-4 text-center"
      role="status"
      aria-live="polite"
    >
      <svg
        className="h-16 w-16 text-muted mb-4"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={1.5}
          d="M18.364 5.636a9 9 0 010 12.728m0 0l-2.829-2.829m2.829 2.829L21 21M15.536 8.464a5 5 0 010 7.072m0 0l-2.829-2.829m-4.243 2.829a4.978 4.978 0 01-1.414-2.83m-1.414 5.658a9 9 0 01-2.167-9.238m7.824 2.167a1 1 0 111.414 1.414m-1.414-1.414L3 3m8.293 8.293l1.414 1.414"
        />
      </svg>
      <h2 className="text-lg font-medium text-foreground mb-2">
        Offline - No Cached Data
      </h2>
      <p className="text-muted max-w-md">
        You're currently offline and no {resourceName} have been cached yet.
        Connect to the internet to load your {resourceName}.
      </p>
    </div>
  );
}

// Hook to check if we should show offline empty state
export function useOfflineEmptyState(data: unknown[] | undefined, isLoading: boolean): boolean {
  const [isOnline, setIsOnline] = useState(getIsOnline());

  useEffect(() => {
    return subscribeToOnlineStatus(setIsOnline);
  }, []);

  // Show offline empty state when:
  // 1. We're offline
  // 2. Data is empty or undefined
  // 3. We're still in a loading state (query hasn't resolved)
  const hasNoData = !data || data.length === 0;
  return !isOnline && hasNoData && isLoading;
}
