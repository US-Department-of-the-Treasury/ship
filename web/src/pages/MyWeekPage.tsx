import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiGet } from '@/lib/api';
import { cn } from '@/lib/cn';
import { priorityColors } from '@/lib/statusColors';

interface Issue {
  id: string;
  title: string;
  state: string;
  priority: string;
  ticket_number: number;
  display_id: string;
  estimate: number | null;
  assignee_id: string | null;
  assignee_name: string | null;
}

interface SprintGroup {
  sprint: {
    id: string;
    name: string;
    sprint_number: number;
  };
  program: {
    id: string;
    name: string;
  };
  issues: Issue[];
}

interface MyWeekData {
  groups: SprintGroup[];
  summary: {
    total_issues: number;
    completed_issues: number;
    in_progress_issues: number;
    remaining_issues: number;
  };
  week: {
    current_sprint_number: number;
    start_date: string;
    end_date: string;
    days_remaining: number;
  };
}

const STATE_COLORS: Record<string, string> = {
  backlog: 'bg-gray-500',
  todo: 'bg-blue-500',
  in_progress: 'bg-yellow-500',
  in_review: 'bg-purple-500',
  done: 'bg-green-500',
  cancelled: 'bg-red-500',
};

const STATE_LABELS: Record<string, string> = {
  backlog: 'Backlog',
  todo: 'To Do',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
  cancelled: 'Cancelled',
};

type FilterState = 'all' | 'todo' | 'in_progress' | 'in_review' | 'done';

export function MyWeekPage() {
  const [showMine, setShowMine] = useState(false);
  const [stateFilter, setStateFilter] = useState<FilterState>('all');

  // Build query params
  const queryParams = new URLSearchParams();
  if (showMine) queryParams.set('show_mine', 'true');
  if (stateFilter !== 'all') queryParams.set('state', stateFilter);
  const queryString = queryParams.toString();

  const { data, isLoading, error } = useQuery<MyWeekData>({
    queryKey: ['my-week', showMine, stateFilter],
    queryFn: async () => {
      const url = queryString
        ? `/api/sprints/my-week?${queryString}`
        : '/api/sprints/my-week';
      const response = await apiGet(url);
      if (!response.ok) throw new Error('Failed to fetch week data');
      return response.json();
    },
  });

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted">Loading your week...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-red-500">Failed to load week data</div>
      </div>
    );
  }

  const { groups = [], summary, week } = data || {};

  // Calculate progress percentage
  const progressPercent = summary && summary.total_issues > 0
    ? Math.round((summary.completed_issues / summary.total_issues) * 100)
    : 0;

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-foreground">My Week</h1>
            <p className="mt-1 text-sm text-muted">
              Sprint {week?.current_sprint_number} &middot; {week?.days_remaining} days remaining
            </p>
          </div>

          {/* Filters */}
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={showMine}
                onChange={(e) => setShowMine(e.target.checked)}
                className="rounded border-border"
              />
              <span className="text-muted">Show mine only</span>
            </label>

            <select
              value={stateFilter}
              onChange={(e) => setStateFilter(e.target.value as FilterState)}
              className="rounded-md border border-border bg-background px-2 py-1 text-sm text-foreground"
            >
              <option value="all">All states</option>
              <option value="todo">To Do</option>
              <option value="in_progress">In Progress</option>
              <option value="in_review">In Review</option>
              <option value="done">Done</option>
            </select>
          </div>
        </div>

        {/* Summary Stats */}
        {summary && (
          <div className="grid grid-cols-4 gap-4">
            <StatCard
              label="Total Issues"
              value={summary.total_issues}
              color="text-foreground"
            />
            <StatCard
              label="Completed"
              value={summary.completed_issues}
              color="text-green-600"
            />
            <StatCard
              label="In Progress"
              value={summary.in_progress_issues}
              color="text-yellow-600"
            />
            <StatCard
              label="Remaining"
              value={summary.remaining_issues}
              color="text-blue-600"
            />
          </div>
        )}

        {/* Progress Bar */}
        {summary && summary.total_issues > 0 && (
          <div className="rounded-lg border border-border bg-background p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-foreground">Week Progress</span>
              <span className="text-sm text-muted">{progressPercent}% complete</span>
            </div>
            <div className="h-3 rounded-full bg-border overflow-hidden">
              <div
                className={cn(
                  'h-full transition-all',
                  progressPercent >= 100 ? 'bg-green-500' :
                  progressPercent >= 50 ? 'bg-yellow-500' : 'bg-blue-500'
                )}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        )}

        {/* Issue Groups */}
        {groups.length === 0 ? (
          <div className="rounded-lg border border-border bg-background p-8 text-center">
            <p className="text-muted">No issues found for this week</p>
            <p className="text-sm text-muted mt-1">
              {showMine ? 'Try unchecking "Show mine only"' : 'Issues will appear here when assigned to active sprints'}
            </p>
          </div>
        ) : (
          <div className="space-y-6">
            {groups.map((group) => (
              <IssueGroup key={`${group.sprint.id}-${group.program.id}`} group={group} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string;
  value: number;
  color: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <div className="text-xs font-medium text-muted uppercase tracking-wide">
        {label}
      </div>
      <div className={cn('text-2xl font-bold mt-1', color)}>{value}</div>
    </div>
  );
}

function IssueGroup({ group }: { group: SprintGroup }) {
  return (
    <div className="rounded-lg border border-border bg-background overflow-hidden">
      {/* Group Header */}
      <div className="flex items-center justify-between border-b border-border bg-background/50 px-4 py-3">
        <div className="flex items-center gap-3">
          <Link
            to={`/programs/${group.program.id}`}
            className="text-sm font-medium text-muted hover:text-foreground transition-colors"
          >
            {group.program.name}
          </Link>
          <span className="text-muted">/</span>
          <Link
            to={`/sprints/${group.sprint.id}`}
            className="font-medium text-foreground hover:text-accent transition-colors"
          >
            {group.sprint.name}
          </Link>
        </div>
        <span className="text-xs text-muted">
          {group.issues.length} issue{group.issues.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Issues List */}
      <div className="divide-y divide-border">
        {group.issues.map((issue) => (
          <IssueRow key={issue.id} issue={issue} />
        ))}
      </div>
    </div>
  );
}

function IssueRow({ issue }: { issue: Issue }) {
  return (
    <Link
      to={`/issues/${issue.id}`}
      className="flex items-center gap-3 px-4 py-3 hover:bg-background/80 transition-colors"
    >
      {/* State indicator */}
      <span className={cn('h-2.5 w-2.5 rounded-full flex-shrink-0', STATE_COLORS[issue.state])} />

      {/* Issue info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-mono text-muted">{issue.display_id}</span>
          <span className={cn('text-xs', priorityColors[issue.priority])}>
            {issue.priority !== 'none' && issue.priority.charAt(0).toUpperCase()}
          </span>
          {issue.estimate && (
            <span className="text-xs text-muted">{issue.estimate}h</span>
          )}
        </div>
        <p className="truncate text-sm text-foreground mt-0.5">{issue.title}</p>
      </div>

      {/* State label */}
      <span className="text-xs text-muted capitalize whitespace-nowrap">
        {STATE_LABELS[issue.state] || issue.state}
      </span>

      {/* Assignee */}
      {issue.assignee_name && (
        <span
          className="flex h-6 w-6 items-center justify-center rounded-full bg-accent/80 text-xs font-medium text-white flex-shrink-0"
          title={issue.assignee_name}
        >
          {issue.assignee_name.charAt(0).toUpperCase()}
        </span>
      )}
    </Link>
  );
}
