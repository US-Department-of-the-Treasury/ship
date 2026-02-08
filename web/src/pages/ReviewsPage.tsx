import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { useReviewQueue } from '@/contexts/ReviewQueueContext';
import type { QueueItem } from '@/contexts/ReviewQueueContext';

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
  planDocId: string | null;
  retroDocId: string | null;
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

// Shape of a fetched weekly plan/retro document
interface WeeklyDoc {
  id: string;
  title: string;
  content: unknown;
  properties: Record<string, unknown>;
  person_name?: string;
  project_name?: string;
}

// Selected cell for the review panel
interface SelectedCell {
  personId: string;
  personName: string;
  weekNumber: number;
  weekName: string;
  type: 'plan' | 'retro';
  sprintId: string;
  cell: ReviewCell;
}

// Batch review mode state
interface BatchMode {
  type: 'plans' | 'retros';
  queue: SelectedCell[];
  currentIndex: number;
}

export function ReviewsPage() {
  const navigate = useNavigate();
  const reviewQueue = useReviewQueue();
  const [data, setData] = useState<ReviewsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsedPrograms, setCollapsedPrograms] = useState<Set<string>>(new Set());
  const [selectedCell, setSelectedCell] = useState<SelectedCell | null>(null);
  const [batchMode, setBatchMode] = useState<BatchMode | null>(null);
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

  // Compute stats for current week (pending counts, totals, avg rating)
  const weekStats = useMemo(() => {
    if (!data) return { plansApproved: 0, plansTotal: 0, retrosRated: 0, retrosTotal: 0, avgRating: 0, pendingPlans: 0, pendingRetros: 0 };
    let plansApproved = 0;
    let plansTotal = 0;
    let retrosRated = 0;
    let retrosTotal = 0;
    let ratingSum = 0;
    let ratingCount = 0;
    let pendingPlans = 0;
    let pendingRetros = 0;
    const currentWeek = data.currentSprintNumber;
    for (const person of data.people) {
      const cell = data.reviews[person.personId]?.[currentWeek];
      if (!cell?.sprintId) continue;
      if (cell.hasPlan) {
        plansTotal++;
        if (cell.planApproval?.state === 'approved') plansApproved++;
        else pendingPlans++;
      }
      if (cell.hasRetro) {
        retrosTotal++;
        if (cell.reviewRating) {
          retrosRated++;
          ratingSum += cell.reviewRating.value;
          ratingCount++;
        } else {
          pendingRetros++;
        }
      }
    }
    return {
      plansApproved, plansTotal, retrosRated, retrosTotal,
      avgRating: ratingCount > 0 ? Math.round((ratingSum / ratingCount) * 10) / 10 : 0,
      pendingPlans, pendingRetros,
    };
  }, [data]);

  // Alias for batch mode button counts
  const pendingCounts = useMemo(() => ({
    plans: weekStats.pendingPlans,
    retros: weekStats.pendingRetros,
  }), [weekStats]);

  // Build batch review queue from current week data
  const buildBatchQueue = useCallback((type: 'plans' | 'retros'): SelectedCell[] => {
    if (!data) return [];
    const currentWeek = data.weeks.find(w => w.isCurrent);
    if (!currentWeek) return [];

    const queue: SelectedCell[] = [];
    for (const group of programGroups) {
      for (const person of group.people) {
        const cell = data.reviews[person.personId]?.[currentWeek.number];
        if (!cell?.sprintId) continue;

        if (type === 'plans' && cell.hasPlan && cell.planApproval?.state !== 'approved') {
          queue.push({
            personId: person.personId,
            personName: person.name,
            weekNumber: currentWeek.number,
            weekName: currentWeek.name,
            type: 'plan',
            sprintId: cell.sprintId,
            cell,
          });
        }
        if (type === 'retros' && cell.hasRetro && !cell.reviewRating) {
          queue.push({
            personId: person.personId,
            personName: person.name,
            weekNumber: currentWeek.number,
            weekName: currentWeek.name,
            type: 'retro',
            sprintId: cell.sprintId,
            cell,
          });
        }
      }
    }
    return queue;
  }, [data, programGroups]);

  // Start batch review via queue context (navigates to documents)
  function startBatchReview(type: 'plans' | 'retros') {
    if (!reviewQueue || !data) return;
    const selectedCells = buildBatchQueue(type);
    if (selectedCells.length === 0) return;

    const queueItems: QueueItem[] = selectedCells
      .map(sc => {
        const docId = sc.type === 'plan' ? sc.cell.planDocId : sc.cell.retroDocId;
        if (!docId) return null;
        return {
          personId: sc.personId,
          personName: sc.personName,
          weekNumber: sc.weekNumber,
          weekName: sc.weekName,
          type: sc.type,
          sprintId: sc.sprintId,
          docId,
        };
      })
      .filter((item): item is QueueItem => item !== null);

    if (queueItems.length > 0) {
      reviewQueue.start(queueItems);
    }
  }

  // Advance to next item in batch mode
  function advanceBatch() {
    if (!batchMode) return;
    const nextIndex = batchMode.currentIndex + 1;
    if (nextIndex >= batchMode.queue.length) {
      // All done
      setBatchMode({ ...batchMode, currentIndex: nextIndex });
      setSelectedCell(null);
    } else {
      // Refresh the cell data from the latest state
      const nextItem = batchMode.queue[nextIndex]!;
      const freshCell = data?.reviews[nextItem.personId]?.[nextItem.weekNumber];
      const updatedItem = freshCell ? { ...nextItem, cell: freshCell } : nextItem;
      setBatchMode({ ...batchMode, currentIndex: nextIndex });
      setSelectedCell(updatedItem);
    }
  }

  // Exit batch mode
  function exitBatchMode() {
    setBatchMode(null);
    setSelectedCell(null);
  }

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

  // Handle Escape to close panel / exit batch mode (must be before ALL early returns)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (batchMode) {
          exitBatchMode();
        } else if (selectedCell) {
          setSelectedCell(null);
        }
      }
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [selectedCell, batchMode]);

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
    <div className="flex h-full">
      {/* Main grid area */}
      <div className={cn('flex flex-col', selectedCell ? 'flex-1 min-w-0' : 'flex-1')}>
      {/* Legend + Batch Actions */}
      <div className="flex items-center gap-4 px-4 py-2 border-b border-border text-xs">
        {/* Batch review buttons */}
        {pendingCounts.plans > 0 && (
          <button
            onClick={() => startBatchReview('plans')}
            className="rounded bg-yellow-600 px-3 py-1 text-xs font-medium text-white hover:bg-yellow-500 transition-colors"
          >
            Review Plans ({pendingCounts.plans})
          </button>
        )}
        {pendingCounts.retros > 0 && (
          <button
            onClick={() => startBatchReview('retros')}
            className="rounded bg-yellow-600 px-3 py-1 text-xs font-medium text-white hover:bg-yellow-500 transition-colors"
          >
            Rate Retros ({pendingCounts.retros})
          </button>
        )}
        {(pendingCounts.plans > 0 || pendingCounts.retros > 0) && (
          <div className="h-4 w-px bg-border" />
        )}
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

      {/* Summary Stats */}
      {(weekStats.plansTotal > 0 || weekStats.retrosTotal > 0) && (
        <div className="flex items-center gap-6 px-4 py-1.5 border-b border-border text-xs bg-border/10">
          <span className="text-muted font-medium">This Week:</span>
          {weekStats.plansTotal > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-foreground">Plans:</span>
              <span className={cn('font-medium', weekStats.plansApproved === weekStats.plansTotal ? 'text-green-500' : 'text-foreground')}>
                {weekStats.plansApproved}/{weekStats.plansTotal}
              </span>
              <div className="w-16 h-1.5 rounded-full bg-border overflow-hidden">
                <div
                  className="h-full rounded-full bg-green-500 transition-all"
                  style={{ width: `${weekStats.plansTotal > 0 ? (weekStats.plansApproved / weekStats.plansTotal) * 100 : 0}%` }}
                />
              </div>
            </div>
          )}
          {weekStats.retrosTotal > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-foreground">Retros:</span>
              <span className={cn('font-medium', weekStats.retrosRated === weekStats.retrosTotal ? 'text-green-500' : 'text-foreground')}>
                {weekStats.retrosRated}/{weekStats.retrosTotal}
              </span>
              <div className="w-16 h-1.5 rounded-full bg-border overflow-hidden">
                <div
                  className="h-full rounded-full bg-green-500 transition-all"
                  style={{ width: `${weekStats.retrosTotal > 0 ? (weekStats.retrosRated / weekStats.retrosTotal) * 100 : 0}%` }}
                />
              </div>
            </div>
          )}
          {weekStats.avgRating > 0 && (
            <div className="flex items-center gap-1">
              <span className="text-foreground">Avg Rating:</span>
              <span className="font-medium text-foreground">{weekStats.avgRating}</span>
            </div>
          )}
          {weekStats.plansApproved === weekStats.plansTotal && weekStats.retrosRated === weekStats.retrosTotal && weekStats.plansTotal > 0 && (
            <span className="text-green-500 font-medium">All reviewed</span>
          )}
        </div>
      )}

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
                            if (cell.hasPlan && cell.planDocId) {
                              navigate(`/documents/${cell.planDocId}?review=true&sprintId=${cell.sprintId}`);
                            }
                          }}
                          className={cn(
                            'flex-1 h-full cursor-pointer transition-all hover:brightness-110 border-r border-white/20',
                            selectedCell?.personId === row.personId && selectedCell?.weekNumber === week.number && selectedCell?.type === 'plan' && 'ring-2 ring-inset ring-white/60'
                          )}
                          style={{ backgroundColor: REVIEW_COLORS[planStatus] }}
                          title={`Plan: ${REVIEW_STATUS_TEXT[planStatus]}`}
                          aria-label={`Plan: ${REVIEW_STATUS_TEXT[planStatus]} - ${row.name}`}
                        />
                        {/* Retro status (right half) */}
                        <button
                          onClick={() => {
                            if (cell.hasRetro && cell.retroDocId) {
                              navigate(`/documents/${cell.retroDocId}?review=true&sprintId=${cell.sprintId}`);
                            }
                          }}
                          className={cn(
                            'flex-1 h-full cursor-pointer transition-all hover:brightness-110',
                            selectedCell?.personId === row.personId && selectedCell?.weekNumber === week.number && selectedCell?.type === 'retro' && 'ring-2 ring-inset ring-white/60'
                          )}
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

      {/* Review Panel - right side */}
      {selectedCell && (
        <ReviewPanel
          selectedCell={selectedCell}
          batchMode={batchMode}
          onClose={() => batchMode ? exitBatchMode() : setSelectedCell(null)}
          onApprovePlan={(personId, weekNumber, sprintId) => {
            approvePlan(personId, weekNumber, sprintId);
            setSelectedCell(prev => prev ? {
              ...prev,
              cell: {
                ...prev.cell,
                planApproval: { state: 'approved', approved_by: null, approved_at: new Date().toISOString() },
              },
            } : null);
            // Auto-advance in batch mode
            if (batchMode) setTimeout(advanceBatch, 300);
          }}
          onRateRetro={(personId, weekNumber, sprintId, rating) => {
            rateRetro(personId, weekNumber, sprintId, rating);
            setSelectedCell(prev => prev ? {
              ...prev,
              cell: {
                ...prev.cell,
                reviewApproval: { state: 'approved', approved_by: null, approved_at: new Date().toISOString() },
                reviewRating: { value: rating, rated_by: '', rated_at: new Date().toISOString() },
              },
            } : null);
            // Auto-advance in batch mode
            if (batchMode) setTimeout(advanceBatch, 300);
          }}
          onSkip={batchMode ? advanceBatch : undefined}
        />
      )}

      {/* Batch mode completion state */}
      {batchMode && batchMode.currentIndex >= batchMode.queue.length && (
        <div className="w-[400px] flex-shrink-0 border-l border-border bg-background flex flex-col items-center justify-center gap-4 p-8">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-500/20">
            <svg className="w-8 h-8 text-green-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M20 6L9 17l-5-5" />
            </svg>
          </div>
          <div className="text-center">
            <div className="text-sm font-medium text-foreground">
              All {batchMode.type === 'plans' ? 'plans' : 'retros'} reviewed!
            </div>
            <div className="text-xs text-muted mt-1">
              {batchMode.queue.length} item{batchMode.queue.length !== 1 ? 's' : ''} processed
            </div>
          </div>
          <button
            onClick={exitBatchMode}
            className="rounded bg-accent px-4 py-2 text-xs font-medium text-white hover:bg-accent/80"
          >
            Done
          </button>
        </div>
      )}
    </div>
  );
}

