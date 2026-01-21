import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import {
  DndContext,
  DragOverlay,
  closestCorners,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragStartEvent,
  DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/cn';
import { sprintStatusColors, priorityColors } from '@/lib/statusColors';
import { TabBar, Tab } from '@/components/ui/TabBar';
import { StandupFeed } from '@/components/StandupFeed';
import { SprintReview } from '@/components/SprintReview';
import { SprintReconciliation, ReconciliationDecision } from '@/components/SprintReconciliation';

interface SprintApiResponse {
  id: string;
  program_id: string;
  program_name: string;
  program_prefix: string;
  name: string;
  goal?: string | null;
  sprint_number: number;
  workspace_sprint_start_date: string;
  issue_count: number;
  completed_count: number;
}

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
  sprint_number: number;
}

// Compute sprint dates from sprint_number and workspace start date
function computeSprintDates(sprintNumber: number, workspaceStartDate: string): { startDate: string; endDate: string; status: 'planned' | 'active' | 'completed' } {
  const baseDate = new Date(workspaceStartDate);
  const sprintDuration = 7; // 1 week

  // Sprint 1 starts on workspace start date
  const startDate = new Date(baseDate);
  startDate.setDate(startDate.getDate() + (sprintNumber - 1) * sprintDuration);

  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + sprintDuration - 1);

  const now = new Date();
  let status: 'planned' | 'active' | 'completed' = 'planned';
  if (now >= startDate && now <= endDate) {
    status = 'active';
  } else if (now > endDate) {
    status = 'completed';
  }

  return {
    startDate: startDate.toISOString(),
    endDate: endDate.toISOString(),
    status,
  };
}

interface Issue {
  id: string;
  title: string;
  state: string;
  priority: string;
  ticket_number: number;
  assignee_name: string | null;
  assignee_archived?: boolean;
  display_id: string;
  estimate: number | null;
  sprint_id?: string | null;
  carryover_from_sprint_id?: string | null;
  carryover_from_sprint_name?: string | null;
}

const API_URL = import.meta.env.VITE_API_URL ?? '';

// CSRF token cache
let csrfToken: string | null = null;

async function getCsrfToken(): Promise<string> {
  if (!csrfToken) {
    const response = await fetch(`${API_URL}/api/csrf-token`, { credentials: 'include' });
    const data = await response.json();
    csrfToken = data.token;
  }
  return csrfToken!;
}

// Helper for PATCH requests with CSRF token and retry on 403
async function patchWithCsrf(url: string, body: object): Promise<Response> {
  const token = await getCsrfToken();
  let res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  // If CSRF token invalid, clear and retry once
  if (res.status === 403) {
    csrfToken = null;
    const newToken = await getCsrfToken();
    res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': newToken },
      credentials: 'include',
      body: JSON.stringify(body),
    });
  }
  return res;
}

// Helper for POST requests with CSRF token and retry on 403
async function postWithCsrf(url: string, body: object): Promise<Response> {
  const token = await getCsrfToken();
  let res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  // If CSRF token invalid, clear and retry once
  if (res.status === 403) {
    csrfToken = null;
    const newToken = await getCsrfToken();
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': newToken },
      credentials: 'include',
      body: JSON.stringify(body),
    });
  }
  return res;
}

type SprintTab = 'planning' | 'standups' | 'review';

