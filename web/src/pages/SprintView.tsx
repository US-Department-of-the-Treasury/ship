import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
}

// Compute sprint dates from sprint_number and workspace start date
function computeSprintDates(sprintNumber: number, workspaceStartDate: string): { startDate: string; endDate: string; status: 'planned' | 'active' | 'completed' } {
  const baseDate = new Date(workspaceStartDate);
  const sprintDuration = 14; // 2 weeks

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
  display_id: string;
  estimate: number | null;
  sprint_id?: string | null;
}

const API_URL = import.meta.env.VITE_API_URL ?? '';

export function SprintViewPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [sprint, setSprint] = useState<Sprint | null>(null);
  const [sprintIssues, setSprintIssues] = useState<Issue[]>([]);
  const [backlogIssues, setBacklogIssues] = useState<Issue[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingGoal, setEditingGoal] = useState(false);
  const [goalText, setGoalText] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);

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
        });
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
      moveToSprint(activeIssueId);
    } else if (isInSprint && droppedOnBacklog) {
      moveToBacklog(activeIssueId);
    }
  }, [backlogIssues, sprintIssues, moveToSprint, moveToBacklog]);

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

      {/* Sprint planning columns with drag-and-drop */}
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
            onIssueAction={moveToSprint}
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
            issues={sprintIssues}
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
    </div>
  );
}

function StatusBadge({ status }: { status: Sprint['status'] }) {
  return (
    <span className={cn('rounded px-2 py-0.5 text-xs font-medium capitalize', sprintStatusColors[status])}>
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
  emptyMessage: string;
  onIssueClick: (id: string) => void;
  onIssueAction: (id: string) => void;
  actionType: 'add' | 'remove';
  className?: string;
}) {
  const { setNodeRef, isOver } = useSortable({ id });

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
          'flex-1 overflow-auto p-4 space-y-2 transition-colors',
          isOver && 'bg-accent/10'
        )}
      >
        <SortableContext
          items={issues.map(i => i.id)}
          strategy={verticalListSortingStrategy}
        >
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
        {issues.length === 0 && (
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
}: {
  issue: Issue;
  action: 'add' | 'remove';
  onClick: () => void;
  onAction: () => void;
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
}: {
  issue: Issue;
  action: 'add' | 'remove';
  onClick: () => void;
  onAction: () => void;
}) {
  const localPriorityColors: Record<string, string> = {
    ...priorityColors,
    none: 'text-muted',
  };

  return (
    <div className="group flex items-center gap-2 rounded-lg border border-border bg-background p-3 hover:bg-border/30 transition-colors cursor-grab active:cursor-grabbing">
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
