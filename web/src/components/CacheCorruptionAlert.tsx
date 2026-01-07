import { useState, useEffect } from 'react';
import { subscribeToCacheCorruption, clearAllCacheData, isCacheCorrupted } from '@/lib/queryClient';

export function CacheCorruptionAlert() {
  const [corrupted, setCorrupted] = useState(isCacheCorrupted());
  const [clearing, setClearing] = useState(false);

  useEffect(() => {
    return subscribeToCacheCorruption(setCorrupted);
  }, []);

  const handleClearCache = async () => {
    setClearing(true);
    try {
      await clearAllCacheData();
      // Reload to start fresh
      window.location.reload();
    } catch (error) {
      console.error('Failed to clear cache:', error);
      setClearing(false);
    }
  };

  if (!corrupted) {
    return null;
  }

  return (
    <div
      data-testid="cache-corruption-alert"
      className="bg-destructive/10 border-b border-destructive px-4 py-3 text-sm text-destructive"
      role="alert"
      aria-live="assertive"
    >
      <div className="flex items-center justify-between">
        <div>
          <span className="font-medium">Cache Error Detected</span>
          <span className="ml-2 text-destructive/80">
            Your local cache may be corrupted. Clear it to continue.
          </span>
        </div>
        <button
          onClick={handleClearCache}
          disabled={clearing}
          className="bg-destructive text-destructive-foreground px-3 py-1 rounded text-sm hover:bg-destructive/90 disabled:opacity-50"
          data-testid="clear-corrupted-cache-button"
        >
          {clearing ? 'Clearing...' : 'Clear Cache & Reload'}
        </button>
      </div>
      <p className="mt-1 text-xs text-destructive/70">
        Your pending changes are safe and will be synced after clearing.
      </p>
    </div>
  );
}
