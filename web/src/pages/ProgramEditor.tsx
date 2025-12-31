import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Editor } from '@/components/Editor';
import { useAuth } from '@/hooks/useAuth';
import { usePrograms, Program } from '@/contexts/ProgramsContext';
import { cn } from '@/lib/cn';
import { EditorSkeleton } from '@/components/ui/Skeleton';
import { TabBar, Tab as TabItem } from '@/components/ui/TabBar';
import { KanbanBoard } from '@/components/KanbanBoard';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// CSRF token cache
let csrfToken: string | null = null;

async function getCsrfToken(): Promise<string> {
  if (!csrfToken) {
    const response = await fetch(`${API_URL}/api/csrf-token`, {
      credentials: 'include',
    });
    const data = await response.json();
    csrfToken = data.token;
  }
  return csrfToken!;
}

async function apiPost(endpoint: string, body?: object) {
  const token = await getCsrfToken();
  const res = await fetch(`${API_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': token,
    },
    credentials: 'include',
    body: body ? JSON.stringify(body) : undefined,
  });

  if (res.status === 403) {
    csrfToken = null;
    const newToken = await getCsrfToken();
    return fetch(`${API_URL}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': newToken,
      },
      credentials: 'include',
      body: body ? JSON.stringify(body) : undefined,
    });
  }
  return res;
}

const PROGRAM_COLORS = [
  '#6366f1', // Indigo
  '#8b5cf6', // Violet
  '#ec4899', // Pink
  '#f43f5e', // Rose
  '#ef4444', // Red
  '#f97316', // Orange
  '#eab308', // Yellow
  '#22c55e', // Green
  '#14b8a6', // Teal
  '#06b6d4', // Cyan
  '#3b82f6', // Blue
];

interface Issue {
  id: string;
  title: string;
  state: string;
  priority: string;
  ticket_number: number;
  assignee_id: string | null;
  assignee_name: string | null;
  display_id: string;
  sprint_ref_id: string | null;
}

interface Sprint {
  id: string;
  name: string;
  goal: string | null;
  start_date: string;
  end_date: string;
  status: 'planned' | 'active' | 'completed';
  issue_count: number;
  completed_count: number;
}

type Tab = 'overview' | 'issues' | 'sprints' | 'feedback';

interface Feedback {
  id: string;
  title: string;
  state: string;
  ticket_number: number;
  display_id: string;
  created_at: string;
  created_by_name: string | null;
  rejection_reason: string | null;
}

