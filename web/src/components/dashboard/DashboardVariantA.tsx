import { Link } from 'react-router-dom';
import { useDashboardActionItems, ActionItem } from '@/hooks/useDashboardActionItems';
import { useDashboardFocus, ProjectFocus, PlanItem } from '@/hooks/useDashboardFocus';
import { cn } from '@/lib/cn';

export function DashboardVariantA() {
  const { data: actionItemsData, isLoading: actionItemsLoading } = useDashboardActionItems();
  const { data: focusData, isLoading: focusLoading } = useDashboardFocus();

  const actionItems = actionItemsData?.action_items || [];

  return (
    <div className="space-y-8">
      {/* Action Required Section */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <h2 className="text-xs font-semibold text-muted uppercase tracking-wide">
            Action Required
          </h2>
          <span className="text-xs font-medium text-muted bg-border px-1.5 py-0.5 rounded-full">
            {actionItemsLoading ? '-' : actionItems.length}
          </span>
        </div>

        {actionItemsLoading ? (
          <div className="rounded-lg border border-border bg-background p-4">
            <p className="text-sm text-muted">Loading...</p>
          </div>
        ) : actionItems.length > 0 ? (
          <div className="space-y-2">
            {actionItems.map((item) => (
              <ActionCard key={item.id} item={item} />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-dashed border-border bg-background p-5 text-center">
            <div className="text-sm font-medium text-green-400">
              You're all caught up
            </div>
            <div className="text-xs text-muted mt-1">
              All plans and retros are submitted
            </div>
          </div>
        )}
      </div>

      {/* Divider */}
      <div className="h-px bg-border" />

      {/* Your Focus This Week */}
      <div>
        <h2 className="text-xs font-semibold text-muted uppercase tracking-wide mb-3">
          Your Focus This Week
        </h2>

        {focusLoading ? (
          <div className="rounded-lg border border-border bg-background p-4">
            <p className="text-sm text-muted">Loading...</p>
          </div>
        ) : focusData && focusData.projects.length > 0 ? (
          <div className="space-y-4">
            {focusData.projects.map((project) => (
              <FocusCard
                key={project.id}
                project={project}
                weekNumber={focusData.current_week_number}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-background p-4">
            <p className="text-sm text-muted">
              No project allocations found for this week.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function ActionCard({ item }: { item: ActionItem }) {
  const dotColor = {
    overdue: 'bg-red-500 shadow-[0_0_6px_rgba(239,68,68,0.4)]',
    due_today: 'bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.3)]',
    due_soon: 'bg-blue-500',
    upcoming: 'bg-blue-500',
  };

  const badgeStyle = {
    overdue: 'bg-red-500/15 text-red-300',
    due_today: 'bg-amber-500/15 text-amber-300',
    due_soon: 'bg-blue-500/15 text-blue-300',
    upcoming: 'bg-blue-500/15 text-blue-300',
  };

  const badgeLabel = {
    overdue: 'Overdue',
    due_today: 'Due today',
    due_soon: 'Due soon',
    upcoming: 'Upcoming',
  };

  return (
    <Link
      to={`/documents/${item.sprint_id}`}
      className="flex items-center gap-3 rounded-lg border border-border bg-background p-3.5 hover:border-accent/50 transition-colors"
    >
      <span className={cn('h-2 w-2 rounded-full shrink-0', dotColor[item.urgency])} />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-foreground">
          Write your {item.type} for Week {item.sprint_number}
        </div>
        <div className="text-xs text-muted mt-0.5">
          {item.program_name}
        </div>
      </div>
      <span className={cn('text-xs font-medium px-2 py-0.5 rounded', badgeStyle[item.urgency])}>
        {badgeLabel[item.urgency]}
      </span>
      <span className="text-muted text-sm">&rsaquo;</span>
    </Link>
  );
}

function FocusCard({
  project,
  weekNumber,
}: {
  project: ProjectFocus;
  weekNumber: number;
}) {
  const plan = project.plan || project.previous_plan;
  const planWeek = plan?.week_number || weekNumber;
  const isCurrentWeek = plan === project.plan;

  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <div className="flex items-center gap-2.5 mb-3">
        <span className="h-2.5 w-2.5 rounded-sm bg-accent shrink-0" />
        <div>
          <div className="text-sm font-semibold text-foreground">{project.title}</div>
          <div className="text-xs text-muted">
            {project.program_name} &middot; Week {weekNumber}
          </div>
        </div>
      </div>

      {plan && plan.items.length > 0 ? (
        <>
          <div className="text-xs text-muted mb-3">
            From your Week {planWeek} plan{!isCurrentWeek ? ' (last week)' : ''}
          </div>
          <div className="space-y-0">
            {plan.items.map((item, i) => (
              <PlanItemRow key={i} item={item} />
            ))}
          </div>
        </>
      ) : (
        <div className="text-sm text-muted">
          No plan written yet &mdash;{' '}
          <Link to={`/documents/${project.id}`} className="text-accent hover:underline">
            Write your Week {weekNumber} plan
          </Link>
        </div>
      )}
    </div>
  );
}

function PlanItemRow({ item }: { item: PlanItem }) {
  return (
    <div className="flex items-start gap-2.5 py-2 border-t border-border/50 first:border-t-0">
      <span
        className={cn(
          'mt-0.5 h-4 w-4 rounded-full border-[1.5px] shrink-0 flex items-center justify-center',
          item.checked
            ? 'border-green-500 bg-green-500'
            : 'border-muted/50'
        )}
      >
        {item.checked && (
          <svg className="h-2.5 w-2.5 text-background" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M2 6l3 3 5-5" />
          </svg>
        )}
      </span>
      <span className={cn(
        'text-sm leading-relaxed',
        item.checked ? 'text-muted line-through' : 'text-foreground'
      )}>
        {item.text}
      </span>
    </div>
  );
}
