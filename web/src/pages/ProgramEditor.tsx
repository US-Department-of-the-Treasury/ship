import { useState, useEffect, useCallback, useRef, useMemo, FormEvent } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Editor } from '@/components/Editor';
import { SelectableList, RowRenderProps, UseSelectionReturn } from '@/components/SelectableList';
import { useAuth } from '@/hooks/useAuth';
import { usePrograms, Program } from '@/contexts/ProgramsContext';
import { useIssues } from '@/contexts/IssuesContext';
import { useSprints, Sprint as SprintFromHook } from '@/hooks/useSprintsQuery';
import { cn, getContrastTextColor } from '@/lib/cn';
import { issueStatusColors, sprintStatusColors } from '@/lib/statusColors';
import { EditorSkeleton } from '@/components/ui/Skeleton';
import { TabBar, Tab as TabItem } from '@/components/ui/TabBar';
import { KanbanBoard } from '@/components/KanbanBoard';
import { PersonCombobox, Person } from '@/components/PersonCombobox';
import { useAutoSave } from '@/hooks/useAutoSave';
import { EmojiPickerPopover } from '@/components/EmojiPicker';

const API_URL = import.meta.env.VITE_API_URL ?? '';

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
  sprint_id: string | null;
}

type SprintFilter = 'all' | 'backlog' | 'active' | 'upcoming' | 'completed' | string;

interface SprintOwner {
  id: string;
  name: string;
  email: string;
}

interface Sprint {
  id: string;
  name: string;
  sprint_number: number;
  owner: SprintOwner | null;
  issue_count: number;
  completed_count: number;
  started_count: number;
  total_estimate_hours?: number;
  _pending?: boolean;
  _pendingId?: string;
}

interface SprintsResponse {
  workspace_sprint_start_date: string;
  sprints: Sprint[];
}

// Sprint window represents a 2-week period (may or may not have a sprint document)
interface SprintWindow {
  sprint_number: number;
  start_date: Date;
  end_date: Date;
  status: 'active' | 'upcoming' | 'completed';
  sprint: Sprint | null; // null if no sprint document exists for this window
}

type Tab = 'overview' | 'issues' | 'sprints';