/** Panel for reviewing plan/retro content */
function ReviewPanel({
  selectedCell,
  batchMode,
  onClose,
  onApprovePlan,
  onRateRetro,
  onSkip,
}: {
  selectedCell: SelectedCell;
  batchMode: BatchMode | null;
  onClose: () => void;
  onApprovePlan: (personId: string, weekNumber: number, sprintId: string) => void;
  onRateRetro: (personId: string, weekNumber: number, sprintId: string, rating: number) => void;
  onSkip?: () => void;
}) {
  const [planDoc, setPlanDoc] = useState<WeeklyDoc | null>(null);
  const [retroDoc, setRetroDoc] = useState<WeeklyDoc | null>(null);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [selectedRating, setSelectedRating] = useState<number | null>(null);

  // Fetch plan/retro content when selection changes
  useEffect(() => {
    setLoadingDocs(true);
    setPlanDoc(null);
    setRetroDoc(null);
    setSelectedRating(selectedCell.cell.reviewRating?.value ?? null);

    const fetchDocs = async () => {
      try {
        const params = new URLSearchParams({
          person_id: selectedCell.personId,
          week_number: String(selectedCell.weekNumber),
        });

        // Fetch plan and retro in parallel
        const [planRes, retroRes] = await Promise.all([
          fetch(`${API_URL}/api/weekly-plans?${params}`, { credentials: 'include' }),
          fetch(`${API_URL}/api/weekly-retros?${params}`, { credentials: 'include' }),
        ]);

        if (planRes.ok) {
          const plans = await planRes.json();
          if (plans.length > 0) setPlanDoc(plans[0]);
        }
        if (retroRes.ok) {
          const retros = await retroRes.json();
          if (retros.length > 0) setRetroDoc(retros[0]);
        }
      } catch (err) {
        console.error('Failed to fetch plan/retro:', err);
      } finally {
        setLoadingDocs(false);
      }
    };

    fetchDocs();
  }, [selectedCell.personId, selectedCell.weekNumber]);

  const isRetroMode = selectedCell.type === 'retro';
  const planApprovalState = selectedCell.cell.planApproval?.state;
  const canApprove = selectedCell.cell.hasPlan && planApprovalState !== 'approved';

  return (
    <div className="w-[400px] flex-shrink-0 border-l border-border bg-background flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div>
          <div className="text-sm font-medium text-foreground">{selectedCell.personName}</div>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">{selectedCell.weekName} &middot; {isRetroMode ? 'Retro' : 'Plan'}</span>
            {batchMode && (
              <span className="rounded bg-accent/20 px-1.5 py-0.5 text-[10px] font-medium text-accent">
                {batchMode.currentIndex + 1} of {batchMode.queue.length}
              </span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {onSkip && (
            <button
              onClick={onSkip}
              className="rounded px-2 py-1 text-xs text-muted hover:text-foreground hover:bg-border/50"
            >
              Skip
            </button>
          )}
          <button
            onClick={onClose}
            className="rounded p-1 text-muted hover:text-foreground hover:bg-border/50"
            aria-label="Close panel"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {loadingDocs ? (
          <div className="flex items-center justify-center py-12 text-muted text-sm">Loading...</div>
        ) : isRetroMode ? (
          /* Retro mode: side-by-side plan vs retro */
          <div className="flex flex-col h-full">
            {/* Plan context (dimmed) */}
            <div className="border-b border-border">
              <div className="px-4 py-2 text-[10px] uppercase tracking-wider text-muted bg-border/20">Plan (context)</div>
              <div className="px-4 py-3 opacity-60">
                {planDoc ? (
                  <TipTapContent content={planDoc.content} />
                ) : (
                  <p className="text-sm text-muted italic">No plan submitted for this week</p>
                )}
              </div>
            </div>
            {/* Retro (primary) */}
            <div className="flex-1">
              <div className="px-4 py-2 text-[10px] uppercase tracking-wider text-muted bg-border/20">Retro</div>
              <div className="px-4 py-3">
                {retroDoc ? (
                  <TipTapContent content={retroDoc.content} />
                ) : (
                  <p className="text-sm text-muted italic">No retro submitted for this week</p>
                )}
              </div>
            </div>
          </div>
        ) : (
          /* Plan mode: show plan content */
          <div className="px-4 py-3">
            {planDoc ? (
              <TipTapContent content={planDoc.content} />
            ) : (
              <p className="text-sm text-muted italic">No plan submitted for this week</p>
            )}
          </div>
        )}
      </div>

      {/* Action bar */}
      <div className="border-t border-border px-4 py-3">
        {isRetroMode ? (
          /* Rating controls for retro */
          <div>
            <div className="text-xs text-muted mb-2">Performance Rating</div>
            <div className="flex gap-1 mb-3">
              {OPM_RATINGS.map(r => (
                <button
                  key={r.value}
                  onClick={() => setSelectedRating(r.value)}
                  className={cn(
                    'flex-1 flex flex-col items-center gap-0.5 rounded py-1.5 text-xs transition-all',
                    selectedRating === r.value
                      ? 'bg-accent/20 ring-1 ring-accent'
                      : 'bg-border/30 hover:bg-border/50'
                  )}
                  title={r.label}
                >
                  <span className={cn('font-bold', r.color)}>{r.value}</span>
                  <span className="text-[9px] text-muted leading-tight">{r.label.split(' ')[0]}</span>
                </button>
              ))}
            </div>
            <button
              onClick={() => {
                if (selectedRating) {
                  onRateRetro(selectedCell.personId, selectedCell.weekNumber, selectedCell.sprintId, selectedRating);
                }
              }}
              disabled={!selectedRating || !retroDoc}
              className={cn(
                'w-full rounded py-2 text-sm font-medium transition-colors',
                selectedRating && retroDoc
                  ? 'bg-green-600 text-white hover:bg-green-500 cursor-pointer'
                  : 'bg-border/30 text-muted cursor-not-allowed'
              )}
            >
              {selectedCell.cell.reviewRating ? 'Update Rating' : 'Rate & Approve'}
            </button>
          </div>
        ) : (
          /* Approve button for plan */
          <button
            onClick={() => onApprovePlan(selectedCell.personId, selectedCell.weekNumber, selectedCell.sprintId)}
            disabled={!canApprove}
            className={cn(
              'w-full rounded py-2 text-sm font-medium transition-colors',
              planApprovalState === 'approved'
                ? 'bg-green-600/20 text-green-400 cursor-default'
                : canApprove
                  ? planApprovalState === 'changed_since_approved'
                    ? 'bg-orange-600 text-white hover:bg-orange-500 cursor-pointer'
                    : 'bg-green-600 text-white hover:bg-green-500 cursor-pointer'
                  : 'bg-border/30 text-muted cursor-not-allowed'
            )}
          >
            {planApprovalState === 'approved'
              ? 'Approved'
              : planApprovalState === 'changed_since_approved'
                ? 'Re-approve Plan'
                : 'Approve Plan'}
          </button>
        )}
      </div>
    </div>
  );
}

/** Renders TipTap JSON content as simple HTML */
function TipTapContent({ content }: { content: unknown }) {
  if (!content || typeof content !== 'object') {
    return <p className="text-sm text-muted italic">Empty</p>;
  }

  const doc = content as { type?: string; content?: unknown[] };
  if (!doc.content || !Array.isArray(doc.content)) {
    return <p className="text-sm text-muted italic">Empty</p>;
  }

  return (
    <div className="text-sm text-foreground space-y-2">
      {doc.content.map((node, i) => (
        <TipTapNode key={i} node={node} />
      ))}
    </div>
  );
}

function TipTapNode({ node }: { node: unknown }) {
  if (!node || typeof node !== 'object') return null;
  const n = node as { type?: string; content?: unknown[]; text?: string; attrs?: Record<string, unknown>; marks?: Array<{ type: string }> };

  if (n.type === 'text') {
    let text = <>{n.text}</>;
    if (n.marks) {
      for (const mark of n.marks) {
        if (mark.type === 'bold') text = <strong>{text}</strong>;
        if (mark.type === 'italic') text = <em>{text}</em>;
      }
    }
    return text;
  }

  const children = n.content?.map((child, i) => <TipTapNode key={i} node={child} />) ?? null;

  switch (n.type) {
    case 'heading': {
      const level = (n.attrs?.level as number) || 2;
      if (level === 1) return <h3 className="text-base font-semibold text-foreground">{children}</h3>;
      if (level === 2) return <h4 className="text-sm font-semibold text-foreground">{children}</h4>;
      return <h5 className="text-sm font-medium text-foreground">{children}</h5>;
    }
    case 'paragraph':
      return <p className="text-sm leading-relaxed">{children || '\u00A0'}</p>;
    case 'bulletList':
      return <ul className="list-disc pl-5 space-y-1">{children}</ul>;
    case 'listItem':
      return <li className="text-sm">{children}</li>;
    case 'blockquote':
      return <blockquote className="border-l-2 border-accent/50 pl-3 text-sm italic text-muted">{children}</blockquote>;
    default:
      return <div>{children}</div>;
  }
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
