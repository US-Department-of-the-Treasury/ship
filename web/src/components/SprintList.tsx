import { useNavigate } from 'react-router-dom';
import { useSprintsQuery, Sprint } from '@/hooks/useSprintsQuery';
import { useProjectSprintsQuery, ProjectSprint } from '@/hooks/useProjectsQuery';
import { cn } from '@/lib/cn';

// Union type that works with both Sprint and ProjectSprint
interface SprintItem {
  id: string;
  name: string;
  sprint_number: number;
  status: 'planning' | 'active' | 'completed';
  start_date?: string | null;
  end_date?: string | null;
  issue_count: number;
  completed_count: number;
  days_remaining?: number | null;
  owner?: { id: string; name: string; email: string } | null;
}

interface SprintListProps {
  /** Program ID to fetch sprints for (exclusive with lockedProjectId) */
  lockedProgramId?: string;
  /** Project ID to fetch sprints for (exclusive with lockedProgramId) */
  lockedProjectId?: string;
  /** Callback when Plan Sprint is clicked */
  onPlanSprint?: (sprintId?: string) => void;
  /** Callback when a sprint is clicked (defaults to navigation) */
  onSprintClick?: (sprintId: string) => void;
  /** Show the Plan Sprint button */
  showPlanButton?: boolean;
  /** Custom empty state message */
  emptyMessage?: string;
  /** Custom empty state hint */
  emptyHint?: string;
}

/**
 * SprintList - Unified sprint list component for programs and projects
 *
 * Renders a list of sprints with consistent UI including:
 * - Sprint number badge
 * - Status badge (Planning/Active/Completed)
 * - Date range
 * - Owner name (if available)
 * - Days remaining (for active sprints)
 * - Progress (completed/total issues)
 * - Plan Sprint button (optional)
 */
export function SprintList({
  lockedProgramId,
  lockedProjectId,
  onPlanSprint,
  onSprintClick,
  showPlanButton = false,
  emptyMessage,
  emptyHint,
}: SprintListProps) {
  const navigate = useNavigate();

  // Fetch sprints based on context
  const programQuery = useSprintsQuery(lockedProgramId);
  const projectQuery = useProjectSprintsQuery(lockedProjectId);

  // Determine which query to use
  const isProjectContext = !!lockedProjectId;
  const query = isProjectContext ? projectQuery : programQuery;
  const sprints: SprintItem[] = isProjectContext
    ? (projectQuery.data ?? [])
    : (programQuery.data?.sprints ?? []);

  const loading = query.isLoading;

  // Default click handler navigates to sprint view
  const handleSprintClick = (sprintId: string) => {
    if (onSprintClick) {
      onSprintClick(sprintId);
    } else {
      navigate(`/sprints/${sprintId}/view`);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="flex items-center gap-2 text-muted">
          <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Loading sprints...
        </div>
      </div>
    );
  }

  if (sprints.length === 0) {
    const contextType = isProjectContext ? 'project' : 'program';
    const defaultEmptyMessage = `No sprints in this ${contextType}`;
    const defaultEmptyHint = isProjectContext
      ? 'Link sprints to this project from the sprint editor'
      : 'Create sprints using the Plan Sprint button';

    return (
      <div className="flex flex-col items-center justify-center h-48 text-muted">
        <svg className="w-12 h-12 mb-3 opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
        </svg>
        <p className="text-sm font-medium">{emptyMessage || defaultEmptyMessage}</p>
        <p className="text-xs mt-1">{emptyHint || defaultEmptyHint}</p>
        {showPlanButton && onPlanSprint && (
          <button
            onClick={() => onPlanSprint()}
            className="mt-4 rounded-md bg-accent/20 px-3 py-1.5 text-sm font-medium text-accent hover:bg-accent/30 transition-colors"
          >
            Plan Sprint
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-4 pb-20">
      {showPlanButton && onPlanSprint && (
        <div className="mb-4 flex justify-end">
          <button
            onClick={() => onPlanSprint()}
            className="rounded-md bg-accent/20 px-3 py-1.5 text-sm font-medium text-accent hover:bg-accent/30 transition-colors"
          >
            Plan Sprint
          </button>
        </div>
      )}
      <div className="space-y-2">
        {sprints.map((sprint) => (
          <SprintCard
            key={sprint.id}
            sprint={sprint}
            onClick={() => handleSprintClick(sprint.id)}
          />
        ))}
      </div>
    </div>
  );
}

// Individual sprint card component
interface SprintCardProps {
  sprint: SprintItem;
  onClick: () => void;
}

function SprintCard({ sprint, onClick }: SprintCardProps) {
  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  const getStatusBadgeClass = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-500/20 text-green-300';
      case 'completed':
        return 'bg-gray-500/20 text-gray-300';
      case 'planning':
      default:
        return 'bg-blue-500/20 text-blue-300';
    }
  };

  return (
    <div
      onClick={onClick}
      className="flex items-center gap-4 p-3 rounded-lg border border-border hover:bg-accent/5 cursor-pointer transition-colors"
    >
      {/* Sprint number badge */}
      <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-accent/20 flex items-center justify-center">
        <span className="text-sm font-bold text-accent">{sprint.sprint_number}</span>
      </div>

      {/* Sprint info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-foreground truncate">
            {sprint.name || `Sprint ${sprint.sprint_number}`}
          </h3>
          <span className={cn(
            'inline-flex px-2 py-0.5 text-xs font-medium rounded capitalize',
            getStatusBadgeClass(sprint.status)
          )}>
            {sprint.status}
          </span>
        </div>
        <div className="flex items-center gap-3 mt-1 text-xs text-muted">
          <span>{formatDate(sprint.start_date)} – {formatDate(sprint.end_date)}</span>
          {sprint.owner && <span>{sprint.owner.name}</span>}
          {sprint.days_remaining != null && sprint.status === 'active' && (
            <span className="text-accent">{sprint.days_remaining}d remaining</span>
          )}
        </div>
      </div>

      {/* Progress */}
      <div className="flex-shrink-0 text-right">
        <div className="text-sm font-medium text-foreground">
          {sprint.completed_count}/{sprint.issue_count}
        </div>
        <div className="text-xs text-muted">issues done</div>
      </div>

      {/* Arrow */}
      <svg className="w-4 h-4 text-muted flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
        <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
      </svg>
    </div>
  );
}
