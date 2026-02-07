import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { cn } from '@/lib/cn';

const API_URL = import.meta.env.VITE_API_URL ?? '';

// CSRF token cache
let csrfToken: string | null = null;

async function getCsrfToken(): Promise<string> {
  if (!csrfToken) {
    const res = await fetch(`${API_URL}/api/csrf-token`, { credentials: 'include' });
    const data = await res.json();
    csrfToken = data.token;
  }
  return csrfToken!;
}

// OPM 5-level performance rating scale
const OPM_RATINGS = [
  { value: 5, label: 'Outstanding', color: 'text-green-500', bg: 'bg-green-500/10' },
  { value: 4, label: 'Exceeds Expectations', color: 'text-blue-500', bg: 'bg-blue-500/10' },
  { value: 3, label: 'Fully Successful', color: 'text-muted', bg: 'bg-border/50' },
  { value: 2, label: 'Minimally Satisfactory', color: 'text-orange-500', bg: 'bg-orange-500/10' },
  { value: 1, label: 'Unacceptable', color: 'text-red-500', bg: 'bg-red-500/10' },
] as const;

// Review status colors — matches StatusOverviewHeatmap's bold style
type ReviewStatus = 'approved' | 'needs_review' | 'late' | 'changed' | 'empty';

const REVIEW_COLORS: Record<ReviewStatus, string> = {
  approved: '#22c55e',     // green — approved or rated
  needs_review: '#eab308', // yellow — submitted, needs manager action
  late: '#ef4444',         // red — past due, nothing submitted
  changed: '#f97316',      // orange — changed since approved
  empty: '#6b7280',        // gray — no allocation or future
};

const REVIEW_STATUS_TEXT: Record<ReviewStatus, string> = {
  approved: 'approved',
  needs_review: 'needs review',
  late: 'late',
  changed: 'changed since approved',
  empty: 'no submission',
};

interface Week {
  number: number;
  name: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
}

interface ReviewPerson {
  personId: string;
  name: string;
  programId: string | null;
  programName: string | null;
  programColor: string | null;
}

interface ApprovalInfo {
  state: string;
  approved_by?: string | null;
  approved_at?: string | null;
  approved_version_id?: number | null;
}

interface RatingInfo {
  value: number;
  rated_by?: string;
  rated_at?: string;
}

interface ReviewCell {
  planApproval: ApprovalInfo | null;
  reviewApproval: ApprovalInfo | null;
  reviewRating: RatingInfo | null;
  hasPlan: boolean;
  hasRetro: boolean;
  sprintId: string | null;
}

interface ReviewsData {
  people: ReviewPerson[];
  weeks: Week[];
  reviews: Record<string, Record<number, ReviewCell>>;
  currentSprintNumber: number;
}

interface ProgramGroup {
  programId: string | null;
  programName: string;
  programColor: string | null;
  people: ReviewPerson[];
}

/** Determine the review status color for a plan cell */
function getPlanStatus(cell: ReviewCell | undefined, weekIsPast: boolean): ReviewStatus {
  if (!cell || !cell.sprintId) return 'empty';
  if (cell.planApproval?.state === 'approved') return 'approved';
  if (cell.planApproval?.state === 'changed_since_approved') return 'changed';
  if (cell.hasPlan) return 'needs_review';
  if (weekIsPast) return 'late';
  return 'empty';
}

/** Determine the review status color for a retro cell */
function getRetroStatus(cell: ReviewCell | undefined, weekIsPast: boolean): ReviewStatus {
  if (!cell || !cell.sprintId) return 'empty';
  if (cell.reviewRating) return 'approved';
  if (cell.reviewApproval?.state === 'approved') return 'approved';
  if (cell.reviewApproval?.state === 'changed_since_approved') return 'changed';
  if (cell.hasRetro) return 'needs_review';
  if (weekIsPast) return 'late';
  return 'empty';
}

