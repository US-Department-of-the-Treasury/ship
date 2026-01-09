import { useState, useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { getIsOnline, subscribeToOnlineStatus } from '@/lib/queryClient';

const STALE_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

// Test helper: allow tests to force stale state
let forceStaleForTesting = false;
if (typeof window !== 'undefined') {
  window.addEventListener('force-stale-data', () => {
    forceStaleForTesting = true;
    window.dispatchEvent(new CustomEvent('stale-data-forced'));
  });
}

function formatTimeSince(timestamp: number): string {
  const now = Date.now();
  const diff = now - timestamp;
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (hours >= 1) {
    return `${hours} hour${hours > 1 ? 's' : ''} ago`;
  } else if (minutes >= 1) {
    return `${minutes} minute${minutes > 1 ? 's' : ''} ago`;
  }
  return 'just now';
}

export function StaleDataBanner() {
  const queryClient = useQueryClient();
  const [online, setOnline] = useState(getIsOnline());
  const [lastFetchTime, setLastFetchTime] = useState<number | null>(null);
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [forcedStale, setForcedStale] = useState(forceStaleForTesting);

  useEffect(() => {
    const unsubOnline = subscribeToOnlineStatus(setOnline);
    return unsubOnline;
  }, []);

  // Test helper: listen for force-stale event
  useEffect(() => {
    const handleForceStale = () => {
      setForcedStale(true);
    };
    window.addEventListener('force-stale-data', handleForceStale);
    return () => window.removeEventListener('force-stale-data', handleForceStale);
  }, []);

  // Update last fetch time from query cache
  useEffect(() => {
    const checkCacheFreshness = () => {
      const queries = queryClient.getQueryCache().getAll();
      let oldestDataUpdatedAt: number | null = null;

      // Find the oldest data in cache for main list queries
      for (const query of queries) {
        if (query.state.dataUpdatedAt) {
          if (oldestDataUpdatedAt === null || query.state.dataUpdatedAt < oldestDataUpdatedAt) {
            oldestDataUpdatedAt = query.state.dataUpdatedAt;
          }
        }
      }

      setLastFetchTime(oldestDataUpdatedAt);
    };

    checkCacheFreshness();
    const interval = setInterval(checkCacheFreshness, 10000);
    return () => clearInterval(interval);
  }, [queryClient]);

  // Update current time for relative time display
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 60000); // Update every minute
    return () => clearInterval(interval);
  }, []);

  // Only show when offline and data is stale (or forced for testing)
  const isStale = lastFetchTime ? currentTime - lastFetchTime > STALE_THRESHOLD_MS : false;
  const shouldShow = (!online && isStale) || forcedStale;

  if (!shouldShow) {
    return null;
  }

  // Use a default message when forced without actual staleness data
  const timeMessage = lastFetchTime ? `cached ${formatTimeSince(lastFetchTime)}` : 'cached data';

  return (
    <div
      data-testid="stale-data-banner"
      className="flex items-center justify-center gap-2 bg-yellow-100 border-b border-yellow-200 px-4 py-2 text-sm text-yellow-800"
      role="status"
      aria-live="polite"
    >
      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
        />
      </svg>
      <span>
        Data may be outdated - {timeMessage}
      </span>
    </div>
  );
}
