import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getIsOnline, subscribeToOnlineStatus } from '@/lib/queryClient';

interface StaleDataBannerProps {
  queryKey?: readonly unknown[];
}

function formatLastSyncTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 1) return 'just now';
  if (diffMins === 1) return '1 minute ago';
  if (diffMins < 60) return `${diffMins} minutes ago`;

  const diffHours = Math.floor(diffMins / 60);
  if (diffHours === 1) return '1 hour ago';
  if (diffHours < 24) return `${diffHours} hours ago`;

  return date.toLocaleString();
}

export function StaleDataBanner({ queryKey }: StaleDataBannerProps) {
  const queryClient = useQueryClient();
  const [isStale, setIsStale] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [isOnline, setIsOnline] = useState(getIsOnline());

  useEffect(() => {
    return subscribeToOnlineStatus(setIsOnline);
  }, []);

  useEffect(() => {
    if (!queryKey) return;

    const checkStale = () => {
      const queryState = queryClient.getQueryState(queryKey);
      if (queryState && queryState.dataUpdatedAt > 0) {
        setLastUpdated(queryState.dataUpdatedAt);
        const staleTime = 5 * 60 * 1000; // 5 minutes
        const isDataStale = queryState.dataUpdatedAt < Date.now() - staleTime;
        // Show banner when offline OR when data is stale
        setIsStale(isDataStale || !isOnline);
      }
    };

    checkStale();
    const interval = setInterval(checkStale, 30000); // Check every 30 seconds

    return () => clearInterval(interval);
  }, [queryClient, queryKey, isOnline]);

  if (!isStale || !lastUpdated) {
    return null;
  }

  const handleRefresh = () => {
    if (queryKey) {
      queryClient.invalidateQueries({ queryKey });
    }
  };

  return (
    <div
      data-testid="stale-data-banner"
      className="flex items-center justify-between gap-2 rounded bg-blue-50 px-3 py-2 text-sm text-blue-800"
      role="alert"
    >
      <div className="flex flex-col">
        <span>Data may be outdated.</span>
        <span data-testid="last-sync-time" className="text-xs text-blue-600">
          Last synced: {formatLastSyncTime(lastUpdated)}
        </span>
      </div>
      <button
        onClick={handleRefresh}
        className="rounded bg-blue-100 px-2 py-1 text-xs font-medium hover:bg-blue-200"
        disabled={!isOnline}
      >
        {isOnline ? 'Refresh' : 'Offline'}
      </button>
    </div>
  );
}