export function SprintViewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [sprint, setSprint] = useState<Sprint | null>(null);
  const [sprintIssues, setSprintIssues] = useState<Issue[]>([]);
  const [backlogIssues, setBacklogIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalText, setGoalText] = useState('');

  // Derive active tab from URL pathname
  const activeTab: SprintTab = useMemo(() => {
    const path = location.pathname;
    if (path.includes('/planning')) return 'planning';
    if (path.includes('/standups')) return 'standups';
    if (path.includes('/review')) return 'review';
    // Default: /view or base path defaults to standups (per user decision)
    return 'standups';
  }, [location.pathname]);

  // Tab change navigates to new URL (with replace to avoid history bloat)
  const handleTabChange = useCallback((tabId: string) => {
    navigate(`/sprints/${id}/${tabId}`, { replace: true });
  }, [id, navigate]);
  const [activeId, setActiveId] = useState<string | null>(null);
  // Estimate modal state
  const [pendingIssue, setPendingIssue] = useState<Issue | null>(null);
  const [estimateInput, setEstimateInput] = useState('');
  // Scope change tracking
  const [scopeData, setScopeData] = useState<{
    originalScope: number;
    currentScope: number;
    scopeChangePercent: number;
    sprintStartDate: string;
    scopeChanges: Array<{
      timestamp: string;
      scopeAfter: number;
      changeType: 'added' | 'removed';
      estimateChange: number;
    }>;
  } | null>(null);

  // Drag-and-drop sensors
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  // Calculate estimate totals
  const backlogEstimate = useMemo(() => {
    return backlogIssues.reduce((sum, issue) => sum + (issue.estimate || 0), 0);
  }, [backlogIssues]);

  const sprintEstimate = useMemo(() => {
    return sprintIssues.reduce((sum, issue) => sum + (issue.estimate || 0), 0);
  }, [sprintIssues]);

  const completedEstimate = useMemo(() => {
    return sprintIssues
      .filter(issue => issue.state === 'done')
      .reduce((sum, issue) => sum + (issue.estimate || 0), 0);
  }, [sprintIssues]);

  // Separate carryover issues from regular issues
  const carryoverIssues = useMemo(() => {
    return sprintIssues.filter(issue => issue.carryover_from_sprint_id);
  }, [sprintIssues]);

  const regularSprintIssues = useMemo(() => {
    return sprintIssues.filter(issue => !issue.carryover_from_sprint_id);
  }, [sprintIssues]);

  // Reset state and fetch data when sprint ID changes
  useEffect(() => {
    if (!id) return;

    // Reset state for new sprint
    setSprint(null);
    setSprintIssues([]);
    setBacklogIssues([]);
    setLoading(true);
    setEditingGoal(false);
    setScopeData(null);

    let cancelled = false;

    async function fetchData() {
      try {
        const sprintRes = await fetch(`${API_URL}/api/sprints/${id}`, { credentials: 'include' });

        if (cancelled) return;

        if (!sprintRes.ok) {
          navigate('/programs');
          return;
        }

        const sprintData: SprintApiResponse = await sprintRes.json();
        if (cancelled) return;

        // Transform API response to Sprint type with computed dates
        const { startDate, endDate, status } = computeSprintDates(
          sprintData.sprint_number,
          sprintData.workspace_sprint_start_date
        );

        setSprint({
          id: sprintData.id,
          program_id: sprintData.program_id,
          program_name: sprintData.program_name,
          program_prefix: sprintData.program_prefix,
          name: sprintData.name,
          goal: sprintData.goal ?? null,
          start_date: startDate,
          end_date: endDate,
          status,
          issue_count: sprintData.issue_count,
          completed_count: sprintData.completed_count,
          sprint_number: sprintData.sprint_number,
        });
        setGoalText(sprintData.goal || '');

        // Fetch sprint issues, backlog, and scope changes
        const [sprintIssuesRes, backlogRes, scopeRes] = await Promise.all([
          fetch(`${API_URL}/api/sprints/${id}/issues`, { credentials: 'include' }),
          fetch(`${API_URL}/api/programs/${sprintData.program_id}/issues`, { credentials: 'include' }),
          fetch(`${API_URL}/api/sprints/${id}/scope-changes`, { credentials: 'include' }),
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

        if (scopeRes.ok) {
          setScopeData(await scopeRes.json());
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

  // Check if issue needs estimate before adding to sprint
  const initiateAddToSprint = (issueId: string) => {
    const issue = backlogIssues.find(i => i.id === issueId);
    if (!issue) return;

    if (!issue.estimate) {
      // Show estimate modal
      setPendingIssue(issue);
      setEstimateInput('');
    } else {
      // Has estimate, move directly
      moveToSprint(issue);
    }
  };

  // Actually move the issue to sprint (called after estimate is set)
  const moveToSprint = async (issue: Issue, newEstimate?: number) => {
    if (!id) return;
    try {
      // Build update payload - estimate goes at top level, not nested in properties
      const payload: { sprint_id: string; estimate?: number } = { sprint_id: id };
      if (newEstimate !== undefined) {
        payload.estimate = newEstimate;
      }

      const res = await patchWithCsrf(`${API_URL}/api/issues/${issue.id}`, payload);

      if (res.ok) {
        // Update local state
        const updatedIssue = { ...issue, estimate: newEstimate ?? issue.estimate };
        setBacklogIssues(prev => prev.filter(i => i.id !== issue.id));
        setSprintIssues(prev => [...prev, updatedIssue]);
      }
    } catch (err) {
      console.error('Failed to move issue:', err);
    }
  };

  // Handle estimate submission from modal
  const handleEstimateSubmit = () => {
    if (!pendingIssue) return;
    const estimate = parseFloat(estimateInput);
    if (isNaN(estimate) || estimate <= 0) return;

    moveToSprint(pendingIssue, estimate);
    setPendingIssue(null);
    setEstimateInput('');
  };

  const cancelEstimateModal = () => {
    setPendingIssue(null);
    setEstimateInput('');
  };

  const moveToBacklog = async (issueId: string) => {
    try {
      const res = await patchWithCsrf(`${API_URL}/api/issues/${issueId}`, { sprint_id: null });

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
      const res = await patchWithCsrf(`${API_URL}/api/sprints/${id}`, { sprint_status: status });

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
      const res = await patchWithCsrf(`${API_URL}/api/sprints/${id}`, { goal: goalText || null });

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

      const res = await postWithCsrf(`${API_URL}/api/documents`, {
        title,
        document_type: docType,
        sprint_id: id,
      });

      if (res.ok) {
        const doc = await res.json();
        navigate(`/docs/${doc.id}`);
      }
    } catch (err) {
      console.error('Failed to create document:', err);
    }
  };

  // Drag-and-drop handlers
  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(event.active.id as string);
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);

    if (!over) return;

    const activeIssueId = active.id as string;
    const overId = over.id as string;

    // Determine source and target
    const isInBacklog = backlogIssues.some(i => i.id === activeIssueId);
    const isInSprint = sprintIssues.some(i => i.id === activeIssueId);

    // Check if dropped on sprint column or an issue in sprint
    const droppedOnSprint = overId === 'sprint-column' || sprintIssues.some(i => i.id === overId);
    // Check if dropped on backlog column or an issue in backlog
    const droppedOnBacklog = overId === 'backlog-column' || backlogIssues.some(i => i.id === overId);

    if (isInBacklog && droppedOnSprint) {
      // Use initiateAddToSprint to check for estimate
      initiateAddToSprint(activeIssueId);
    } else if (isInSprint && droppedOnBacklog) {
      moveToBacklog(activeIssueId);
    }
  }, [backlogIssues, sprintIssues, initiateAddToSprint, moveToBacklog]);

  // Get active issue for drag overlay
  const activeIssue = activeId
    ? [...backlogIssues, ...sprintIssues].find(i => i.id === activeId)
    : null;

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

        {/* Scope Change Indicator */}
        {scopeData && scopeData.scopeChangePercent !== 0 && (
          <div className="mt-2 text-sm">
            <span
              className={cn(
                'font-medium',
                scopeData.scopeChangePercent > 0 ? 'text-orange-500' : 'text-green-500'
              )}
              title={`Original scope: ${scopeData.originalScope}h → Current: ${scopeData.currentScope}h`}
            >
              Scope change: {scopeData.scopeChangePercent > 0 ? '+' : ''}{scopeData.scopeChangePercent}%
            </span>
          </div>
        )}

        {/* Sprint Progress Graph */}
        {sprintEstimate > 0 && (
          <SprintProgressGraph
            startDate={sprint.start_date}
            endDate={sprint.end_date}
            scopeHours={sprintEstimate}
            completedHours={completedEstimate}
            status={sprint.status}
            originalScope={scopeData?.originalScope}
            scopeChanges={scopeData?.scopeChanges}
          />
        )}

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

      {/* Tabs */}
      <TabBar
        tabs={[
          { id: 'planning', label: 'Planning' },
          { id: 'standups', label: 'Standups' },
          { id: 'review', label: 'Review' },
        ]}
        activeTab={activeTab}
        onTabChange={handleTabChange}
      />

      {/* Tab content */}
      {activeTab === 'planning' ? (
        /* Sprint planning columns with drag-and-drop */
        <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div className="flex flex-1 overflow-hidden">
          {/* Backlog column */}
          <DroppableColumn
            id="backlog-column"
            title="Backlog"
            issueCount={backlogIssues.length}
            estimateHours={backlogEstimate}
            issues={backlogIssues}
            emptyMessage="No issues in backlog"
            onIssueClick={(issueId) => navigate(`/issues/${issueId}`)}
            onIssueAction={initiateAddToSprint}
            actionType="add"
            className="border-r border-border"
          />

          {/* Sprint column */}
          <DroppableColumn
            id="sprint-column"
            title="Sprint"
            issueCount={sprintIssues.length}
            estimateHours={sprintEstimate}
            completedHours={completedEstimate}
            issues={regularSprintIssues}
            carryoverIssues={carryoverIssues}
            emptyMessage="Drag issues from backlog to add"
            onIssueClick={(issueId) => navigate(`/issues/${issueId}`)}
            onIssueAction={moveToBacklog}
            actionType="remove"
          />
        </div>

        {/* Drag overlay */}
        <DragOverlay>
          {activeIssue ? <IssueCardPreview issue={activeIssue} /> : null}
        </DragOverlay>
      </DndContext>
      ) : activeTab === 'standups' ? (
        /* Standups feed */
        <StandupFeed sprintId={sprint.id} />
      ) : (
        /* Sprint review with reconciliation */
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Sprint reconciliation for incomplete issues */}
          <div className="border-b border-border p-4">
            <SprintReconciliation
              sprintId={sprint.id}
              sprintNumber={sprint.sprint_number}
              programId={sprint.program_id}
              onDecisionMade={(decision) => {
                // Refresh sprint issues when decisions are made
                // The SprintReconciliation handles its own query invalidation
                console.log('Reconciliation decision:', decision);
              }}
            />
          </div>
          {/* Sprint review editor */}
          <div className="flex-1 overflow-auto pb-20">
            <SprintReview sprintId={sprint.id} />
          </div>
        </div>
      )}

      {/* Estimate Required Modal */}
      {pendingIssue && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-96 rounded-lg border border-border bg-background p-6 shadow-lg">
            <h3 className="text-lg font-semibold text-foreground">Estimate Required</h3>
            <p className="mt-2 text-sm text-muted">
              Please enter an estimate for this issue before adding it to the sprint:
            </p>
            <div className="mt-3 rounded-md border border-border bg-border/30 p-3">
              <span className="text-xs font-mono text-muted">{pendingIssue.display_id}</span>
              <p className="mt-1 text-sm text-foreground">{pendingIssue.title}</p>
            </div>
            <div className="mt-4">
              <label className="block text-sm font-medium text-foreground">
                Estimate (hours)
              </label>
              <input
                type="number"
                min="0.5"
                step="0.5"
                value={estimateInput}
                onChange={(e) => setEstimateInput(e.target.value)}
                placeholder="e.g., 4"
                className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleEstimateSubmit();
                  if (e.key === 'Escape') cancelEstimateModal();
                }}
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={cancelEstimateModal}
                className="rounded-md px-4 py-2 text-sm text-muted hover:bg-border"
              >
                Cancel
              </button>
              <button
                onClick={handleEstimateSubmit}
                disabled={!estimateInput || parseFloat(estimateInput) <= 0}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Add to Sprint
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: Sprint['status'] }) {
  return (
    <span className={cn('rounded px-2 py-0.5 text-xs font-medium capitalize whitespace-nowrap', sprintStatusColors[status])}>
      {status}
    </span>
  );
}

