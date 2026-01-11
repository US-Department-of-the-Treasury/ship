export type SyncStatus = 'pending' | 'syncing' | 'synced' | 'conflict' | null;

interface PendingSyncIconProps {
  isPending?: boolean;
  syncStatus?: SyncStatus;
}

export function PendingSyncIcon({ isPending, syncStatus }: PendingSyncIconProps) {
  // Determine effective status - syncStatus takes precedence, then isPending for backwards compat
  const effectiveStatus = syncStatus ?? (isPending ? 'pending' : null);

  if (!effectiveStatus) {
    return null;
  }

  const config = {
    pending: {
      testId: 'sync-status-pending',
      ariaLabel: 'Pending sync',
      className: 'text-amber-500',
      iconClass: 'animate-pulse',
    },
    syncing: {
      testId: 'sync-status-syncing',
      ariaLabel: 'Syncing',
      className: 'text-blue-500',
      iconClass: 'animate-spin',
    },
    synced: {
      testId: 'sync-status-synced',
      ariaLabel: 'Synced',
      className: 'text-green-500',
      iconClass: '',
    },
    conflict: {
      testId: 'sync-status-conflict',
      ariaLabel: 'Sync conflict',
      className: 'text-red-500',
      iconClass: '',
    },
  }[effectiveStatus];

  // Syncing uses a spinner icon, others use sync arrows
  const SyncIcon = effectiveStatus === 'syncing' ? SpinnerIcon : SyncArrowsIcon;
  const CheckIcon = effectiveStatus === 'synced' ? CheckCircleIcon : null;

  return (
    <span
      data-testid="pending-sync-icon"
      className={`inline-flex items-center justify-center ${config.className}`}
      role="status"
      aria-live="polite"
      aria-atomic="true"
      aria-label={config.ariaLabel}
    >
      <span data-testid={config.testId}>
        {CheckIcon ? <CheckIcon className="h-4 w-4" /> : <SyncIcon className={`h-4 w-4 ${config.iconClass}`} />}
      </span>
    </span>
  );
}

function SyncArrowsIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
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
  );
}

function SpinnerIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle
        className="opacity-25"
        cx="12"
        cy="12"
        r="10"
        stroke="currentColor"
        strokeWidth="4"
      />
      <path
        className="opacity-75"
        fill="currentColor"
        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
      />
    </svg>
  );
}

function CheckCircleIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      viewBox="0 0 24 24"
      stroke="currentColor"
      aria-hidden="true"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
      />
    </svg>
  );
}
