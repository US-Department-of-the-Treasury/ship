import { useState, useMemo } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useLiveQuery } from '@tanstack/react-db';
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
  type DocumentRow,
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

// Helper to get properties from a document row
function getProps<T>(row: DocumentRow): T | null {
  return parseProperties<T>(row);
}

export function MyWeekPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { user } = useAuth();
  const weekNumberParam = searchParams.get('week_number');
  const targetWeekNumber = weekNumberParam ? parseInt(weekNumberParam, 10) : undefined;

  const [creating, setCreating] = useState<string | null>(null);

  // --- Electric/TanStack DB live queries ---

  // 1. Get workspace for sprint_start_date
  const { data: workspaces } = useLiveQuery((q) =>
    q.from({ ws: workspacesCollection })
  );
  const workspace = workspaces?.[0];

  // 2. Get current user's person document
  const { data: allPersons } = useLiveQuery((q) =>
    q.from({ p: personsCollection })
  );
  const person = useMemo(() => {
    if (!allPersons || !user?.id) return null;
    return allPersons.find((p) => {
      const props = getProps<PersonProperties>(p);
      return props?.user_id === user.id;
    }) ?? null;
  }, [allPersons, user?.id]);

  // Compute week info from workspace sprint_start_date
  const weekInfo = useMemo(() => {
    if (!workspace) return null;
    return computeWeekInfo(workspace.sprint_start_date, targetWeekNumber);
  }, [workspace, targetWeekNumber]);

  // 3. Get weekly plans
  const { data: allPlans } = useLiveQuery((q) =>
    q.from({ plan: weeklyPlansCollection })
  );
  const plan = useMemo(() => {
    if (!allPlans || !person || !weekInfo) return null;
    return allPlans.find((p) => {
      const props = getProps<WeeklyPlanProperties>(p);
      return props?.person_id === person.id
        && props?.week_number === weekInfo.weekNumber
        && !p.archived_at && !p.deleted_at;
    }) ?? null;
  }, [allPlans, person, weekInfo]);

  // 4. Get weekly retros (current + previous)
  const { data: allRetros } = useLiveQuery((q) =>
    q.from({ retro: weeklyRetrosCollection })
  );
  const retro = useMemo(() => {
    if (!allRetros || !person || !weekInfo) return null;
    return allRetros.find((r) => {
      const props = getProps<WeeklyRetroProperties>(r);
      return props?.person_id === person.id
        && props?.week_number === weekInfo.weekNumber
        && !r.archived_at && !r.deleted_at;
    }) ?? null;
  }, [allRetros, person, weekInfo]);

  const previousRetro = useMemo(() => {
    if (!allRetros || !person || !weekInfo || weekInfo.previousWeekNumber <= 0) return null;
    const found = allRetros.find((r) => {
      const props = getProps<WeeklyRetroProperties>(r);
      return props?.person_id === person.id
        && props?.week_number === weekInfo.previousWeekNumber
        && !r.archived_at && !r.deleted_at;
    });
    if (found) {
      const props = getProps<WeeklyRetroProperties>(found);
      return {
        id: found.id as string | null,
        title: found.title as string | null,
        submitted_at: props?.submitted_at ?? null,
        week_number: weekInfo.previousWeekNumber,
      };
    }
    return {
      id: null,
      title: null,
      submitted_at: null,
      week_number: weekInfo.previousWeekNumber,
    };
  }, [allRetros, person, weekInfo]);

  // 5. Get standups for this week
  const { data: allStandups } = useLiveQuery((q) =>
    q.from({ s: standupsCollection })
  );
  const standupSlots = useMemo(() => {
    if (!weekInfo || !user?.id) return [];
    const standupMap = new Map<string, DocumentRow>();
    if (allStandups) {
      for (const s of allStandups) {
        const props = getProps<StandupProperties>(s);
        if (props?.author_id === user.id && props?.date && !s.deleted_at) {
          standupMap.set(props.date, s);
        }
      }
    }
    return weekInfo.standupDates.map((date) => {
      const standup = standupMap.get(date);
      const dayOfWeek = new Date(date + 'T00:00:00Z').toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' });
      return {
        date,
        day: dayOfWeek,
        standup: standup ? {
          id: standup.id,
          title: standup.title,
          date,
          created_at: standup.created_at,
        } : null,
      };
    });
  }, [allStandups, weekInfo, user?.id]);

  // 6. Get project assignments via sprints
  const { data: allSprints } = useLiveQuery((q) =>
    q.from({ sp: sprintsCollection })
  );
  const { data: allProjects } = useLiveQuery((q) =>
    q.from({ proj: projectsCollection })
  );
  const projects = useMemo(() => {
    if (!allSprints || !allProjects || !person || !weekInfo) return [];
    // Find sprints for this week that include this person
    const projectIds = new Set<string>();
    for (const sp of allSprints) {
      const props = getProps<SprintProperties>(sp);
      if (!props) continue;
      if (props.sprint_number !== weekInfo.weekNumber) continue;
      if (!props.assignee_ids?.includes(person.id)) continue;
      if (props.project_id) projectIds.add(props.project_id);
    }
    // Map to project details
    return allProjects
      .filter((p) => projectIds.has(p.id) && !p.archived_at)
      .map((p) => ({
        id: p.id,
        title: p.title,
        program_name: null as string | null, // Would need program association query
      }));
  }, [allSprints, allProjects, person, weekInfo]);

  // --- Derived state ---
  const isLoading = !workspace || !person || !weekInfo;

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

  const planSubmittedAt = plan ? getProps<WeeklyPlanProperties>(plan)?.submitted_at ?? null : null;
  const retroSubmittedAt = retro ? getProps<WeeklyRetroProperties>(retro)?.submitted_at ?? null : null;

  const showPreviousRetroNudge = week.is_current
    && previousRetro
    && previousRetro.id !== null
    ? !previousRetro.submitted_at
    : week.is_current && previousRetro && previousRetro.id === null;

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
        {projects.length > 0 && (
          <section className="mb-6">
            <h2 className="text-sm font-medium text-muted uppercase tracking-wide mb-3">Assigned Projects</h2>
            <div className="space-y-1.5">
              {projects.map(project => (
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
                <p className="text-xs text-orange-300/70 mt-0.5">Week {previousRetro!.week_number} retro needs your input</p>
              </div>
              {previousRetro!.id ? (
                <Link
                  to={`/documents/${previousRetro!.id}`}
                  className="text-xs font-medium text-orange-300 hover:text-orange-200 underline"
                >
                  Complete retro
                </Link>
              ) : (
                <button
                  onClick={() => handleCreateRetro(previousRetro!.week_number)}
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
                  const isDue = !planSubmittedAt && week.week_number <= week.current_week_number && projects.length > 0;
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
              const isDue = week.week_number <= week.current_week_number && projects.length > 0;
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
                  const isDue = !retroSubmittedAt && retroDueForWeek && projects.length > 0;
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
              const isDue = retroDueForWeek && projects.length > 0;
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
            {standupSlots.map((slot) => {
              const isPast = isDateInPast(slot.date);
              const isToday = isDateToday(slot.date);
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
                    {slot.day.slice(0, 3)}
                  </span>
                  <span className="text-xs text-muted ml-1">
                    {new Date(slot.date + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', timeZone: 'UTC' })}
                  </span>
                </div>
              );

              const statusDot = slot.standup
                ? <div className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
                : isPast
                  ? <div className="w-2 h-2 rounded-full bg-border flex-shrink-0" />
                  : null;

              if (slot.standup) {
                return (
                  <Link key={slot.date} to={`/documents/${slot.standup.id}`} className={rowClass}>
                    {dateLabel}
                    <div className="flex-1 min-w-0">
                      <span className="text-sm text-foreground truncate block">{slot.standup.title}</span>
                    </div>
                    {statusDot}
                  </Link>
                );
              }

              if (isFuture) {
                return (
                  <div key={slot.date} className={rowClass}>
                    {dateLabel}
                    <div className="flex-1 min-w-0">
                      <span className="text-xs text-muted italic">Upcoming</span>
                    </div>
                  </div>
                );
              }

              return (
                <button
                  key={slot.date}
                  onClick={() => handleCreateStandup(slot.date)}
                  disabled={creating === `standup-${slot.date}`}
                  className={cn(rowClass, 'w-full text-left cursor-pointer disabled:opacity-50')}
                >
                  {dateLabel}
                  <div className="flex-1 min-w-0">
                    <span className="text-xs text-muted">
                      {creating === `standup-${slot.date}` ? 'Creating...' : '+ Write update'}
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
