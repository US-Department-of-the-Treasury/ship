import { useState, useMemo } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useLiveQuery } from '@tanstack/react-db';
import { and, eq, isNull } from '@tanstack/db';
import { useAuth } from '@/hooks/useAuth';
import {
  workspacesCollection,
  personsCollection,
  weeklyPlansCollection,
  weeklyRetrosCollection,
  standupsCollection,
  sprintsCollection,
  projectsCollection,
} from '@/electric/collections';
import {
  parseProperties,
  type PersonProperties,
  type WeeklyPlanProperties,
  type WeeklyRetroProperties,
  type StandupProperties,
  type SprintProperties,
} from '@/electric/schemas';
import { apiPost } from '@/lib/api';
import { cn } from '@/lib/cn';

function formatDateRange(startDate: string, endDate: string): string {
  const start = new Date(startDate + 'T00:00:00Z');
  const end = new Date(endDate + 'T00:00:00Z');
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', timeZone: 'UTC' };
  const yearOpts: Intl.DateTimeFormatOptions = { ...opts, year: 'numeric' };
  return `${start.toLocaleDateString('en-US', opts)} – ${end.toLocaleDateString('en-US', yearOpts)}`;
}

function isDateInPast(dateStr: string): boolean {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const date = new Date(dateStr + 'T00:00:00Z');
  return date < today;
}

function isDateToday(dateStr: string): boolean {
  const today = new Date();
  const todayStr = today.toISOString().split('T')[0];
  return dateStr === todayStr;
}

// Compute week number from workspace sprint start date
function computeWeekInfo(sprintStartDate: string, targetWeekNumber?: number) {
  const workspaceStartDate = new Date(sprintStartDate + 'T00:00:00Z');
  const sprintDuration = 7;

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const daysSinceStart = Math.floor((today.getTime() - workspaceStartDate.getTime()) / (1000 * 60 * 60 * 24));
  const currentWeekNumber = Math.floor(daysSinceStart / sprintDuration) + 1;

  const weekNumber = targetWeekNumber ?? currentWeekNumber;
  const isCurrent = weekNumber === currentWeekNumber;

  const weekStart = new Date(workspaceStartDate);
  weekStart.setUTCDate(weekStart.getUTCDate() + (weekNumber - 1) * sprintDuration);
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + sprintDuration - 1);

  // Build 7-day date array for standups
  const standupDates: string[] = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(weekStart);
    d.setUTCDate(d.getUTCDate() + i);
    standupDates.push(d.toISOString().split('T')[0] as string);
  }

  return {
    weekNumber,
    currentWeekNumber,
    isCurrent,
    startDate: weekStart.toISOString().split('T')[0] as string,
    endDate: weekEnd.toISOString().split('T')[0] as string,
    previousWeekNumber: weekNumber - 1,
    standupDates,
  };
}

