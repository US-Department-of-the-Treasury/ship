import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { Editor } from '@/components/Editor';
import { useAuth } from '@/hooks/useAuth';
import { useAutoSave } from '@/hooks/useAutoSave';
import { TabBar } from '@/components/ui/TabBar';
import { SprintSidebar } from '@/components/sidebars/SprintSidebar';
import { IssuesList, DEFAULT_FILTER_TABS } from '@/components/IssuesList';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';

interface Sprint {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: 'planning' | 'active' | 'completed';
  program_id: string | null;
  program_name?: string;
  hypothesis?: string;
  issue_count: number;
  completed_count: number;
  is_complete: boolean | null;
  missing_fields: string[];
}

const API_URL = import.meta.env.VITE_API_URL ?? '';

type PlanningTab = 'overview' | 'issues';

/**
 * SprintPlanningPage - Dedicated sprint planning page with Overview and Issues tabs
 *
 * This page provides a focused experience for planning sprints:
 * - Overview tab: Sprint document with TipTap editor for hypothesis and success criteria
 * - Issues tab: List of issues to scope into the sprint (to be implemented in next story)
 * - Create flow: When id is 'new', shows inline create form
 */
export function SprintPlanningPage() {
  const { id, tab: tabParam } = useParams<{ id: string; tab?: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const { showToast } = useToast();
  const [sprint, setSprint] = useState<Sprint | null>(null);
  const [loading, setLoading] = useState(true);
  const [isStarting, setIsStarting] = useState(false);

  // Check if this is a create flow
  const isCreateMode = id === 'new';
  const programId = searchParams.get('program');
  const projectId = searchParams.get('project');

  // Get active tab from URL route param, default to 'overview'
  const activeTab: PlanningTab = tabParam === 'issues' ? 'issues' : 'overview';

  // Update tab in URL when changed using route segments
  const setActiveTab = useCallback((tab: PlanningTab) => {
    if (tab === 'overview') {
      navigate(`/sprints/${id}/plan`, { replace: true });
    } else {
      navigate(`/sprints/${id}/plan/${tab}`, { replace: true });
    }
  }, [id, navigate]);

  // Fetch sprint data (skip in create mode)
  useEffect(() => {
    if (!id || isCreateMode) {
      setLoading(false);
      return;
    }

    setSprint(null);
    setLoading(true);

    let cancelled = false;

    async function fetchSprint() {
      try {
        const res = await fetch(`${API_URL}/api/sprints/${id}`, { credentials: 'include' });

        if (cancelled) return;

        if (res.ok) {
          const data = await res.json();
          setSprint(data);
        } else if (res.status === 404) {
          navigate('/sprints');
          return;
        }
      } catch (err) {
        if (!cancelled) console.error('Failed to fetch sprint:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchSprint();
    return () => { cancelled = true; };
  }, [id, navigate, isCreateMode]);

  // Update sprint
  const updateSprint = useCallback(async (updates: Partial<Sprint>) => {
    if (!id) return;
    try {
      const res = await fetch(`${API_URL}/api/sprints/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        const data = await res.json();
        setSprint(data);
      }
    } catch (err) {
      console.error('Failed to update sprint:', err);
    }
  }, [id]);

  // Throttled title save
  const throttledTitleSave = useAutoSave({
    onSave: async (name: string) => {
      if (name) await updateSprint({ name });
    },
  });

  // Handle back navigation
  const handleBack = useCallback(() => {
    if (sprint?.program_id) {
      navigate(`/programs/${sprint.program_id}/sprints`);
    } else {
      navigate('/sprints');
    }
  }, [sprint, navigate]);

  // Start sprint with scope snapshot
  const startSprint = useCallback(async () => {
    if (!id) return;
    setIsStarting(true);
    try {
      const res = await fetch(`${API_URL}/api/sprints/${id}/start`, {
        method: 'POST',
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setSprint(data);
        const count = data.snapshot_issue_count ?? 0;
        showToast(`Sprint started with ${count} issue${count === 1 ? '' : 's'}`, 'success');
      } else {
        const err = await res.json();
        showToast(err.error || 'Failed to start sprint', 'error');
      }
    } catch (err) {
      console.error('Failed to start sprint:', err);
      showToast('Failed to start sprint', 'error');
    } finally {
      setIsStarting(false);
    }
  }, [id, showToast]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted">Loading sprint...</div>
      </div>
    );
  }

  // Create mode: show inline form
  if (isCreateMode) {
    return (
      <CreateSprintForm
        programId={programId}
        projectId={projectId}
        onCreated={(newSprintId) => navigate(`/sprints/${newSprintId}/plan`, { replace: true })}
        onCancel={() => {
          if (programId) {
            navigate(`/programs/${programId}/sprints`);
          } else if (projectId) {
            navigate(`/projects/${projectId}/sprints`);
          } else {
            navigate('/sprints');
          }
        }}
      />
    );
  }

  if (!sprint || !user) {
    return null;
  }

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'issues', label: `Issues${sprint.issue_count > 0 ? ` (${sprint.issue_count})` : ''}` },
  ];

  return (
    <div className="flex h-full flex-col">
      {/* Header with sprint info and tabs */}
      <div className="border-b border-border">
        <div className="flex items-center gap-3 px-6 py-3">
          <button
            onClick={handleBack}
            className="text-muted hover:text-foreground transition-colors"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold text-foreground">Plan Sprint</h1>
            <StatusBadge status={sprint.status} />
          </div>
        </div>
        <div className="px-4">
          <TabBar
            tabs={tabs}
            activeTab={activeTab}
            onTabChange={(tabId) => setActiveTab(tabId as PlanningTab)}
            rightContent={
              sprint.status === 'planning' ? (
                <button
                  onClick={startSprint}
                  disabled={isStarting}
                  className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isStarting ? 'Starting...' : 'Start Sprint'}
                </button>
              ) : undefined
            }
          />
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'overview' ? (
          <Editor
            documentId={sprint.id}
            userName={user.name}
            initialTitle={sprint.name}
            onTitleChange={throttledTitleSave}
            roomPrefix="sprint"
            placeholder="Document your sprint hypothesis and success criteria..."
            sidebar={
              <SprintSidebar
                sprint={sprint}
                onUpdate={updateSprint}
                highlightedFields={sprint.missing_fields}
              />
            }
          />
        ) : (
          <SprintIssuesTab sprint={sprint} />
        )}
      </div>
    </div>
  );
}

// Status badge component
function StatusBadge({ status }: { status: 'planning' | 'active' | 'completed' }) {
  const statusConfig = {
    planning: { label: 'Planning', className: 'bg-blue-500/20 text-blue-400' },
    active: { label: 'Active', className: 'bg-green-500/20 text-green-400' },
    completed: { label: 'Completed', className: 'bg-gray-500/20 text-gray-400' },
  };

  const config = statusConfig[status];

  return (
    <span className={cn('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium', config.className)}>
      {config.label}
    </span>
  );
}

/**
 * SprintIssuesTab - Issues list for sprint planning
 *
 * Shows issues from the sprint's program with:
 * - Filter by state (All, Active, Backlog, Done)
 * - Checkbox selection for bulk sprint assignment
 * - Sprint column showing current assignment
 * - New issues inherit the sprint context
 */
function SprintIssuesTab({ sprint }: { sprint: Sprint }) {
  // Filter tabs for planning context - show all states
  const planningFilterTabs = DEFAULT_FILTER_TABS;

  return (
    <IssuesList
      // Lock to program context - shows all issues from this program
      lockedProgramId={sprint.program_id || undefined}
      // Inherit context for new issues - auto-assign to this sprint and program
      inheritedContext={{
        programId: sprint.program_id || undefined,
        sprintId: sprint.id,
      }}
      // UI configuration
      filterTabs={planningFilterTabs}
      initialStateFilter=""
      showProgramFilter={false}
      showProjectFilter={true}
      showSprintFilter={true}
      showCreateButton={true}
      createButtonLabel="New Issue"
      viewModes={['list', 'kanban']}
      initialViewMode="list"
      storageKeyPrefix={`sprint-planning-${sprint.id}`}
      selectionPersistenceKey={`sprint-planning-${sprint.id}`}
      enableKeyboardNavigation={true}
      enableInlineSprintAssignment={true}
      emptyState={
        <div className="text-center py-12">
          <svg className="h-12 w-12 mx-auto mb-4 text-muted opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <p className="text-sm font-medium text-muted">No issues in this program yet</p>
          <p className="text-xs text-muted mt-1">Create issues to scope them into this sprint</p>
        </div>
      }
    />
  );
}

/**
 * CreateSprintForm - Inline form for creating a new sprint
 *
 * Shows a simple form to create a sprint with:
 * - Title field (auto-populated with "Sprint N")
 * - Program context (from URL param)
 */
interface CreateSprintFormProps {
  programId: string | null;
  projectId: string | null;
  onCreated: (sprintId: string) => void;
  onCancel: () => void;
}

function CreateSprintForm({ programId, projectId, onCreated, onCancel }: CreateSprintFormProps) {
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nextSprintNumber, setNextSprintNumber] = useState<number | null>(null);

  // Fetch the next sprint number for the program
  useEffect(() => {
    if (!programId) return;

    async function fetchNextNumber() {
      try {
        const res = await fetch(`${API_URL}/api/programs/${programId}/sprints`, { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          const maxNumber = data.sprints?.reduce((max: number, s: { sprint_number: number }) =>
            Math.max(max, s.sprint_number || 0), 0) ?? 0;
          setNextSprintNumber(maxNumber + 1);
          setTitle(`Sprint ${maxNumber + 1}`);
        }
      } catch {
        setNextSprintNumber(1);
        setTitle('Sprint 1');
      }
    }

    fetchNextNumber();
  }, [programId]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !programId) return;

    setCreating(true);
    setError(null);

    try {
      const res = await fetch(`${API_URL}/api/sprints`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          program_id: programId,
          title: title.trim(),
          sprint_number: nextSprintNumber || 1,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        onCreated(data.id);
      } else {
        const errData = await res.json();
        setError(errData.error || 'Failed to create sprint');
      }
    } catch {
      setError('Failed to create sprint');
    } finally {
      setCreating(false);
    }
  };

  // If no program context, show error
  if (!programId) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <p className="text-muted mb-4">A program is required to create a sprint.</p>
          <button
            onClick={onCancel}
            className="text-sm text-accent hover:underline"
          >
            Go back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-border">
        <div className="flex items-center gap-3 px-6 py-3">
          <button
            onClick={onCancel}
            className="text-muted hover:text-foreground transition-colors"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <h1 className="text-lg font-semibold text-foreground">Create Sprint</h1>
        </div>
      </div>

      {/* Form content */}
      <div className="flex-1 overflow-auto p-6">
        <form onSubmit={handleSubmit} className="max-w-md mx-auto space-y-6">
          <div>
            <label htmlFor="sprint-title" className="block text-sm font-medium text-foreground mb-2">
              Sprint Name
            </label>
            <input
              id="sprint-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Sprint name..."
              autoFocus
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-2 focus:ring-accent/50"
            />
          </div>

          {error && (
            <div className="text-sm text-red-400 bg-red-500/10 rounded-lg px-3 py-2">
              {error}
            </div>
          )}

          <div className="flex gap-3">
            <button
              type="button"
              onClick={onCancel}
              disabled={creating}
              className="flex-1 rounded-lg border border-border px-4 py-2 text-sm font-medium text-muted hover:bg-accent/5 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating || !title.trim()}
              className="flex-1 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {creating ? 'Creating...' : 'Create Sprint'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
