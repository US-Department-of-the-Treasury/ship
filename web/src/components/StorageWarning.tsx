import { useState, useEffect } from 'react';
import { subscribeToStorageQuota, StorageQuotaInfo, clearOldCacheEntries } from '@/lib/queryClient';

export function StorageWarning() {
  const [storageInfo, setStorageInfo] = useState<StorageQuotaInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    return subscribeToStorageQuota((info) => {
      setStorageInfo(info);
      // Reset dismissed state if we drop below warning
      if (!info.isWarning) {
        setDismissed(false);
      }
    });
  }, []);

  const handleClearCache = async () => {
    setClearing(true);
    try {
      await clearOldCacheEntries();
    } finally {
      setClearing(false);
    }
  };

  // Don't show if no warning or dismissed
  if (!storageInfo?.isWarning || dismissed) {
    return null;
  }

  const formatBytes = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
  };

  const percentUsed = Math.round(storageInfo.percentUsed * 100);

  return (
    <div
      data-testid="storage-warning"
      className={`px-4 py-3 text-sm ${
        storageInfo.isCritical
          ? 'bg-destructive/10 border-destructive text-destructive'
          : 'bg-warning/10 border-warning text-warning-foreground'
      } border-b`}
      role="alert"
      aria-live="polite"
    >
      <div className="flex items-center justify-between">
        <div>
          <span className="font-medium">
            {storageInfo.isCritical ? 'Storage Almost Full' : 'Storage Running Low'}
          </span>
          <span className="ml-2 text-muted-foreground">
            {formatBytes(storageInfo.usage)} of {formatBytes(storageInfo.quota)} used ({percentUsed}%)
          </span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleClearCache}
            disabled={clearing}
            className="underline hover:no-underline disabled:opacity-50"
            data-testid="clear-cache-button"
          >
            {clearing ? 'Clearing...' : 'Clear old cache'}
          </button>
          <button
            onClick={() => setDismissed(true)}
            className="underline hover:no-underline"
            data-testid="dismiss-storage-warning"
          >
            Dismiss
          </button>
        </div>
      </div>
      {storageInfo.isCritical && (
        <p className="mt-1 text-xs text-muted-foreground">
          Your pending changes are safe. Only cached data will be cleared.
        </p>
      )}
    </div>
  );
}
