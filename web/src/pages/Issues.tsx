import { useState, useEffect, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { KanbanBoard } from '@/components/KanbanBoard';
import { cn } from '@/lib/cn';

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

interface Issue {
  id: string;
  title: string;
  state: string;
  priority: string;
  ticket_number: number;
  assignee_id: string | null;
  assignee_name: string | null;
  created_at: string;
  updated_at: string;
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

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
  const [issues, setIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<ViewMode>('list');

  const stateFilter = searchParams.get('state') || '';

  const fetchIssues = useCallback(async () => {
    try {
      let url = `${API_URL}/api/issues`;
      if (stateFilter) {
        url += `?state=${stateFilter}`;
      }
      const res = await fetch(url, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setIssues(data);
      }
    } catch (err) {
      console.error('Failed to fetch issues:', err);
    } finally {
      setLoading(false);
    }
  }, [stateFilter]);

  useEffect(() => {
    fetchIssues();
  }, [fetchIssues]);

  const createIssue = async () => {
    try {
      const res = await fetch(`${API_URL}/api/issues`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ title: 'Untitled Issue' }),
      });
      if (res.ok) {
        const issue = await res.json();
        navigate(`/issues/${issue.id}`);
      }
    } catch (err) {
      console.error('Failed to create issue:', err);
    }
  };

  const setFilter = (state: string) => {
    if (state) {
      setSearchParams({ state });
    } else {
      setSearchParams({});
    }
  };

  const updateIssue = async (id: string, updates: { state: string }) => {
    try {
      const res = await fetch(`${API_URL}/api/issues/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        // Optimistically update local state
        setIssues(prev => prev.map(issue =>
          issue.id === id ? { ...issue, ...updates } : issue
        ));
      }
    } catch (err) {
      console.error('Failed to update issue:', err);
    }
  };

  // Keyboard shortcuts - "c" to create issue
  useKeyboardShortcuts({
    c: createIssue,
  });

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted">Loading...</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <h1 className="text-xl font-semibold text-foreground">Issues</h1>
        <div className="flex items-center gap-3">
          {/* View toggle */}
          <div className="flex rounded-md border border-border">
            <button
              onClick={() => setViewMode('list')}
              className={cn(
                'px-3 py-1 text-sm transition-colors',
                viewMode === 'list' ? 'bg-border text-foreground' : 'text-muted hover:text-foreground'
              )}
            >
              <ListIcon />
            </button>
            <button
              onClick={() => setViewMode('kanban')}
              className={cn(
                'px-3 py-1 text-sm transition-colors',
                viewMode === 'kanban' ? 'bg-border text-foreground' : 'text-muted hover:text-foreground'
              )}
            >
              <KanbanIcon />
            </button>
          </div>
          <button
            onClick={createIssue}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 transition-colors"
          >
            New Issue
          </button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 border-b border-border px-6 py-2">
        <FilterTab label="All" active={!stateFilter} onClick={() => setFilter('')} />
        <FilterTab label="Active" active={stateFilter === 'todo,in_progress'} onClick={() => setFilter('todo,in_progress')} />
        <FilterTab label="Backlog" active={stateFilter === 'backlog'} onClick={() => setFilter('backlog')} />
        <FilterTab label="Done" active={stateFilter === 'done'} onClick={() => setFilter('done')} />
      </div>

      {/* Content */}
      {viewMode === 'kanban' ? (
        <KanbanBoard
          issues={issues}
          onUpdateIssue={updateIssue}
          onIssueClick={(id) => navigate(`/issues/${id}`)}
        />
      ) : (
        <div className="flex-1 overflow-auto">
          {issues.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <p className="text-muted">No issues yet</p>
                <button
                  onClick={createIssue}
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
                      {formatDate(issue.updated_at)}
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

function FilterTab({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
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

  return (
    <span className={cn('rounded px-2 py-0.5 text-xs font-medium', colors[state] || colors.backlog)}>
      {STATE_LABELS[state] || state}
    </span>
  );
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