export function ProgramEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { programs, loading, updateProgram: contextUpdateProgram } = usePrograms();
  const { createIssue: contextCreateIssue } = useIssues();

  // Initialize activeTab from URL param or default to 'overview'
  const tabParam = searchParams.get('tab') as Tab | null;
  const [activeTab, setActiveTab] = useState<Tab>(tabParam && ['overview', 'issues', 'sprints'].includes(tabParam) ? tabParam : 'overview');
  const [issues, setIssues] = useState<Issue[]>([]);
  const [issuesLoading, setIssuesLoading] = useState(false);
  const [viewMode, setViewMode] = useState<'list' | 'kanban'>('list');
  const [sprintFilter, setSprintFilter] = useState<SprintFilter>('all');
  const [selectedIssues, setSelectedIssues] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const [showQuickAddModal, setShowQuickAddModal] = useState(false);

  // Use TanStack Query for sprints
  const {
    sprints,
    loading: sprintsLoading,
    workspaceSprintStartDate,
    createSprint: createSprintMutation,
  } = useSprints(id);

  // Reset tab data when program ID changes
  useEffect(() => {
    setIssues([]);
  }, [id]);

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

  // Sprints are now loaded via TanStack Query (useSprints hook)

  // Keyboard shortcut: 'C' to quick-add issue
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't trigger if typing in an input, textarea, or contenteditable
      const target = e.target as HTMLElement;
      if (
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable ||
        e.metaKey ||
        e.ctrlKey ||
        e.altKey
      ) {
        return;
      }

      if (e.key === 'c' || e.key === 'C') {
        e.preventDefault();
        setShowQuickAddModal(true);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleUpdateProgram = useCallback(async (updates: Partial<Program>) => {
    if (!id) return;
    await contextUpdateProgram(id, updates);
  }, [id, contextUpdateProgram]);

  // Throttled title save with stale response handling
  const throttledTitleSave = useAutoSave({
    onSave: async (name: string) => {
      if (name) await handleUpdateProgram({ name });
    },
  });

  const createIssue = async () => {
    if (!id) return;
    const issue = await contextCreateIssue({ program_id: id });
    if (issue) {
      navigate(`/issues/${issue.id}`);
    }
  };

  // Quick add issue handler
  const handleQuickAddIssue = async (data: { title: string; estimate: number; assignee_id: string | null }) => {
    if (!id) return;
    try {
      const res = await apiPost('/api/issues', {
        program_id: id,
        title: data.title,
        properties: {
          estimate: data.estimate,
          ...(data.assignee_id && { assignee_id: data.assignee_id }),
        },
      });
      if (res.ok) {
        const issue = await res.json();
        setToast(`Created ${issue.display_id}`);
        setTimeout(() => setToast(null), 3000);
        // Refresh issues if on issues tab
        if (activeTab === 'issues') {
          const issuesRes = await fetch(`${API_URL}/api/programs/${id}/issues`, { credentials: 'include' });
          if (issuesRes.ok) setIssues(await issuesRes.json());
        }
      }
    } catch (err) {
      console.error('Failed to create issue:', err);
    }
    setShowQuickAddModal(false);
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
  ];

  // Filter issues based on sprint filter
  const filteredIssues = issues.filter(issue => {
    if (sprintFilter === 'all') return true;
    if (sprintFilter === 'backlog') return !issue.sprint_id;
    if (sprintFilter === 'active' && workspaceSprintStartDate) {
      // Find active sprint
      const activeSprint = sprints.find(s => computeSprintStatus(s.sprint_number, workspaceSprintStartDate) === 'active');
      return activeSprint && issue.sprint_id === activeSprint.id;
    }
    if (sprintFilter === 'upcoming' && workspaceSprintStartDate) {
      // Find upcoming sprints
      const upcomingSprintIds = sprints
        .filter(s => computeSprintStatus(s.sprint_number, workspaceSprintStartDate) === 'upcoming')
        .map(s => s.id);
      return issue.sprint_id && upcomingSprintIds.includes(issue.sprint_id);
    }
    if (sprintFilter === 'completed' && workspaceSprintStartDate) {
      // Find completed sprints
      const completedSprintIds = sprints
        .filter(s => computeSprintStatus(s.sprint_number, workspaceSprintStartDate) === 'completed')
        .map(s => s.id);
      return issue.sprint_id && completedSprintIds.includes(issue.sprint_id);
    }
    // Specific sprint ID
    return issue.sprint_id === sprintFilter;
  });

  // Get sprint filter label for dropdown
  const getSprintFilterLabel = () => {
    if (sprintFilter === 'all') return 'All Sprints';
    if (sprintFilter === 'backlog') return 'Backlog';
    if (sprintFilter === 'active') return 'Active Sprint';
    if (sprintFilter === 'upcoming') return 'Upcoming';
    if (sprintFilter === 'completed') return 'Completed';
    const sprint = sprints.find(s => s.id === sprintFilter);
    return sprint ? `Sprint ${sprint.sprint_number}` : 'All Sprints';
  };

  const renderTabActions = () => {
    if (activeTab === 'issues') {
      return (
        <>
          {/* Sprint Filter Dropdown */}
          <select
            value={sprintFilter}
            onChange={(e) => setSprintFilter(e.target.value as SprintFilter)}
            className="rounded-md border border-border bg-background px-3 py-1.5 text-sm text-foreground"
          >
            <option value="all">All Sprints</option>
            <option value="backlog">Backlog (No Sprint)</option>
            <option value="active">Active Sprint</option>
            <option value="upcoming">Upcoming Sprints</option>
            <option value="completed">Completed Sprints</option>
            {sprints.length > 0 && (
              <optgroup label="Specific Sprints">
                {sprints.map(sprint => (
                  <option key={sprint.id} value={sprint.id}>
                    Sprint {sprint.sprint_number}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
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
            data-testid="program-new-issue"
          >
            New Issue
          </button>
        </>
      );
    }
    if (activeTab === 'sprints') {
      // Sprint creation happens via clicking empty windows in the timeline
      return null;
    }
    return null;
  };

  return (
    <>
      {/* Toast notification */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 rounded-md bg-green-600 px-4 py-3 text-sm font-medium text-white shadow-lg animate-in fade-in slide-in-from-top-2">
          {toast}
        </div>
      )}

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
            onTitleChange={throttledTitleSave}
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
                issues={filteredIssues}
                onUpdateIssue={updateIssue}
                onIssueClick={(issueId) => navigate(`/issues/${issueId}`)}
              />
            ) : (
              <ProgramIssuesList
                issues={filteredIssues}
                sprints={sprints}
                selectedIssues={selectedIssues}
                onSelectionChange={setSelectedIssues}
                onIssueClick={(issueId) => navigate(`/issues/${issueId}`)}
                onBulkMoveToSprint={async (sprintId) => {
                  const token = await getCsrfToken();
                  await Promise.all(
                    Array.from(selectedIssues).map(issueId =>
                      fetch(`${API_URL}/api/issues/${issueId}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
                        credentials: 'include',
                        body: JSON.stringify({ sprint_id: sprintId }),
                      })
                    )
                  );
                  // Refresh issues
                  const res = await fetch(`${API_URL}/api/programs/${id}/issues`, { credentials: 'include' });
                  if (res.ok) setIssues(await res.json());
                  setSelectedIssues(new Set());
                }}
              />
            )}
          </div>
        )}

        {activeTab === 'sprints' && (
          <div className="h-full overflow-auto">
            {sprintsLoading ? (
              <div className="flex h-full items-center justify-center">
                <div className="text-muted">Loading sprints...</div>
              </div>
            ) : workspaceSprintStartDate ? (
              <SprintsTab
                sprints={sprints}
                workspaceSprintStartDate={workspaceSprintStartDate}
                programId={id!}
                onSprintClick={(sprintId) => navigate(`/sprints/${sprintId}/view`)}
                createSprint={createSprintMutation}
              />
            ) : null}
          </div>
        )}

      </div>

      </div>

      {/* Quick Add Issue Modal (triggered by 'C' key) */}
      {showQuickAddModal && (
        <QuickAddIssueModal
          programId={id!}
          onSubmit={handleQuickAddIssue}
          onClose={() => setShowQuickAddModal(false)}
        />
      )}
    </>
  );
}

// Quick Add Issue Modal component
function QuickAddIssueModal({
  programId,
  onSubmit,
  onClose,
}: {
  programId: string;
  onSubmit: (data: { title: string; estimate: number; assignee_id: string | null }) => void;
  onClose: () => void;
}) {
  const [title, setTitle] = useState('');
  const [estimate, setEstimate] = useState('');
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Fetch team members (filter out pending users)
  useEffect(() => {
    fetch(`${API_URL}/api/team/people`, { credentials: 'include' })
      .then(res => res.ok ? res.json() : [])
      .then((data: Person[]) => setPeople(data.filter(p => p.user_id)))
      .catch(console.error);
  }, []);

  // Focus title input on mount
  useEffect(() => {
    titleInputRef.current?.focus();
  }, []);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    const estimateNum = parseFloat(estimate);
    if (!title.trim()) return;
    if (!estimate || isNaN(estimateNum) || estimateNum <= 0) return;
    onSubmit({ title: title.trim(), estimate: estimateNum, assignee_id: assigneeId });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
      onKeyDown={handleKeyDown}
    >
      <div
        className="w-full max-w-md rounded-lg border border-border bg-background p-6 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-foreground">Quick Add Issue</h2>
          <span className="text-xs text-muted bg-border/50 rounded px-2 py-1">
            Press C to open
          </span>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Title <span className="text-red-500">*</span>
            </label>
            <input
              ref={titleInputRef}
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Issue title..."
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Estimate (hours) <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              min="0.5"
              step="0.5"
              value={estimate}
              onChange={(e) => setEstimate(e.target.value)}
              placeholder="e.g., 4"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-foreground mb-1">
              Assignee (optional)
            </label>
            <PersonCombobox
              people={people}
              value={assigneeId}
              onChange={setAssigneeId}
              placeholder="Select assignee..."
            />
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
              disabled={!title.trim() || !estimate || parseFloat(estimate) <= 0}
              className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Create Issue
            </button>
          </div>
        </form>

        <p className="mt-4 text-xs text-muted text-center">
          Issue will be created in backlog · Press Enter to create
        </p>
      </div>
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
  onUpdateProgram: (updates: Partial<Program> & { owner_id?: string | null }) => void;
}) {
  const [people, setPeople] = useState<Person[]>([]);

  // Fetch team members (filter out pending users who don't have user_id yet)
  useEffect(() => {
    fetch(`${API_URL}/api/team/people`, { credentials: 'include' })
      .then(res => res.ok ? res.json() : [])
      .then((data: Person[]) => setPeople(data.filter(p => p.user_id)))
      .catch(console.error);
  }, []);

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
          <PropertyRow label="Owner">
            <PersonCombobox
              people={people}
              value={program.owner?.id || null}
              onChange={(ownerId) => onUpdateProgram({ owner_id: ownerId })}
              placeholder="Select owner..."
            />
          </PropertyRow>

          <PropertyRow label="Icon">
            <EmojiPickerPopover
              value={program.emoji}
              onChange={(emoji) => onUpdateProgram({ emoji })}
            >
              <div
                className="flex h-10 w-10 items-center justify-center rounded-lg text-lg cursor-pointer hover:ring-2 hover:ring-accent transition-all"
                style={{ backgroundColor: program.color, color: getContrastTextColor(program.color) }}
              >
                {program.emoji || program.name?.[0]?.toUpperCase() || '?'}
              </div>
            </EmojiPickerPopover>
            <p className="mt-1 text-xs text-muted">Click to change</p>
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

// Status labels for issues
const STATE_LABELS: Record<string, string> = {
  backlog: 'Backlog',
  todo: 'Todo',
  in_progress: 'In Progress',
  done: 'Done',
  cancelled: 'Cancelled',
};

// Program Issues List using SelectableList component
function ProgramIssuesList({
  issues,
  sprints,
  selectedIssues,
  onSelectionChange,
  onIssueClick,
  onBulkMoveToSprint,
}: {
  issues: Issue[];
  sprints: Sprint[];
  selectedIssues: Set<string>;
  onSelectionChange: (selected: Set<string>) => void;
  onIssueClick: (id: string) => void;
  onBulkMoveToSprint: (sprintId: string | null) => Promise<void>;
}) {
  const [isMoving, setIsMoving] = useState(false);

  // Column definitions
  const columns = useMemo(() => [
    { key: 'id', label: 'ID' },
    { key: 'title', label: 'Title' },
    { key: 'status', label: 'Status' },
    { key: 'assignee', label: 'Assignee' },
    { key: 'sprint', label: 'Sprint' },
  ], []);

  // Render function for issue rows
  const renderIssueRow = useCallback((issue: Issue, _props: RowRenderProps) => {
    const sprint = sprints.find(s => s.id === issue.sprint_id);
    return (
      <>
        <td className="px-4 py-3 text-sm font-mono text-muted" role="gridcell">
          {issue.display_id}
        </td>
        <td className="px-4 py-3 text-sm text-foreground" role="gridcell">
          {issue.title}
        </td>
        <td className="px-4 py-3" role="gridcell">
          <span className={cn('rounded px-2 py-0.5 text-xs font-medium', issueStatusColors[issue.state])}>
            {STATE_LABELS[issue.state] || issue.state}
          </span>
        </td>
        <td className="px-4 py-3 text-sm text-muted" role="gridcell">
          {issue.assignee_name || 'Unassigned'}
        </td>
        <td className="px-4 py-3 text-sm text-muted" role="gridcell">
          {sprint ? `Sprint ${sprint.sprint_number}` : '—'}
        </td>
      </>
    );
  }, [sprints]);

  const handleMoveToSprint = async (sprintId: string) => {
    setIsMoving(true);
    try {
      await onBulkMoveToSprint(sprintId === 'backlog' ? null : sprintId);
    } finally {
      setIsMoving(false);
    }
  };

  // Empty state
  const emptyState = useMemo(() => (
    <p className="text-muted">No issues match the current filter</p>
  ), []);

  const hasSelection = selectedIssues.size > 0;

  return (
    <div className="flex flex-col h-full">
      {/* Bulk action bar */}
      {hasSelection && (
        <div className="flex items-center gap-4 px-6 py-2 bg-accent/10 border-b border-border">
          <span className="text-sm text-foreground">
            {selectedIssues.size} issue{selectedIssues.size !== 1 ? 's' : ''} selected
          </span>
          <select
            value=""
            onChange={(e) => e.target.value && handleMoveToSprint(e.target.value)}
            disabled={isMoving}
            className="rounded-md border border-border bg-background px-3 py-1 text-sm text-foreground"
          >
            <option value="">Move to Sprint...</option>
            <option value="backlog">Remove from Sprint (Backlog)</option>
            {sprints.map(sprint => (
              <option key={sprint.id} value={sprint.id}>
                Sprint {sprint.sprint_number}
              </option>
            ))}
          </select>
          {isMoving && <span className="text-xs text-muted">Moving...</span>}
          <button
            onClick={() => onSelectionChange(new Set())}
            className="ml-auto text-xs text-muted hover:text-foreground"
          >
            Clear selection
          </button>
        </div>
      )}

      {/* Issues list using SelectableList */}
      <div className="flex-1 overflow-auto">
        <SelectableList
          items={issues}
          renderRow={renderIssueRow}
          columns={columns}
          emptyState={emptyState}
          onItemClick={(issue) => onIssueClick(issue.id)}
          onSelectionChange={onSelectionChange}
          ariaLabel="Program issues list"
        />
      </div>
    </div>
  );
}

// Compute sprint dates from sprint number
function computeSprintDates(sprintNumber: number, workspaceStartDate: Date): { start: Date; end: Date } {
  const start = new Date(workspaceStartDate);
  start.setDate(start.getDate() + (sprintNumber - 1) * 14);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 13);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

// Compute sprint status from dates
function computeSprintStatus(sprintNumber: number, workspaceStartDate: Date): 'active' | 'upcoming' | 'completed' {
  const { start, end } = computeSprintDates(sprintNumber, workspaceStartDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (today < start) return 'upcoming';
  if (today > end) return 'completed';
  return 'active';
}

// Get current sprint number
function getCurrentSprintNumber(workspaceStartDate: Date): number {
  const today = new Date();
  const daysSinceStart = Math.floor((today.getTime() - workspaceStartDate.getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(1, Math.floor(daysSinceStart / 14) + 1);
}

// Generate sprint windows for display
function generateSprintWindows(
  sprints: Sprint[],
  workspaceStartDate: Date,
  rangeStart: number,
  rangeEnd: number
): SprintWindow[] {
  const sprintMap = new Map(sprints.map(s => [s.sprint_number, s]));
  const windows: SprintWindow[] = [];

  for (let num = rangeStart; num <= rangeEnd; num++) {
    const { start, end } = computeSprintDates(num, workspaceStartDate);
    const status = computeSprintStatus(num, workspaceStartDate);
    windows.push({
      sprint_number: num,
      start_date: start,
      end_date: end,
      status,
      sprint: sprintMap.get(num) || null,
    });
  }

  return windows;
}

// Sprint issue for the issues list
interface SprintIssue {
  id: string;
  title: string;
  state: string;
  display_id: string;
  assignee_name: string | null;
}

// Main SprintsTab component with two-part layout
function SprintsTab({
  sprints,
  workspaceSprintStartDate,
  programId,
  onSprintClick,
  createSprint,
}: {
  sprints: Sprint[];
  workspaceSprintStartDate: Date;
  programId: string;
  onSprintClick: (id: string) => void;
  createSprint: (sprintNumber: number, ownerId: string, title?: string) => Promise<Sprint | null>;
}) {
  const navigate = useNavigate();
  const [showOwnerPrompt, setShowOwnerPrompt] = useState<number | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [sprintIssues, setSprintIssues] = useState<SprintIssue[]>([]);
  const [issuesLoading, setIssuesLoading] = useState(false);

  // Fetch team members for owner selection (filter out pending users)
  useEffect(() => {
    fetch(`${API_URL}/api/team/people`, { credentials: 'include' })
      .then(res => res.ok ? res.json() : [])
      .then((data: Person[]) => setPeople(data.filter(p => p.user_id)))
      .catch(console.error);
  }, []);

  const currentSprintNumber = getCurrentSprintNumber(workspaceSprintStartDate);

  // Find active sprint - used for initial selection
  const activeSprint = sprints.find(s => computeSprintStatus(s.sprint_number, workspaceSprintStartDate) === 'active');

  // Selected sprint number for the chart (defaults to active sprint, or first sprint if no active)
  const [selectedSprintNumber, setSelectedSprintNumber] = useState<number>(() => {
    if (activeSprint) return activeSprint.sprint_number;
    if (sprints.length > 0) return sprints[0].sprint_number;
    return currentSprintNumber;
  });

  // Find selected sprint and its window
  const selectedSprint = sprints.find(s => s.sprint_number === selectedSprintNumber);
  const selectedWindow = selectedSprint ? {
    sprint_number: selectedSprint.sprint_number,
    start_date: computeSprintDates(selectedSprint.sprint_number, workspaceSprintStartDate).start,
    end_date: computeSprintDates(selectedSprint.sprint_number, workspaceSprintStartDate).end,
    status: computeSprintStatus(selectedSprint.sprint_number, workspaceSprintStartDate),
    sprint: selectedSprint,
  } : null;

  // Fetch issues when selected sprint changes
  useEffect(() => {
    if (selectedSprint) {
      setIssuesLoading(true);
      fetch(`${API_URL}/api/sprints/${selectedSprint.id}/issues`, { credentials: 'include' })
        .then(res => res.ok ? res.json() : [])
        .then(setSprintIssues)
        .catch(console.error)
        .finally(() => setIssuesLoading(false));
    } else {
      setSprintIssues([]);
    }
  }, [selectedSprint?.id]);

  // Generate windows for NoActiveSprintMessage (simplified range)
  const rangeStart = Math.max(1, currentSprintNumber - 3);
  const rangeEnd = currentSprintNumber + 6;
  const windows = generateSprintWindows(sprints, workspaceSprintStartDate, rangeStart, rangeEnd);

  // Handle sprint selection from timeline
  const handleSelectSprint = (sprintNumber: number) => {
    setSelectedSprintNumber(sprintNumber);
  };

  // Handle sprint creation using TanStack Query mutation
  const handleCreateSprint = async (sprintNumber: number, ownerId: string) => {
    try {
      const newSprint = await createSprint(sprintNumber, ownerId, `Sprint ${sprintNumber}`);
      if (newSprint) {
        setShowOwnerPrompt(null);
        // Navigate to the new sprint (Create & Open)
        onSprintClick(newSprint.id);
      }
    } catch (err) {
      console.error('Failed to create sprint:', err);
      alert('Failed to create sprint');
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Top Section: Two-column layout - chart left, issues right */}
      <div className="flex-1 min-h-0 p-6 overflow-hidden">
        {selectedSprint && selectedWindow ? (
          <div className="flex gap-6 h-full">
            {/* Left: Sprint Progress Chart */}
            <div className="flex-1 min-w-0 h-full">
              <ActiveSprintProgress
                sprint={selectedSprint}
                window={selectedWindow}
                onClick={() => onSprintClick(selectedSprint.id)}
              />
            </div>
            {/* Right: Sprint Issues List */}
            <div className="w-80 flex-shrink-0">
              <SprintIssuesList
                issues={sprintIssues}
                loading={issuesLoading}
                onIssueClick={(id) => navigate(`/issues/${id}`)}
              />
            </div>
          </div>
        ) : (
          <NoActiveSprintMessage
            windows={windows}
            currentSprintNumber={currentSprintNumber}
          />
        )}
      </div>

      {/* Bottom Section: Horizontal Timeline - fixed height */}
      <div className="flex-shrink-0 border-t border-border p-4">
        <h3 className="mb-3 text-sm font-medium text-muted uppercase tracking-wide">Timeline</h3>
        <SprintTimeline
          sprints={sprints}
          workspaceSprintStartDate={workspaceSprintStartDate}
          currentSprintNumber={currentSprintNumber}
          selectedSprintNumber={selectedSprintNumber}
          onSelectSprint={handleSelectSprint}
          onOpenSprint={onSprintClick}
          onCreateClick={(num) => setShowOwnerPrompt(num)}
        />
      </div>

      {/* Owner Selection Prompt */}
      {showOwnerPrompt !== null && (
        <OwnerSelectPrompt
          sprintNumber={showOwnerPrompt}
          dateRange={computeSprintDates(showOwnerPrompt, workspaceSprintStartDate)}
          people={people}
          existingSprints={sprints}
          onSelect={(ownerId) => handleCreateSprint(showOwnerPrompt, ownerId)}
          onCancel={() => setShowOwnerPrompt(null)}
        />
      )}
    </div>
  );
}

// Sprint issues list component
function SprintIssuesList({
  issues,
  loading,
  onIssueClick,
}: {
  issues: SprintIssue[];
  loading: boolean;
  onIssueClick: (id: string) => void;
}) {
  const stateColors: Record<string, string> = {
    backlog: 'bg-gray-500',
    todo: 'bg-blue-500',
    in_progress: 'bg-yellow-500',
    done: 'bg-green-500',
    cancelled: 'bg-red-500',
  };

  if (loading) {
    return (
      <div className="h-full rounded-lg border border-border bg-background/50 p-4">
        <h3 className="text-sm font-medium text-muted mb-3">Issues</h3>
        <div className="text-sm text-muted">Loading...</div>
      </div>
    );
  }

  return (
    <div className="h-full rounded-lg border border-border bg-background/50 p-4 flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-medium text-muted">Issues</h3>
        <span className="text-xs text-muted">{issues.length} total</span>
      </div>
      {issues.length === 0 ? (
        <div className="flex-1 flex items-center justify-center text-sm text-muted">
          No issues in this sprint
        </div>
      ) : (
        <div className="flex-1 overflow-auto -mx-4 px-4">
          <div className="space-y-1">
            {issues.map((issue) => (
              <button
                key={issue.id}
                onClick={() => onIssueClick(issue.id)}
                className="w-full text-left rounded-md px-2 py-1.5 hover:bg-border/50 transition-colors group"
              >
                <div className="flex items-center gap-2">
                  <div className={cn('h-2 w-2 rounded-full flex-shrink-0', stateColors[issue.state] || 'bg-gray-500')} />
                  <span className="text-xs text-muted font-mono">{issue.display_id}</span>
                </div>
                <div className="text-sm text-foreground truncate mt-0.5 group-hover:text-accent transition-colors">
                  {issue.title}
                </div>
                {issue.assignee_name && (
                  <div className="text-xs text-muted truncate mt-0.5">
                    {issue.assignee_name}
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Active sprint progress section with Linear-style graph
function ActiveSprintProgress({
  sprint,
  window: sprintWindow,
  onClick,
}: {
  sprint: Sprint;
  window: SprintWindow;
  onClick: () => void;
}) {
  const chartRef = useRef<HTMLDivElement>(null);
  const [chartSize, setChartSize] = useState({ width: 400, height: 150 }); // Start with reasonable defaults

  // Measure chart container using ResizeObserver for reliable sizing
  useEffect(() => {
    const element = chartRef.current;
    if (!element) return;

    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setChartSize({ width, height });
        }
      }
    });

    resizeObserver.observe(element);
    return () => resizeObserver.disconnect();
  }, []);

  const totalDays = 14;
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const daysElapsed = Math.max(0, Math.floor(
    (today.getTime() - sprintWindow.start_date.getTime()) / (1000 * 60 * 60 * 24)
  ));
  const daysRemaining = Math.max(0, totalDays - daysElapsed);

  // For completed sprints, days elapsed is the full sprint
  const effectiveDaysElapsed = sprintWindow.status === 'completed' ? totalDays : daysElapsed;

  // Calculate predicted completion
  const completedPerDay = effectiveDaysElapsed > 0 ? sprint.completed_count / effectiveDaysElapsed : 0;
  const remaining = sprint.issue_count - sprint.completed_count;
  const daysToComplete = completedPerDay > 0 ? Math.ceil(remaining / completedPerDay) : Infinity;

  // For prediction, we need to know when we'll hit scope
  const predictedDaysFromStart = effectiveDaysElapsed + daysToComplete;
  const isLate = predictedDaysFromStart > totalDays;
  const daysDiff = Math.abs(predictedDaysFromStart - totalDays);

  // Get status for non-active sprints
  const status = sprintWindow.status;
  const statusLabel = status === 'active' ? 'ACTIVE' : status === 'upcoming' ? 'UPCOMING' : 'COMPLETED';
  const statusClass = status === 'active' ? 'bg-accent/20 text-accent' : sprintStatusColors[status] || sprintStatusColors.completed;

  // Chart calculations
  const padding = { top: 20, right: 20, bottom: 30, left: 40 };
  const chartWidth = Math.max(0, chartSize.width - padding.left - padding.right);
  const chartHeight = Math.max(0, chartSize.height - padding.top - padding.bottom);

  // Scale for Y axis (issue count)
  const maxY = Math.max(sprint.issue_count, 1);
  const yScale = (value: number) => chartHeight - (value / maxY) * chartHeight;

  // Scale for X axis (days) - extend if prediction goes past sprint end
  const totalXDays = isLate && remaining > 0 ? Math.min(predictedDaysFromStart, totalDays + 14) : totalDays;
  const xScale = (day: number) => (day / totalXDays) * chartWidth;

  // Generate date labels for X axis
  const dateLabels = useMemo(() => {
    const labels: { day: number; label: string }[] = [];
    // Start, middle, end of sprint
    labels.push({ day: 0, label: formatDate(sprintWindow.start_date.toISOString()) });
    labels.push({ day: 7, label: formatDate(new Date(sprintWindow.start_date.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString()) });
    labels.push({ day: 14, label: formatDate(sprintWindow.end_date.toISOString()) });
    return labels;
  }, [sprintWindow.start_date, sprintWindow.end_date]);

  // Y axis labels
  const yLabels = useMemo(() => {
    if (maxY <= 3) return Array.from({ length: maxY + 1 }, (_, i) => i);
    return [0, Math.floor(maxY / 2), maxY];
  }, [maxY]);

  // Build the "completed" line path - rises from 0 at start to completed_count at today
  // For a real app, this would use historical data points
  const completedPath = useMemo(() => {
    if (chartWidth <= 0 || chartHeight <= 0) return '';

    const points: string[] = [];
    // Start at 0
    points.push(`M ${xScale(0)} ${yScale(0)}`);

    // Linear progression to current completed (simplified - real app would have daily data)
    if (effectiveDaysElapsed > 0) {
      points.push(`L ${xScale(effectiveDaysElapsed)} ${yScale(sprint.completed_count)}`);
    }

    return points.join(' ');
  }, [chartWidth, chartHeight, effectiveDaysElapsed, sprint.completed_count, xScale, yScale]);

  // Build the "started" line path (completed + in_progress)
  const startedPath = useMemo(() => {
    if (chartWidth <= 0 || chartHeight <= 0) return '';

    const startedTotal = sprint.completed_count + sprint.started_count;
    const points: string[] = [];
    points.push(`M ${xScale(0)} ${yScale(0)}`);

    if (effectiveDaysElapsed > 0) {
      points.push(`L ${xScale(effectiveDaysElapsed)} ${yScale(startedTotal)}`);
    }

    return points.join(' ');
  }, [chartWidth, chartHeight, effectiveDaysElapsed, sprint.completed_count, sprint.started_count, xScale, yScale]);

  // Build the filled area under completed line
  const completedAreaPath = useMemo(() => {
    if (chartWidth <= 0 || chartHeight <= 0 || effectiveDaysElapsed <= 0) return '';

    return `
      M ${xScale(0)} ${yScale(0)}
      L ${xScale(effectiveDaysElapsed)} ${yScale(sprint.completed_count)}
      L ${xScale(effectiveDaysElapsed)} ${yScale(0)}
      L ${xScale(0)} ${yScale(0)}
      Z
    `;
  }, [chartWidth, chartHeight, effectiveDaysElapsed, sprint.completed_count, xScale, yScale]);

  // Prediction line (dotted, from current to projected completion)
  const predictionPath = useMemo(() => {
    if (chartWidth <= 0 || chartHeight <= 0) return '';
    if (sprint.completed_count === sprint.issue_count) return ''; // Already done
    if (completedPerDay <= 0) return ''; // No velocity
    if (effectiveDaysElapsed <= 0) return ''; // Sprint hasn't started

    const endDay = Math.min(predictedDaysFromStart, totalXDays);
    const endValue = Math.min(sprint.issue_count, sprint.completed_count + completedPerDay * (endDay - effectiveDaysElapsed));

    return `M ${xScale(effectiveDaysElapsed)} ${yScale(sprint.completed_count)} L ${xScale(endDay)} ${yScale(endValue)}`;
  }, [chartWidth, chartHeight, effectiveDaysElapsed, sprint.completed_count, sprint.issue_count, completedPerDay, predictedDaysFromStart, totalXDays, xScale, yScale]);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between mb-4 flex-shrink-0">
        <div className="flex items-center gap-3">
          <span className={cn('rounded px-2 py-0.5 text-xs font-medium', statusClass)}>{statusLabel}</span>
          <h2 className="text-lg font-semibold text-foreground">{sprint.name}</h2>
          <span className="text-sm text-muted">·</span>
          <span className="text-sm text-muted">
            {formatDate(sprintWindow.start_date.toISOString())} - {formatDate(sprintWindow.end_date.toISOString())}
          </span>
          {sprint.owner && (
            <>
              <span className="text-sm text-muted">·</span>
              <span className="text-sm text-muted">{sprint.owner.name}</span>
            </>
          )}
        </div>
        <button
          onClick={onClick}
          className="rounded-md px-3 py-1.5 text-sm text-accent hover:bg-accent/10 transition-colors"
        >
          Open →
        </button>
      </div>

      {/* Progress Graph - fills remaining space */}
      <div className="rounded-lg border border-border bg-background/50 p-4 flex-1 flex flex-col min-h-0">
        {/* Stats row */}
        <div className="flex items-center gap-6 mb-4 text-sm flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-sm bg-gray-500" />
            <span className="text-muted">Scope: {sprint.issue_count}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-sm bg-yellow-500" />
            <span className="text-muted">Started: {sprint.started_count}</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="h-3 w-3 rounded-sm bg-accent" />
            <span className="text-muted">Completed: {sprint.completed_count}</span>
          </div>
          {(sprint.total_estimate_hours ?? 0) > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-muted">·</span>
              <span className="text-muted">{sprint.total_estimate_hours}h estimated</span>
            </div>
          )}
        </div>

        {/* SVG Chart - fills remaining space */}
        <div ref={chartRef} className="flex-1 min-h-[150px] mb-4">
          <svg width="100%" height="100%" viewBox={`0 0 ${chartSize.width} ${chartSize.height}`} preserveAspectRatio="xMidYMid meet" className="overflow-visible">
              <g transform={`translate(${padding.left}, ${padding.top})`}>
                {/* Grid lines */}
                {yLabels.map((value) => (
                  <g key={value}>
                    <line
                      x1={0}
                      y1={yScale(value)}
                      x2={chartWidth}
                      y2={yScale(value)}
                      stroke="currentColor"
                      strokeOpacity={0.1}
                    />
                    <text
                      x={-8}
                      y={yScale(value)}
                      textAnchor="end"
                      dominantBaseline="middle"
                      className="fill-muted text-xs"
                    >
                      {value}
                    </text>
                  </g>
                ))}

                {/* X axis labels */}
                {dateLabels.map(({ day, label }) => (
                  <text
                    key={day}
                    x={xScale(day)}
                    y={chartHeight + 20}
                    textAnchor="middle"
                    className="fill-muted text-xs"
                  >
                    {label}
                  </text>
                ))}

                {/* Scope line (gray, flat at top) */}
                <line
                  x1={0}
                  y1={yScale(sprint.issue_count)}
                  x2={chartWidth}
                  y2={yScale(sprint.issue_count)}
                  stroke="#6b7280"
                  strokeWidth={2}
                />

                {/* Completed area fill */}
                {completedAreaPath && (
                  <path
                    d={completedAreaPath}
                    fill="rgba(99, 102, 241, 0.2)"
                  />
                )}

                {/* Started line (yellow) */}
                {startedPath && (
                  <path
                    d={startedPath}
                    fill="none"
                    stroke="#eab308"
                    strokeWidth={2}
                  />
                )}

                {/* Completed line (blue) */}
                {completedPath && (
                  <path
                    d={completedPath}
                    fill="none"
                    stroke="#6366f1"
                    strokeWidth={2}
                  />
                )}

                {/* Prediction line (dotted purple) */}
                {predictionPath && (
                  <path
                    d={predictionPath}
                    fill="none"
                    stroke="#a855f7"
                    strokeWidth={2}
                    strokeDasharray="6 4"
                  />
                )}

                {/* Today marker (vertical line) - only for active sprints */}
                {status === 'active' && effectiveDaysElapsed > 0 && effectiveDaysElapsed < totalDays && (
                  <line
                    x1={xScale(effectiveDaysElapsed)}
                    y1={0}
                    x2={xScale(effectiveDaysElapsed)}
                    y2={chartHeight}
                    stroke="#6366f1"
                    strokeWidth={1}
                  />
                )}

                {/* Sprint end marker (if prediction extends past) */}
                {isLate && remaining > 0 && (
                  <line
                    x1={xScale(totalDays)}
                    y1={0}
                    x2={xScale(totalDays)}
                    y2={chartHeight}
                    stroke="#ef4444"
                    strokeWidth={1}
                    strokeDasharray="4 4"
                  />
                )}

                {/* Data points */}
                {effectiveDaysElapsed > 0 && (
                  <>
                    {/* Completed point */}
                    <circle
                      cx={xScale(effectiveDaysElapsed)}
                      cy={yScale(sprint.completed_count)}
                      r={4}
                      fill="#6366f1"
                    />
                    {/* Started point */}
                    <circle
                      cx={xScale(effectiveDaysElapsed)}
                      cy={yScale(sprint.completed_count + sprint.started_count)}
                      r={4}
                      fill="#eab308"
                    />
                  </>
                )}
              </g>
            </svg>
        </div>

        {/* Prediction text */}
        <div className="flex items-center justify-between text-sm flex-shrink-0">
          <span className="text-muted">
            {status === 'completed'
              ? 'Sprint completed'
              : status === 'upcoming'
              ? 'Sprint not started'
              : `${daysRemaining} ${daysRemaining === 1 ? 'day' : 'days'} left`
            }
          </span>
          {status === 'active' && sprint.completed_count > 0 && remaining > 0 && (
            <span className={isLate ? 'text-red-400' : 'text-green-400'}>
              {isLate
                ? `Estimated ${daysDiff} days late`
                : `Estimated ${daysDiff} days early`}
            </span>
          )}
          {sprint.completed_count === sprint.issue_count && sprint.issue_count > 0 && (
            <span className="text-green-400">All issues complete!</span>
          )}
        </div>
      </div>
    </div>
  );
}

// No active sprint message
function NoActiveSprintMessage({
  windows,
  currentSprintNumber,
}: {
  windows: SprintWindow[];
  currentSprintNumber: number;
}) {
  const nextSprint = windows.find(w => w.status === 'upcoming' && w.sprint);

  return (
    <div className="text-center py-8">
      <h2 className="text-lg font-semibold text-foreground mb-2">No active sprint</h2>
      {nextSprint ? (
        <p className="text-muted">
          Next sprint: {nextSprint.sprint!.name} starts {formatDate(nextSprint.start_date.toISOString())}
        </p>
      ) : (
        <p className="text-muted">
          Create a sprint for window {currentSprintNumber} in the timeline below
        </p>
      )}
    </div>
  );
}

// Horizontal timeline component with infinite scroll
function SprintTimeline({
  sprints,
  workspaceSprintStartDate,
  currentSprintNumber,
  selectedSprintNumber,
  onSelectSprint,
  onOpenSprint,
  onCreateClick,
}: {
  sprints: Sprint[];
  workspaceSprintStartDate: Date;
  currentSprintNumber: number;
  selectedSprintNumber: number;
  onSelectSprint: (sprintNumber: number) => void;
  onOpenSprint: (id: string) => void;
  onCreateClick: (sprintNumber: number) => void;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [rangeStart, setRangeStart] = useState(() => Math.max(1, currentSprintNumber - 13)); // ~quarter back
  const [rangeEnd, setRangeEnd] = useState(() => currentSprintNumber + 13); // ~quarter forward
  const [hasInitialized, setHasInitialized] = useState(false);

  // Generate windows for current range
  const windows = useMemo(() => {
    return generateSprintWindows(sprints, workspaceSprintStartDate, rangeStart, rangeEnd);
  }, [sprints, workspaceSprintStartDate, rangeStart, rangeEnd]);

  // Center on current sprint on mount
  useEffect(() => {
    if (scrollRef.current && !hasInitialized) {
      const activeCard = scrollRef.current.querySelector('[data-active="true"]');
      if (activeCard) {
        activeCard.scrollIntoView({ behavior: 'auto', inline: 'center', block: 'nearest' });
        setHasInitialized(true);
      }
    }
  }, [hasInitialized, windows]);

  // Handle scroll to load more windows
  const handleScroll = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;

    const { scrollLeft, scrollWidth, clientWidth } = container;
    const scrollRight = scrollWidth - scrollLeft - clientWidth;

    // Load more on the left when within 200px of left edge
    if (scrollLeft < 200 && rangeStart > 1) {
      const prevScrollWidth = scrollWidth;
      const newStart = Math.max(1, rangeStart - 13);
      setRangeStart(newStart);
      // Maintain scroll position after prepending
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          const newScrollWidth = scrollRef.current.scrollWidth;
          scrollRef.current.scrollLeft = scrollLeft + (newScrollWidth - prevScrollWidth);
        }
      });
    }

    // Load more on the right when within 200px of right edge
    if (scrollRight < 200) {
      setRangeEnd(prev => prev + 13);
    }
  }, [rangeStart]);

  // Attach scroll listener
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [handleScroll]);

  return (
    <div
      ref={scrollRef}
      className="flex gap-3 overflow-x-auto py-2 scrollbar-hide"
      style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
    >
      {windows.map((window) => (
        <SprintWindowCard
          key={window.sprint_number}
          window={window}
          isCurrentWindow={window.sprint_number === currentSprintNumber}
          isSelected={window.sprint_number === selectedSprintNumber}
          onSelectSprint={onSelectSprint}
          onOpenSprint={onOpenSprint}
          onCreateClick={onCreateClick}
        />
      ))}
    </div>
  );
}

// Individual sprint window card
function SprintWindowCard({
  window,
  isCurrentWindow,
  isSelected,
  onSelectSprint,
  onOpenSprint,
  onCreateClick,
}: {
  window: SprintWindow;
  isCurrentWindow: boolean;
  isSelected: boolean;
  onSelectSprint: (sprintNumber: number) => void;
  onOpenSprint: (id: string) => void;
  onCreateClick: (sprintNumber: number) => void;
}) {
  const { sprint, status, sprint_number, start_date, end_date } = window;
  const canCreate = status !== 'completed';

  if (sprint) {
    // Filled window - sprint exists
    const progress = sprint.issue_count > 0
      ? Math.round((sprint.completed_count / sprint.issue_count) * 100)
      : 0;

    return (
      <button
        onClick={() => onSelectSprint(sprint_number)}
        onDoubleClick={() => onOpenSprint(sprint.id)}
        data-active={status === 'active'}
        data-selected={isSelected}
        className={cn(
          'flex-shrink-0 w-40 rounded-lg border p-3 text-left transition-colors hover:bg-border/30',
          isSelected ? 'border-accent border-2 bg-accent/10' : status === 'active' ? 'border-accent/50 border' : 'border-border',
          status === 'completed' && !isSelected && 'opacity-60'
        )}
      >
        <div className="flex items-center justify-between mb-1">
          <span className="font-medium text-foreground text-sm">{sprint.name}</span>
          {status === 'active' && (
            <span className="text-xs text-accent">●</span>
          )}
        </div>
        {sprint.owner && (
          <div className="text-xs text-muted mb-2 truncate">{sprint.owner.name}</div>
        )}
        <div className="text-xs text-muted mb-2">
          {formatDate(start_date.toISOString())} - {formatDate(end_date.toISOString())}
        </div>
        {status === 'completed' ? (
          <div className="text-xs text-muted">
            {sprint.completed_count}/{sprint.issue_count} ✓
            {(sprint.total_estimate_hours ?? 0) > 0 && ` · ${sprint.total_estimate_hours}h`}
          </div>
        ) : (
          <>
            <div className="text-xs text-muted mb-1">
              {sprint.completed_count}/{sprint.issue_count} done
              {(sprint.total_estimate_hours ?? 0) > 0 && ` · ${sprint.total_estimate_hours}h`}
            </div>
            <div className="h-1.5 rounded-full bg-border overflow-hidden">
              <div
                className="h-full bg-accent transition-all"
                style={{ width: `${progress}%` }}
              />
            </div>
          </>
        )}
        <div className="mt-2 text-xs">
          <span className={cn(
            'rounded px-1.5 py-0.5',
            status === 'active' ? 'bg-accent/20 text-accent' : sprintStatusColors[status]
          )}>
            {status.charAt(0).toUpperCase() + status.slice(1)}
          </span>
        </div>
      </button>
    );
  }

  // Empty window - no sprint
  return (
    <div
      data-active={isCurrentWindow}
      className={cn(
        'flex-shrink-0 w-40 rounded-lg border border-dashed p-3 text-left',
        canCreate ? 'border-border hover:border-accent/50 cursor-pointer' : 'border-border/50 opacity-50',
        isCurrentWindow && 'border-accent/30'
      )}
      onClick={() => canCreate && onCreateClick(sprint_number)}
    >
      <div className="font-medium text-muted text-sm mb-1">Window {sprint_number}</div>
      <div className="text-xs text-muted mb-2">
        {formatDate(start_date.toISOString())} - {formatDate(end_date.toISOString())}
      </div>
      {canCreate ? (
        <div className="text-xs text-accent">+ Create sprint</div>
      ) : (
        <div className="text-xs text-muted">No sprint</div>
      )}
      <div className="mt-2 text-xs">
        <span className={cn(
          'rounded px-1.5 py-0.5',
          sprintStatusColors[status]
        )}>
          {status.charAt(0).toUpperCase() + status.slice(1)}
        </span>
      </div>
    </div>
  );
}

// Owner selection prompt for sprint creation
function OwnerSelectPrompt({
  sprintNumber,
  dateRange,
  people,
  existingSprints,
  onSelect,
  onCancel,
}: {
  sprintNumber: number;
  dateRange: { start: Date; end: Date };
  people: Person[];
  existingSprints: Sprint[];
  onSelect: (ownerId: string) => void;
  onCancel: () => void;
}) {
  const [selectedOwner, setSelectedOwner] = useState<string | null>(null);

  // Check owner availability (simple version - just show who has sprints)
  const ownerSprintCounts = new Map<string, number>();
  existingSprints.forEach(s => {
    if (s.owner) {
      ownerSprintCounts.set(s.owner.id, (ownerSprintCounts.get(s.owner.id) || 0) + 1);
    }
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-sm rounded-lg border border-border bg-background p-6">
        <h2 className="text-lg font-semibold text-foreground">
          Create Sprint {sprintNumber}
        </h2>
        <p className="mt-1 text-sm text-muted">
          {formatDate(dateRange.start.toISOString())} - {formatDate(dateRange.end.toISOString())}
        </p>

        <div className="mt-4">
          <label className="mb-2 block text-sm font-medium text-muted">Who should own this sprint?</label>
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {people.map((person) => {
              const sprintCount = ownerSprintCounts.get(person.user_id) || 0;
              return (
                <button
                  key={person.user_id}
                  onClick={() => setSelectedOwner(person.user_id)}
                  className={cn(
                    'w-full flex items-center justify-between rounded-md px-3 py-2 text-left text-sm transition-colors',
                    selectedOwner === person.user_id
                      ? 'bg-accent text-white'
                      : 'bg-border/30 text-foreground hover:bg-border/50'
                  )}
                >
                  <span>{person.name}</span>
                  {sprintCount > 0 ? (
                    <span className={cn(
                      'text-xs',
                      selectedOwner === person.user_id ? 'text-white/70' : 'text-yellow-400'
                    )}>
                      ⚠ {sprintCount} sprint{sprintCount > 1 ? 's' : ''}
                    </span>
                  ) : (
                    <span className={cn(
                      'text-xs',
                      selectedOwner === person.user_id ? 'text-white/70' : 'text-green-400'
                    )}>
                      ✓ Available
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            onClick={onCancel}
            className="rounded-md px-4 py-2 text-sm text-muted hover:bg-border transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => selectedOwner && onSelect(selectedOwner)}
            disabled={!selectedOwner}
            className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Create & Open
          </button>
        </div>
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
