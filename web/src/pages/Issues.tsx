import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { KanbanBoard } from '@/components/KanbanBoard';
import { useIssues, Issue } from '@/contexts/IssuesContext';
import { IssuesListSkeleton } from '@/components/ui/Skeleton';
import { Combobox } from '@/components/ui/Combobox';
import { cn } from '@/lib/cn';

const SORT_OPTIONS = [
  { value: 'updated', label: 'Updated' },
  { value: 'created', label: 'Created' },
  { value: 'priority', label: 'Priority' },
  { value: 'title', label: 'Title' },
];

function useKeyboardShortcuts(shortcuts: Record<string, () => void>) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input or textarea
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      const key = e.key.toLowerCase();
      if (shortcuts[key]) {
        e.preventDefault();
        shortcuts[key]();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [shortcuts]);
}

type ViewMode = 'list' | 'kanban';

const STATE_LABELS: Record<string, string> = {
  backlog: 'Backlog',
  todo: 'Todo',
  in_progress: 'In Progress',
  done: 'Done',
  cancelled: 'Cancelled',
};

const PRIORITY_LABELS: Record<string, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  none: 'No Priority',
};

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'text-red-400',
  high: 'text-orange-400',
  medium: 'text-yellow-400',
  low: 'text-blue-400',
  none: 'text-muted',
};