export function MyWeekPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const weekNumberParam = searchParams.get('week_number');
  const targetWeekNumber = weekNumberParam ? parseInt(weekNumberParam, 10) : undefined;

  const [creating, setCreating] = useState<string | null>(null);

  // --- Electric/TanStack DB live queries ---

  // 1. Get workspace (single row, no filtering needed)
  const { data: workspace } = useLiveQuery((q) =>
    q.from({ ws: workspacesCollection }).findOne()
  );

  // 2. Get current user's person document (JSONB property filter)
  const userId = user?.id;
  const { data: person } = useLiveQuery(
    (q) => userId
      ? q.from({ p: personsCollection })
          .fn.where((row) => parseProperties<PersonProperties>(row.p)?.user_id === userId)
          .findOne()
      : null,
    [userId],
  );

  // Compute week info from workspace sprint_start_date (pure computation, not a filter)
  const weekInfo = useMemo(() => {
    if (!workspace) return null;
    return computeWeekInfo(workspace.sprint_start_date, targetWeekNumber);
  }, [workspace, targetWeekNumber]);

  // 3. Get weekly plan — fn.select extracts submitted_at from JSONB
  const personId = person?.id;
  const weekNumber = weekInfo?.weekNumber;
  const { data: plan } = useLiveQuery(
    (q) => personId && weekNumber != null
      ? q.from({ plan: weeklyPlansCollection })
          .where(({ plan }) => and(isNull(plan.archived_at), isNull(plan.deleted_at)))
          .fn.where((row) => {
            const props = parseProperties<WeeklyPlanProperties>(row.plan);
            return props?.person_id === personId && props?.week_number === weekNumber;
          })
          .fn.select((row) => ({
            id: row.plan.id,
            title: row.plan.title,
            submitted_at: parseProperties<WeeklyPlanProperties>(row.plan)?.submitted_at ?? null,
          }))
          .findOne()
      : null,
    [personId, weekNumber],
  );

  // 4. Get weekly retro — fn.select extracts submitted_at from JSONB
  const { data: retro } = useLiveQuery(
    (q) => personId && weekNumber != null
      ? q.from({ retro: weeklyRetrosCollection })
          .where(({ retro }) => and(isNull(retro.archived_at), isNull(retro.deleted_at)))
          .fn.where((row) => {
            const props = parseProperties<WeeklyRetroProperties>(row.retro);
            return props?.person_id === personId && props?.week_number === weekNumber;
          })
          .fn.select((row) => ({
            id: row.retro.id,
            title: row.retro.title,
            submitted_at: parseProperties<WeeklyRetroProperties>(row.retro)?.submitted_at ?? null,
          }))
          .findOne()
      : null,
    [personId, weekNumber],
  );

  // 5. Get previous week's retro — fn.select extracts submitted_at from JSONB
  const prevWeekNumber = weekInfo?.previousWeekNumber ?? 0;
  const { data: previousRetro } = useLiveQuery(
    (q) => personId && prevWeekNumber > 0
      ? q.from({ retro: weeklyRetrosCollection })
          .where(({ retro }) => and(isNull(retro.archived_at), isNull(retro.deleted_at)))
          .fn.where((row) => {
            const props = parseProperties<WeeklyRetroProperties>(row.retro);
            return props?.person_id === personId && props?.week_number === prevWeekNumber;
          })
          .fn.select((row) => ({
            id: row.retro.id,
            submitted_at: parseProperties<WeeklyRetroProperties>(row.retro)?.submitted_at ?? null,
          }))
          .findOne()
      : null,
    [personId, prevWeekNumber],
  );

  // 6. Get standups — fn.select extracts date from JSONB so render doesn't need parseProperties
  const { data: userStandups } = useLiveQuery(
    (q) => userId
      ? q.from({ s: standupsCollection })
          .where(({ s }) => isNull(s.deleted_at))
          .fn.where((row) => parseProperties<StandupProperties>(row.s)?.author_id === userId)
          .fn.select((row) => ({
            id: row.s.id,
            title: row.s.title,
            date: parseProperties<StandupProperties>(row.s)?.date ?? '',
          }))
      : null,
    [userId],
  );

  // 7. Get projects via sprint subquery join
  //    Subquery: filter sprints by person + week, extract project_id via fn.select
  //    Main: inner join projects on project_id — no imperative bridging code needed
  const { data: projects } = useLiveQuery(
    (q) => personId && weekNumber != null
      ? (() => {
          const sprintSub = q
            .from({ sp: sprintsCollection })
            .fn.where((row) => {
              const props = parseProperties<SprintProperties>(row.sp);
              return props?.sprint_number === weekNumber
                && (props?.assignee_ids?.includes(personId) ?? false);
            })
            .fn.select((row) => ({
              project_id: parseProperties<SprintProperties>(row.sp)?.project_id ?? '',
            }));

          return q
            .from({ proj: projectsCollection })
            .where(({ proj }) => isNull(proj.archived_at))
            .innerJoin(
              { sprint: sprintSub },
              ({ proj, sprint }) => eq(proj.id, sprint.project_id)
            )
            .fn.select((row) => ({
              id: row.proj.id,
              title: row.proj.title,
              program_name: null as string | null,
            }));
        })()
      : null,
    [personId, weekNumber],
  );

  // --- Derived state ---
  const isLoading = !workspace || !person || !weekInfo;
  const projectList = projects ?? [];

  const navigateToWeek = (wn: number) => {
    if (weekInfo && wn === weekInfo.currentWeekNumber) {
      setSearchParams({});
    } else {
      setSearchParams({ week_number: String(wn) });
    }
  };

  const handleCreatePlan = async () => {
    if (!person || !weekInfo) return;
    setCreating('plan');
    try {
      const res = await apiPost('/api/weekly-plans', {
        person_id: person.id,
        week_number: weekInfo.weekNumber,
      });
      if (res.ok) {
        const doc = await res.json();
        navigate(`/documents/${doc.id}`);
      }
    } finally {
      setCreating(null);
    }
  };

  const handleCreateRetro = async (weekNum: number) => {
    if (!person) return;
    setCreating('retro');
    try {
      const res = await apiPost('/api/weekly-retros', {
        person_id: person.id,
        week_number: weekNum,
      });
      if (res.ok) {
        const doc = await res.json();
        navigate(`/documents/${doc.id}`);
      }
    } finally {
      setCreating(null);
    }
  };

  const handleCreateStandup = async (date: string) => {
    setCreating(`standup-${date}`);
    try {
      const res = await apiPost('/api/standups', { date });
      if (res.ok) {
        const doc = await res.json();
        navigate(`/documents/${doc.id}`);
      }
    } finally {
      setCreating(null);
    }
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-muted">Loading week...</p>
      </div>
    );
  }

  const week = {
    week_number: weekInfo.weekNumber,
    current_week_number: weekInfo.currentWeekNumber,
    start_date: weekInfo.startDate,
    end_date: weekInfo.endDate,
    is_current: weekInfo.isCurrent,
  };

  const planSubmittedAt = plan?.submitted_at ?? null;
  const retroSubmittedAt = retro?.submitted_at ?? null;

  const showPreviousRetroNudge = week.is_current && prevWeekNumber > 0 && (
    previousRetro === undefined || !previousRetro.submitted_at
  );

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-2.5">
          <h1 className="text-xl font-semibold text-foreground">Week {week.week_number}</h1>
          {week.is_current && (
            <span className="text-xs bg-accent/20 text-accent px-1.5 py-0.5 rounded">Current</span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => navigateToWeek(week.week_number - 1)}
            className="p-1.5 rounded hover:bg-border/50 text-muted hover:text-foreground transition-colors"
            aria-label="Previous week"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <span className="text-sm text-muted px-1.5">{formatDateRange(week.start_date, week.end_date)}</span>
          <button
            onClick={() => navigateToWeek(week.week_number + 1)}
            className="p-1.5 rounded hover:bg-border/50 text-muted hover:text-foreground transition-colors"
            aria-label="Next week"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" />
            </svg>
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-6 py-8">

        {/* Project Assignments */}
        {projectList.length > 0 && (
          <section className="mb-6">
            <h2 className="text-sm font-medium text-muted uppercase tracking-wide mb-3">Assigned Projects</h2>
            <div className="space-y-1.5">
              {projectList.map(project => (
                <Link
                  key={project.id}
                  to={`/documents/${project.id}`}
                  className="flex items-center gap-3 rounded-lg border border-border bg-surface px-4 py-2.5 hover:border-accent/50 transition-colors"
                >
                  <span className="text-sm text-foreground">{project.title}</span>
                  {project.program_name && (
                    <span className="text-xs text-muted">{project.program_name}</span>
                  )}
                </Link>
              ))}
            </div>
          </section>
        )}

        {/* Previous Week Retro Nudge */}
        {showPreviousRetroNudge && (
          <div className="mb-6 rounded-lg border border-orange-500/30 bg-orange-500/10 px-4 py-3">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-orange-300">Last week's retro is not complete</p>
                <p className="text-xs text-orange-300/70 mt-0.5">Week {prevWeekNumber} retro needs your input</p>
              </div>
              {previousRetro ? (
                <Link
                  to={`/documents/${previousRetro.id}`}
                  className="text-xs font-medium text-orange-300 hover:text-orange-200 underline"
                >
                  Complete retro
                </Link>
              ) : (
                <button
                  onClick={() => handleCreateRetro(prevWeekNumber)}
                  disabled={creating === 'retro'}
                  className="text-xs font-medium text-orange-300 hover:text-orange-200 underline disabled:opacity-50"
                >
                  {creating === 'retro' ? 'Creating...' : 'Create retro'}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Plan & Retro - two column layout */}
        <div className="grid grid-cols-2 gap-8 mb-6">
          <section>
            <h2 className="text-sm font-medium text-muted uppercase tracking-wide mb-3">Weekly Plan</h2>
            {plan ? (
              <Link
                to={`/documents/${plan.id}`}
                className="block rounded-lg border border-border bg-surface p-4 hover:border-accent/50 transition-colors relative"
              >
                {(() => {
                  const isDue = !planSubmittedAt && week.week_number <= week.current_week_number && projectList.length > 0;
                  const isSubmitted = !!planSubmittedAt;
                  if (isDue) {
                    return <span className="absolute top-3 right-3 text-xs bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded">Due today</span>;
                  }
                  if (isSubmitted) {
                    return <span className="absolute top-3 right-3 text-xs bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded">Submitted</span>;
                  }
                  return <span className="absolute top-3 right-3 text-xs bg-border text-muted px-1.5 py-0.5 rounded">Unsubmitted</span>;
                })()}
                <p className="text-sm text-foreground">{plan.title}</p>
              </Link>
            ) : (() => {
              const isDue = week.week_number <= week.current_week_number && projectList.length > 0;
              return (
                <button
                  onClick={handleCreatePlan}
                  disabled={creating === 'plan'}
                  className={cn(
                    'w-full rounded-lg border border-dashed px-4 py-3 text-sm transition-colors disabled:opacity-50 flex items-center justify-between',
                    isDue
                      ? 'border-red-500/40 text-red-400 font-semibold hover:border-red-500/60'
                      : 'border-border text-muted hover:border-accent/50 hover:text-foreground'
                  )}
                >
                  {isDue && (
                    <span className="text-xs bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded font-medium">Due today</span>
                  )}
                  <span>{creating === 'plan' ? 'Creating...' : '+ Create plan for this week'}</span>
                </button>
              );
            })()}
          </section>

          <section>
            <h2 className="text-sm font-medium text-muted uppercase tracking-wide mb-3">Weekly Retro</h2>
            {retro ? (
              <Link
                to={`/documents/${retro.id}`}
                className="block rounded-lg border border-border bg-surface p-4 hover:border-accent/50 transition-colors relative"
              >
                {(() => {
                  const todayDay = new Date().getDay();
                  const isFridayOrLater = todayDay === 0 || todayDay >= 5;
                  const retroDueForWeek = week.week_number < week.current_week_number || (week.week_number === week.current_week_number && isFridayOrLater);
                  const isDue = !retroSubmittedAt && retroDueForWeek && projectList.length > 0;
                  const isSubmitted = !!retroSubmittedAt;
                  if (isDue) {
                    return <span className="absolute top-3 right-3 text-xs bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded">Due today</span>;
                  }
                  if (isSubmitted) {
                    return <span className="absolute top-3 right-3 text-xs bg-yellow-500/20 text-yellow-400 px-1.5 py-0.5 rounded">Submitted</span>;
                  }
                  return <span className="absolute top-3 right-3 text-xs bg-border text-muted px-1.5 py-0.5 rounded">Unsubmitted</span>;
                })()}
                <p className="text-sm text-foreground">{retro.title}</p>
              </Link>
            ) : (() => {
              const todayDay = new Date().getDay();
              const isFridayOrLater = todayDay === 0 || todayDay >= 5;
              const retroDueForWeek = week.week_number < week.current_week_number || (week.week_number === week.current_week_number && isFridayOrLater);
              const isDue = retroDueForWeek && projectList.length > 0;
              return (
                <button
                  onClick={() => handleCreateRetro(week.week_number)}
                  disabled={creating === 'retro'}
                  className={cn(
                    'w-full rounded-lg border border-dashed px-4 py-3 text-sm transition-colors disabled:opacity-50 flex items-center justify-between',
                    isDue
                      ? 'border-red-500/40 text-red-400 font-semibold hover:border-red-500/60'
                      : 'border-border text-muted hover:border-accent/50 hover:text-foreground'
                  )}
                >
                  {isDue && (
                    <span className="text-xs bg-red-500/20 text-red-400 px-1.5 py-0.5 rounded font-medium">Due today</span>
                  )}
                  <span>{creating === 'retro' ? 'Creating...' : '+ Create retro for this week'}</span>
                </button>
              );
            })()}
          </section>
        </div>

        {/* Daily Updates */}
        <section className="mb-6">
          <h2 className="text-sm font-medium text-muted uppercase tracking-wide mb-3">Daily Updates</h2>
          <div className="space-y-1.5">
            {weekInfo.standupDates.map((date) => {
              const standup = (userStandups ?? []).find((s) => s.date === date);
              const dayOfWeek = new Date(date + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
              const isPast = isDateInPast(date);
              const isToday = isDateToday(date);
              const isFuture = !isPast && !isToday;

              const rowClass = cn(
                'flex items-center gap-3 rounded-lg border px-4 py-2.5',
                isToday ? 'border-accent/30 bg-accent/5' : 'border-border bg-surface',
                isFuture && 'opacity-40',
                !isFuture && 'hover:border-accent/50 transition-colors'
              );

              const dateLabel = (
                <div className="w-20 flex-shrink-0">
                  <span className={cn('text-xs font-medium', isToday ? 'text-accent' : 'text-muted')}>
                    {dayOfWeek.slice(0, 3)}
                  </span>
                  <span className="text-xs text-muted ml-1">
                    {new Date(date + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', timeZone: 'UTC' })}
                  </span>
                </div>
              );

              const statusDot = standup
                ? <div className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
                : isPast
                  ? <div className="w-2 h-2 rounded-full bg-border flex-shrink-0" />
                  : null;

              if (standup) {
                return (
                  <Link key={date} to={`/documents/${standup.id}`} className={rowClass}>
                    {dateLabel}
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-foreground truncate block">{standup.title}</span>
                    </div>
                    {statusDot}
                  </Link>
                );
              }

              if (isFuture) {
                return (
                  <div key={date} className={rowClass}>
                    {dateLabel}
                    <div className="flex-1 min-w-0">
                      <span className="text-xs text-muted italic">Upcoming</span>
                    </div>
                  </div>
                );
              }

              return (
                <button
                  key={date}
                  onClick={() => handleCreateStandup(date)}
                  disabled={creating === `standup-${date}`}
                  className={cn(rowClass, 'w-full text-left cursor-pointer disabled:opacity-50')}
                >
                  {dateLabel}
                  <div className="flex-1 min-w-0">
                    <span className="text-xs text-muted">
                      {creating === `standup-${date}` ? 'Creating...' : '+ Write update'}
                    </span>
                  </div>
                  {statusDot}
                </button>
              );
            })}
          </div>
        </section>

      </div>
      </div>
    </div>
  );
}
