import { useState, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useActiveSprintsQuery, ActiveSprint } from '@/hooks/useSprintsQuery';
import { useProjects, Project } from '@/contexts/ProjectsContext';
import { useDashboardActionItems, ActionItem } from '@/hooks/useDashboardActionItems';
import { useDashboardMyWork, WorkItem } from '@/hooks/useDashboardMyWork';
import { cn } from '@/lib/cn';

type DashboardView = 'my-work' | 'overview';

const API_URL = import.meta.env.VITE_API_URL ?? '';

interface Standup {
  id: string;
  sprint_id: string;
  title: string;
  content: unknown;
  author_id: string;
  author_name: string | null;
  author_email: string | null;
  created_at: string;
  updated_at: string;
  // Added by Dashboard fetch:
  sprint_title?: string;
  program_name?: string;
}

// Helper to extract text from TipTap content
function extractTextFromContent(content: unknown): string {
  if (!content || typeof content !== 'object') return '';
  const doc = content as { content?: Array<{ content?: Array<{ text?: string }> }> };
  if (!doc.content) return '';

  const texts: string[] = [];
  for (const block of doc.content) {
    if (block.content) {
      for (const inline of block.content) {
        if (inline.text) texts.push(inline.text);
      }
    }
  }
  return texts.join(' ').slice(0, 200) + (texts.join(' ').length > 200 ? '...' : '');
}

// Format relative time
function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays === 1) return 'Yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