export function ReviewsPage() {
  const [data, setData] = useState<ReviewsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsedPrograms, setCollapsedPrograms] = useState<Set<string>>(new Set());
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const hasScrolledToCurrentRef = useRef(false);

  useEffect(() => {
    fetchReviews();
  }, []);

  // Approve a plan optimistically
  const approvePlan = useCallback(async (personId: string, weekNumber: number, sprintId: string) => {
    if (!data) return;

    // Optimistic update
    setData(prev => {
      if (!prev) return prev;
      const updated = { ...prev, reviews: { ...prev.reviews } };
      updated.reviews[personId] = { ...updated.reviews[personId] };
      updated.reviews[personId][weekNumber] = {
        ...updated.reviews[personId][weekNumber],
        planApproval: { state: 'approved', approved_by: null, approved_at: new Date().toISOString() },
      };
      return updated;
    });

    try {
      const token = await getCsrfToken();
      const res = await fetch(`${API_URL}/api/weeks/${sprintId}/approve-plan`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': token },
      });
      if (!res.ok) throw new Error('Failed to approve plan');
    } catch {
      // Revert on error
      fetchReviews();
    }
  }, [data]);

  // Rate a retro (also approves it)
  const rateRetro = useCallback(async (personId: string, weekNumber: number, sprintId: string, rating: number) => {
    if (!data) return;

    // Optimistic update
    setData(prev => {
      if (!prev) return prev;
      const updated = { ...prev, reviews: { ...prev.reviews } };
      updated.reviews[personId] = { ...updated.reviews[personId] };
      updated.reviews[personId][weekNumber] = {
        ...updated.reviews[personId][weekNumber],
        reviewApproval: { state: 'approved', approved_by: null, approved_at: new Date().toISOString() },
        reviewRating: { value: rating, rated_by: '', rated_at: new Date().toISOString() },
      };
      return updated;
    });

    try {
      const token = await getCsrfToken();
      const res = await fetch(`${API_URL}/api/weeks/${sprintId}/approve-review`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': token },
        body: JSON.stringify({ rating }),
      });
      if (!res.ok) throw new Error('Failed to rate retro');
    } catch {
      // Revert on error
      fetchReviews();
    }
  }, [data]);

  async function fetchReviews() {
    try {
      setLoading(true);
      const res = await fetch(`${API_URL}/api/team/reviews?sprint_count=8`, {
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`);
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load reviews');
    } finally {
      setLoading(false);
    }
  }

  // Group people by program
  const programGroups = useMemo((): ProgramGroup[] => {
    if (!data) return [];

    const groups = new Map<string, ProgramGroup>();
    const UNASSIGNED_KEY = '__unassigned__';

    for (const person of data.people) {
      const groupKey = person.programId || UNASSIGNED_KEY;

      if (!groups.has(groupKey)) {
        groups.set(groupKey, {
          programId: person.programId,
          programName: person.programName || 'No Program',
          programColor: person.programColor,
          people: [],
        });
      }

      groups.get(groupKey)!.people.push(person);
    }

    const sorted = Array.from(groups.values()).sort((a, b) => {
      if (a.programId === null) return 1;
      if (b.programId === null) return -1;
      return a.programName.localeCompare(b.programName);
    });

    for (const group of sorted) {
      group.people.sort((a, b) => a.name.localeCompare(b.name));
    }

    return sorted;
  }, [data]);

  // Build row structure for synchronized scrolling
  const rowStructure = useMemo(() => {
    const rows: Array<{
      type: 'program' | 'person';
      id: string;
      name: string;
      color?: string | null;
      personId?: string;
      peopleCount?: number;
    }> = [];

    for (const group of programGroups) {
      const groupKey = group.programId || '__unassigned__';
      const isCollapsed = collapsedPrograms.has(groupKey);

      rows.push({
        type: 'program',
        id: groupKey,
        name: group.programName,
        color: group.programColor,
        peopleCount: group.people.length,
      });

      if (!isCollapsed) {
        for (const person of group.people) {
          rows.push({
            type: 'person',
            id: `${person.personId}`,
            name: person.name,
            personId: person.personId,
          });
        }
      }
    }

    return rows;
  }, [programGroups, collapsedPrograms]);

  // Scroll to current week on first render
  useEffect(() => {
    if (data && scrollContainerRef.current && !hasScrolledToCurrentRef.current) {
      const currentWeekIndex = data.weeks.findIndex(w => w.isCurrent);
      if (currentWeekIndex >= 0) {
        requestAnimationFrame(() => {
          if (scrollContainerRef.current) {
            const columnWidth = 100;
            const scrollPosition = Math.max(0, (currentWeekIndex - 2) * columnWidth);
            scrollContainerRef.current.scrollLeft = scrollPosition;
            hasScrolledToCurrentRef.current = true;
          }
        });
      }
    }
  }, [data]);

  function toggleProgram(programId: string | null) {
    const key = programId || '__unassigned__';
    setCollapsedPrograms(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="flex items-center gap-2 text-muted">
          <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Loading...
        </div>
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

  return (
    <div className="flex h-full flex-col">
      {/* Legend */}
      <div className="flex items-center gap-4 px-4 py-2 border-b border-border text-xs">
        <span className="text-muted">Review Status:</span>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded" style={{ backgroundColor: REVIEW_COLORS.approved }} />
          <span>Approved</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded" style={{ backgroundColor: REVIEW_COLORS.needs_review }} />
          <span>Needs Review</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded" style={{ backgroundColor: REVIEW_COLORS.late }} />
          <span>Late</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded" style={{ backgroundColor: REVIEW_COLORS.changed }} />
          <span>Changed</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded" style={{ backgroundColor: REVIEW_COLORS.empty }} />
          <span>No Submission</span>
        </div>
        <span className="text-muted ml-4">|</span>
        <span className="text-muted">Left = Plan, Right = Retro</span>
      </div>

      {/* Grid container */}
      <div ref={scrollContainerRef} className="flex-1 overflow-auto pb-20">
        <div className="inline-flex min-w-full">
          {/* Sticky left column - Names */}
          <div className="flex flex-col sticky left-0 z-20 bg-background border-r border-border">
            {/* Header cell */}
            <div className="flex h-10 w-[240px] items-center border-b border-border px-3 sticky top-0 z-30 bg-background">
              <span className="text-xs font-medium text-muted">Program / Person</span>
            </div>

            {/* Rows */}
            {rowStructure.map((row, index) => {
              if (row.type === 'program') {
                return (
                  <button
                    key={`program-${row.id}`}
                    onClick={() => toggleProgram(row.id === '__unassigned__' ? null : row.id)}
                    className="flex h-10 w-[240px] items-center gap-2 border-b border-border bg-border/30 px-3 hover:bg-border/50 text-left"
                  >
                    <svg
                      className={cn('w-3 h-3 transition-transform', !collapsedPrograms.has(row.id) && 'rotate-90')}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M9 18l6-6-6-6" />
                    </svg>
                    {row.color && (
                      <span
                        className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold text-white"
                        style={{ backgroundColor: row.color }}
                      >
                        {row.name.charAt(0).toUpperCase()}
                      </span>
                    )}
                    <span className="truncate text-xs font-medium">{row.name}</span>
                    <span className="ml-auto text-[10px] text-muted">{row.peopleCount}</span>
                  </button>
                );
              }

              // Person row
              return (
                <div
                  key={`person-${row.id}-${index}`}
                  className="flex h-10 w-[240px] items-center gap-2 border-b border-border pl-6 pr-3 bg-background"
                >
                  <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-medium text-white bg-accent/80">
                    {row.name.charAt(0).toUpperCase()}
                  </div>
                  <span className="truncate text-xs text-foreground">{row.name}</span>
                </div>
              );
            })}
          </div>

          {/* Week columns */}
          <div className="flex">
            {data.weeks.map(week => {
              const weekIsPast = week.number < data.currentSprintNumber;

              return (
                <div key={week.number} className="flex flex-col">
                  {/* Week header */}
                  <div
                    className={cn(
                      'flex h-10 w-[100px] flex-col items-center justify-center border-b border-r border-border px-2 sticky top-0 z-10 bg-background',
                      week.isCurrent && 'ring-1 ring-inset ring-accent/30'
                    )}
                  >
                    <span className={cn('text-xs font-medium', week.isCurrent ? 'text-accent' : 'text-foreground')}>
                      {week.name}
                    </span>
                    <span className="text-[10px] text-muted">
                      {formatDateRange(week.startDate, week.endDate)}
                    </span>
                  </div>

                  {/* Cells for each row */}
                  {rowStructure.map((row, index) => {
                    if (row.type === 'program') {
                      return (
                        <div
                          key={`program-${row.id}-week-${week.number}`}
                          className={cn(
                            'h-10 w-[100px] border-b border-r border-border bg-border/30',
                            week.isCurrent && 'bg-accent/5'
                          )}
                        />
                      );
                    }

                    const cell = row.personId ? data.reviews[row.personId]?.[week.number] : undefined;
                    const planStatus = getPlanStatus(cell, weekIsPast);
                    const retroStatus = getRetroStatus(cell, weekIsPast);

                    // Empty state - no sprint allocation
                    if (!cell || !cell.sprintId) {
                      return (
                        <div
                          key={`person-${row.id}-week-${week.number}-${index}`}
                          className={cn(
                            'flex h-10 w-[100px] items-center justify-center border-b border-r border-border',
                            week.isCurrent && 'bg-accent/5'
                          )}
                        >
                          <span className="text-xs text-muted">-</span>
                        </div>
                      );
                    }

                    return (
                      <div
                        key={`person-${row.id}-week-${week.number}-${index}`}
                        className={cn(
                          'flex h-10 w-[100px] border-b border-r border-border overflow-hidden',
                          week.isCurrent && 'ring-1 ring-inset ring-accent/20'
                        )}
                      >
                        {/* Plan status (left half) */}
                        <button
                          onClick={() => {
                            if (planStatus === 'needs_review' || planStatus === 'changed') {
                              approvePlan(row.personId!, week.number, cell.sprintId!);
                            }
                          }}
                          className="flex-1 h-full cursor-pointer transition-all hover:brightness-110 border-r border-white/20"
                          style={{ backgroundColor: REVIEW_COLORS[planStatus] }}
                          title={`Plan: ${REVIEW_STATUS_TEXT[planStatus]}`}
                          aria-label={`Plan: ${REVIEW_STATUS_TEXT[planStatus]} - ${row.name}`}
                        />
                        {/* Retro status (right half) */}
                        <button
                          onClick={() => {
                            // For now, clicking retro cells will be handled by the review panel (story 2/3)
                            // No inline action needed for color-block cells
                          }}
                          className="flex-1 h-full cursor-pointer transition-all hover:brightness-110"
                          style={{ backgroundColor: REVIEW_COLORS[retroStatus] }}
                          title={`Retro: ${REVIEW_STATUS_TEXT[retroStatus]}`}
                          aria-label={`Retro: ${REVIEW_STATUS_TEXT[retroStatus]} - ${row.name}`}
                        />
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </div>
      </div>
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

export default ReviewsPage;
