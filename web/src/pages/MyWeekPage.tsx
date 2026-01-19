import { useState, useEffect, useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { apiGet, apiPatch } from '@/lib/api';
import { cn } from '@/lib/cn';
import { priorityColors } from '@/lib/statusColors';
import { KanbanBoard } from '@/components/KanbanBoard';
import { useToast } from '@/components/ui/Toast';

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
    sprint_number: number;
    current_sprint_number: number;
    start_date: string;
    end_date: string;
    days_remaining: number;
    is_historical: boolean;
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
  const [selectedSprintNumber, setSelectedSprintNumber] = useState<number | null>(null);
  const [viewMode, setViewMode] = useState<'list' | 'kanban'>(() => {
    const saved = localStorage.getItem('my-week-view');
    if (saved === 'kanban') return 'kanban';
    return 'list';
  });

  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { showToast } = useToast();

  // Build query params
  const queryParams = new URLSearchParams();
  if (showMine) queryParams.set('show_mine', 'true');
  if (stateFilter !== 'all') queryParams.set('state', stateFilter);
  if (selectedSprintNumber !== null) queryParams.set('sprint_number', String(selectedSprintNumber));
  const queryString = queryParams.toString();

  const { data, isLoading, error } = useQuery<MyWeekData>({
    queryKey: ['my-week', showMine, stateFilter, selectedSprintNumber],
    queryFn: async () => {
      const url = queryString
        ? `/api/sprints/my-week?${queryString}`
        : '/api/sprints/my-week';
      const response = await apiGet(url);
      if (!response.ok) throw new Error('Failed to fetch week data');
      return response.json();
    },
  });

  // Persist view mode to localStorage
  useEffect(() => {
    localStorage.setItem('my-week-view', viewMode);
  }, [viewMode]);

  // Flatten all issues from all groups for kanban view
  const allIssues = useMemo(() => {
    if (!data?.groups) return [];
    return data.groups.flatMap(group => group.issues);
  }, [data?.groups]);

  // Handle issue state update from kanban drag-drop
  const handleUpdateIssue = useCallback(async (issueId: string, updates: { state: string }) => {
    try {
      const res = await apiPatch(`/api/issues/${issueId}`, updates);
      if (res.ok) {
        // Invalidate my-week query to refresh the list
        queryClient.invalidateQueries({ queryKey: ['my-week'] });
      } else {
        const errorData = await res.json();
        showToast(errorData.error || 'Failed to update issue', 'error');
      }
    } catch (err) {
      console.error('Failed to update issue:', err);
      showToast('Failed to update issue', 'error');
    }
  }, [queryClient, showToast]);

  // Handle issue click from kanban
  const handleIssueClick = useCallback((issueId: string) => {
    navigate(`/issues/${issueId}`);
  }, [navigate]);

  // Generate week options for the picker (current week + past 12 weeks)
  // Must be before early returns to maintain hooks order
  const weekOptions = useMemo(() => {
    if (!data?.week?.current_sprint_number) return [];
    const options: { value: number; label: string }[] = [];
    const currentNum = data.week.current_sprint_number;

    for (let i = 0; i <= 12; i++) {
      const sprintNum = currentNum - i;
      if (sprintNum <= 0) break;
      options.push({
        value: sprintNum,
        label: i === 0 ? `Sprint ${sprintNum} (Current)` : `Sprint ${sprintNum}`,
      });
    }
    return options;
  }, [data?.week?.current_sprint_number]);

  // Format date range for display
  const formatDateRange = useCallback((startDate: string, endDate: string) => {
    const start = new Date(startDate + 'T00:00:00');
    const end = new Date(endDate + 'T00:00:00');
    const options: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
    return `${start.toLocaleDateString('en-US', options)} - ${end.toLocaleDateString('en-US', options)}`;
  }, []);

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

  // Is this a historical view?
  const isHistorical = week?.is_historical ?? false;

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mx-auto max-w-5xl space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-foreground">My Week</h1>
              {/* Week Picker Dropdown */}
              {weekOptions.length > 0 && (
                <select
                  value={selectedSprintNumber ?? week?.current_sprint_number ?? ''}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    // Reset to current week if selecting current
                    if (val === week?.current_sprint_number) {
                      setSelectedSprintNumber(null);
                    } else {
                      setSelectedSprintNumber(val);
                    }
                  }}
                  className="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground"
                >
                  {weekOptions.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              )}
            </div>
            <p className="mt-1 text-sm text-muted">
              {isHistorical ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="inline-block h-2 w-2 rounded-full bg-amber-500" />
                  <span className="text-amber-600 font-medium">Viewing {week && formatDateRange(week.start_date, week.end_date)}</span>
                  <span className="text-muted">&middot; Historical view (read-only)</span>
                </span>
              ) : (
                <>
                  {week && formatDateRange(week.start_date, week.end_date)} &middot; {week?.days_remaining} days remaining
                </>
              )}
            </p>
          </div>

          {/* Filters and View Toggle */}
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

            {/* View Toggle */}
            <div className="flex items-center border border-border rounded-md bg-border/30 p-0.5">
              <button
                type="button"
                onClick={() => setViewMode('list')}
                className={cn(
                  'flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded transition-colors',
                  viewMode === 'list'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted hover:text-foreground'
                )}
                aria-pressed={viewMode === 'list'}
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
                </svg>
                List
              </button>
              <button
                type="button"
                onClick={() => setViewMode('kanban')}
                className={cn(
                  'flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded transition-colors',
                  viewMode === 'kanban'
                    ? 'bg-background text-foreground shadow-sm'
                    : 'text-muted hover:text-foreground'
                )}
                aria-pressed={viewMode === 'kanban'}
              >
                <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                  <path d="M5 3a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2V5a2 2 0 00-2-2H5zm0 2h3v10H5V5zm5 0h3v10h-3V5zm5 0h0v10h0V5z" />
                </svg>
                Board
              </button>
            </div>
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

        {/* Issue View (List or Kanban) */}
        {viewMode === 'kanban' ? (
          allIssues.length === 0 ? (
            <div className="rounded-lg border border-border bg-background p-8 text-center">
              <p className="text-muted">No issues found for this week</p>
              <p className="text-sm text-muted mt-1">
                {showMine ? 'Try unchecking "Show mine only"' : 'Issues will appear here when assigned to active sprints'}
              </p>
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-background overflow-hidden -mx-6">
              <KanbanBoard
                issues={allIssues}
                onUpdateIssue={handleUpdateIssue}
                onIssueClick={handleIssueClick}
                disabled={isHistorical}
              />
            </div>
          )
        ) : (
          /* List View (grouped by sprint) */
          groups.length === 0 ? (
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
          )
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
