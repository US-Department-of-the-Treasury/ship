import { useState, useEffect } from 'react';

interface IncompleteDocumentBannerProps {
  documentId: string;
  isComplete: boolean | null;
  missingFields: string[];
}

/**
 * Warning banner shown on incomplete documents (projects, sprints).
 * Dismissible per session - reappears on page reload.
 */
export function IncompleteDocumentBanner({
  documentId,
  isComplete,
  missingFields,
}: IncompleteDocumentBannerProps) {
  const [isDismissed, setIsDismissed] = useState(false);
  const storageKey = `incomplete-banner-dismissed-${documentId}`;

  // Check if banner was dismissed this session
  useEffect(() => {
    const dismissed = sessionStorage.getItem(storageKey);
    if (dismissed === 'true') {
      setIsDismissed(true);
    }
  }, [storageKey]);

  // Don't show if complete or no missing fields
  if (isComplete === true || missingFields.length === 0) {
    return null;
  }

  // Don't show if dismissed this session
  if (isDismissed) {
    return null;
  }

  const handleDismiss = () => {
    sessionStorage.setItem(storageKey, 'true');
    setIsDismissed(true);
  };

  return (
    <div className="flex items-center justify-between gap-3 bg-amber-50 border border-amber-200 px-4 py-2.5 text-sm text-amber-800 dark:bg-amber-950/50 dark:border-amber-800 dark:text-amber-200">
      <div className="flex items-center gap-2">
        <svg
          className="h-4 w-4 flex-shrink-0"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
          />
        </svg>
        <span>
          <strong>Incomplete:</strong> Missing {missingFields.join(', ')}
        </span>
      </div>
      <button
        onClick={handleDismiss}
        className="flex-shrink-0 rounded p-1 hover:bg-amber-200/50 dark:hover:bg-amber-800/50"
        aria-label="Dismiss warning"
      >
        <svg
          className="h-4 w-4"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M6 18L18 6M6 6l12 12"
          />
        </svg>
      </button>
    </div>
  );
}
