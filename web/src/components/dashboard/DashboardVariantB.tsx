import { Link } from 'react-router-dom';
import { useDashboardActionItems, ActionItem } from '@/hooks/useDashboardActionItems';
import { useDashboardFocus, ProjectFocus, PlanItem, RecentActivity } from '@/hooks/useDashboardFocus';
import { cn } from '@/lib/cn';
import { formatRelativeTime } from '@/lib/date-utils';

export function DashboardVariantB() {
  const { data: actionItemsData, isLoading: actionItemsLoading } = useDashboardActionItems();
  const { data: focusData, isLoading: focusLoading } = useDashboardFocus();

  const actionItems = actionItemsData?.action_items || [];
  const projects = focusData?.projects || [];
  const weekNumber = focusData?.current_week_number || 0;

  const loading = actionItemsLoading || focusLoading;

  if (loading) {
    return (
      <div className="rounded-lg border border-border bg-background p-4">
        <p className="text-sm text-muted">Loading...</p>
      </div>
    );
  }

  // Calculate day dots
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0=Sun, 1=Mon, ...
  const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];

  // All rituals complete?
  const allComplete = actionItems.length === 0;

  return (
    <div className="space-y-5">
      {/* Week Indicator */}
      <div className="flex items-center justify-between rounded-lg bg-[#1a1a1a] px-4 py-2.5">
        <div>
          <div className="text-sm font-semibold text-foreground">Week {weekNumber}</div>
          <div className="text-xs text-muted">
            {focusData?.week_start && formatWeekRange(focusData.week_start, focusData.week_end)}
          </div>
        </div>
        <div className="flex gap-1">
          {dayNames.map((_, i) => {
            const dayNum = i + 1; // 1=Mon ... 5=Fri
            const isPast = dayNum < dayOfWeek;
            const isToday = dayNum === dayOfWeek;
            return (
              <div
                key={i}
                title={dayNames[i]}
                className={cn(
                  'h-1 w-5 rounded-sm',
                  isToday ? 'bg-accent' : isPast ? 'bg-muted/50' : 'bg-border'
                )}
              />
            );
          })}
        </div>
      </div>

      {/* All Caught Up Banner */}
      {allComplete && (
        <div className="rounded-lg border border-dashed border-border bg-background p-3 text-center">
          <div className="text-sm font-medium text-green-400">All rituals complete</div>
          <div className="text-xs text-muted mt-0.5">
            Plans and retros are submitted for all projects
          </div>
        </div>
      )}

      {/* Project Cards */}
      {projects.map((project) => {
        const projectActions = getProjectActions(project, actionItems, weekNumber);
        const hasOutstanding = projectActions.some(a => a.status !== 'done');

        return (
          <ProjectCard
            key={project.id}
            project={project}
            actions={projectActions}
            weekNumber={weekNumber}
            expanded={hasOutstanding || allComplete}
            dimmed={allComplete ? false : !hasOutstanding}
          />
        );
      })}
    </div>
  );
}

interface RitualAction {
  type: 'plan' | 'retro';
  label: string;
  status: 'overdue' | 'due' | 'done';
  sprintId?: string;
}

function getProjectActions(
  project: ProjectFocus,
  actionItems: ActionItem[],
  weekNumber: number
): RitualAction[] {
  const actions: RitualAction[] = [];

  // Check retro for previous week
  const retroItem = actionItems.find(
    a => a.type === 'retro' && a.sprint_number === weekNumber - 1
  );
  if (retroItem) {
    actions.push({
      type: 'retro',
      label: `Retro W${weekNumber - 1}`,
      status: retroItem.urgency === 'overdue' ? 'overdue' : 'due',
      sprintId: retroItem.sprint_id,
    });
  } else {
    actions.push({
      type: 'retro',
      label: `Retro W${weekNumber - 1}`,
      status: 'done',
    });
  }

  // Check plan for current week
  const planItem = actionItems.find(
    a => a.type === 'plan' && a.sprint_number === weekNumber
  );
  if (planItem) {
    actions.push({
      type: 'plan',
      label: `Plan W${weekNumber}`,
      status: planItem.urgency === 'overdue' ? 'overdue' : 'due',
      sprintId: planItem.sprint_id,
    });
  } else {
    actions.push({
      type: 'plan',
      label: `Plan W${weekNumber}`,
      status: 'done',
    });
  }

  return actions;
}

