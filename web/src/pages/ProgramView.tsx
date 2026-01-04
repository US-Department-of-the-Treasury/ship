import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { cn, getContrastTextColor } from '@/lib/cn';
import { KanbanBoard } from '@/components/KanbanBoard';
import { TabBar, Tab as TabItem } from '@/components/ui/TabBar';
import { EmojiPickerPopover } from '@/components/EmojiPicker';

interface Program {
  id: string;
  name: string;
  description: string | null;
  color: string;
  emoji?: string | null;
  issue_count: number;
  sprint_count: number;
  archived_at: string | null;
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

const API_URL = import.meta.env.VITE_API_URL ?? '';

type Tab = 'issues' | 'sprints' | 'settings';

export function ProgramViewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [program, setProgram] = useState<Program | null>(null);
  const [issues, setIssues] = useState<Issue[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<Tab>('issues');
  const [viewMode, setViewMode] = useState<'list' | 'kanban'>('list');
  const [showCreateSprintModal, setShowCreateSprintModal] = useState(false);

  // Reset state and fetch data when program ID changes
  useEffect(() => {
    if (!id) return;

    // Reset state for new program
    setProgram(null);
    setIssues([]);
    setSprints([]);
    setLoading(true);

    let cancelled = false;

    async function fetchData() {
      try {
        const [programRes, issuesRes, sprintsRes] = await Promise.all([
          fetch(`${API_URL}/api/programs/${id}`, { credentials: 'include' }),
          fetch(`${API_URL}/api/programs/${id}/issues`, { credentials: 'include' }),
          fetch(`${API_URL}/api/programs/${id}/sprints`, { credentials: 'include' }),
        ]);

        if (cancelled) return;

        if (programRes.ok) {
          setProgram(await programRes.json());
        } else {
          navigate('/programs');
          return;
        }

        if (issuesRes.ok) setIssues(await issuesRes.json());
        if (sprintsRes.ok) setSprints(await sprintsRes.json());
      } catch (err) {
        if (!cancelled) console.error('Failed to fetch program:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchData();
    return () => { cancelled = true; };
  }, [id, navigate]);

  const createIssue = async () => {
    if (!id) return;
    try {
      const res = await fetch(`${API_URL}/api/issues`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ title: 'Untitled', program_id: id }),
      });
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
      const res = await fetch(`${API_URL}/api/sprints`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ title: data.name, goal: data.goal, start_date: data.start_date, end_date: data.end_date, program_id: id }),
      });
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

  const updateProgram = async (updates: Partial<Program>) => {
    if (!id) return;
    try {
      const res = await fetch(`${API_URL}/api/programs/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        const updated = await res.json();
        setProgram(prev => prev ? { ...prev, ...updated } : null);
      }
    } catch (err) {
      console.error('Failed to update program:', err);
    }
  };

  if (loading || !program) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted">Loading...</div>
      </div>
    );
  }

  const tabs: TabItem[] = [
    { id: 'issues', label: 'Issues' },
    { id: 'sprints', label: 'Sprints' },
    { id: 'settings', label: 'Settings' },
  ];

  const renderTabActions = () => {
    if (activeTab === 'issues') {
      return (
        <>
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
    return null;
  };

  return (
    <div className="flex h-full flex-col">
      {/* Breadcrumbs Header */}
      <div className="flex items-center gap-3 border-b border-border px-6 py-3">
        <button
          onClick={() => navigate('/programs')}
          className="text-muted hover:text-foreground transition-colors"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <div
          className="flex h-8 w-8 items-center justify-center rounded-lg text-sm text-white"
          style={{ backgroundColor: program.color }}
        >
          {program.emoji || program.name?.[0]?.toUpperCase() || '?'}
        </div>
        <div>
          <h1 className="text-lg font-semibold text-foreground">{program.name}</h1>
        </div>
      </div>

      {/* Tab Bar */}
      <TabBar
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={(tabId) => setActiveTab(tabId as Tab)}
        rightContent={renderTabActions()}
      />

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {activeTab === 'issues' && (
          viewMode === 'kanban' ? (
            <KanbanBoard
              issues={issues}
              onUpdateIssue={updateIssue}
              onIssueClick={(issueId) => navigate(`/issues/${issueId}`)}
            />
          ) : (
            <IssuesList issues={issues} onIssueClick={(issueId) => navigate(`/issues/${issueId}`)} />
          )
        )}

        {activeTab === 'sprints' && (
          <SprintsList
            sprints={sprints}
            onSprintClick={(sprintId) => navigate(`/sprints/${sprintId}/view`)}
          />
        )}

        {activeTab === 'settings' && (
          <ProgramSettings program={program} onUpdate={updateProgram} />
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
  const statusColors: Record<string, string> = {
    planned: 'bg-gray-500/20 text-gray-400',
    active: 'bg-green-500/20 text-green-400',
    completed: 'bg-blue-500/20 text-blue-400',
  };

  if (sprints.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted">No sprints in this program</p>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      {sprints.map((sprint) => {
        const progress = sprint.issue_count > 0
          ? Math.round((sprint.completed_count / sprint.issue_count) * 100)
          : 0;

        return (
          <button
            key={sprint.id}
            onClick={() => onSprintClick(sprint.id)}
            className="w-full rounded-lg border border-border bg-background p-4 text-left transition-colors hover:bg-border/30"
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h3 className="font-medium text-foreground">{sprint.name}</h3>
                <span className={cn('rounded px-2 py-0.5 text-xs font-medium capitalize', statusColors[sprint.status])}>
                  {sprint.status}
                </span>
              </div>
              <span className="text-sm text-muted">
                {formatDate(sprint.start_date)} - {formatDate(sprint.end_date)}
              </span>
            </div>

            {sprint.goal && (
              <p className="mt-2 text-sm text-muted">{sprint.goal}</p>
            )}

            <div className="mt-3 flex items-center gap-3">
              <div className="flex-1 h-2 rounded-full bg-border overflow-hidden">
                <div
                  className="h-full bg-accent transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
              <span className="text-xs text-muted">
                {sprint.completed_count}/{sprint.issue_count} done
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function ProgramSettings({ program, onUpdate }: { program: Program; onUpdate: (updates: Partial<Program>) => void }) {
  const [name, setName] = useState(program.name);
  const [description, setDescription] = useState(program.description || '');

  const handleSave = () => {
    onUpdate({ name, description: description || null });
  };

  const handleEmojiChange = (emoji: string | null) => {
    onUpdate({ emoji });
  };

  return (
    <div className="p-6 max-w-xl space-y-6">
      <div>
        <label className="mb-1 block text-sm font-medium text-muted">Icon</label>
        <EmojiPickerPopover value={program.emoji} onChange={handleEmojiChange}>
          <div
            className="flex h-12 w-12 items-center justify-center rounded-lg text-xl cursor-pointer hover:ring-2 hover:ring-accent transition-all"
            style={{ backgroundColor: program.color, color: getContrastTextColor(program.color) }}
          >
            {program.emoji || program.name?.[0]?.toUpperCase() || '?'}
          </div>
        </EmojiPickerPopover>
        <p className="mt-1 text-xs text-muted">Click to change emoji</p>
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-muted">Name</label>
        <input
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      <div>
        <label className="mb-1 block text-sm font-medium text-muted">Description</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={3}
          className="w-full rounded-md border border-border bg-background px-3 py-2 text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
        />
      </div>

      <button
        onClick={handleSave}
        className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors"
      >
        Save Changes
      </button>
    </div>
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
