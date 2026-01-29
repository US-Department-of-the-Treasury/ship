import { useNavigate } from 'react-router-dom';
import { useActiveWeeksQuery, ActiveWeek } from '@/hooks/useWeeksQuery';
import { cn } from '@/lib/cn';

export function WeeksPage() {
  const navigate = useNavigate();
  const { data, isLoading, error } = useActiveWeeksQuery();

  if (isLoading) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h1 className="text-xl font-semibold text-foreground">Weeks</h1>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="text-muted">Loading weeks...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h1 className="text-xl font-semibold text-foreground">Weeks</h1>
        </div>
        <div className="flex flex-1 items-center justify-center">
          <div className="text-red-400">Failed to load weeks</div>
        </div>
      </div>
    );
  }

  const sprints = data?.weeks || [];
  const currentSprintNumber = data?.current_sprint_number || 0;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-semibold text-foreground">Weeks</h1>
          {currentSprintNumber > 0 && (
            <span className="rounded-full bg-accent/20 px-2.5 py-0.5 text-xs font-medium text-accent">
              Week {currentSprintNumber}
            </span>
          )}
        </div>
        {data && (
          <div className="text-sm text-muted">
            {data.days_remaining} day{data.days_remaining !== 1 ? 's' : ''} remaining
          </div>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        {sprints.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
            <p className="text-muted">No active weeks</p>
            <p className="text-sm text-muted/70">
              Check Programs to see upcoming weeks
            </p>
          </div>
        ) : (
          <table className="w-full" role="grid" aria-label="Active weeks">
            <thead>
              <tr className="border-b border-border bg-background/50">
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                  Week
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                  Program
                </th>
                <th className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-muted">
                  Owner
                </th>
                <th className="px-4 py-3 text-center text-xs font-medium uppercase tracking-wider text-muted">
                  Progress
                </th>
                <th className="px-4 py-3 text-right text-xs font-medium uppercase tracking-wider text-muted">
                  Days Left
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sprints.map((sprint) => (
                <SprintRow
                  key={sprint.id}
                  sprint={sprint}
                  onClick={() => navigate(`/documents/${sprint.id}`)}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

interface SprintRowProps {
  sprint: ActiveWeek;
  onClick: () => void;
}

function SprintRow({ sprint, onClick }: SprintRowProps) {
  const progressPercent = sprint.issue_count > 0
    ? Math.round((sprint.completed_count / sprint.issue_count) * 100)
    : 0;

  return (
    <tr
      onClick={onClick}
      className="cursor-pointer transition-colors hover:bg-border/30"
      role="row"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      {/* Sprint name */}
      <td className="px-4 py-3" role="gridcell">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-foreground">
            {sprint.name || 'Untitled'}
          </span>
        </div>
      </td>

      {/* Program */}
      <td className="px-4 py-3" role="gridcell">
        <div className="flex items-center gap-2">
          {sprint.program_prefix && (
            <span className="rounded bg-border px-1.5 py-0.5 text-xs font-medium text-muted whitespace-nowrap">
              {sprint.program_prefix}
            </span>
          )}
          <span className="text-sm text-muted">
            {sprint.program_name || '—'}
          </span>
        </div>
      </td>

      {/* Owner */}
      <td className="px-4 py-3" role="gridcell">
        {sprint.owner ? (
          <div className="flex items-center gap-2">
            <span
              className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-accent/80 text-xs font-medium text-white"
              title={sprint.owner.name}
            >
              {sprint.owner.name?.charAt(0).toUpperCase() || '?'}
            </span>
            <span className="text-sm text-muted">{sprint.owner.name}</span>
          </div>
        ) : (
          <span className="text-sm text-muted">Unassigned</span>
        )}
      </td>

      {/* Progress */}
      <td className="px-4 py-3 text-center" role="gridcell">
        <div className="flex items-center justify-center gap-2">
          <span className="text-sm text-muted">
            {sprint.completed_count}/{sprint.issue_count}
          </span>
          {sprint.issue_count > 0 && (
            <div className="h-1.5 w-16 overflow-hidden rounded-full bg-border">
              <div
                className={cn(
                  'h-full rounded-full transition-all',
                  progressPercent === 100 ? 'bg-green-500' : 'bg-accent'
                )}
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          )}
        </div>
      </td>

      {/* Days remaining */}
      <td className="px-4 py-3 text-right" role="gridcell">
        <span className={cn(
          'text-sm',
          sprint.days_remaining <= 1 ? 'text-orange-400' : 'text-muted'
        )}>
          {sprint.days_remaining}d
        </span>
      </td>
    </tr>
  );
}
