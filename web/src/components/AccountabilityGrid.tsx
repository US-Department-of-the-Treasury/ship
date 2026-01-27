import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/cn';

const API_URL = import.meta.env.VITE_API_URL ?? '';

// Federal holidays for business day calculations (2025-2026)
const FEDERAL_HOLIDAYS = new Set([
  '2025-01-01', '2025-01-20', '2025-02-17', '2025-05-26', '2025-06-19',
  '2025-07-04', '2025-09-01', '2025-10-13', '2025-11-11', '2025-11-27', '2025-12-25',
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-05-25', '2026-06-19',
  '2026-07-03', '2026-09-07', '2026-10-12', '2026-11-11', '2026-11-26', '2026-12-25',
]);

function isWeekend(date: Date): boolean {
  const day = date.getUTCDay();
  return day === 0 || day === 6;
}

function isBusinessDay(dateStr: string): boolean {
  const [year, month, day] = dateStr.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return !isWeekend(date) && !FEDERAL_HOLIDAYS.has(dateStr);
}

// Count business days from startDateStr to endDateStr (exclusive start, inclusive end)
function businessDaysBetween(startDateStr: string, endDateStr: string): number {
  const [sYear, sMonth, sDay] = startDateStr.split('-').map(Number);
  const [eYear, eMonth, eDay] = endDateStr.split('-').map(Number);
  const startDate = new Date(Date.UTC(sYear, sMonth - 1, sDay));
  const endDate = new Date(Date.UTC(eYear, eMonth - 1, eDay));

  const forward = endDate >= startDate;
  const direction = forward ? 1 : -1;

  let count = 0;
  const current = new Date(startDate);

  while (true) {
    current.setUTCDate(current.getUTCDate() + direction);
    const y = current.getUTCFullYear();
    const m = String(current.getUTCMonth() + 1).padStart(2, '0');
    const d = String(current.getUTCDate()).padStart(2, '0');
    const currentDateStr = `${y}-${m}-${d}`;

    if (forward) {
      if (current > endDate) break;
    } else {
      if (current < endDate) break;
    }

    if (isBusinessDay(currentDateStr)) {
      count++;
    }
  }

  return forward ? count : -count;
}

interface Sprint {
  number: number;
  name: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
}

interface ApprovalState {
  state: 'approved' | 'changed_since_approved' | null;
}

interface SprintAssignment {
  sprintDocId: string;
  hasHypothesis: boolean;
  hypothesisApproval: ApprovalState | null;
  hasReview: boolean;
  reviewApproval: ApprovalState | null;
}

interface PersonData {
  id: string;
  name: string;
  sprintAssignments: Record<number, SprintAssignment>;
}

interface ProjectData {
  id: string;
  title: string;
  color: string;
  hasHypothesis: boolean;
  hypothesisApproval: ApprovalState | null;
  hasRetro: boolean;
  retroApproval: ApprovalState | null;
  sprintAllocations: number[];
}

interface ProgramData {
  id: string | null;
  name: string;
  color: string | null;
  emoji: string | null;
  people: PersonData[];
  projects: ProjectData[];
}

interface AccountabilityGridData {
  sprints: Sprint[];
  currentSprintNumber: number;
  todayStr: string;
  programs: ProgramData[];
}

// Status types for hypothesis/review
type DeadlineStatus = 'future' | 'warning' | 'overdue' | 'written' | 'approved';

function getHypothesisStatus(
  hasHypothesis: boolean,
  approvalState: string | null | undefined,
  sprintStartDate: string,
  todayStr: string
): DeadlineStatus {
  if (hasHypothesis) {
    return approvalState === 'approved' ? 'approved' : 'written';
  }

  // No hypothesis - check deadline
  // Hypothesis deadline is sprint start date
  const businessDaysUntil = businessDaysBetween(todayStr, sprintStartDate);

  if (businessDaysUntil < 0) {
    // Sprint has started - overdue
    return 'overdue';
  } else if (businessDaysUntil <= 2) {
    // Within 2 business days - warning
    return 'warning';
  }

  return 'future';
}