// Droppable column component
function DroppableColumn({
  id,
  title,
  issueCount,
  estimateHours,
  completedHours,
  issues,
  carryoverIssues,
  emptyMessage,
  onIssueClick,
  onIssueAction,
  actionType,
  className,
}: {
  id: string;
  title: string;
  issueCount: number;
  estimateHours: number;
  completedHours?: number;
  issues: Issue[];
  carryoverIssues?: Issue[];
  emptyMessage: string;
  onIssueClick: (id: string) => void;
  onIssueAction: (id: string) => void;
  actionType: 'add' | 'remove';
  className?: string;
}) {
  const { setNodeRef, isOver } = useSortable({ id });

  // Group carryover issues by source sprint
  const carryoverGroups = carryoverIssues?.reduce((acc, issue) => {
    const sprintName = issue.carryover_from_sprint_name || 'Previous Sprint';
    if (!acc[sprintName]) {
      acc[sprintName] = [];
    }
    acc[sprintName].push(issue);
    return acc;
  }, {} as Record<string, Issue[]>) || {};

  const allIssues = [...(carryoverIssues || []), ...issues];

  return (
    <div className={cn('flex w-1/2 flex-col', className)}>
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <h2 className="font-medium text-foreground">{title}</h2>
          <p className="text-xs text-muted">
            {issueCount} issues
            {estimateHours > 0 && (
              <> &middot; {estimateHours} hrs{completedHours !== undefined && ` (${completedHours} done)`}</>
            )}
          </p>
        </div>
        {completedHours !== undefined && estimateHours > 0 && (
          <div className="text-right">
            <span className="text-sm font-medium text-foreground">
              {completedHours}/{estimateHours} hrs
            </span>
          </div>
        )}
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          'flex-1 overflow-auto p-4 pb-20 space-y-2 transition-colors',
          isOver && 'bg-accent/10'
        )}
      >
        <SortableContext
          items={allIssues.map(i => i.id)}
          strategy={verticalListSortingStrategy}
        >
          {/* Carryover sections */}
          {Object.entries(carryoverGroups).map(([sprintName, groupIssues]) => (
            <div key={sprintName} className="mb-4">
              <div className="mb-2 flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-orange-500" />
                <span className="text-xs font-medium text-orange-500">
                  Carryover from {sprintName}
                </span>
              </div>
              {groupIssues.map((issue) => (
                <DraggableIssueCard
                  key={issue.id}
                  issue={issue}
                  action={actionType}
                  onClick={() => onIssueClick(issue.id)}
                  onAction={() => onIssueAction(issue.id)}
                  isCarryover
                />
              ))}
            </div>
          ))}

          {/* Regular issues */}
          {issues.map((issue) => (
            <DraggableIssueCard
              key={issue.id}
              issue={issue}
              action={actionType}
              onClick={() => onIssueClick(issue.id)}
              onAction={() => onIssueAction(issue.id)}
            />
          ))}
        </SortableContext>
        {allIssues.length === 0 && (
          <p className="text-center text-sm text-muted py-8">{emptyMessage}</p>
        )}
      </div>
    </div>
  );
}

