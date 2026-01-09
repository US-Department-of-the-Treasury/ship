import { useNavigate } from 'react-router-dom';
import { useGitHubActivityQuery, GitHubActivity } from '@/hooks/useGitHubActivityQuery';
import { cn } from '@/lib/cn';

interface GitHubActivityFeedProps {
  /** Filter to repos linked to this program */
  programId?: string;
  /** Filter to PRs referencing this issue (by ticket_number) */
  issueId?: number;
  /** Filter to PRs by this GitHub username */
  authorLogin?: string;
  /** Max number of items to show */
  limit?: number;
  /** Custom empty state message */
  emptyMessage?: string;
  /** Whether to show a compact view (smaller items) */
  compact?: boolean;
  /** If true, return null instead of showing empty state when no activity */
  hideWhenEmpty?: boolean;
}

/**
 * GitHubActivityFeed - Shows recent GitHub PRs with linked Ship issues
 *
 * Used in program view and issue detail to show related GitHub activity.
 */
export function GitHubActivityFeed({
  programId,
  issueId,
  authorLogin,
  limit = 10,
  emptyMessage = 'No GitHub activity',
  compact = false,
  hideWhenEmpty = false,
}: GitHubActivityFeedProps) {
  const navigate = useNavigate();
  const { data, isLoading, error } = useGitHubActivityQuery({
    program_id: programId,
    issue_id: issueId,
    author_login: authorLogin,
    limit,
  });

  if (isLoading) {
    return <ActivitySkeleton count={3} compact={compact} />;
  }

  if (error) {
    return (
      <div className="text-sm text-muted py-4 text-center">
        Failed to load GitHub activity
      </div>
    );
  }

  if (!data?.activities?.length) {
    if (hideWhenEmpty) {
      return null;
    }
    return (
      <div className="text-sm text-muted py-4 text-center">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {data.activities.map((activity) => (
        <ActivityItem
          key={activity.id}
          activity={activity}
          compact={compact}
          onIssueClick={(ticketNumber) => {
            // Navigate to issue by ticket number
            navigate(`/issues?ticket=${ticketNumber}`);
          }}
        />
      ))}
    </div>
  );
}

interface ActivityItemProps {
  activity: GitHubActivity;
  compact: boolean;
  onIssueClick: (ticketNumber: number) => void;
}

function ActivityItem({ activity, compact, onIssueClick }: ActivityItemProps) {
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-lg border border-border p-3 transition-colors hover:bg-border/30',
        compact && 'p-2 gap-2'
      )}
    >
      {/* Author avatar */}
      {activity.author_avatar_url ? (
        <img
          src={activity.author_avatar_url}
          alt={activity.author_login}
          className={cn(
            'shrink-0 rounded-full',
            compact ? 'h-6 w-6' : 'h-8 w-8'
          )}
        />
      ) : (
        <div
          className={cn(
            'shrink-0 rounded-full bg-accent/80 flex items-center justify-center text-white font-medium',
            compact ? 'h-6 w-6 text-xs' : 'h-8 w-8 text-sm'
          )}
        >
          {activity.author_login.charAt(0).toUpperCase()}
        </div>
      )}

      {/* Content */}
      <div className="min-w-0 flex-1">
        {/* PR title with link */}
        <div className="flex items-center gap-2 flex-wrap">
          <a
            href={activity.url}
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              'font-medium text-foreground hover:text-accent hover:underline truncate max-w-full',
              compact ? 'text-sm' : 'text-base'
            )}
            title={activity.title}
          >
            {activity.title}
          </a>
          <PRStatusBadge status={activity.event_type} />
        </div>

        {/* Meta line: author, repo, time */}
        <div className={cn('text-muted flex items-center gap-2 flex-wrap', compact ? 'text-xs' : 'text-sm')}>
          <span>{activity.author_login}</span>
          <span className="text-muted/50">in</span>
          <span className="font-mono text-xs">
            {activity.repo_owner}/{activity.repo_name}
          </span>
          <span className="text-muted/50">&middot;</span>
          <span>{formatRelativeTime(activity.github_created_at)}</span>
        </div>

        {/* Linked issues */}
        {activity.issue_ids.length > 0 && (
          <div className="mt-1.5 flex items-center gap-1.5 flex-wrap">
            <LinkIcon className="h-3 w-3 text-muted" />
            {activity.issue_ids.map((ticketNumber) => (
              <button
                key={ticketNumber}
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onIssueClick(ticketNumber);
                }}
                className="inline-flex items-center rounded bg-accent/10 px-1.5 py-0.5 text-xs font-medium text-accent hover:bg-accent/20 transition-colors"
              >
                #{ticketNumber}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* External link icon */}
      <a
        href={activity.url}
        target="_blank"
        rel="noopener noreferrer"
        className="shrink-0 text-muted hover:text-foreground transition-colors"
        aria-label="Open in GitHub"
      >
        <ExternalLinkIcon className={cn(compact ? 'h-3.5 w-3.5' : 'h-4 w-4')} />
      </a>
    </div>
  );
}

interface PRStatusBadgeProps {
  status: GitHubActivity['event_type'];
}

function PRStatusBadge({ status }: PRStatusBadgeProps) {
  const config = {
    pr_opened: { label: 'Open', className: 'bg-green-500/20 text-green-600' },
    pr_merged: { label: 'Merged', className: 'bg-purple-500/20 text-purple-600' },
    pr_closed: { label: 'Closed', className: 'bg-red-500/20 text-red-600' },
  };

  const { label, className } = config[status] || { label: status, className: 'bg-muted/20 text-muted' };

  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', className)}>
      {label}
    </span>
  );
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function ActivitySkeleton({ count, compact }: { count: number; compact: boolean }) {
  return (
    <div className="space-y-2 animate-pulse">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={cn(
            'flex items-start gap-3 rounded-lg border border-border p-3',
            compact && 'p-2 gap-2'
          )}
        >
          <div className={cn('shrink-0 rounded-full bg-border/50', compact ? 'h-6 w-6' : 'h-8 w-8')} />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-3/4 rounded bg-border/50" />
            <div className="h-3 w-1/2 rounded bg-border/30" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ExternalLinkIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
    </svg>
  );
}

function LinkIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
    </svg>
  );
}

function GitHubIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="currentColor" viewBox="0 0 24 24">
      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
    </svg>
  );
}

interface GitHubIssueSectionProps {
  /** The issue's ticket_number to look up linked PRs */
  ticketNumber: number;
}

/**
 * GitHubIssueSection - Shows linked PRs in issue properties sidebar
 *
 * This is a wrapper component that shows a "GitHub" section with linked PRs.
 * The entire section is hidden when there are no PRs referencing this issue.
 */
export function GitHubIssueSection({ ticketNumber }: GitHubIssueSectionProps) {
  const { data, isLoading } = useGitHubActivityQuery({
    issue_id: ticketNumber,
    limit: 5,
  });

  // Hide entire section when loading or no data
  if (isLoading || !data?.activities?.length) {
    return null;
  }

  return (
    <div className="mt-4 pt-4 border-t border-border">
      <div className="flex items-center gap-1.5 mb-2">
        <GitHubIcon className="h-4 w-4 text-muted" />
        <span className="text-xs font-medium text-muted">Linked PRs</span>
      </div>
      <div className="space-y-2">
        {data.activities.map((activity) => (
          <a
            key={activity.id}
            href={activity.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-2 rounded border border-border p-2 hover:bg-border/30 transition-colors group"
          >
            <PRStatusBadge status={activity.event_type} />
            <span className="flex-1 truncate text-sm text-foreground group-hover:text-accent">
              {activity.title}
            </span>
            <ExternalLinkIcon className="h-3.5 w-3.5 text-muted shrink-0" />
          </a>
        ))}
      </div>
    </div>
  );
}
