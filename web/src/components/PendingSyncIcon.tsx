interface PendingSyncIconProps {
  isPending?: boolean;
}

export function PendingSyncIcon({ isPending }: PendingSyncIconProps) {
  if (!isPending) {
    return null;
  }

  return (
    <span
      data-testid="pending-sync-icon"
      className="inline-flex items-center justify-center text-amber-500"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label="Pending sync"
    >
      <svg
        className="h-4 w-4 animate-pulse"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        aria-hidden="true"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
        />
      </svg>
    </span>
  );
}