// Draggable issue card wrapper
function DraggableIssueCard({
  issue,
  action,
  onClick,
  onAction,
  isCarryover,
}: {
  issue: Issue;
  action: 'add' | 'remove';
  onClick: () => void;
  onAction: () => void;
  isCarryover?: boolean;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: issue.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn('touch-none', isDragging && 'opacity-50')}
    >
      <IssueCard
        issue={issue}
        action={action}
        onClick={onClick}
        onAction={onAction}
        isCarryover={isCarryover}
      />
    </div>
  );
}

// Issue card preview for drag overlay
function IssueCardPreview({ issue }: { issue: Issue }) {
  return (
    <div className="rounded-lg border border-accent bg-background p-3 shadow-lg">
      <div className="flex items-center gap-2">
        <span className="text-xs font-mono text-muted">{issue.display_id}</span>
        {issue.estimate && (
          <span className="text-xs text-accent">{issue.estimate}h</span>
        )}
      </div>
      <p className="mt-1 text-sm text-foreground truncate">{issue.title}</p>
    </div>
  );
}

const STATE_COLORS: Record<string, string> = {
  backlog: 'bg-gray-500',
  todo: 'bg-blue-500',
  in_progress: 'bg-yellow-500',
  done: 'bg-green-500',
  cancelled: 'bg-red-500',
};

