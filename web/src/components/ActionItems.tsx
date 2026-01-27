import { Link } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { useActionItemsQuery, ActionItem } from '@/hooks/useActionItemsQuery';

const ACCOUNTABILITY_TYPE_LABELS: Record<string, string> = {
  standup: 'Post standup',
  sprint_plan: 'Write plan',
  sprint_review: 'Complete review',
  sprint_start: 'Start sprint',
  sprint_issues: 'Add issues',
  project_plan: 'Write plan',
  project_retro: 'Complete retro',
};

const ACCOUNTABILITY_TYPE_ICONS: Record<string, React.ReactNode> = {
  standup: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
    </svg>
  ),
  sprint_plan: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
    </svg>
  ),
  sprint_review: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  sprint_start: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
    </svg>
  ),
  sprint_issues: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
    </svg>
  ),
  project_plan: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
    </svg>
  ),
  project_retro: (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
    </svg>
  ),
};

function formatDueDate(dueDate: string | null, daysOverdue: number): { text: string; isOverdue: boolean } {
  if (!dueDate) {
    return { text: 'No due date', isOverdue: false };
  }

  if (daysOverdue > 0) {
    return { text: `${daysOverdue} day${daysOverdue === 1 ? '' : 's'} overdue`, isOverdue: true };
  } else if (daysOverdue === 0) {
    return { text: 'Due today', isOverdue: true };
  } else {
    const dueDateObj = new Date(dueDate + 'T00:00:00');
    return {
      text: `Due ${dueDateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
      isOverdue: false,
    };
  }
}

function ActionItemRow({ item }: { item: ActionItem }) {
  const typeLabel = item.accountability_type
    ? ACCOUNTABILITY_TYPE_LABELS[item.accountability_type] || item.accountability_type
    : 'Action Item';
  const icon = item.accountability_type
    ? ACCOUNTABILITY_TYPE_ICONS[item.accountability_type]
    : null;
  const { text: dueText, isOverdue } = formatDueDate(item.due_date, item.days_overdue);

  // Link to the target document if available, otherwise to the issue itself
  const targetUrl = item.accountability_target_id
    ? `/documents/${item.accountability_target_id}`
    : `/documents/${item.id}`;

  return (
    <Link
      to={targetUrl}
      className="flex items-center gap-3 px-4 py-3 hover:bg-background/80 transition-colors"
    >
      {/* Type icon */}
      <span className={cn(
        'flex items-center justify-center h-8 w-8 rounded-full flex-shrink-0',
        isOverdue ? 'bg-red-100 text-red-600 dark:bg-red-900/30 dark:text-red-400' : 'bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400'
      )}>
        {icon}
      </span>

      {/* Item info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-muted uppercase tracking-wide">{typeLabel}</span>
          {item.target_title && (
            <>
              <span className="text-muted">&middot;</span>
              <span className="text-xs text-muted truncate">{item.target_title}</span>
            </>
          )}
        </div>
        <p className="truncate text-sm text-foreground mt-0.5">{item.title}</p>
      </div>

      {/* Due date */}
      <span className={cn(
        'text-xs whitespace-nowrap',
        isOverdue ? 'text-red-600 font-medium dark:text-red-400' : 'text-muted'
      )}>
        {dueText}
      </span>

      {/* Arrow indicator */}
      <svg className="w-4 h-4 text-muted flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
      </svg>
    </Link>
  );
}

export function ActionItems() {
  const { data, isLoading, error } = useActionItemsQuery();

  if (isLoading) {
    return (
      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-6">
        <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400">
          <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
          </svg>
          <span className="text-sm font-medium">Loading action items...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return null; // Silently fail if action items can't be loaded
  }

  if (!data?.items || data.items.length === 0) {
    return null; // Don't show section if no action items
  }

  const overdueCount = data.items.filter(item => item.days_overdue >= 0).length;

  return (
    <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-amber-500/20 bg-amber-500/5">
        <div className="flex items-center gap-2">
          <svg className="w-5 h-5 text-amber-600 dark:text-amber-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
          </svg>
          <h2 className="text-sm font-semibold text-amber-700 dark:text-amber-300">
            Action Items
          </h2>
          <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-amber-600 text-white">
            {data.items.length}
          </span>
        </div>
        {overdueCount > 0 && (
          <span className="text-xs font-medium text-red-600 dark:text-red-400">
            {overdueCount} due/overdue
          </span>
        )}
      </div>

      {/* Items list */}
      <div className="divide-y divide-amber-500/20 bg-background">
        {data.items.map((item) => (
          <ActionItemRow key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}

export default ActionItems;
