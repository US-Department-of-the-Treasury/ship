import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useActiveSprintsQuery, ActiveSprint } from '@/hooks/useSprintsQuery';
import { useProjects, Project } from '@/contexts/ProjectsContext';
import { cn } from '@/lib/cn';

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
  const { data: sprintsData, isLoading: sprintsLoading } = useActiveSprintsQuery();
  const { projects, loading: projectsLoading } = useProjects();
  const [recentStandups, setRecentStandups] = useState<Standup[]>([]);
  const [standupsLoading, setStandupsLoading] = useState(true);

  const activeSprints = sprintsData?.sprints || [];

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

  return (
    <div className="h-full overflow-auto p-6">
      <div className="mx-auto max-w-6xl space-y-8">
        {/* Header */}
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dashboard</h1>
          <p className="mt-1 text-sm text-muted">
            Cross-program overview of work transparency
          </p>
        </div>

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