function IssueCard({
  issue,
  action,
  onClick,
  onAction,
  isCarryover,
}: {
  issue: Issue;
  action: 'add' | 'remove';
  onClick: () => void;
  onAction: () => void;
  isCarryover?: boolean;
}) {
  const localPriorityColors: Record<string, string> = {
    ...priorityColors,
    none: 'text-muted',
  };

  return (
    <div className={cn(
      "group flex items-center gap-2 rounded-lg border bg-background p-3 hover:bg-border/30 transition-colors cursor-grab active:cursor-grabbing",
      isCarryover ? "border-orange-500/50" : "border-border"
    )}>
      <button
        onClick={(e) => {
          e.stopPropagation();
          onAction();
        }}
        className={cn(
          'flex h-6 w-6 items-center justify-center rounded text-white transition-colors flex-shrink-0',
          action === 'add'
            ? 'bg-green-600 hover:bg-green-700'
            : 'bg-red-600 hover:bg-red-700'
        )}
        title={action === 'add' ? 'Add to sprint' : 'Remove from sprint'}
      >
        {action === 'add' ? '+' : '-'}
      </button>

      <button onClick={onClick} className="flex-1 text-left min-w-0">
        <div className="flex items-center gap-2">
          <span className={cn('h-2 w-2 rounded-full flex-shrink-0', STATE_COLORS[issue.state])} />
          <span className="text-xs font-mono text-muted">{issue.display_id}</span>
          {isCarryover && (
            <span className="rounded px-1.5 py-0.5 text-[10px] font-medium bg-orange-500/20 text-orange-500 whitespace-nowrap" title={`Carried over from ${issue.carryover_from_sprint_name || 'previous sprint'}`}>
              Carryover
            </span>
          )}
          <span className={cn('text-xs', localPriorityColors[issue.priority])}>
            {issue.priority !== 'none' && issue.priority.charAt(0).toUpperCase()}
          </span>
          {issue.estimate && (
            <span className="text-xs text-muted">{issue.estimate}h</span>
          )}
        </div>
        <p className="mt-1 text-sm text-foreground truncate">{issue.title}</p>
      </button>
    </div>
  );
}

