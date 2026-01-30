import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { WeekTimeline, getCurrentSprintNumber, type Sprint } from '@/components/week/WeekTimeline';
import { WeekDetailView } from '@/components/week/WeekDetailView';
import { useProjectSprints } from '@/hooks/useWeeksQuery';
import { apiGet, apiPost } from '@/lib/api';
import { cn } from '@/lib/cn';
import type { DocumentTabProps } from '@/lib/document-tabs';

const API_URL = import.meta.env.VITE_API_URL ?? '';

interface Week {
  number: number;
  name: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
}

interface PersonWeekStatus {
  isAllocated: boolean;
  planId: string | null;
  retroId: string | null;
}

interface Person {
  id: string;
  name: string;
  weeks: Record<number, PersonWeekStatus>;
}

interface AllocationGridData {
  projectId: string;
  projectTitle: string;
  currentSprintNumber: number;
  weeks: Week[];
  people: Person[];
}

/**
 * ProjectWeeksTab - Shows weeks associated with a project
 *
 * This is the "Weeks" tab content when viewing a project document.
 * Features a horizontal scrolling WeekTimeline at the top.
 * Below that shows an allocation grid with people as rows and weeks as columns.
 * When nestedPath contains a week ID, shows WeekDetailView inline.
 */
export default function ProjectSprintsTab({ documentId, nestedPath }: DocumentTabProps) {
  const navigate = useNavigate();
  const { sprints, loading: sprintsLoading, workspaceSprintStartDate } = useProjectSprints(documentId);
  const [gridData, setGridData] = useState<AllocationGridData | null>(null);
  const [gridLoading, setGridLoading] = useState(true);
  const [gridError, setGridError] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const hasScrolledToCurrentRef = useRef(false);

  // If nestedPath is provided and looks like a UUID, show sprint detail
  const isUuid = nestedPath && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(nestedPath);
  const selectedSprintId = isUuid ? nestedPath : null;

  // Fetch allocation grid data
  useEffect(() => {
    async function fetchGrid() {
      try {
        setGridLoading(true);
        const res = await apiGet(`/api/weekly-plans/project-allocation-grid/${documentId}`);
        if (!res.ok) {
          throw new Error('Failed to load allocation grid');
        }
        const data = await res.json();
        setGridData(data);
      } catch (err) {
        setGridError('Failed to load allocation data');
      } finally {
        setGridLoading(false);
      }
    }

    fetchGrid();
  }, [documentId]);

  // Scroll to current week on initial load
  useEffect(() => {
    if (gridData && scrollContainerRef.current && !hasScrolledToCurrentRef.current) {
      const currentWeekIndex = gridData.weeks.findIndex(w => w.isCurrent);
      if (currentWeekIndex >= 0) {
        requestAnimationFrame(() => {
          if (scrollContainerRef.current) {
            const columnWidth = 120;
            const scrollPosition = Math.max(0, (currentWeekIndex - 1) * columnWidth);
            scrollContainerRef.current.scrollLeft = scrollPosition;
            hasScrolledToCurrentRef.current = true;
          }
        });
      }
    }
  }, [gridData]);

  // Handle sprint selection from timeline
  const handleSelectSprint = useCallback((_sprintNumber: number, sprint: Sprint | null) => {
    if (sprint) {
      navigate(`/documents/${documentId}/sprints/${sprint.id}`);
    }
  }, [documentId, navigate]);

  // Handle sprint open (double-click or direct navigation)
  const handleOpenSprint = useCallback((sprintId: string) => {
    navigate(`/documents/${documentId}/sprints/${sprintId}`);
  }, [documentId, navigate]);

  // Handle cell click - create/navigate to plan or retro
  const handleCellClick = useCallback(async (personId: string, weekNumber: number, type: 'plan' | 'retro') => {
    try {
      const endpoint = type === 'plan' ? '/api/weekly-plans' : '/api/weekly-retros';
      const response = await apiPost(endpoint, {
        person_id: personId,
        project_id: documentId,
        week_number: weekNumber,
      });

      if (response.ok) {
        const doc = await response.json();
        navigate(`/documents/${doc.id}`);
      }
    } catch (err) {
      console.error('Failed to create/navigate to document:', err);
    }
  }, [documentId, navigate]);

  const loading = sprintsLoading || gridLoading;

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

  // If a sprint is selected, show detail view
  if (selectedSprintId) {
    return (
      <div className="flex h-full flex-col">
        {/* Top Section: Horizontal Timeline - fixed height */}
        <div className="flex-shrink-0 border-b border-border p-4">
          <h3 className="mb-3 text-sm font-medium text-muted uppercase tracking-wide">Timeline</h3>
          <WeekTimeline
            sprints={sprints}
            workspaceSprintStartDate={workspaceSprintStartDate}
            selectedSprintId={selectedSprintId ?? undefined}
            onSelectSprint={handleSelectSprint}
            onOpenSprint={handleOpenSprint}
          />
        </div>

        {/* Bottom Section: Sprint Details */}
        <div className="flex-1 min-h-0 overflow-auto">
          <WeekDetailView
            sprintId={selectedSprintId}
            projectId={documentId}
            onBack={() => navigate(`/documents/${documentId}/sprints`)}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Top Section: Horizontal Timeline - fixed height */}
      <div className="flex-shrink-0 border-b border-border p-4">
        <h3 className="mb-3 text-sm font-medium text-muted uppercase tracking-wide">Timeline</h3>
        <WeekTimeline
          sprints={sprints}
          workspaceSprintStartDate={workspaceSprintStartDate}
          selectedSprintId={selectedSprintId ?? undefined}
          onSelectSprint={handleSelectSprint}
          onOpenSprint={handleOpenSprint}
        />
      </div>

      {/* Bottom Section: Allocation Grid or Empty State */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {gridError ? (
          <div className="flex items-center justify-center h-full text-red-500">
            {gridError}
          </div>
        ) : gridData && gridData.people.length > 0 ? (
          <AllocationGrid
            data={gridData}
            scrollContainerRef={scrollContainerRef}
            onCellClick={handleCellClick}
          />
        ) : (
          <EmptyAllocationState sprints={sprints} workspaceSprintStartDate={workspaceSprintStartDate} />
        )}
      </div>
    </div>
  );
}

// Allocation grid component
interface AllocationGridProps {
  data: AllocationGridData;
  scrollContainerRef: React.RefObject<HTMLDivElement>;
  onCellClick: (personId: string, weekNumber: number, type: 'plan' | 'retro') => void;
}

function AllocationGrid({ data, scrollContainerRef, onCellClick }: AllocationGridProps) {
  const navigate = useNavigate();

  return (
    <div className="h-full flex flex-col">
      {/* Legend */}
      <div className="flex-shrink-0 p-3 border-b border-border bg-border/10">
        <div className="flex items-center gap-4 text-xs text-muted">
          <span className="font-medium">Legend:</span>
          <div className="flex items-center gap-1">
            <StatusIcon status="exists" />
            <span>Written</span>
          </div>
          <div className="flex items-center gap-1">
            <StatusIcon status="missing-due" />
            <span>Missing (past due)</span>
          </div>
          <div className="flex items-center gap-1">
            <StatusIcon status="not-due" />
            <span>Not yet due</span>
          </div>
          <div className="flex items-center gap-1">
            <span className="text-muted">P = Plan</span>
            <span className="text-muted">R = Retro</span>
          </div>
        </div>
      </div>

      {/* Grid container */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-auto"
      >
        <div className="inline-flex min-w-full">
          {/* Sticky left column - Person names */}
          <div className="flex flex-col sticky left-0 z-20 bg-background border-r border-border">
            {/* Header cell */}
            <div className="flex h-12 w-[160px] items-center border-b border-border px-3 sticky top-0 z-30 bg-background">
              <span className="text-xs font-medium text-muted">Team Member</span>
            </div>

            {/* Person rows */}
            {data.people.map((person) => (
              <div
                key={person.id}
                className="flex h-10 w-[160px] items-center border-b border-border px-3 cursor-pointer hover:bg-border/20"
                onClick={() => navigate(`/documents/${person.id}`)}
                title={person.name}
              >
                <span className="truncate text-sm">{person.name}</span>
              </div>
            ))}
          </div>

          {/* Week columns */}
          <div className="flex">
            {data.weeks.map((week) => (
              <div key={week.number} className="flex flex-col">
                {/* Week header */}
                <div
                  className={cn(
                    'flex h-12 w-[120px] flex-col items-center justify-center border-b border-r border-border px-2 sticky top-0 z-10 bg-background',
                    week.isCurrent && 'ring-1 ring-inset ring-accent/30'
                  )}
                >
                  <span className={cn(
                    'text-xs font-medium',
                    week.isCurrent ? 'text-accent' : 'text-foreground'
                  )}>
                    {week.name}
                  </span>
                  <span className="text-[10px] text-muted">
                    {formatDateRange(week.startDate, week.endDate)}
                  </span>
                </div>

                {/* Person cells for this week */}
                {data.people.map((person) => {
                  const weekStatus = person.weeks[week.number];
                  if (!weekStatus) return (
                    <div
                      key={person.id}
                      className={cn(
                        "h-10 w-[120px] border-b border-r border-border",
                        week.isCurrent && "bg-accent/5"
                      )}
                    />
                  );

                  const isPastPlanDue = week.number < data.currentSprintNumber ||
                    (week.isCurrent && new Date().getDay() > 1); // After Monday
                  const isPastRetroDue = week.number < data.currentSprintNumber ||
                    (week.isCurrent && new Date().getDay() > 5); // After Friday

                  return (
                    <AllocationCell
                      key={person.id}
                      personId={person.id}
                      weekNumber={week.number}
                      status={weekStatus}
                      isCurrent={week.isCurrent}
                      isPastPlanDue={isPastPlanDue}
                      isPastRetroDue={isPastRetroDue}
                      onCellClick={onCellClick}
                    />
                  );
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

// Individual cell in the allocation grid
interface AllocationCellProps {
  personId: string;
  weekNumber: number;
  status: PersonWeekStatus;
  isCurrent: boolean;
  isPastPlanDue: boolean;
  isPastRetroDue: boolean;
  onCellClick: (personId: string, weekNumber: number, type: 'plan' | 'retro') => void;
}

function AllocationCell({
  personId,
  weekNumber,
  status,
  isCurrent,
  isPastPlanDue,
  isPastRetroDue,
  onCellClick,
}: AllocationCellProps) {
  const navigate = useNavigate();

  // Determine status for plan and retro
  const planStatus = status.planId
    ? 'exists'
    : status.isAllocated && isPastPlanDue
    ? 'missing-due'
    : status.isAllocated
    ? 'not-due'
    : 'not-allocated';

  const retroStatus = status.retroId
    ? 'exists'
    : status.isAllocated && isPastRetroDue
    ? 'missing-due'
    : status.isAllocated
    ? 'not-due'
    : 'not-allocated';

  // Handle click on plan/retro icon
  const handlePlanClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (status.planId) {
      navigate(`/documents/${status.planId}`);
    } else if (status.isAllocated) {
      onCellClick(personId, weekNumber, 'plan');
    }
  };

  const handleRetroClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (status.retroId) {
      navigate(`/documents/${status.retroId}`);
    } else if (status.isAllocated) {
      onCellClick(personId, weekNumber, 'retro');
    }
  };

  return (
    <div
      className={cn(
        "flex h-10 w-[120px] items-center justify-center gap-2 border-b border-r border-border",
        isCurrent && "bg-accent/5",
        status.isAllocated ? "bg-border/10" : ""
      )}
    >
      {status.isAllocated ? (
        <>
          {/* Plan status */}
          <button
            onClick={handlePlanClick}
            className="flex flex-col items-center hover:opacity-80 transition-opacity"
            title={planStatus === 'exists' ? 'View plan' : planStatus === 'missing-due' ? 'Write plan (overdue)' : 'Write plan'}
          >
            <span className="text-[9px] text-muted mb-0.5">P</span>
            <StatusIcon status={planStatus} />
          </button>

          {/* Retro status */}
          <button
            onClick={handleRetroClick}
            className="flex flex-col items-center hover:opacity-80 transition-opacity"
            title={retroStatus === 'exists' ? 'View retro' : retroStatus === 'missing-due' ? 'Write retro (overdue)' : 'Write retro'}
          >
            <span className="text-[9px] text-muted mb-0.5">R</span>
            <StatusIcon status={retroStatus} />
          </button>
        </>
      ) : (
        <span className="text-[10px] text-muted">-</span>
      )}
    </div>
  );
}

// Status icon component
function StatusIcon({ status }: { status: 'exists' | 'missing-due' | 'not-due' | 'not-allocated' }) {
  if (status === 'exists') {
    return (
      <svg className="h-4 w-4 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
      </svg>
    );
  }

  if (status === 'missing-due') {
    return (
      <svg className="h-4 w-4 text-red-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
      </svg>
    );
  }

  if (status === 'not-due') {
    return (
      <svg className="h-4 w-4 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <circle cx="12" cy="12" r="8" strokeWidth="2" />
      </svg>
    );
  }

  return null;
}

// Empty state when no allocations
function EmptyAllocationState({
  sprints,
  workspaceSprintStartDate,
}: {
  sprints: Sprint[];
  workspaceSprintStartDate: Date;
}) {
  const currentSprintNumber = getCurrentSprintNumber(workspaceSprintStartDate);
  const activeSprint = sprints.find(s => s.sprint_number === currentSprintNumber);

  if (sprints.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-muted p-8">
        <svg className="w-16 h-16 mb-4 opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
        </svg>
        <p className="text-lg font-medium mb-2">No team allocations</p>
        <p className="text-sm text-center max-w-md">
          Assign issues to team members in weeks for this project to see accountability tracking here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center h-full text-muted p-8">
      <svg className="w-16 h-16 mb-4 opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z" />
      </svg>
      <p className="text-lg font-medium mb-2">No team allocations</p>
      <p className="text-sm text-center max-w-md">
        Assign issues to team members in weeks for this project to see their plan and retro status here.
        {activeSprint && (
          <span className="block mt-2 text-accent">
            The current week is active.
          </span>
        )}
      </p>
    </div>
  );
}

function formatDateRange(startDate: string, endDate: string): string {
  const start = new Date(startDate + 'T00:00:00Z');
  const end = new Date(endDate + 'T00:00:00Z');

  const startMonth = start.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  const startDay = start.getUTCDate();
  const endMonth = end.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  const endDay = end.getUTCDate();

  if (startMonth === endMonth) {
    return `${startMonth} ${startDay}-${endDay}`;
  }
  return `${startMonth} ${startDay} - ${endMonth} ${endDay}`;
}