export function DashboardPage() {
  const [searchParams] = useSearchParams();
  const currentView: DashboardView = (searchParams.get('view') as DashboardView) || 'my-work';

  const { data: sprintsData, isLoading: sprintsLoading } = useActiveSprintsQuery();
  const { projects, loading: projectsLoading } = useProjects();
  const { data: actionItemsData, isLoading: actionItemsLoading } = useDashboardActionItems();
  const { data: myWorkData, isLoading: myWorkLoading } = useDashboardMyWork();
  const [recentStandups, setRecentStandups] = useState<Standup[]>([]);
  const [standupsLoading, setStandupsLoading] = useState(true);

  const activeSprints = sprintsData?.sprints || [];
  const actionItems = actionItemsData?.action_items || [];
  const myWorkGrouped = myWorkData?.grouped || { overdue: [], this_sprint: [], later: [] };

  // Fetch recent standups from all active sprints
  useEffect(() => {
    async function fetchStandups() {
      if (activeSprints.length === 0) {
        setStandupsLoading(false);
        return;
      }

      try {
        const allStandups: Standup[] = [];

        // Fetch standups from each active sprint (in parallel)
        const responses = await Promise.all(
          activeSprints.map(async (sprint) => {
            const res = await fetch(`${API_URL}/api/sprints/${sprint.id}/standups`, {
              credentials: 'include',
            });
            if (res.ok) {
              const standups: Standup[] = await res.json();
              return standups.map(s => ({
                ...s,
                sprint_id: sprint.id,
                sprint_title: sprint.name,
                program_name: sprint.program_name,
              }));
            }
            return [];
          })
        );

        // Flatten and sort by date (newest first)
        responses.forEach(standups => allStandups.push(...standups));
        allStandups.sort((a, b) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );

        // Take the most recent 10
        setRecentStandups(allStandups.slice(0, 10));
      } catch (err) {
        console.error('Failed to fetch standups:', err);
      } finally {
        setStandupsLoading(false);
      }
    }

    if (!sprintsLoading) {
      fetchStandups();
    }
  }, [activeSprints, sprintsLoading]);

  // Calculate project status summary
  const projectSummary = {
    active: projects.filter(p => !p.archived_at).length,
    archived: projects.filter(p => p.archived_at).length,
    total: projects.length,
  };

  // Get top projects by ICE score
  const topProjects = [...projects]
    .filter(p => !p.archived_at)
    .sort((a, b) => (b.ice_score || 0) - (a.ice_score || 0))
    .slice(0, 5);

  const loading = sprintsLoading || projectsLoading;

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted">Loading dashboard...</div>
      </div>
    );
  }

  // Filter overdue items for blocking banner
  const overdueItems = actionItems.filter(item => item.urgency === 'overdue');

  return (
    <div className="h-full overflow-auto">
      {/* Blocking Banner for Overdue Items */}
      {overdueItems.length > 0 && (
        <div className="bg-red-600 text-white px-6 py-3">
          <div className="mx-auto max-w-6xl">
            {overdueItems.length === 1 ? (
              <Link
                to={`/programs/${overdueItems[0].program_id}/sprints/${overdueItems[0].sprint_id}`}
                className="flex items-center gap-2 hover:underline"
              >
                <span className="font-medium">
                  {overdueItems[0].program_name} Sprint {overdueItems[0].sprint_number} is missing a {overdueItems[0].type}
                </span>
                <span className="text-red-200">→ Write now</span>
              </Link>
            ) : (
              <div className="space-y-1">
                <div className="font-medium">
                  {overdueItems.length} overdue sprint documents need your attention:
                </div>
                <div className="flex flex-wrap gap-3">
                  {overdueItems.map(item => (
                    <Link
                      key={item.id}
                      to={`/programs/${item.program_id}/sprints/${item.sprint_id}`}
                      className="text-sm hover:underline text-red-100"
                    >
                      {item.program_name} Sprint {item.sprint_number} ({item.type}) →
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="p-6">
        <div className="mx-auto max-w-6xl space-y-8">
          {/* Header */}
          <div>
            <h1 className="text-2xl font-bold text-foreground">
              {currentView === 'my-work' ? 'My Work' : 'Dashboard'}
            </h1>
            <p className="mt-1 text-sm text-muted">
              {currentView === 'my-work'
                ? 'Your sprint documentation and assigned work'
                : 'Cross-program overview of work transparency'}
            </p>
          </div>

          {currentView === 'my-work' ? (
            /* My Work View - Action Items + Context */
            <>
              {/* Action Items Section */}
              {actionItemsLoading ? (
                <div className="rounded-lg border border-border bg-background p-4">
                  <p className="text-sm text-muted">Loading action items...</p>
                </div>
              ) : actionItems.length > 0 ? (
                <div className="rounded-lg border border-border bg-background p-4">
                  <h2 className="text-lg font-semibold text-foreground mb-4">
                    Action Items
                  </h2>
                  <div className="space-y-3">
                    {actionItems.map((item) => (
                      <ActionItemCard key={item.id} item={item} />
                    ))}
                  </div>
                </div>
              ) : null}

              {/* My Work Context Section */}
              {myWorkLoading ? (
                <div className="rounded-lg border border-border bg-background p-4">
                  <p className="text-sm text-muted">Loading your work...</p>
                </div>
              ) : (myWorkGrouped.overdue.length > 0 || myWorkGrouped.this_sprint.length > 0 || myWorkGrouped.later.length > 0) ? (
                <div className="space-y-6">
                  {/* Overdue Section */}
                  {myWorkGrouped.overdue.length > 0 && (
                    <div className="rounded-lg border border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-950/20 p-4">
                      <h2 className="text-lg font-semibold text-red-700 dark:text-red-400 mb-4">
                        Overdue ({myWorkGrouped.overdue.length})
                      </h2>
                      <div className="space-y-2">
                        {myWorkGrouped.overdue.map((item) => (
                          <WorkItemCard key={item.id} item={item} />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* This Sprint Section */}
                  {myWorkGrouped.this_sprint.length > 0 && (
                    <div className="rounded-lg border border-border bg-background p-4">
                      <h2 className="text-lg font-semibold text-foreground mb-4">
                        This Sprint ({myWorkGrouped.this_sprint.length})
                      </h2>
                      <div className="space-y-2">
                        {myWorkGrouped.this_sprint.map((item) => (
                          <WorkItemCard key={item.id} item={item} />
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Later Section */}
                  {myWorkGrouped.later.length > 0 && (
                    <div className="rounded-lg border border-border bg-background p-4">
                      <h2 className="text-lg font-semibold text-muted mb-4">
                        Later ({myWorkGrouped.later.length})
                      </h2>
                      <div className="space-y-2">
                        {myWorkGrouped.later.map((item) => (
                          <WorkItemCard key={item.id} item={item} />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              ) : actionItems.length === 0 ? (
                /* Empty State - only show when no action items AND no work items */
                <div className="rounded-lg border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-950/20 p-8 text-center">
                  <div className="text-5xl mb-4">&#x2713;</div>
                  <h2 className="text-xl font-semibold text-green-700 dark:text-green-400 mb-2">
                    All caught up!
                  </h2>
                  <p className="text-sm text-muted mb-6">
                    You have no overdue sprint docs, assigned issues, or active projects right now.
                  </p>
                  <div className="flex justify-center gap-4">
                    <Link
                      to="/dashboard?view=overview"
                      className="inline-flex items-center gap-2 rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/50 transition-colors"
                    >
                      View team overview
                    </Link>
                    <Link
                      to="/issues/new"
                      className="inline-flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors"
                    >
                      Create a new issue
                    </Link>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            /* Overview View - Stats and Lists */
            <>
              {/* Stats Grid */}
              <div className="grid grid-cols-4 gap-4">
                <StatCard
                  label="Active Sprints"
                  value={activeSprints.length}
                  color="text-blue-600"
                />
                <StatCard
                  label="Active Projects"
                  value={projectSummary.active}
                  color="text-green-600"
                />
                <StatCard
                  label="Recent Standups"
                  value={recentStandups.length}
                  color="text-purple-600"
                />
                <StatCard
                  label="Days in Sprint"
                  value={sprintsData?.days_remaining ? `${14 - sprintsData.days_remaining}` : '-'}
                  subtitle={sprintsData?.days_remaining ? `${sprintsData.days_remaining} remaining` : undefined}
                  color="text-orange-600"
                />
              </div>

              {/* Main Content Grid */}
              <div className="grid grid-cols-2 gap-6">
                {/* Active Sprints */}
                <div className="rounded-lg border border-border bg-background p-4">
                  <h2 className="text-lg font-semibold text-foreground mb-4">
                    Active Sprints
                  </h2>
                  {activeSprints.length === 0 ? (
                    <p className="text-sm text-muted">No active sprints</p>
                  ) : (
                    <div className="space-y-3">
                      {activeSprints.map((sprint) => (
                        <SprintCard key={sprint.id} sprint={sprint} />
                      ))}
                    </div>
                  )}
                </div>

                {/* Top Projects by ICE */}
                <div className="rounded-lg border border-border bg-background p-4">
                  <h2 className="text-lg font-semibold text-foreground mb-4">
                    Top Projects by ICE
                  </h2>
                  {topProjects.length === 0 ? (
                    <p className="text-sm text-muted">No active projects</p>
                  ) : (
                    <div className="space-y-3">
                      {topProjects.map((project) => (
                        <ProjectCard key={project.id} project={project} />
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Recent Standups */}
              <div className="rounded-lg border border-border bg-background p-4">
                <h2 className="text-lg font-semibold text-foreground mb-4">
                  Recent Standups
                </h2>
                {standupsLoading ? (
                  <p className="text-sm text-muted">Loading standups...</p>
                ) : recentStandups.length === 0 ? (
                  <p className="text-sm text-muted">No recent standups</p>
                ) : (
                  <div className="space-y-3">
                    {recentStandups.map((standup) => (
                      <StandupCard key={standup.id} standup={standup} />
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function StatCard({
  label,
  value,
  subtitle,
  color,
}: {
  label: string;
  value: number | string;
  subtitle?: string;
  color: string;
}) {
  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <div className="text-xs font-medium text-muted uppercase tracking-wide">
        {label}
      </div>
      <div className={cn('text-3xl font-bold mt-1', color)}>{value}</div>
      {subtitle && (
        <div className="text-xs text-muted mt-1">{subtitle}</div>
      )}
    </div>
  );
}

function SprintCard({ sprint }: { sprint: ActiveSprint }) {
  const progress = sprint.issue_count > 0
    ? Math.round((sprint.completed_count / sprint.issue_count) * 100)
    : 0;

  return (
    <Link
      to={`/programs/${sprint.program_id}/sprints/${sprint.id}`}
      className="block rounded-md border border-border bg-background p-3 hover:border-accent/50 transition-colors"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {sprint.owner && (
            <span
              className="flex h-6 w-6 items-center justify-center rounded-full bg-accent/80 text-xs font-medium text-white"
              title={sprint.owner.name}
            >
              {sprint.owner.name?.charAt(0).toUpperCase()}
            </span>
          )}
          <span className="font-medium text-foreground">
            {sprint.program_name}
          </span>
        </div>
        <span className="text-xs text-muted">
          {sprint.completed_count}/{sprint.issue_count} issues
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-2 rounded-full bg-border overflow-hidden">
        <div
          className={cn(
            'h-full transition-all',
            progress >= 100 ? 'bg-green-500' :
            progress >= 50 ? 'bg-yellow-500' : 'bg-blue-500'
          )}
          style={{ width: `${progress}%` }}
        />
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-xs text-muted">{progress}% complete</span>
        <span className="text-xs text-muted">{sprint.days_remaining}d remaining</span>
      </div>
    </Link>
  );
}

function ProjectCard({ project }: { project: Project }) {
  return (
    <Link
      to={`/projects/${project.id}`}
      className="flex items-center justify-between rounded-md border border-border bg-background p-3 hover:border-accent/50 transition-colors"
    >
      <div className="flex items-center gap-3">
        <span
          className="flex h-8 w-8 items-center justify-center rounded-md text-sm font-medium"
          style={{
            backgroundColor: project.color || '#6366f1',
            color: '#fff',
          }}
        >
          {project.emoji || project.title?.[0]?.toUpperCase() || '?'}
        </span>
        <div>
          <div className="font-medium text-foreground">
            {project.title || 'Untitled'}
          </div>
          {project.owner && (
            <div className="text-xs text-muted">
              {project.owner.name}
            </div>
          )}
        </div>
      </div>
      <div className="text-right">
        <div className="text-lg font-bold text-accent tabular-nums">
          {project.ice_score}
        </div>
        <div className="text-xs text-muted">ICE</div>
      </div>
    </Link>
  );
}

function StandupCard({ standup }: { standup: Standup }) {
  const contentPreview = extractTextFromContent(standup.content);
  const authorInitial = standup.author_name?.charAt(0).toUpperCase() || '?';
  const authorDisplay = standup.author_name || 'Unknown';

  return (
    <div className="rounded-md border border-border bg-background p-3">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-accent/80 text-xs font-medium text-white">
            {authorInitial}
          </span>
          <span className="font-medium text-foreground text-sm">
            {authorDisplay}
          </span>
          <span className="text-xs text-muted">
            in {standup.program_name}
          </span>
        </div>
        <span className="text-xs text-muted">
          {formatRelativeTime(standup.created_at)}
        </span>
      </div>
      <p className="text-sm text-muted line-clamp-2">
        {contentPreview || 'No content'}
      </p>
    </div>
  );
}

function ActionItemCard({ item }: { item: ActionItem }) {
  const urgencyStyles = {
    overdue: 'border-red-500 bg-red-50 dark:bg-red-950/20',
    due_today: 'border-orange-500 bg-orange-50 dark:bg-orange-950/20',
    due_soon: 'border-yellow-500 bg-yellow-50 dark:bg-yellow-950/20',
    upcoming: 'border-border bg-background',
  };

  const urgencyTextStyles = {
    overdue: 'text-red-600 dark:text-red-400',
    due_today: 'text-orange-600 dark:text-orange-400',
    due_soon: 'text-yellow-600 dark:text-yellow-400',
    upcoming: 'text-muted',
  };

  const urgencyLabel = {
    overdue: `${Math.abs(item.days_until_due)}d overdue`,
    due_today: 'Due today',
    due_soon: `Due in ${item.days_until_due}d`,
    upcoming: `Due in ${item.days_until_due}d`,
  };

  return (
    <Link
      to={`/programs/${item.program_id}/sprints/${item.sprint_id}`}
      className={cn(
        'block rounded-md border p-3 hover:border-accent/50 transition-colors',
        urgencyStyles[item.urgency]
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={cn(
            'inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium',
            item.type === 'plan' ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300' : 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300'
          )}>
            {item.type === 'plan' ? 'Plan' : 'Retro'}
          </span>
          <span className="font-medium text-foreground">
            {item.message}
          </span>
        </div>
        <span className={cn('text-xs font-medium', urgencyTextStyles[item.urgency])}>
          {urgencyLabel[item.urgency]}
        </span>
      </div>
      <div className="mt-1 text-xs text-muted">
        {item.program_name} · Sprint {item.sprint_number}
      </div>
    </Link>
  );
}

function WorkItemCard({ item }: { item: WorkItem }) {
  // Determine link destination based on item type
  const getLink = () => {
    switch (item.type) {
      case 'issue':
        return `/issues/${item.id}`;
      case 'project':
        return `/projects/${item.id}`;
      case 'sprint':
        return `/sprints/${item.id}`;
      default:
        return '#';
    }
  };

  // Type badge styles
  const typeBadgeStyles = {
    issue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
    project: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
    sprint: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  };

  // Priority badge for issues
  const priorityStyles: Record<string, string> = {
    urgent: 'text-red-600 dark:text-red-400',
    high: 'text-orange-600 dark:text-orange-400',
    medium: 'text-yellow-600 dark:text-yellow-400',
    low: 'text-gray-500 dark:text-gray-400',
    none: 'text-gray-400 dark:text-gray-500',
  };

  return (
    <Link
      to={getLink()}
      className="flex items-center justify-between rounded-md border border-border bg-background p-3 hover:border-accent/50 transition-colors"
    >
      <div className="flex items-center gap-3 min-w-0">
        {/* Type Badge */}
        <span className={cn(
          'inline-flex items-center shrink-0 rounded-full px-2 py-0.5 text-xs font-medium',
          typeBadgeStyles[item.type]
        )}>
          {item.type === 'issue' && item.ticket_number ? `#${item.ticket_number}` : item.type.charAt(0).toUpperCase() + item.type.slice(1)}
        </span>

        {/* Title and metadata */}
        <div className="min-w-0">
          <div className="font-medium text-foreground truncate">
            {item.title || 'Untitled'}
          </div>
          <div className="text-xs text-muted truncate">
            {item.program_name && <span>{item.program_name}</span>}
            {item.type === 'issue' && item.sprint_name && (
              <span> · {item.sprint_name}</span>
            )}
            {item.type === 'sprint' && item.days_remaining !== undefined && (
              <span> · {item.days_remaining}d remaining</span>
            )}
            {item.type === 'project' && item.inferred_status && (
              <span> · {item.inferred_status}</span>
            )}
          </div>
        </div>
      </div>

      {/* Right side - priority/score */}
      <div className="shrink-0 text-right">
        {item.type === 'issue' && item.priority && (
          <span className={cn('text-xs font-medium', priorityStyles[item.priority] || 'text-muted')}>
            {item.priority}
          </span>
        )}
        {item.type === 'project' && item.ice_score !== null && (
          <div>
            <span className="text-sm font-bold text-accent tabular-nums">{item.ice_score}</span>
            <span className="text-xs text-muted ml-1">ICE</span>
          </div>
        )}
      </div>
    </Link>
  );
}
