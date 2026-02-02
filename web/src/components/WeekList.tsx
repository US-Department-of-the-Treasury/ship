import { useNavigate } from 'react-router-dom';
import { useSprintsQuery, Sprint } from '@/hooks/useWeeksQuery';
import { useProjectWeeksQuery, ProjectWeek } from '@/hooks/useProjectsQuery';
import { cn } from '@/lib/cn';

// Union type that works with both Sprint and ProjectWeek
interface WeekItem {
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

interface WeekListProps {
  /** Program ID to fetch weeks for (exclusive with lockedProjectId) */
  lockedProgramId?: string;
  /** Project ID to fetch weeks for (exclusive with lockedProgramId) */
  lockedProjectId?: string;
  /** Callback when Plan Week is clicked */
  onPlanWeek?: (weekId?: string) => void;
  /** Callback when a week is clicked (defaults to navigation) */
  onWeekClick?: (weekId: string) => void;
  /** Show the Plan Week button */
  showPlanButton?: boolean;
  /** Custom empty state message */
  emptyMessage?: string;
  /** Custom empty state hint */
  emptyHint?: string;
}

/**
 * WeekList - Unified week list component for programs and projects
 *
 * Renders a list of weeks with consistent UI including:
 * - Week number badge
 * - Status badge (Planning/Active/Completed)
 * - Date range
 * - Owner name (if available)
 * - Days remaining (for active weeks)
 * - Progress (completed/total issues)
 * - Plan Week button (optional)
 */
export function WeekList({
  lockedProgramId,
  lockedProjectId,
  onPlanWeek,
  onWeekClick,
  showPlanButton = false,
  emptyMessage,
  emptyHint,
}: WeekListProps) {
  const navigate = useNavigate();

  // Fetch weeks based on context
  const programQuery = useSprintsQuery(lockedProgramId);
  const projectQuery = useProjectWeeksQuery(lockedProjectId);

  // Determine which query to use
  const isProjectContext = !!lockedProjectId;
  const query = isProjectContext ? projectQuery : programQuery;
  const weeks: WeekItem[] = isProjectContext
    ? (projectQuery.data ?? [])
    : (programQuery.data?.weeks ?? []);

  const loading = query.isLoading;

  // Default click handler navigates to week view
  const handleWeekClick = (weekId: string) => {
    if (onWeekClick) {
      onWeekClick(weekId);
    } else {
      navigate(`/documents/${weekId}`);
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
          Loading weeks...
        </div>
      </div>
    );
  }

  if (weeks.length === 0) {
    const contextType = isProjectContext ? 'project' : 'program';
    const defaultEmptyMessage = `No weeks in this ${contextType}`;
    const defaultEmptyHint = isProjectContext
      ? 'Link weeks to this project from the week editor'
      : 'Create weeks using the Plan Week button';

    return (
      <div className="flex flex-col items-center justify-center h-48 text-muted">
        <svg className="w-12 h-12 mb-3 opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
        </svg>
        <p className="text-sm font-medium">{emptyMessage || defaultEmptyMessage}</p>
        <p className="text-xs mt-1">{emptyHint || defaultEmptyHint}</p>
        {showPlanButton && onPlanWeek && (
          <button
            onClick={() => onPlanWeek()}
            className="mt-4 rounded-md bg-accent/20 px-3 py-1.5 text-sm font-medium text-accent hover:bg-accent/30 transition-colors"
          >
            Plan Week
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto p-4 pb-20">
      {showPlanButton && onPlanWeek && (
        <div className="mb-4 flex justify-end">
          <button
            onClick={() => onPlanWeek()}
            className="rounded-md bg-accent/20 px-3 py-1.5 text-sm font-medium text-accent hover:bg-accent/30 transition-colors"
          >
            Plan Week
          </button>
        </div>
      )}
      <div className="space-y-2">
        {weeks.map((week) => (
          <WeekCard
            key={week.id}
            week={week}
            onClick={() => handleWeekClick(week.id)}
          />
        ))}
      </div>
    </div>
  );
}

// Individual week card component
interface WeekCardProps {
  week: WeekItem;
  onClick: () => void;
}

function WeekCard({ week, onClick }: WeekCardProps) {
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
      {/* Week number badge */}
      <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-accent/20 flex items-center justify-center">
        <span className="text-sm font-bold text-accent">{week.sprint_number}</span>
      </div>

      {/* Week info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-foreground truncate">
            {week.name || `Week ${week.sprint_number}`}
          </h3>
          <span className={cn(
            'inline-flex px-2 py-0.5 text-xs font-medium rounded capitalize',
            getStatusBadgeClass(week.status)
          )}>
            {week.status}
          </span>
        </div>
        <div className="flex items-center gap-3 mt-1 text-xs text-muted">
          <span>{formatDate(week.start_date)} – {formatDate(week.end_date)}</span>
          {week.owner && <span>{week.owner.name}</span>}
          {week.days_remaining != null && week.status === 'active' && (
            <span className="text-accent">{week.days_remaining}d remaining</span>
          )}
        </div>
      </div>

      {/* Progress */}
      <div className="flex-shrink-0 text-right">
        <div className="text-sm font-medium text-foreground">
          {week.completed_count}/{week.issue_count}
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
