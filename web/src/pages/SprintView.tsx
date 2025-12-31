import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { cn } from '@/lib/cn';

interface Sprint {
  id: string;
  program_id: string;
  program_name: string;
  program_prefix: string;
  name: string;
  goal: string | null;
  start_date: string;
  end_date: string;
  status: 'planned' | 'active' | 'completed';
  issue_count: number;
  completed_count: number;
}

interface Issue {
  id: string;
  title: string;
  state: string;
  priority: string;
  ticket_number: number;
  assignee_name: string | null;
  display_id: string;
}

const API_URL = import.meta.env.VITE_API_URL ?? (import.meta.env.DEV ? 'http://localhost:3000' : '');

export function SprintViewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [sprint, setSprint] = useState<Sprint | null>(null);
  const [sprintIssues, setSprintIssues] = useState<Issue[]>([]);
  const [backlogIssues, setBacklogIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalText, setGoalText] = useState('');

  // Reset state and fetch data when sprint ID changes
  useEffect(() => {
    if (!id) return;

    // Reset state for new sprint
    setSprint(null);
    setSprintIssues([]);
    setBacklogIssues([]);
    setLoading(true);
    setEditingGoal(false);

    let cancelled = false;

    async function fetchData() {
      try {
        const sprintRes = await fetch(`${API_URL}/api/sprints/${id}`, { credentials: 'include' });

        if (cancelled) return;

        if (!sprintRes.ok) {
          navigate('/programs');
          return;
        }

        const sprintData = await sprintRes.json();
        if (cancelled) return;

        setSprint(sprintData);
        setGoalText(sprintData.goal || '');

        // Fetch sprint issues and backlog (program issues not in any sprint)
        const [sprintIssuesRes, backlogRes] = await Promise.all([
          fetch(`${API_URL}/api/sprints/${id}/issues`, { credentials: 'include' }),
          fetch(`${API_URL}/api/programs/${sprintData.program_id}/issues`, { credentials: 'include' }),
        ]);

        if (cancelled) return;

        if (sprintIssuesRes.ok) {
          setSprintIssues(await sprintIssuesRes.json());
        }

        if (backlogRes.ok) {
          const programIssues = await backlogRes.json();
          // Filter to only show issues not in any sprint
          setBacklogIssues(programIssues.filter((i: Issue & { sprint_id: string | null }) => !i.sprint_id));
        }
      } catch (err) {
        if (!cancelled) console.error('Failed to fetch sprint:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, [id, navigate]);

  const moveToSprint = async (issueId: string) => {
    if (!id) return;
    try {
      const res = await fetch(`${API_URL}/api/issues/${issueId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ sprint_id: id }),
      });

      if (res.ok) {
        const issue = backlogIssues.find(i => i.id === issueId);
        if (issue) {
          setBacklogIssues(prev => prev.filter(i => i.id !== issueId));
          setSprintIssues(prev => [...prev, issue]);
        }
      }
    } catch (err) {
      console.error('Failed to move issue:', err);
    }
  };

  const moveToBacklog = async (issueId: string) => {
    try {
      const res = await fetch(`${API_URL}/api/issues/${issueId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ sprint_id: null }),
      });

      if (res.ok) {
        const issue = sprintIssues.find(i => i.id === issueId);
        if (issue) {
          setSprintIssues(prev => prev.filter(i => i.id !== issueId));
          setBacklogIssues(prev => [...prev, issue]);
        }
      }
    } catch (err) {
      console.error('Failed to move issue:', err);
    }
  };

  const updateSprintStatus = async (status: Sprint['status']) => {
    if (!id) return;
    try {
      const res = await fetch(`${API_URL}/api/sprints/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ sprint_status: status }),
      });

      if (res.ok) {
        setSprint(prev => prev ? { ...prev, status } : null);
      }
    } catch (err) {
      console.error('Failed to update sprint:', err);
    }
  };

  const saveGoal = async () => {
    if (!id) return;
    try {
      const res = await fetch(`${API_URL}/api/sprints/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ goal: goalText || null }),
      });

      if (res.ok) {
        setSprint(prev => prev ? { ...prev, goal: goalText || null } : null);
        setEditingGoal(false);
      }
    } catch (err) {
      console.error('Failed to update goal:', err);
    }
  };

  const createSprintDocument = async (docType: 'sprint_plan' | 'sprint_retro') => {
    if (!id || !sprint) return;
    try {
      const title = docType === 'sprint_plan'
        ? `${sprint.name} - Sprint Plan`
        : `${sprint.name} - Retrospective`;

      const res = await fetch(`${API_URL}/api/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          title,
          document_type: docType,
          sprint_id: id,
        }),
      });

      if (res.ok) {
        const doc = await res.json();
        navigate(`/docs/${doc.id}`);
      }
    } catch (err) {
      console.error('Failed to create document:', err);
    }
  };

  if (loading || !sprint) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted">Loading...</div>
      </div>
    );
  }

  const progress = sprintIssues.length > 0
    ? Math.round((sprintIssues.filter(i => i.state === 'done').length / sprintIssues.length) * 100)
    : 0;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-border px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => navigate(`/programs/${sprint.program_id}`)}
              className="text-muted hover:text-foreground transition-colors"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
              </svg>
            </button>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-semibold text-foreground">{sprint.name}</h1>
                <StatusBadge status={sprint.status} />
              </div>
              <p className="text-xs text-muted">
                {sprint.program_name} &middot; {formatDate(sprint.start_date)} - {formatDate(sprint.end_date)}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => createSprintDocument('sprint_plan')}
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-border/50 transition-colors"
            >
              Sprint Plan
            </button>
            <button
              onClick={() => createSprintDocument('sprint_retro')}
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium text-foreground hover:bg-border/50 transition-colors"
            >
              Retrospective
            </button>
            {sprint.status === 'planned' && (
              <button
                onClick={() => updateSprintStatus('active')}
                className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 transition-colors"
              >
                Start Sprint
              </button>
            )}
            {sprint.status === 'active' && (
              <button
                onClick={() => updateSprintStatus('completed')}
                className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 transition-colors"
              >
                Complete Sprint
              </button>
            )}
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-4 flex items-center gap-3">
          <div className="flex-1 h-2 rounded-full bg-border overflow-hidden">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-sm text-muted">
            {progress}% complete ({sprintIssues.filter(i => i.state === 'done').length}/{sprintIssues.length})
          </span>
        </div>

        {/* Goal */}
        <div className="mt-3">
          {editingGoal ? (
            <div className="flex gap-2">
              <input
                type="text"
                value={goalText}
                onChange={(e) => setGoalText(e.target.value)}
                placeholder="Sprint goal..."
                className="flex-1 rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveGoal();
                  if (e.key === 'Escape') setEditingGoal(false);
                }}
              />
              <button
                onClick={saveGoal}
                className="rounded-md bg-accent px-3 py-1.5 text-sm text-white hover:bg-accent/90"
              >
                Save
              </button>
              <button
                onClick={() => setEditingGoal(false)}
                className="rounded-md px-3 py-1.5 text-sm text-muted hover:bg-border"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setEditingGoal(true)}
              className="text-sm text-muted hover:text-foreground transition-colors"
            >
              {sprint.goal || 'Click to add a sprint goal...'}
            </button>
          )}
        </div>
      </div>

      {/* Sprint planning columns */}
      <div className="flex flex-1 overflow-hidden">
        {/* Backlog column */}
        <div className="flex w-1/2 flex-col border-r border-border">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="font-medium text-foreground">Backlog</h2>
            <span className="text-sm text-muted">{backlogIssues.length} issues</span>
          </div>
          <div className="flex-1 overflow-auto p-4 space-y-2">
            {backlogIssues.map((issue) => (
              <IssueCard
                key={issue.id}
                issue={issue}
                action="add"
                onClick={() => navigate(`/issues/${issue.id}`)}
                onAction={() => moveToSprint(issue.id)}
              />
            ))}
            {backlogIssues.length === 0 && (
              <p className="text-center text-sm text-muted py-8">No issues in backlog</p>
            )}
          </div>
        </div>

        {/* Sprint column */}
        <div className="flex w-1/2 flex-col">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <h2 className="font-medium text-foreground">Sprint</h2>
            <span className="text-sm text-muted">{sprintIssues.length} issues</span>
          </div>
          <div className="flex-1 overflow-auto p-4 space-y-2">
            {sprintIssues.map((issue) => (
              <IssueCard
                key={issue.id}
                issue={issue}
                action="remove"
                onClick={() => navigate(`/issues/${issue.id}`)}
                onAction={() => moveToBacklog(issue.id)}
              />
            ))}
            {sprintIssues.length === 0 && (
              <p className="text-center text-sm text-muted py-8">Add issues from the backlog</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: Sprint['status'] }) {
  const colors: Record<string, string> = {
    planned: 'bg-gray-500/20 text-gray-400',
    active: 'bg-green-500/20 text-green-400',
    completed: 'bg-blue-500/20 text-blue-400',
  };

  return (
    <span className={cn('rounded px-2 py-0.5 text-xs font-medium capitalize', colors[status])}>
      {status}
    </span>
  );
}

function IssueCard({
  issue,
  action,
  onClick,
  onAction,
}: {
  issue: Issue;
  action: 'add' | 'remove';
  onClick: () => void;
  onAction: () => void;
}) {
  const stateColors: Record<string, string> = {
    backlog: 'bg-gray-500',
    todo: 'bg-blue-500',
    in_progress: 'bg-yellow-500',
    done: 'bg-green-500',
    cancelled: 'bg-red-500',
  };

  const priorityColors: Record<string, string> = {
    urgent: 'text-red-400',
    high: 'text-orange-400',
    medium: 'text-yellow-400',
    low: 'text-blue-400',
    none: 'text-muted',
  };

  return (
    <div className="group flex items-center gap-2 rounded-lg border border-border bg-background p-3 hover:bg-border/30 transition-colors">
      <button
        onClick={(e) => {
          e.stopPropagation();
          onAction();
        }}
        className={cn(
          'flex h-6 w-6 items-center justify-center rounded text-white transition-colors',
          action === 'add'
            ? 'bg-green-600 hover:bg-green-700'
            : 'bg-red-600 hover:bg-red-700'
        )}
        title={action === 'add' ? 'Add to sprint' : 'Remove from sprint'}
      >
        {action === 'add' ? '+' : '-'}
      </button>

      <button onClick={onClick} className="flex-1 text-left">
        <div className="flex items-center gap-2">
          <span className={cn('h-2 w-2 rounded-full flex-shrink-0', stateColors[issue.state])} />
          <span className="text-xs font-mono text-muted">{issue.display_id}</span>
          <span className={cn('text-xs', priorityColors[issue.priority])}>
            {issue.priority !== 'none' && issue.priority.charAt(0).toUpperCase()}
          </span>
        </div>
        <p className="mt-1 text-sm text-foreground truncate">{issue.title}</p>
      </button>
    </div>
  );
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
