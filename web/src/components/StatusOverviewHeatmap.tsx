import { useState, useEffect, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/cn';
import { apiPost } from '@/lib/api';

const API_URL = import.meta.env.VITE_API_URL ?? '';

type Status = 'done' | 'due' | 'late' | 'future';

interface Week {
  number: number;
  name: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
}

interface PersonWeekData {
  planId: string | null;
  planStatus: Status;
  retroId: string | null;
  retroStatus: Status;
}

interface Person {
  id: string;
  name: string;
  weeks: Record<number, PersonWeekData>;
}

interface Project {
  id: string;
  title: string;
  color: string;
  isArchived: boolean;
  people: Person[];
}

interface Program {
  id: string;
  name: string;
  color: string;
  projects: Project[];
}

interface AccountabilityGridV2Data {
  programs: Program[];
  weeks: Week[];
  currentSprintNumber: number;
}

// Status colors
const STATUS_COLORS: Record<Status, string> = {
  done: '#22c55e',   // green
  due: '#eab308',    // yellow
  late: '#ef4444',   // red
  future: '#6b7280', // gray
};

// User-friendly status text for tooltips
const STATUS_TEXT: Record<Status, string> = {
  done: 'done',
  due: 'due this week',
  late: 'late',
  future: 'not yet due',
};

/**
 * StatusCell - Shows Plan/Retro status as two colored squares
 */
function StatusCell({
  planStatus,
  retroStatus,
  onPlanClick,
  onRetroClick,
  isNavigating,
}: {
  planStatus: Status;
  retroStatus: Status;
  onPlanClick?: () => void;
  onRetroClick?: () => void;
  isNavigating?: 'plan' | 'retro' | null;
}) {
  return (
    <div className="flex w-full h-full">
      {/* Plan status (left half) */}
      <button
        onClick={onPlanClick}
        disabled={isNavigating !== null}
        className={cn(
          'flex-1 h-full cursor-pointer transition-all hover:brightness-110',
          isNavigating === 'plan' && 'animate-pulse'
        )}
        style={{ backgroundColor: STATUS_COLORS[planStatus] }}
        title={`Weekly Plan (${STATUS_TEXT[planStatus]})`}
      />
      {/* Retro status (right half) */}
      <button
        onClick={onRetroClick}
        disabled={isNavigating !== null}
        className={cn(
          'flex-1 h-full cursor-pointer transition-all hover:brightness-110',
          isNavigating === 'retro' && 'animate-pulse'
        )}
        style={{ backgroundColor: STATUS_COLORS[retroStatus] }}
        title={`Weekly Retro (${STATUS_TEXT[retroStatus]})`}
      />
    </div>
  );
}

interface StatusOverviewHeatmapProps {
  showArchived?: boolean;
}

export function StatusOverviewHeatmap({ showArchived = false }: StatusOverviewHeatmapProps) {
  const navigate = useNavigate();
  const [data, setData] = useState<AccountabilityGridV2Data | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedPrograms, setExpandedPrograms] = useState<Set<string>>(new Set());
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [navigatingCell, setNavigatingCell] = useState<{
    projectId: string;
    personId: string;
    weekNumber: number;
    type: 'plan' | 'retro';
  } | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const hasScrolledToCurrentRef = useRef(false);

  // Fetch data
  useEffect(() => {
    async function fetchData() {
      try {
        setLoading(true);
        const params = new URLSearchParams();
        if (showArchived) params.set('showArchived', 'true');
        const url = `${API_URL}/api/team/accountability-grid-v2${params.toString() ? `?${params}` : ''}`;
        const res = await fetch(url, { credentials: 'include' });

        if (!res.ok) {
          if (res.status === 403) {
            setError('Admin access required to view accountability grid');
          } else {
            setError('Failed to load accountability data');
          }
          return;
        }

        const json: AccountabilityGridV2Data = await res.json();
        setData(json);

        // Auto-expand all programs by default
        setExpandedPrograms(new Set(json.programs.map(p => p.id)));
      } catch (err) {
        setError('Failed to load accountability data');
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [showArchived]);

  // Scroll to current week on initial load
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

  // Navigate to weekly plan or retro
  async function handleNavigate(
    projectId: string,
    personId: string,
    weekNumber: number,
    type: 'plan' | 'retro',
    existingDocId: string | null
  ) {
    if (existingDocId) {
      navigate(`/documents/${existingDocId}`);
      return;
    }

    setNavigatingCell({ projectId, personId, weekNumber, type });
    try {
      const endpoint = type === 'plan' ? '/api/weekly-plans' : '/api/weekly-retros';
      const response = await apiPost(endpoint, {
        person_id: personId,
        project_id: projectId,
        week_number: weekNumber,
      });

      if (response.ok) {
        const doc = await response.json();
        navigate(`/documents/${doc.id}`);
      } else {
        console.error(`Failed to create weekly ${type}:`, await response.text());
      }
    } catch (err) {
      console.error(`Failed to create weekly ${type}:`, err);
    } finally {
      setNavigatingCell(null);
    }
  }

  function toggleProgram(programId: string) {
    setExpandedPrograms(prev => {
      const next = new Set(prev);
      if (next.has(programId)) {
        next.delete(programId);
      } else {
        next.add(programId);
      }
      return next;
    });
  }

  function toggleProject(projectId: string) {
    setExpandedProjects(prev => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  }

  // Count rows for building the left column structure
  const rowStructure = useMemo(() => {
    if (!data) return [];

    const rows: Array<{
      type: 'program' | 'project' | 'person';
      id: string;
      name: string;
      color?: string;
      projectId?: string;
      isArchived?: boolean;
      depth: number;
    }> = [];

    for (const program of data.programs) {
      rows.push({
        type: 'program',
        id: program.id,
        name: program.name,
        color: program.color,
        depth: 0,
      });

      if (expandedPrograms.has(program.id)) {
        for (const project of program.projects) {
          rows.push({
            type: 'project',
            id: project.id,
            name: project.title,
            color: project.color,
            isArchived: project.isArchived,
            depth: 1,
          });

          if (expandedProjects.has(project.id)) {
            for (const person of project.people) {
              rows.push({
                type: 'person',
                id: person.id,
                name: person.name,
                projectId: project.id,
                depth: 2,
              });
            }
          }
        }
      }
    }

    return rows;
  }, [data, expandedPrograms, expandedProjects]);

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

  if (!data || data.programs.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-muted p-8">
        <svg className="w-16 h-16 mb-4 opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12.75V12A2.25 2.25 0 014.5 9.75h15A2.25 2.25 0 0121.75 12v.75m-8.69-6.44l-2.12-2.12a1.5 1.5 0 00-1.061-.44H4.5A2.25 2.25 0 002.25 6v12a2.25 2.25 0 002.25 2.25h15A2.25 2.25 0 0021.75 18V9a2.25 2.25 0 00-2.25-2.25h-5.379a1.5 1.5 0 01-1.06-.44z" />
        </svg>
        <p className="text-lg font-medium mb-2">No projects yet</p>
        <p className="text-sm text-center max-w-md">
          Create projects in Programs to see them here.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Legend */}
      <div className="flex items-center gap-4 px-4 py-2 border-b border-border text-xs">
        <span className="text-muted">Status:</span>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded" style={{ backgroundColor: STATUS_COLORS.done }} />
          <span>Done</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded" style={{ backgroundColor: STATUS_COLORS.due }} />
          <span>Due</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded" style={{ backgroundColor: STATUS_COLORS.late }} />
          <span>Late</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 rounded" style={{ backgroundColor: STATUS_COLORS.future }} />
          <span>Future</span>
        </div>
        <span className="text-muted ml-4">|</span>
        <span className="text-muted">Left = Plan, Right = Retro</span>
      </div>

      {/* Grid container */}
      <div ref={scrollContainerRef} className="flex-1 overflow-auto pb-20">
        <div className="inline-flex min-w-full">
          {/* Sticky left column - Hierarchy */}
          <div className="flex flex-col sticky left-0 z-20 bg-background border-r border-border">
            {/* Header cell */}
            <div className="flex h-10 w-[240px] items-center border-b border-border px-3 sticky top-0 z-30 bg-background">
              <span className="text-xs font-medium text-muted">Program / Project / Person</span>
            </div>

            {/* Hierarchy rows */}
            {rowStructure.map((row, index) => {
              if (row.type === 'program') {
                return (
                  <button
                    key={`program-${row.id}`}
                    onClick={() => toggleProgram(row.id)}
                    className="flex h-10 w-[240px] items-center gap-2 border-b border-border bg-border/30 px-3 hover:bg-border/50 text-left"
                  >
                    <svg
                      className={cn('w-3 h-3 transition-transform', expandedPrograms.has(row.id) && 'rotate-90')}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M9 18l6-6-6-6" />
                    </svg>
                    <span
                      className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold text-white"
                      style={{ backgroundColor: row.color || '#6b7280' }}
                    >
                      {row.name.charAt(0).toUpperCase()}
                    </span>
                    <span className="truncate text-xs font-medium">{row.name}</span>
                    <span className="ml-auto text-[10px] text-muted">
                      {data.programs.find(p => p.id === row.id)?.projects.length || 0}
                    </span>
                  </button>
                );
              }

              if (row.type === 'project') {
                const project = data.programs.flatMap(p => p.projects).find(proj => proj.id === row.id);
                return (
                  <button
                    key={`project-${row.id}`}
                    onClick={() => toggleProject(row.id)}
                    className={cn(
                      'flex h-10 w-[240px] items-center gap-2 border-b border-border pl-6 pr-3 hover:bg-border/20 text-left',
                      row.isArchived && 'opacity-60'
                    )}
                  >
                    <svg
                      className={cn('w-3 h-3 transition-transform', expandedProjects.has(row.id) && 'rotate-90')}
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M9 18l6-6-6-6" />
                    </svg>
                    <span
                      className="shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold text-white"
                      style={{ backgroundColor: row.color || '#6b7280' }}
                    >
                      {row.name.charAt(0).toUpperCase()}
                    </span>
                    <span className="truncate text-xs">{row.name}</span>
                    <span className="ml-auto text-[10px] text-muted">
                      {project?.people.length || 0}
                    </span>
                  </button>
                );
              }

              // Person row
              return (
                <div
                  key={`person-${row.projectId}-${row.id}-${index}`}
                  className="flex h-10 w-[240px] items-center gap-2 border-b border-border pl-12 pr-3 bg-background"
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
            {data.weeks.map((week) => (
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
                    // Empty cell for program header row
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

                  if (row.type === 'project') {
                    // Empty cell for project header row
                    return (
                      <div
                        key={`project-${row.id}-week-${week.number}`}
                        className={cn(
                          'h-10 w-[100px] border-b border-r border-border',
                          week.isCurrent && 'bg-accent/5'
                        )}
                      />
                    );
                  }

                  // Person cell - find the data
                  const projectId = row.projectId!;
                  const project = data.programs.flatMap(p => p.projects).find(proj => proj.id === projectId);
                  const person = project?.people.find(p => p.id === row.id);
                  const weekData = person?.weeks[week.number];

                  if (!weekData) {
                    return (
                      <div
                        key={`person-${projectId}-${row.id}-week-${week.number}-${index}`}
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
                      key={`person-${projectId}-${row.id}-week-${week.number}-${index}`}
                      className={cn(
                        'flex h-10 w-[100px] border-b border-r border-border overflow-hidden',
                        week.isCurrent && 'ring-1 ring-inset ring-accent/20'
                      )}
                    >
                      <StatusCell
                        planStatus={weekData.planStatus}
                        retroStatus={weekData.retroStatus}
                        onPlanClick={() =>
                          handleNavigate(projectId, row.id, week.number, 'plan', weekData.planId)
                        }
                        onRetroClick={() =>
                          handleNavigate(projectId, row.id, week.number, 'retro', weekData.retroId)
                        }
                        isNavigating={
                          navigatingCell?.projectId === projectId &&
                          navigatingCell?.personId === row.id &&
                          navigatingCell?.weekNumber === week.number
                            ? navigatingCell.type
                            : null
                        }
                      />
                    </div>
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

export default StatusOverviewHeatmap;
