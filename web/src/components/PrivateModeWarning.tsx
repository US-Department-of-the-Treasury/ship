import { useState, useEffect } from 'react';
import { subscribeToPrivateMode, isPrivateBrowsingMode } from '@/lib/queryClient';

export function PrivateModeWarning() {
  const [isPrivate, setIsPrivate] = useState(isPrivateBrowsingMode());
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    return subscribeToPrivateMode(setIsPrivate);
  }, []);

  if (!isPrivate || dismissed) {
    return null;
  }

  return (
    <div
      data-testid="private-mode-warning"
      className="bg-warning/10 border-b border-warning px-4 py-3 text-sm text-warning-foreground"
      role="alert"
      aria-live="polite"
    >
      <div className="flex items-center justify-between">
        <div>
          <span className="font-medium">Private Browsing Mode</span>
          <span className="ml-2 text-muted-foreground">
            Offline features are limited. Your changes will sync but won't be cached locally.
          </span>
        </div>
        <button
          onClick={() => setDismissed(true)}
          className="underline hover:no-underline"
          data-testid="dismiss-private-mode-warning"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