export function ProgramEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { programs, loading, updateProgram: contextUpdateProgram } = usePrograms();

  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [issues, setIssues] = useState<Issue[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [issuesLoading, setIssuesLoading] = useState(false);
  const [sprintsLoading, setSprintsLoading] = useState(false);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'kanban'>('list');
  const [feedbackFilter, setFeedbackFilter] = useState<'new' | 'backlog' | 'closed' | 'all'>('new');
  const [showCreateSprintModal, setShowCreateSprintModal] = useState(false);

  // Get the current program from context
  const program = programs.find(p => p.id === id) || null;

  useEffect(() => {
    // If programs are loaded but this program isn't found, redirect
    if (!loading && id && !program) {
      navigate('/programs');
    }
  }, [loading, id, program, navigate]);

  // Fetch issues when switching to issues tab
  useEffect(() => {
    if (activeTab === 'issues' && id && issues.length === 0) {
      setIssuesLoading(true);
      fetch(`${API_URL}/api/programs/${id}/issues`, { credentials: 'include' })
        .then(res => res.ok ? res.json() : [])
        .then(setIssues)
        .catch(console.error)
        .finally(() => setIssuesLoading(false));
    }
  }, [activeTab, id, issues.length]);

  // Fetch sprints when switching to sprints tab
  useEffect(() => {
    if (activeTab === 'sprints' && id && sprints.length === 0) {
      setSprintsLoading(true);
      fetch(`${API_URL}/api/programs/${id}/sprints`, { credentials: 'include' })
        .then(res => res.ok ? res.json() : [])
        .then(setSprints)
        .catch(console.error)
        .finally(() => setSprintsLoading(false));
    }
  }, [activeTab, id, sprints.length]);

  // Fetch feedback when switching to feedback tab
  const fetchFeedback = useCallback(() => {
    if (!id) return;
    setFeedbackLoading(true);
    fetch(`${API_URL}/api/issues?source=feedback&program_id=${id}`, { credentials: 'include' })
      .then(res => res.ok ? res.json() : [])
      .then(setFeedback)
      .catch(console.error)
      .finally(() => setFeedbackLoading(false));
  }, [id]);

  useEffect(() => {
    if (activeTab === 'feedback' && id && feedback.length === 0) {
      fetchFeedback();
    }
  }, [activeTab, id, feedback.length, fetchFeedback]);

  const handleUpdateProgram = useCallback(async (updates: Partial<Program>) => {
    if (!id) return;
    await contextUpdateProgram(id, updates);
  }, [id, contextUpdateProgram]);

  const handleTitleChange = useCallback((newTitle: string) => {
    handleUpdateProgram({ name: newTitle });
  }, [handleUpdateProgram]);

  const createIssue = async () => {
    if (!id) return;
    try {
      const res = await apiPost('/api/issues', { title: 'Untitled', program_id: id });
      if (res.ok) {
        const issue = await res.json();
        navigate(`/issues/${issue.id}`);
      }
    } catch (err) {
      console.error('Failed to create issue:', err);
    }
  };

  const createSprint = async (data: { name: string; goal: string; start_date: string; end_date: string }) => {
    if (!id) return;
    try {
      const res = await apiPost('/api/sprints', { title: data.name, goal: data.goal, start_date: data.start_date, end_date: data.end_date, program_id: id });
      if (res.ok) {
        const sprint = await res.json();
        setSprints(prev => [sprint, ...prev]);
        setShowCreateSprintModal(false);
      } else {
        const error = await res.json();
        alert(error.error || 'Failed to create sprint');
      }
    } catch (err) {
      console.error('Failed to create sprint:', err);
    }
  };

  const updateIssue = async (issueId: string, updates: { state: string }) => {
    try {
      const res = await fetch(`${API_URL}/api/issues/${issueId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        setIssues(prev => prev.map(issue =>
          issue.id === issueId ? { ...issue, ...updates } : issue
        ));
      }
    } catch (err) {
      console.error('Failed to update issue:', err);
    }
  };

  if (loading) {
    return <EditorSkeleton />;
  }

  if (!program || !user) {
    return null;
  }

  const tabs: TabItem[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'issues', label: 'Issues' },
    { id: 'sprints', label: 'Sprints' },
    { id: 'feedback', label: 'Feedback' },
  ];

  const renderTabActions = () => {
    if (activeTab === 'issues') {
      return (
        <>
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
        </>
      );
    }
    if (activeTab === 'sprints') {
      return (
        <button
          onClick={() => setShowCreateSprintModal(true)}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 transition-colors"
        >
          New Sprint
        </button>
      );
    }
    if (activeTab === 'feedback') {
      return (
        <button
          onClick={() => navigate(`/feedback/new?program_id=${id}`)}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 transition-colors"
        >
          Give Feedback
        </button>
      );
    }
    return null;
  };

  return (
    <div className="flex h-full flex-col">
      {/* Tab Bar */}
      <TabBar
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={(tabId) => setActiveTab(tabId as Tab)}
        rightContent={renderTabActions()}
      />

      {/* Content */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'overview' && (
          <OverviewTab
            program={program}
            user={user}
            onTitleChange={handleTitleChange}
            onUpdateProgram={handleUpdateProgram}
          />
        )}

        {activeTab === 'issues' && (
          <div className="h-full overflow-auto">
            {issuesLoading ? (
              <div className="flex h-full items-center justify-center">
                <div className="text-muted">Loading issues...</div>
              </div>
            ) : viewMode === 'kanban' ? (
              <KanbanBoard
                issues={issues}
                onUpdateIssue={updateIssue}
                onIssueClick={(issueId) => navigate(`/issues/${issueId}`)}
              />
            ) : (
              <IssuesList issues={issues} onIssueClick={(issueId) => navigate(`/issues/${issueId}`)} />
            )}
          </div>
        )}

        {activeTab === 'sprints' && (
          <div className="h-full overflow-auto">
            {sprintsLoading ? (
              <div className="flex h-full items-center justify-center">
                <div className="text-muted">Loading sprints...</div>
              </div>
            ) : (
              <SprintsList
                sprints={sprints}
                onSprintClick={(sprintId) => navigate(`/sprints/${sprintId}/view`)}
              />
            )}
          </div>
        )}

        {activeTab === 'feedback' && (
          <div className="h-full overflow-auto">
            {feedbackLoading ? (
              <div className="flex h-full items-center justify-center">
                <div className="text-muted">Loading feedback...</div>
              </div>
            ) : (
              <FeedbackList
                feedback={feedback}
                filter={feedbackFilter}
                onFilterChange={setFeedbackFilter}
                onFeedbackClick={(feedbackId) => navigate(`/feedback/${feedbackId}`)}
                onAccept={async (feedbackId) => {
                  try {
                    const res = await apiPost(`/api/feedback/${feedbackId}/accept`);
                    if (res.ok) {
                      fetchFeedback();
                    }
                  } catch (err) {
                    console.error('Failed to accept feedback:', err);
                  }
                }}
                onReject={async (feedbackId, reason) => {
                  try {
                    const res = await apiPost(`/api/feedback/${feedbackId}/reject`, { reason });
                    if (res.ok) {
                      fetchFeedback();
                    }
                  } catch (err) {
                    console.error('Failed to reject feedback:', err);
                  }
                }}
              />
            )}
          </div>
        )}
      </div>

      {showCreateSprintModal && (
        <CreateSprintModal
          onClose={() => setShowCreateSprintModal(false)}
          onCreate={createSprint}
        />
      )}
    </div>
  );
}

function OverviewTab({
  program,
  user,
  onTitleChange,
  onUpdateProgram,
}: {
  program: Program;
  user: { name: string };
  onTitleChange: (title: string) => void;
  onUpdateProgram: (updates: Partial<Program>) => void;
}) {
  return (
    <Editor
      documentId={program.id}
      userName={user.name}
      initialTitle={program.name}
      onTitleChange={onTitleChange}
      roomPrefix="program"
      placeholder="Describe this program..."
      sidebar={
        <div className="space-y-4 p-4">
          <PropertyRow label="Prefix">
            <input
              type="text"
              value={program.prefix}
              disabled
              className="w-full rounded bg-border/50 px-2 py-1 text-sm font-mono text-muted cursor-not-allowed"
            />
            <p className="mt-1 text-xs text-muted">Cannot be changed</p>
          </PropertyRow>

          <PropertyRow label="Color">
            <div className="flex flex-wrap gap-1.5">
              {PROGRAM_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => onUpdateProgram({ color: c })}
                  className={cn(
                    'h-6 w-6 rounded-full transition-transform',
                    program.color === c ? 'ring-2 ring-white ring-offset-1 ring-offset-background scale-110' : 'hover:scale-105'
                  )}
                  style={{ backgroundColor: c }}
                />
              ))}
            </div>
          </PropertyRow>
        </div>
      }
    />
  );
}

function PropertyRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted">{label}</label>
      {children}
    </div>
  );
}

function IssuesList({ issues, onIssueClick }: { issues: Issue[]; onIssueClick: (id: string) => void }) {
  const stateColors: Record<string, string> = {
    backlog: 'bg-gray-500/20 text-gray-400',
    todo: 'bg-blue-500/20 text-blue-400',
    in_progress: 'bg-yellow-500/20 text-yellow-400',
    done: 'bg-green-500/20 text-green-400',
    cancelled: 'bg-red-500/20 text-red-400',
  };

  const stateLabels: Record<string, string> = {
    backlog: 'Backlog',
    todo: 'Todo',
    in_progress: 'In Progress',
    done: 'Done',
    cancelled: 'Cancelled',
  };

  if (issues.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted">No issues in this program</p>
      </div>
    );
  }

  return (
    <table className="w-full">
      <thead className="sticky top-0 bg-background">
        <tr className="border-b border-border text-left text-xs text-muted">
          <th className="px-6 py-2 font-medium">ID</th>
          <th className="px-6 py-2 font-medium">Title</th>
          <th className="px-6 py-2 font-medium">Status</th>
          <th className="px-6 py-2 font-medium">Assignee</th>
        </tr>
      </thead>
      <tbody>
        {issues.map((issue) => (
          <tr
            key={issue.id}
            onClick={() => onIssueClick(issue.id)}
            className="cursor-pointer border-b border-border/50 hover:bg-border/30 transition-colors"
          >
            <td className="px-6 py-3 text-sm font-mono text-muted">
              {issue.display_id}
            </td>
            <td className="px-6 py-3 text-sm text-foreground">
              {issue.title}
            </td>
            <td className="px-6 py-3">
              <span className={cn('rounded px-2 py-0.5 text-xs font-medium', stateColors[issue.state])}>
                {stateLabels[issue.state] || issue.state}
              </span>
            </td>
            <td className="px-6 py-3 text-sm text-muted">
              {issue.assignee_name || 'Unassigned'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SprintsList({ sprints, onSprintClick }: { sprints: Sprint[]; onSprintClick: (id: string) => void }) {
  const [completedExpanded, setCompletedExpanded] = useState(false);

  if (sprints.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted">No sprints in this program</p>
      </div>
    );
  }

  // Group sprints by status
  const grouped = {
    active: sprints.filter(s => s.status === 'active'),
    upcoming: sprints
      .filter(s => s.status === 'planned')
      .sort((a, b) => new Date(a.start_date).getTime() - new Date(b.start_date).getTime()),
    completed: sprints
      .filter(s => s.status === 'completed')
      .sort((a, b) => new Date(b.end_date).getTime() - new Date(a.end_date).getTime()),
  };

  return (
    <div className="p-6 space-y-6">
      {/* Active Sprint - Hero Card */}
      {grouped.active.map((sprint) => (
        <ActiveSprintCard key={sprint.id} sprint={sprint} onClick={() => onSprintClick(sprint.id)} />
      ))}

      {/* Upcoming Section */}
      {grouped.upcoming.length > 0 && (
        <div>
          <h3 className="mb-3 text-sm font-medium text-muted">Upcoming ({grouped.upcoming.length})</h3>
          <div className="space-y-2">
            {grouped.upcoming.map((sprint) => (
              <UpcomingSprintRow key={sprint.id} sprint={sprint} onClick={() => onSprintClick(sprint.id)} />
            ))}
          </div>
        </div>
      )}

      {/* Completed Section - Collapsible */}
      {grouped.completed.length > 0 && (
        <div>
          <button
            onClick={() => setCompletedExpanded(!completedExpanded)}
            className="flex w-full items-center gap-2 text-sm font-medium text-muted hover:text-foreground transition-colors"
          >
            <ChevronIcon expanded={completedExpanded} />
            Completed ({grouped.completed.length})
          </button>
          {completedExpanded && (
            <div className="mt-3 space-y-2">
              {grouped.completed.map((sprint) => (
                <CompletedSprintRow key={sprint.id} sprint={sprint} onClick={() => onSprintClick(sprint.id)} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ActiveSprintCard({ sprint, onClick }: { sprint: Sprint; onClick: () => void }) {
  const progress = sprint.issue_count > 0
    ? Math.round((sprint.completed_count / sprint.issue_count) * 100)
    : 0;

  const daysRemaining = Math.max(0, Math.ceil(
    (new Date(sprint.end_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  ));

  return (
    <button
      onClick={onClick}
      className="w-full rounded-lg border border-border border-l-4 border-l-accent bg-background p-6 text-left transition-colors hover:bg-border/30"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-foreground">{sprint.name}</h3>
        <span className="text-sm text-muted">
          {daysRemaining} {daysRemaining === 1 ? 'day' : 'days'} remaining
        </span>
      </div>

      {sprint.goal && (
        <p className="mt-2 text-sm text-muted">{sprint.goal}</p>
      )}

      <div className="mt-4 flex items-center gap-3">
        <div className="flex-1 h-3 rounded-full bg-border overflow-hidden">
          <div
            className="h-full bg-accent transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
        <span className="text-sm font-medium text-foreground">
          {sprint.completed_count}/{sprint.issue_count} done
        </span>
      </div>
    </button>
  );
}

function UpcomingSprintRow({ sprint, onClick }: { sprint: Sprint; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-border/30"
    >
      <span className="font-medium text-foreground">{sprint.name}</span>
      <span className="mx-2 text-muted">·</span>
      <span className="text-muted">Starts {formatDate(sprint.start_date)}</span>
      <span className="mx-2 text-muted">·</span>
      <span className="text-muted">{sprint.issue_count} issues</span>
    </button>
  );
}

function CompletedSprintRow({ sprint, onClick }: { sprint: Sprint; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="w-full rounded-md px-3 py-2 text-left text-sm opacity-60 transition-colors hover:bg-border/30 hover:opacity-100"
    >
      <span className="font-medium text-foreground">{sprint.name}</span>
      <span className="mx-2 text-muted">·</span>
      <span className="text-muted">{formatDate(sprint.end_date)}</span>
      <span className="mx-2 text-muted">·</span>
      <span className="text-muted">{sprint.completed_count}/{sprint.issue_count} done</span>
    </button>
  );
}

function ChevronIcon({ expanded }: { expanded: boolean }) {
  return (
    <svg
      className={cn('h-4 w-4 transition-transform', expanded && 'rotate-90')}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  );
}

function CreateSprintModal({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (data: { name: string; goal: string; start_date: string; end_date: string }) => void;
}) {
  const today = new Date().toISOString().split('T')[0];
  const twoWeeksLater = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [startDate, setStartDate] = useState(today);
  const [endDate, setEndDate] = useState(twoWeeksLater);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    onCreate({ name: name.trim(), goal: goal.trim(), start_date: startDate, end_date: endDate });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg border border-border bg-background p-6">
        <h2 className="text-lg font-semibold text-foreground">Create Sprint</h2>

        <form onSubmit={handleSubmit} className="mt-4 space-y-4">
          <div>
            <label className="mb-1 block text-sm font-medium text-muted">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Sprint 1"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              autoFocus
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-muted">Goal (optional)</label>
            <textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="What should we accomplish this sprint?"
              rows={2}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-muted">Start Date</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-muted">End Date</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-md px-4 py-2 text-sm text-muted hover:bg-border transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim()}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Create Sprint
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
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

function FeedbackList({
  feedback,
  filter,
  onFilterChange,
  onFeedbackClick,
  onAccept,
  onReject,
}: {
  feedback: Feedback[];
  filter: 'new' | 'backlog' | 'closed' | 'all';
  onFilterChange: (filter: 'new' | 'backlog' | 'closed' | 'all') => void;
  onFeedbackClick: (id: string) => void;
  onAccept: (id: string) => void;
  onReject: (id: string, reason: string) => void;
}) {
  const [showRejectModal, setShowRejectModal] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');

  const stateColors: Record<string, string> = {
    new: 'bg-purple-500/20 text-purple-400',
    backlog: 'bg-green-500/20 text-green-400',
    closed: 'bg-red-500/20 text-red-400',
  };

  const stateLabels: Record<string, string> = {
    new: 'New',
    backlog: 'Accepted',
    closed: 'Rejected',
  };

  const filters: { id: 'new' | 'backlog' | 'closed' | 'all'; label: string }[] = [
    { id: 'new', label: 'New' },
    { id: 'backlog', label: 'Accepted' },
    { id: 'closed', label: 'Rejected' },
    { id: 'all', label: 'All' },
  ];

  const filteredFeedback = filter === 'all'
    ? feedback
    : feedback.filter(f => f.state === filter);

  const handleReject = () => {
    if (showRejectModal && rejectReason.trim()) {
      onReject(showRejectModal, rejectReason.trim());
      setShowRejectModal(null);
      setRejectReason('');
    }
  };

  return (
    <div className="h-full flex flex-col">
      {/* Filter tabs */}
      <div className="flex gap-1 border-b border-border px-6 py-2">
        {filters.map((f) => (
          <button
            key={f.id}
            onClick={() => onFilterChange(f.id)}
            className={cn(
              'rounded-md px-3 py-1.5 text-sm transition-colors',
              filter === f.id
                ? 'bg-border text-foreground'
                : 'text-muted hover:text-foreground hover:bg-border/50'
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Content */}
      {filteredFeedback.length === 0 ? (
        <div className="flex h-full items-center justify-center">
          <p className="text-muted">
            {filter === 'new' && feedback.length > 0
              ? 'All caught up! No new feedback to triage'
              : 'No feedback submitted for this program'}
          </p>
        </div>
      ) : (
        <table className="w-full">
          <thead className="sticky top-0 bg-background">
            <tr className="border-b border-border text-left text-xs text-muted">
              <th className="px-6 py-2 font-medium">ID</th>
              <th className="px-6 py-2 font-medium">Title</th>
              <th className="px-6 py-2 font-medium">Status</th>
              <th className="px-6 py-2 font-medium">Submitted</th>
              <th className="px-6 py-2 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filteredFeedback.map((item) => (
              <tr
                key={item.id}
                className="cursor-pointer border-b border-border/50 hover:bg-border/30 transition-colors"
              >
                <td
                  onClick={() => onFeedbackClick(item.id)}
                  className="px-6 py-3 text-sm font-mono text-muted"
                >
                  {item.display_id}
                </td>
                <td
                  onClick={() => onFeedbackClick(item.id)}
                  className="px-6 py-3 text-sm text-foreground"
                >
                  {item.title}
                </td>
                <td
                  onClick={() => onFeedbackClick(item.id)}
                  className="px-6 py-3"
                >
                  <span className={cn('rounded px-2 py-0.5 text-xs font-medium', stateColors[item.state] || 'bg-gray-500/20 text-gray-400')}>
                    {stateLabels[item.state] || item.state}
                  </span>
                </td>
                <td
                  onClick={() => onFeedbackClick(item.id)}
                  className="px-6 py-3 text-sm text-muted"
                >
                  {formatDate(item.created_at)}
                </td>
                <td className="px-6 py-3">
                  {item.state === 'new' && (
                    <div className="flex gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onAccept(item.id);
                        }}
                        className="rounded p-1 text-green-400 hover:bg-green-500/20 transition-colors"
                        title="Accept"
                      >
                        <CheckIcon />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setShowRejectModal(item.id);
                        }}
                        className="rounded p-1 text-red-400 hover:bg-red-500/20 transition-colors"
                        title="Reject"
                      >
                        <XIcon />
                      </button>
                    </div>
                  )}
                  {item.state === 'closed' && item.rejection_reason && (
                    <span className="text-xs text-muted truncate max-w-[200px] block" title={item.rejection_reason}>
                      {item.rejection_reason}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Reject Modal */}
      {showRejectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg border border-border bg-background p-6">
            <h2 className="text-lg font-semibold text-foreground">Reject Feedback</h2>
            <p className="mt-1 text-sm text-muted">Why are you rejecting this feedback?</p>

            <div className="mt-4 space-y-2">
              {['Duplicate', 'Out of scope', 'Already exists', 'Won\'t fix'].map((reason) => (
                <button
                  key={reason}
                  onClick={() => setRejectReason(reason)}
                  className={cn(
                    'w-full rounded-md px-3 py-2 text-left text-sm transition-colors',
                    rejectReason === reason
                      ? 'bg-accent text-white'
                      : 'bg-border/50 text-foreground hover:bg-border'
                  )}
                >
                  {reason}
                </button>
              ))}
            </div>

            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Or enter a custom reason..."
              rows={2}
              className="mt-4 w-full rounded-md border border-border bg-background px-3 py-2 text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowRejectModal(null);
                  setRejectReason('');
                }}
                className="rounded-md px-4 py-2 text-sm text-muted hover:bg-border transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleReject}
                disabled={!rejectReason.trim()}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CheckIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  );
}

function XIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}