function getReviewStatus(
  hasReview: boolean,
  approvalState: string | null | undefined,
  sprintEndDate: string,
  todayStr: string
): DeadlineStatus {
  if (hasReview) {
    return approvalState === 'approved' ? 'approved' : 'written';
  }

  // No review - check deadline
  // Review deadline is sprint end date
  const businessDaysUntil = businessDaysBetween(todayStr, sprintEndDate);

  if (businessDaysUntil < 0) {
    // Sprint has ended - overdue
    return 'overdue';
  } else if (businessDaysUntil <= 2) {
    // Within 2 business days of ending - warning
    return 'warning';
  }

  return 'future';
}

// Status indicator component
function StatusCell({
  status,
  label,
}: {
  status: DeadlineStatus;
  label: 'H' | 'R';
}) {
  const title = label === 'H' ? 'Hypothesis' : 'Review';

  if (status === 'future') {
    // Gray empty circle
    return (
      <div
        className="flex h-5 w-5 items-center justify-center rounded-full bg-gray-200 text-[9px] font-medium text-gray-500"
        title={`${title}: Not yet due`}
      >
        {label}
      </div>
    );
  }

  if (status === 'warning') {
    // Yellow warning
    return (
      <div
        className="flex h-5 w-5 items-center justify-center rounded-full bg-yellow-100 text-[9px] font-bold text-yellow-700"
        title={`${title}: Due within 2 business days`}
      >
        ⚠️
      </div>
    );
  }

  if (status === 'overdue') {
    // Red error
    return (
      <div
        className="flex h-5 w-5 items-center justify-center rounded-full bg-red-100 text-[9px] font-bold text-red-700"
        title={`${title}: Overdue`}
      >
        🔴
      </div>
    );
  }

  if (status === 'written') {
    // Green checkmark (not approved)
    return (
      <div
        className="flex h-5 w-5 items-center justify-center rounded-full bg-green-100 text-[9px] font-bold text-green-700"
        title={`${title}: Written (pending approval)`}
      >
        ✓
      </div>
    );
  }

  // Approved - green with border
  return (
    <div
      className="flex h-5 w-5 items-center justify-center rounded-full bg-green-500 text-[9px] font-bold text-white ring-2 ring-green-600"
      title={`${title}: Approved`}
    >
      ✓✓
    </div>
  );
}

