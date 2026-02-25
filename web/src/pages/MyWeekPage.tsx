import { useState } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useMyWeekQuery, StandupSlot } from '@/hooks/useMyWeekQuery';
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

export function MyWeekPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const weekNumberParam = searchParams.get('week_number');
  const weekNumber = weekNumberParam ? parseInt(weekNumberParam, 10) : undefined;

  const { data, isLoading, error } = useMyWeekQuery(weekNumber);
  const [creating, setCreating] = useState<string | null>(null);

  const navigateToWeek = (wn: number) => {
    if (data && wn === data.week.current_week_number) {
      setSearchParams({});
    } else {
      setSearchParams({ week_number: String(wn) });
    }
  };

  const handleCreatePlan = async () => {
    if (!data) return;
    setCreating('plan');
    try {
      const res = await apiPost('/api/weekly-plans', {
        person_id: data.person_id,
        week_number: data.week.week_number,
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
    if (!data) return;
    setCreating('retro');
    try {
      const res = await apiPost('/api/weekly-retros', {
        person_id: data.person_id,
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

  if (error || !data) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <p className="text-sm text-red-400">Failed to load week data</p>
      </div>
    );
  }

  const { week, plan, retro, previous_retro, standups, projects } = data;
  const showPreviousRetroNudge = week.is_current
    && previous_retro
    && previous_retro.id !== null
    ? !previous_retro.submitted_at
    : week.is_current && previous_retro && previous_retro.id === null;

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
                <p className="text-xs text-orange-300/70 mt-0.5">Week {previous_retro!.week_number} retro needs your input</p>
              </div>
              {previous_retro!.id ? (
                <Link
                  to={`/documents/${previous_retro!.id}`}
                  className="text-xs font-medium text-orange-300 hover:text-orange-200 underline"
                >
                  Complete retro
                </Link>
              ) : (
                <button
                  onClick={() => handleCreateRetro(previous_retro!.week_number)}
                  disabled={creating === 'retro'}
                  className="text-xs font-medium text-orange-300 hover:text-orange-200 underline disabled:opacity-50"
                >
                  {creating === 'retro' ? 'Creating...' : 'Create retro'}
                </button>
              )}
            </div>
          </div>
        )}

        {/* Plan Section */}
        <section className="mb-6">
          <h2 className="text-sm font-medium text-muted uppercase tracking-wide mb-3">Weekly Plan</h2>
          {plan ? (
            <Link
              to={`/documents/${plan.id}`}
              className="block rounded-lg border border-border bg-surface px-4 py-3 hover:border-accent/50 transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm text-foreground">{plan.title}</span>
                {plan.submitted_at ? (
                  <span className="text-xs text-green-400">Submitted</span>
                ) : (
                  <span className="text-xs text-muted">Draft</span>
                )}
              </div>
            </Link>
          ) : (
            <button
              onClick={handleCreatePlan}
              disabled={creating === 'plan'}
              className="w-full rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted hover:border-accent/50 hover:text-foreground transition-colors disabled:opacity-50"
            >
              {creating === 'plan' ? 'Creating...' : '+ Create plan for this week'}
            </button>
          )}
        </section>

        {/* Daily Standups */}
        <section className="mb-6">
          <h2 className="text-sm font-medium text-muted uppercase tracking-wide mb-3">Daily Updates</h2>
          <div className="space-y-1.5">
            {standups.map((slot: StandupSlot) => {
              const isPast = isDateInPast(slot.date);
              const isToday = isDateToday(slot.date);
              const isFuture = !isPast && !isToday;

              return (
                <div
                  key={slot.date}
                  className={cn(
                    'flex items-center gap-3 rounded-lg border px-4 py-2.5',
                    isToday ? 'border-accent/30 bg-accent/5' : 'border-border bg-surface',
                    isFuture && 'opacity-40'
                  )}
                >
                  <div className="w-20 flex-shrink-0">
                    <span className={cn('text-xs font-medium', isToday ? 'text-accent' : 'text-muted')}>
                      {slot.day.slice(0, 3)}
                    </span>
                    <span className="text-xs text-muted ml-1">
                      {new Date(slot.date + 'T00:00:00Z').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', timeZone: 'UTC' })}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0">
                    {slot.standup ? (
                      <Link
                        to={`/documents/${slot.standup.id}`}
                        className="text-sm text-foreground hover:text-accent truncate block"
                      >
                        {slot.standup.title}
                      </Link>
                    ) : isFuture ? (
                      <span className="text-xs text-muted italic">Upcoming</span>
                    ) : (
                      <button
                        onClick={() => handleCreateStandup(slot.date)}
                        disabled={creating === `standup-${slot.date}`}
                        className="text-xs text-muted hover:text-foreground disabled:opacity-50"
                      >
                        {creating === `standup-${slot.date}` ? 'Creating...' : '+ Write standup'}
                      </button>
                    )}
                  </div>
                  {slot.standup && (
                    <div className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
                  )}
                  {!slot.standup && isPast && !isFuture && (
                    <div className="w-2 h-2 rounded-full bg-border flex-shrink-0" />
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* Retro Section */}
        <section className="mb-6">
          <h2 className="text-sm font-medium text-muted uppercase tracking-wide mb-3">Weekly Retro</h2>
          {retro ? (
            <Link
              to={`/documents/${retro.id}`}
              className="block rounded-lg border border-border bg-surface px-4 py-3 hover:border-accent/50 transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="text-sm text-foreground">{retro.title}</span>
                {retro.submitted_at ? (
                  <span className="text-xs text-green-400">Submitted</span>
                ) : (
                  <span className="text-xs text-muted">Draft</span>
                )}
              </div>
            </Link>
          ) : (
            <button
              onClick={() => handleCreateRetro(week.week_number)}
              disabled={creating === 'retro'}
              className="w-full rounded-lg border border-dashed border-border px-4 py-3 text-sm text-muted hover:border-accent/50 hover:text-foreground transition-colors disabled:opacity-50"
            >
              {creating === 'retro' ? 'Creating...' : '+ Create retro for this week'}
            </button>
          )}
        </section>

      </div>
      </div>
    </div>
  );
}