function ProjectCard({
  project,
  actions,
  weekNumber,
  expanded,
  dimmed,
}: {
  project: ProjectFocus;
  actions: RitualAction[];
  weekNumber: number;
  expanded: boolean;
  dimmed: boolean;
}) {
  const plan = project.plan || project.previous_plan;
  const isCurrentPlan = plan === project.plan;
  const planLabel = isCurrentPlan
    ? 'Your plan for this week'
    : `Last week's plan (W${plan?.week_number || weekNumber - 1})`;

  return (
    <div className={cn(
      'rounded-lg border border-border overflow-hidden',
      dimmed && 'opacity-60'
    )}>
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3 border-b border-border/50">
        <div className="flex items-center gap-3">
          <span className="h-2.5 w-2.5 rounded-sm bg-accent shrink-0" />
          <span className="text-sm font-semibold text-foreground">{project.title}</span>
          <span className="text-xs text-muted">{project.program_name}</span>
        </div>
        <div className="flex gap-2">
          {actions.map((action) => (
            <RitualPill key={action.label} action={action} />
          ))}
        </div>
      </div>

      {/* Body - two columns */}
      {expanded && plan && plan.items.length > 0 && (
        <div className="grid grid-cols-2">
          <div className="p-4">
            <div className="text-[10px] font-semibold text-muted/60 uppercase tracking-wider mb-2.5">
              {planLabel}
            </div>
            <div className="space-y-1.5">
              {plan.items.map((item, i) => (
                <div key={i} className="flex items-start gap-2 text-xs">
                  <span className="mt-1.5 h-1 w-1 rounded-full bg-muted/50 shrink-0" />
                  <span className="text-foreground leading-relaxed">{item.text}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="p-4 border-l border-border/50">
            <div className="text-[10px] font-semibold text-muted/60 uppercase tracking-wider mb-2.5">
              Recent Activity
            </div>
            {project.recent_activity.length > 0 ? (
              <div className="space-y-1.5">
                {project.recent_activity.slice(0, 4).map((activity) => (
                  <ActivityRow key={activity.id} activity={activity} />
                ))}
              </div>
            ) : (
              <div className="text-xs text-muted">No recent activity</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function RitualPill({ action }: { action: RitualAction }) {
  const styles = {
    overdue: 'bg-red-500/12 text-red-300',
    due: 'bg-amber-500/12 text-amber-300',
    done: 'bg-green-500/12 text-green-300',
  };

  const dotStyles = {
    overdue: 'bg-red-500',
    due: 'bg-amber-500',
    done: 'bg-green-500',
  };

  const pill = (
    <span className={cn(
      'inline-flex items-center gap-1.5 text-[11px] font-medium px-2.5 py-1 rounded cursor-pointer transition-opacity hover:opacity-80',
      styles[action.status]
    )}>
      <span className={cn('h-1.5 w-1.5 rounded-full', dotStyles[action.status])} />
      {action.label}
    </span>
  );

  if (action.sprintId) {
    return <Link to={`/documents/${action.sprintId}`}>{pill}</Link>;
  }

  return pill;
}

function ActivityRow({ activity }: { activity: RecentActivity }) {
  const typeBadge = activity.state === 'done'
    ? 'bg-green-500/15 text-green-300'
    : 'bg-blue-500/15 text-blue-300';

  return (
    <div className="flex items-center gap-2">
      <span className={cn('text-[10px] font-medium px-1.5 py-0.5 rounded shrink-0', typeBadge)}>
        {activity.ticket_number ? `#${activity.ticket_number}` : 'issue'}
      </span>
      <span className="text-xs text-muted truncate">{activity.title}</span>
    </div>
  );
}

function formatWeekRange(start: string, end: string): string {
  const s = new Date(start);
  const e = new Date(end);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${months[s.getMonth()]} ${s.getDate()} \u2013 ${months[e.getMonth()]} ${e.getDate()}`;
}