function formatDate(dateString: string): string {
  return new Date(dateString).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

// Sprint Progress Graph component
function SprintProgressGraph({
  startDate,
  endDate,
  scopeHours,
  completedHours,
  status,
  originalScope,
  scopeChanges,
}: {
  startDate: string;
  endDate: string;
  scopeHours: number;
  completedHours: number;
  status: 'planned' | 'active' | 'completed';
  originalScope?: number;
  scopeChanges?: Array<{
    timestamp: string;
    scopeAfter: number;
    changeType: 'added' | 'removed';
    estimateChange: number;
  }>;
}) {
  // Calculate progress through sprint
  const start = new Date(startDate).getTime();
  const end = new Date(endDate).getTime();
  const now = Date.now();

  // Clamp current time to sprint bounds
  const current = Math.min(Math.max(now, start), end);
  const totalDuration = end - start;
  const elapsed = current - start;
  const progressPercent = totalDuration > 0 ? (elapsed / totalDuration) * 100 : 0;

  // Calculate target completion at current time (linear pace)
  const targetHoursAtNow = (progressPercent / 100) * scopeHours;
  const completionPercent = scopeHours > 0 ? (completedHours / scopeHours) * 100 : 0;

  // SVG dimensions
  const width = 400;
  const height = 120;
  const padding = { top: 20, right: 40, bottom: 30, left: 50 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;

  // Y-axis scale (0 to scopeHours)
  const yScale = (hours: number) =>
    padding.top + chartHeight - (hours / scopeHours) * chartHeight;

  // X-axis scale (0% to 100% progress)
  const xScale = (percent: number) =>
    padding.left + (percent / 100) * chartWidth;

  // Generate dates for x-axis labels
  const startLabel = formatDate(startDate);
  const endLabel = formatDate(endDate);
  const midDate = new Date(start + totalDuration / 2);
  const midLabel = formatDate(midDate.toISOString());

  // Status indicator
  const statusColor = {
    planned: '#9CA3AF', // gray
    active: '#3B82F6', // blue
    completed: '#22C55E', // green
  }[status];

  const isOnTrack = completedHours >= targetHoursAtNow * 0.8;

  return (
    <div className="mt-4 rounded-lg border border-border bg-border/20 p-4">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-foreground">Sprint Progress</h3>
        <div className="flex items-center gap-4 text-xs">
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-gray-400" />
            <span className="text-muted">Scope: {scopeHours}h</span>
          </span>
          <span className="flex items-center gap-1">
            <span className="h-2 w-2 rounded-full bg-accent" />
            <span className="text-muted">Completed: {completedHours}h</span>
          </span>
          {status === 'active' && (
            <span className={cn('font-medium', isOnTrack ? 'text-green-500' : 'text-orange-500')}>
              {isOnTrack ? 'On Track' : 'Behind'}
            </span>
          )}
        </div>
      </div>

      <svg width={width} height={height} className="text-muted">
        {/* Grid lines */}
        <g className="stroke-border">
          {[0, 25, 50, 75, 100].map((percent) => (
            <line
              key={percent}
              x1={xScale(percent)}
              y1={padding.top}
              x2={xScale(percent)}
              y2={padding.top + chartHeight}
              strokeDasharray="2,2"
              strokeWidth={0.5}
            />
          ))}
          {[0, 25, 50, 75, 100].map((percent) => (
            <line
              key={`h-${percent}`}
              x1={padding.left}
              y1={yScale((percent / 100) * scopeHours)}
              x2={padding.left + chartWidth}
              y2={yScale((percent / 100) * scopeHours)}
              strokeDasharray="2,2"
              strokeWidth={0.5}
            />
          ))}
        </g>

        {/* Scope line - shows scope changes over time if available */}
        {scopeChanges && scopeChanges.length > 0 && originalScope !== undefined ? (
          // Draw stepped scope line showing changes
          <g>
            {(() => {
              const segments: JSX.Element[] = [];
              let prevX = xScale(0);
              let prevScope = originalScope;

              // Draw initial horizontal segment from start to first change
              const firstChange = scopeChanges[0];
              const firstChangeTime = new Date(firstChange.timestamp).getTime();
              const firstChangePercent = ((firstChangeTime - start) / totalDuration) * 100;

              segments.push(
                <line
                  key="initial"
                  x1={prevX}
                  y1={yScale(prevScope)}
                  x2={xScale(Math.min(firstChangePercent, 100))}
                  y2={yScale(prevScope)}
                  stroke="#6B7280"
                  strokeWidth={2}
                />
              );

              // Draw scope changes
              for (let i = 0; i < scopeChanges.length; i++) {
                const change = scopeChanges[i];
                const changeTime = new Date(change.timestamp).getTime();
                const changePercent = Math.min(((changeTime - start) / totalDuration) * 100, 100);
                const nextChange = scopeChanges[i + 1];
                const nextChangePercent = nextChange
                  ? Math.min(((new Date(nextChange.timestamp).getTime() - start) / totalDuration) * 100, 100)
                  : 100;

                // Vertical line showing scope jump
                segments.push(
                  <line
                    key={`v-${i}`}
                    x1={xScale(changePercent)}
                    y1={yScale(prevScope)}
                    x2={xScale(changePercent)}
                    y2={yScale(change.scopeAfter)}
                    stroke="#F97316"
                    strokeWidth={1.5}
                    strokeDasharray="2,2"
                  />
                );

                // Horizontal line at new scope level
                segments.push(
                  <line
                    key={`h-${i}`}
                    x1={xScale(changePercent)}
                    y1={yScale(change.scopeAfter)}
                    x2={xScale(nextChangePercent)}
                    y2={yScale(change.scopeAfter)}
                    stroke="#6B7280"
                    strokeWidth={2}
                  />
                );

                // Small marker at change point
                segments.push(
                  <circle
                    key={`m-${i}`}
                    cx={xScale(changePercent)}
                    cy={yScale(change.scopeAfter)}
                    r={3}
                    fill="#F97316"
                  />
                );

                prevScope = change.scopeAfter;
              }

              return segments;
            })()}
          </g>
        ) : (
          // Simple horizontal scope line (no changes)
          <line
            x1={xScale(0)}
            y1={yScale(scopeHours)}
            x2={xScale(100)}
            y2={yScale(scopeHours)}
            stroke="#6B7280"
            strokeWidth={2}
          />
        )}

        {/* Target pace line (diagonal from 0 to scope) */}
        <line
          x1={xScale(0)}
          y1={yScale(0)}
          x2={xScale(100)}
          y2={yScale(scopeHours)}
          stroke={statusColor}
          strokeWidth={1.5}
          strokeDasharray="4,4"
        />

        {/* Completed hours line (from 0 to current) */}
        <line
          x1={xScale(0)}
          y1={yScale(0)}
          x2={xScale(progressPercent)}
          y2={yScale(completedHours)}
          stroke="#8B5CF6"
          strokeWidth={2.5}
        />

        {/* Current position marker */}
        {status === 'active' && (
          <g>
            <circle
              cx={xScale(progressPercent)}
              cy={yScale(completedHours)}
              r={4}
              fill="#8B5CF6"
            />
            {/* Vertical "now" line */}
            <line
              x1={xScale(progressPercent)}
              y1={padding.top}
              x2={xScale(progressPercent)}
              y2={padding.top + chartHeight}
              stroke={statusColor}
              strokeWidth={1}
              strokeDasharray="2,2"
            />
          </g>
        )}

        {/* X-axis labels */}
        <text x={xScale(0)} y={height - 8} fontSize={10} textAnchor="start" fill="currentColor">
          {startLabel}
        </text>
        <text x={xScale(50)} y={height - 8} fontSize={10} textAnchor="middle" fill="currentColor">
          {midLabel}
        </text>
        <text x={xScale(100)} y={height - 8} fontSize={10} textAnchor="end" fill="currentColor">
          {endLabel}
        </text>

        {/* Y-axis labels */}
        <text x={padding.left - 8} y={yScale(0)} fontSize={10} textAnchor="end" dominantBaseline="middle" fill="currentColor">
          0h
        </text>
        <text x={padding.left - 8} y={yScale(scopeHours)} fontSize={10} textAnchor="end" dominantBaseline="middle" fill="currentColor">
          {scopeHours}h
        </text>
      </svg>
    </div>
  );
}