export function IssuesPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { issues: allIssues, loading, createIssue: contextCreateIssue, updateIssue: contextUpdateIssue } = useIssues();
  const [viewMode, setViewMode] = useState<ViewMode>('kanban');
  const [sortBy, setSortBy] = useState<string>('updated');

  const stateFilter = searchParams.get('state') || '';

  // Filter issues client-side based on state filter
  const issues = useMemo(() => {
    if (!stateFilter) return allIssues;
    const states = stateFilter.split(',');
    return allIssues.filter(issue => states.includes(issue.state));
  }, [allIssues, stateFilter]);

  const handleCreateIssue = useCallback(async () => {
    const issue = await contextCreateIssue();
    if (issue) {
      navigate(`/issues/${issue.id}`);
    }
  }, [contextCreateIssue, navigate]);

  const setFilter = (state: string) => {
    setSearchParams((prev) => {
      if (state) {
        prev.set('state', state);
      } else {
        prev.delete('state');
      }
      return prev;
    });
  };

  const handleUpdateIssue = async (id: string, updates: { state: string }) => {
    await contextUpdateIssue(id, updates);
  };

  // Keyboard shortcuts - "c" to create issue
  // Memoize shortcuts object to prevent re-adding event listeners on every render
  const shortcuts = useMemo(() => ({
    c: handleCreateIssue,
  }), [handleCreateIssue]);

  useKeyboardShortcuts(shortcuts);

  if (loading) {
    return <IssuesListSkeleton />;
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <h1 className="text-xl font-semibold text-foreground">Issues</h1>
        <div className="flex items-center gap-3">
          {/* Sort dropdown */}
          <div className="w-32">
            <Combobox
              options={SORT_OPTIONS}
              value={sortBy}
              onChange={(v) => setSortBy(v || 'updated')}
              placeholder="Sort by"
              aria-label="Sort issues by"
              id="issues-sort"
              allowClear={false}
            />
          </div>
          {/* View toggle */}
          <div className="flex rounded-md border border-border" role="group" aria-label="View mode">
            <button
              onClick={() => setViewMode('list')}
              aria-label="List view"
              aria-pressed={viewMode === 'list'}
              className={cn(
                'px-3 py-1 text-sm transition-colors',
                viewMode === 'list' ? 'bg-border text-foreground' : 'text-muted hover:text-foreground'
              )}
            >
              <ListIcon aria-hidden="true" />
            </button>
            <button
              onClick={() => setViewMode('kanban')}
              aria-label="Kanban view"
              aria-pressed={viewMode === 'kanban'}
              className={cn(
                'px-3 py-1 text-sm transition-colors',
                viewMode === 'kanban' ? 'bg-border text-foreground' : 'text-muted hover:text-foreground'
              )}
            >
              <KanbanIcon aria-hidden="true" />
            </button>
          </div>
          <button
            onClick={handleCreateIssue}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 transition-colors"
          >
            New Issue
          </button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 border-b border-border px-6 py-2" role="tablist" aria-label="Issue filters">
        <FilterTab label="All" active={!stateFilter} onClick={() => setFilter('')} id="filter-all" />
        <FilterTab label="Active" active={stateFilter === 'todo,in_progress'} onClick={() => setFilter('todo,in_progress')} id="filter-active" />
        <FilterTab label="Backlog" active={stateFilter === 'backlog'} onClick={() => setFilter('backlog')} id="filter-backlog" />
        <FilterTab label="Done" active={stateFilter === 'done'} onClick={() => setFilter('done')} id="filter-done" />
      </div>

      {/* Content */}
      {viewMode === 'kanban' ? (
        <KanbanBoard
          issues={issues}
          onUpdateIssue={handleUpdateIssue}
          onIssueClick={(id) => navigate(`/issues/${id}`)}
        />
      ) : (
        <div className="flex-1 overflow-auto">
          {issues.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <p className="text-muted">No issues yet</p>
                <button
                  onClick={handleCreateIssue}
                  className="mt-2 text-sm text-accent hover:underline"
                >
                  Create your first issue
                </button>
              </div>
            </div>
          ) : (
            <table className="w-full">
              <thead className="sticky top-0 bg-background">
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="px-6 py-2 font-medium">ID</th>
                  <th className="px-6 py-2 font-medium">Title</th>
                  <th className="px-6 py-2 font-medium">Status</th>
                  <th className="px-6 py-2 font-medium">Priority</th>
                  <th className="px-6 py-2 font-medium">Assignee</th>
                  <th className="px-6 py-2 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody>
                {issues.map((issue) => (
                  <tr
                    key={issue.id}
                    onClick={() => navigate(`/issues/${issue.id}`)}
                    className="cursor-pointer border-b border-border/50 hover:bg-border/30 transition-colors"
                  >
                    <td className="px-6 py-3 text-sm text-muted">
                      #{issue.ticket_number}
                    </td>
                    <td className="px-6 py-3 text-sm text-foreground">
                      {issue.title}
                    </td>
                    <td className="px-6 py-3">
                      <StatusBadge state={issue.state} />
                    </td>
                    <td className="px-6 py-3">
                      <PriorityBadge priority={issue.priority} />
                    </td>
                    <td className="px-6 py-3 text-sm text-muted">
                      {issue.assignee_name || 'Unassigned'}
                    </td>
                    <td className="px-6 py-3 text-sm text-muted">
                      {issue.updated_at ? formatDate(issue.updated_at) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function FilterTab({ label, active, onClick, id }: { label: string; active: boolean; onClick: () => void; id: string }) {
  return (
    <button
      id={id}
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'rounded-md px-3 py-1 text-sm transition-colors',
        active
          ? 'bg-border text-foreground'
          : 'text-muted hover:bg-border/50 hover:text-foreground'
      )}
    >
      {label}
    </button>
  );
}

function StatusBadge({ state }: { state: string }) {
  const colors: Record<string, string> = {
    backlog: 'bg-gray-500/20 text-gray-400',
    todo: 'bg-blue-500/20 text-blue-400',
    in_progress: 'bg-yellow-500/20 text-yellow-400',
    done: 'bg-green-500/20 text-green-400',
    cancelled: 'bg-red-500/20 text-red-400',
  };

  const label = STATE_LABELS[state] || state;

  return (
    <span
      data-status-indicator
      data-status={state}
      aria-label={`Status: ${label}`}
      className={cn('inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium', colors[state] || colors.backlog)}
    >
      <StatusIcon state={state} />
      {label}
      <span className="sr-only">Status: {label}</span>
    </span>
  );
}

function StatusIcon({ state }: { state: string }) {
  const iconProps = { className: 'h-3 w-3', 'aria-hidden': 'true' as const };

  switch (state) {
    case 'backlog':
      return (
        <svg {...iconProps} viewBox="0 0 16 16" fill="none" stroke="currentColor">
          <circle cx="8" cy="8" r="6" strokeWidth="1.5" />
        </svg>
      );
    case 'todo':
      return (
        <svg {...iconProps} viewBox="0 0 16 16" fill="none" stroke="currentColor">
          <circle cx="8" cy="8" r="6" strokeWidth="1.5" />
          <path d="M8 2 A6 6 0 0 1 8 14" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'in_progress':
      return (
        <svg {...iconProps} viewBox="0 0 16 16" fill="none" stroke="currentColor">
          <circle cx="8" cy="8" r="6" strokeWidth="1.5" />
          <path d="M8 2 A6 6 0 1 1 2 8" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'done':
      return (
        <svg {...iconProps} viewBox="0 0 16 16" fill="currentColor">
          <circle cx="8" cy="8" r="6" />
          <path d="M5.5 8l2 2 3-4" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'cancelled':
      return (
        <svg {...iconProps} viewBox="0 0 16 16" fill="none" stroke="currentColor">
          <circle cx="8" cy="8" r="6" strokeWidth="1.5" />
          <path d="M5 5l6 6M11 5l-6 6" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    default:
      return (
        <svg {...iconProps} viewBox="0 0 16 16" fill="none" stroke="currentColor">
          <circle cx="8" cy="8" r="6" strokeWidth="1.5" />
        </svg>
      );
  }
}

function PriorityBadge({ priority }: { priority: string }) {
  return (
    <span className={cn('text-sm', PRIORITY_COLORS[priority] || PRIORITY_COLORS.none)}>
      {PRIORITY_LABELS[priority] || priority}
    </span>
  );
}

function formatDate(dateString: string): string {
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

function ListIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function KanbanIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
    </svg>
  );
}
