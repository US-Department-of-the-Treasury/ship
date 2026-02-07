import { useState, useEffect, useRef, useMemo } from 'react';
import { cn } from '@/lib/cn';

const API_URL = import.meta.env.VITE_API_URL ?? '';

// OPM 5-level performance rating scale
const OPM_RATINGS = [
  { value: 5, label: 'Outstanding', color: 'text-green-500', bg: 'bg-green-500/10' },
  { value: 4, label: 'Exceeds Expectations', color: 'text-blue-500', bg: 'bg-blue-500/10' },
  { value: 3, label: 'Fully Successful', color: 'text-muted', bg: 'bg-border/50' },
  { value: 2, label: 'Minimally Satisfactory', color: 'text-orange-500', bg: 'bg-orange-500/10' },
  { value: 1, label: 'Unacceptable', color: 'text-red-500', bg: 'bg-red-500/10' },
] as const;

function getRatingInfo(value: number) {
  return OPM_RATINGS.find(r => r.value === value) || OPM_RATINGS[2]; // default to Fully Successful
}

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

interface ReviewCell {
  planApproval: { state: string; approved_by: string | null; approved_at: string | null } | null;
  reviewApproval: { state: string } | null;
  reviewRating: { value: number; rated_by: string; rated_at: string } | null;
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