export function AccountabilityGrid() {
  const navigate = useNavigate();
  const [data, setData] = useState<AccountabilityGridData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const hasScrolledToCurrentRef = useRef(false);

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch(`${API_URL}/api/team/accountability-grid`, { credentials: 'include' });
        if (!res.ok) {
          if (res.status === 403) {
            setError('Access denied');
          } else {
            setError('Failed to load accountability data');
          }
          return;
        }
        const json = await res.json();
        setData(json);
      } catch {
        setError('Failed to load accountability data');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, []);

  // Scroll to current sprint on initial load
  useEffect(() => {
    if (data && scrollContainerRef.current && !hasScrolledToCurrentRef.current) {
      const currentSprintIndex = data.sprints.findIndex(s => s.isCurrent);
      if (currentSprintIndex >= 0) {
        requestAnimationFrame(() => {
          if (scrollContainerRef.current) {
            const columnWidth = 100;
            const scrollPosition = Math.max(0, (currentSprintIndex - 2) * columnWidth);
            scrollContainerRef.current.scrollLeft = scrollPosition;
            hasScrolledToCurrentRef.current = true;
          }
        });
      }
    }
  }, [data]);

  // Build sprint date lookup
  const sprintDates = useMemo(() => {
    if (!data) return {};
    const lookup: Record<number, { startDate: string; endDate: string }> = {};
    for (const s of data.sprints) {
      lookup[s.number] = { startDate: s.startDate, endDate: s.endDate };
    }
    return lookup;
  }, [data]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="text-sm text-muted">Loading accountability grid...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <span className="text-sm text-red-500">{error}</span>
      </div>
    );
  }

  if (!data) return null;

  const { sprints, todayStr, programs } = data;

  // Check if there's any data to display
  const hasData = programs.some(p => p.people.length > 0 || p.projects.length > 0);

  if (!hasData) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center">
        <span className="text-sm text-muted">No accountability data yet.</span>
        <span className="text-xs text-muted">
          Assign people to sprints to see their hypothesis and review status here.
        </span>
      </div>
    );
  }

  return (
    <div ref={scrollContainerRef} className="flex-1 overflow-auto pb-20">
      <div className="inline-flex min-w-full">
        {/* Sticky left column - Row labels */}
        <div className="flex flex-col sticky left-0 z-20 bg-background border-r border-border">
          {/* Header cell */}
          <div className="flex h-12 w-[200px] items-center justify-between border-b border-border px-3 sticky top-0 z-30 bg-background">
            <span className="text-xs font-medium text-muted">Accountability</span>
            <div className="flex items-center gap-2 text-[10px] text-muted">
              <span>H=Hypothesis</span>
              <span>R=Review</span>
            </div>
          </div>

          {/* Program groups with people and projects */}
          {programs.map((program) => (
            <div key={program.id || '__no_program__'}>
              {/* Program header */}
              <div className="flex h-8 w-[200px] items-center gap-2 border-b border-border bg-border/30 px-3">
                {program.id ? (
                  <span
                    className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold text-white"
                    style={{ backgroundColor: program.color || '#6b7280' }}
                  >
                    {program.emoji || program.name[0]}
                  </span>
                ) : (
                  <span className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold text-white bg-gray-500">
                    ?
                  </span>
                )}
                <span className="truncate text-xs font-medium text-foreground">
                  {program.name}
                </span>
              </div>

              {/* People rows */}
              {program.people.map((person) => (
                <div
                  key={`${program.id || 'np'}-${person.id}`}
                  className="flex h-10 w-[200px] items-center border-b border-border px-3 pl-6"
                >
                  <span className="truncate text-xs text-foreground">{person.name}</span>
                </div>
              ))}

              {/* Project rows */}
              {program.projects.map((project) => (
                <div
                  key={project.id}
                  className="flex h-6 w-[200px] items-center border-b border-border px-3 pl-6 cursor-pointer hover:bg-border/20"
                  onClick={() => navigate(`/documents/${project.id}`)}
                >
                  <div
                    className="h-2 w-2 rounded-sm mr-2 flex-shrink-0"
                    style={{ backgroundColor: project.color }}
                  />
                  <span className="truncate text-[10px] text-muted">{project.title}</span>
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Sprint columns */}
        <div className="flex">
          {sprints.map((sprint) => (
            <div key={sprint.number} className="flex flex-col">
              {/* Sprint header */}
              <div
                className={cn(
                  'flex h-12 w-[100px] flex-col items-center justify-center border-b border-r border-border px-1 sticky top-0 z-10 bg-background',
                  sprint.isCurrent && 'bg-accent/10'
                )}
              >
                <span
                  className={cn(
                    'text-[11px] font-medium',
                    sprint.isCurrent ? 'text-accent' : 'text-foreground'
                  )}
                >
                  {sprint.name}
                </span>
                <span className="text-[9px] text-muted">
                  {formatDateRange(sprint.startDate, sprint.endDate)}
                </span>
              </div>

              {/* Program groups with people and project cells */}
              {programs.map((program) => (
                <div key={program.id || '__no_program__'}>
                  {/* Program header spacer */}
                  <div
                    className={cn(
                      'h-8 w-[100px] border-b border-r border-border bg-border/30',
                      sprint.isCurrent && 'bg-accent/5'
                    )}
                  />

                  {/* Person sprint cells */}
                  {program.people.map((person) => {
                    const assignment = person.sprintAssignments[sprint.number];
                    const dates = sprintDates[sprint.number];

                    if (!assignment || !dates) {
                      // No assignment for this sprint - empty cell
                      return (
                        <div
                          key={`${program.id || 'np'}-${person.id}-${sprint.number}`}
                          className={cn(
                            'h-10 w-[100px] border-b border-r border-border',
                            sprint.isCurrent && 'bg-accent/5'
                          )}
                        />
                      );
                    }

                    const hypothesisStatus = getHypothesisStatus(
                      assignment.hasHypothesis,
                      assignment.hypothesisApproval?.state,
                      dates.startDate,
                      todayStr
                    );
                    const reviewStatus = getReviewStatus(
                      assignment.hasReview,
                      assignment.reviewApproval?.state,
                      dates.endDate,
                      todayStr
                    );

                    return (
                      <div
                        key={`${program.id || 'np'}-${person.id}-${sprint.number}`}
                        className={cn(
                          'flex h-10 w-[100px] items-center justify-center gap-1 border-b border-r border-border cursor-pointer hover:bg-border/20',
                          sprint.isCurrent && 'bg-accent/5'
                        )}
                        onClick={() => navigate(`/documents/${assignment.sprintDocId}`)}
                        title={`Click to open sprint`}
                      >
                        <StatusCell status={hypothesisStatus} label="H" />
                        <StatusCell status={reviewStatus} label="R" />
                      </div>
                    );
                  })}

                  {/* Project sprint cells */}
                  {program.projects.map((project) => {
                    const hasAllocation = project.sprintAllocations.includes(sprint.number);
                    const minSprint = Math.min(...(project.sprintAllocations.length > 0 ? project.sprintAllocations : [0]));
                    const maxSprint = Math.max(...(project.sprintAllocations.length > 0 ? project.sprintAllocations : [0]));
                    const isInRange = sprint.number >= minSprint && sprint.number <= maxSprint;

                    // Show project line if in allocation range
                    const showLine = isInRange && project.sprintAllocations.length > 0;
                    const isStart = sprint.number === minSprint;
                    const isEnd = sprint.number === maxSprint;

                    return (
                      <div
                        key={`${project.id}-${sprint.number}`}
                        className={cn(
                          'relative h-6 w-[100px] border-b border-r border-border cursor-pointer hover:bg-border/20',
                          sprint.isCurrent && 'bg-accent/5'
                        )}
                        onClick={() => navigate(`/documents/${project.id}`)}
                      >
                        {showLine && (
                          <>
                            {/* Project timeline line */}
                            <div
                              className="absolute top-1/2 -translate-y-1/2 h-1"
                              style={{
                                backgroundColor: project.color,
                                left: isStart ? '8px' : '0px',
                                right: isEnd ? '8px' : '0px',
                              }}
                            />
                            {/* H indicator on start */}
                            {isStart && (
                              <div
                                className={cn(
                                  'absolute left-1 top-1/2 -translate-y-1/2 h-3 w-3 rounded-full text-[7px] font-bold flex items-center justify-center',
                                  project.hasHypothesis
                                    ? project.hypothesisApproval?.state === 'approved'
                                      ? 'bg-green-500 text-white ring-1 ring-green-600'
                                      : 'bg-green-100 text-green-700'
                                    : 'bg-gray-200 text-gray-500'
                                )}
                                title={`Hypothesis: ${project.hasHypothesis ? (project.hypothesisApproval?.state === 'approved' ? 'Approved' : 'Written') : 'Not written'}`}
                              >
                                H
                              </div>
                            )}
                            {/* R indicator on end */}
                            {isEnd && (
                              <div
                                className={cn(
                                  'absolute right-1 top-1/2 -translate-y-1/2 h-3 w-3 rounded-full text-[7px] font-bold flex items-center justify-center',
                                  project.hasRetro
                                    ? project.retroApproval?.state === 'approved'
                                      ? 'bg-green-500 text-white ring-1 ring-green-600'
                                      : 'bg-green-100 text-green-700'
                                    : 'bg-gray-200 text-gray-500'
                                )}
                                title={`Retro: ${project.hasRetro ? (project.retroApproval?.state === 'approved' ? 'Approved' : 'Written') : 'Not written'}`}
                              >
                                R
                              </div>
                            )}
                          </>
                        )}
                        {/* Allocation indicator dot */}
                        {hasAllocation && !showLine && (
                          <div
                            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-2 w-2 rounded-full"
                            style={{ backgroundColor: project.color }}
                          />
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function formatDateRange(startDate: string, endDate: string): string {
  const [sYear, sMonth, sDay] = startDate.split('-').map(Number);
  const [eYear, eMonth, eDay] = endDate.split('-').map(Number);
  const start = new Date(Date.UTC(sYear, sMonth - 1, sDay));
  const end = new Date(Date.UTC(eYear, eMonth - 1, eDay));

  const startMonth = start.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  const startDayNum = start.getUTCDate();
  const endMonth = end.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' });
  const endDayNum = end.getUTCDate();

  if (startMonth === endMonth) {
    return `${startMonth} ${startDayNum}-${endDayNum}`;
  }
  return `${startMonth} ${startDayNum}-${endMonth} ${endDayNum}`;
}

export default AccountabilityGrid;