  // Scroll to current week on first render
  useEffect(() => {
    if (data && scrollContainerRef.current && !hasScrolledToCurrentRef.current) {
      const currentCol = scrollContainerRef.current.querySelector('[data-current-week="true"]');
      if (currentCol) {
        currentCol.scrollIntoView({ inline: 'center', behavior: 'instant' });
        hasScrolledToCurrentRef.current = true;
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
      <div className="flex h-full items-center justify-center">
        <div className="text-sm text-muted">Loading reviews...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-sm text-red-500">{error}</div>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="flex h-10 items-center justify-between border-b border-border px-4">
        <h1 className="text-sm font-medium text-foreground">Reviews</h1>
      </header>

      {/* Grid */}
      <div className="flex-1 overflow-hidden">
        <div className="flex h-full">
          {/* Frozen person names column */}
          <div className="flex-shrink-0 border-r border-border">
            {/* Header spacer */}
            <div className="flex h-8 items-center border-b border-border px-3">
              <span className="text-xs font-medium text-muted">Person</span>
            </div>

            {/* Person rows */}
            <div className="overflow-y-auto" style={{ maxHeight: 'calc(100% - 2rem)' }}>
              {programGroups.map(group => {
                const groupKey = group.programId || '__unassigned__';
                const isCollapsed = collapsedPrograms.has(groupKey);

                return (
                  <div key={groupKey}>
                    {/* Program header */}
                    <button
                      onClick={() => toggleProgram(group.programId)}
                      className="flex w-full items-center gap-1.5 border-b border-border/50 bg-background-secondary px-3 py-1 text-left hover:bg-border/30"
                    >
                      <span className="text-[10px] text-muted">{isCollapsed ? '▸' : '▾'}</span>
                      {group.programColor && (
                        <span
                          className="h-2 w-2 rounded-full"
                          style={{ backgroundColor: group.programColor }}
                        />
                      )}
                      <span className="text-xs font-medium text-muted">{group.programName}</span>
                      <span className="text-[10px] text-muted/60">({group.people.length})</span>
                    </button>

                    {/* Person rows */}
                    {!isCollapsed && group.people.map(person => (
                      <div
                        key={person.personId}
                        className="flex h-10 items-center border-b border-border/50 px-3"
                      >
                        <span className="truncate text-xs text-foreground" style={{ width: 140 }}>
                          {person.name}
                        </span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Scrollable weeks columns */}
          <div className="flex-1 overflow-x-auto" ref={scrollContainerRef}>
            <div className="inline-flex min-w-full flex-col">
              {/* Week headers */}
              <div className="flex border-b border-border">
                {data.weeks.map(week => (
                  <div
                    key={week.number}
                    data-current-week={week.isCurrent || undefined}
                    className={cn(
                      'flex h-8 w-28 flex-shrink-0 flex-col items-center justify-center border-r border-border/50 px-1',
                      week.isCurrent && 'bg-accent/5'
                    )}
                  >
                    <span className={cn('text-[10px] font-medium', week.isCurrent ? 'text-accent' : 'text-muted')}>
                      {week.name}
                    </span>
                    <span className="text-[9px] text-muted/60">
                      {new Date(week.startDate + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                ))}
              </div>

              {/* Data rows */}
              <div className="overflow-y-auto" style={{ maxHeight: 'calc(100% - 2rem)' }}>
                {programGroups.map(group => {
                  const groupKey = group.programId || '__unassigned__';
                  const isCollapsed = collapsedPrograms.has(groupKey);

                  return (
                    <div key={groupKey}>
                      {/* Program header spacer */}
                      <div className="flex border-b border-border/50 bg-background-secondary">
                        {data.weeks.map(week => (
                          <div key={week.number} className="h-[26px] w-28 flex-shrink-0 border-r border-border/50" />
                        ))}
                      </div>

                      {/* Person cells */}
                      {!isCollapsed && group.people.map(person => (
                        <div key={person.personId} className="flex border-b border-border/50">
                          {data.weeks.map(week => {
                            const cell = data.reviews[person.personId]?.[week.number];
                            return (
                              <ReviewCellView
                                key={week.number}
                                cell={cell}
                                isCurrent={week.isCurrent}
                              />
                            );
                          })}
                        </div>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReviewCellView({ cell, isCurrent }: { cell?: ReviewCell; isCurrent: boolean }) {
  if (!cell) {
    return (
      <div className={cn('flex h-10 w-28 flex-shrink-0 items-center justify-center gap-1.5 border-r border-border/50 px-1', isCurrent && 'bg-accent/5')}>
        <span className="text-[10px] text-muted/30">—</span>
      </div>
    );
  }

  const planState = cell.planApproval?.state;
  const ratingValue = cell.reviewRating?.value;
  const ratingInfo = ratingValue ? getRatingInfo(ratingValue) : null;

  return (
    <div className={cn('flex h-10 w-28 flex-shrink-0 items-center justify-center gap-1.5 border-r border-border/50 px-1', isCurrent && 'bg-accent/5')}>
      {/* Plan approval indicator */}
      <div className="flex flex-col items-center" title={getPlanTooltip(cell)}>
        <span className="text-[8px] uppercase text-muted/60 leading-none mb-0.5">Plan</span>
        {planState === 'approved' ? (
          <span className="text-green-500 text-xs">✓</span>
        ) : planState === 'changed_since_approved' ? (
          <span className="text-orange-500 text-xs">!</span>
        ) : cell.hasPlan ? (
          <span className="text-muted/40 text-xs">○</span>
        ) : (
          <span className="text-muted/20 text-xs">·</span>
        )}
      </div>

      {/* Divider */}
      <div className="h-5 w-px bg-border/30" />

      {/* Retro rating indicator */}
      <div className="flex flex-col items-center" title={getRetroTooltip(cell)}>
        <span className="text-[8px] uppercase text-muted/60 leading-none mb-0.5">Retro</span>
        {ratingInfo ? (
          <span className={cn('text-xs font-medium', ratingInfo.color)}>{ratingValue}</span>
        ) : cell.hasRetro ? (
          <span className="text-muted/40 text-xs">○</span>
        ) : (
          <span className="text-muted/20 text-xs">·</span>
        )}
      </div>
    </div>
  );
}

function getPlanTooltip(cell: ReviewCell): string {
  if (cell.planApproval?.state === 'approved') return 'Plan: Approved';
  if (cell.planApproval?.state === 'changed_since_approved') return 'Plan: Changed since approved';
  if (cell.hasPlan) return 'Plan: Pending review';
  return 'No plan submitted';
}

function getRetroTooltip(cell: ReviewCell): string {
  if (cell.reviewRating) {
    const info = getRatingInfo(cell.reviewRating.value);
    return `Retro: ${cell.reviewRating.value} - ${info.label}`;
  }
  if (cell.reviewApproval?.state === 'approved') return 'Retro: Approved (no rating)';
  if (cell.hasRetro) return 'Retro: Pending review';
  return 'No retro submitted';
}

export default ReviewsPage;
