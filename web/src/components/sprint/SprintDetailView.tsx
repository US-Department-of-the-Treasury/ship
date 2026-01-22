import { useState, useEffect } from 'react';
import { cn } from '@/lib/cn';
import { issueStatusColors } from '@/lib/statusColors';
import { StandupFeed } from '@/components/StandupFeed';
import { SprintProgressGraph } from './SprintProgressGraph';

const API_URL = import.meta.env.VITE_API_URL ?? '';

export interface SprintDetail {
  id: string;
  name: string;
  sprint_number: number;
  workspace_sprint_start_date: string;
  owner: { id: string; name: string; email: string } | null;
  issue_count: number;
  completed_count: number;
  goal: string | null;
}

export interface SprintIssue {
  id: string;
  title: string;
  state: string;
  priority: string;
  ticket_number: number;
  assignee_id: string | null;
  assignee_name: string | null;
  assignee_archived?: boolean;
  display_id: string;
  sprint_ref_id: string | null;
  estimate: number | null;
}

export interface SprintDetailViewProps {
  sprintId: string;
  programId: string;
  onIssueClick: (id: string) => void;
  onBack: () => void;
}

/**
 * SprintDetailView - Three-column layout showing sprint burndown, standups, and issues.
 * Used in both ProgramSprintsTab and ProjectSprintsTab for viewing sprint details.
 */
export function SprintDetailView({
  sprintId,
  programId,
  onIssueClick,
  onBack,
}: SprintDetailViewProps) {
  const [sprint, setSprint] = useState<SprintDetail | null>(null);
  const [issues, setIssues] = useState<SprintIssue[]>([]);
  const [loading, setLoading] = useState(true);

  const stateLabels: Record<string, string> = {
    backlog: 'Backlog',
    todo: 'Todo',
    in_progress: 'In Progress',
    done: 'Done',
    cancelled: 'Cancelled',
  };

  // Fetch sprint details and issues
  useEffect(() => {
    let cancelled = false;

    async function fetchSprintData() {
      try {
        const [sprintRes, issuesRes] = await Promise.all([
          fetch(`${API_URL}/api/sprints/${sprintId}`, { credentials: 'include' }),
          fetch(`${API_URL}/api/sprints/${sprintId}/issues`, { credentials: 'include' }),
        ]);

        if (cancelled) return;

        if (sprintRes.ok) {
          setSprint(await sprintRes.json());
        }
        if (issuesRes.ok) {
          setIssues(await issuesRes.json());
        }
      } catch (err) {
        console.error('Failed to fetch sprint data:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchSprintData();
    return () => { cancelled = true; };
  }, [sprintId]);

  // Calculate estimates
  const sprintEstimate = issues.reduce((sum, issue) => sum + (issue.estimate || 0), 0);
  const completedEstimate = issues
    .filter(issue => issue.state === 'done')
    .reduce((sum, issue) => sum + (issue.estimate || 0), 0);

  // Compute sprint dates from sprint_number
  const computeSprintDates = (sprintNumber: number, workspaceStartDate: string) => {
    const baseDate = new Date(workspaceStartDate);
    const sprintDuration = 7; // 1 week

    const startDate = new Date(baseDate);
    startDate.setDate(startDate.getDate() + (sprintNumber - 1) * sprintDuration);

    const endDate = new Date(startDate);
    endDate.setDate(endDate.getDate() + sprintDuration - 1);

    const now = new Date();
    let status: 'planning' | 'active' | 'completed' = 'planning';
    if (now >= startDate && now <= endDate) {
      status = 'active';
    } else if (now > endDate) {
      status = 'completed';
    }

    return { startDate: startDate.toISOString(), endDate: endDate.toISOString(), status };
  };

  if (loading || !sprint) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted">Loading sprint...</div>
      </div>
    );
  }

  const { startDate, endDate, status } = computeSprintDates(
    sprint.sprint_number,
    sprint.workspace_sprint_start_date
  );

  const progress = sprint.issue_count > 0
    ? Math.round((sprint.completed_count / sprint.issue_count) * 100)
    : 0;

  return (
    <div className="flex flex-col h-full">
      {/* Sprint header */}
      <div className="border-b border-border p-4">
        <div className="flex items-center gap-3 mb-3">
          <button
            onClick={onBack}
            className="text-muted hover:text-foreground transition-colors"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div className="flex-1">
            <h2 className="font-semibold text-foreground">{sprint.name}</h2>
            {sprint.owner && (
              <p className="text-sm text-muted">{sprint.owner.name}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex-1 h-2 rounded-full bg-border overflow-hidden">
            <div
              className="h-full bg-accent transition-all"
              style={{ width: `${progress}%` }}
            />
          </div>
          <span className="text-xs text-muted">
            {sprint.completed_count}/{sprint.issue_count} done
          </span>
        </div>
      </div>

      {/* Three-column layout: Burndown | Standup Feed | Issues */}
      <div className="flex flex-1 overflow-hidden">
        {/* Burndown Chart Column */}
        <div className="w-80 flex-shrink-0 border-r border-border overflow-auto p-4">
          <h3 className="text-sm font-medium text-foreground mb-3">Sprint Progress</h3>
          {sprintEstimate > 0 ? (
            <SprintProgressGraph
              startDate={startDate}
              endDate={endDate}
              scopeHours={sprintEstimate}
              completedHours={completedEstimate}
              status={status}
            />
          ) : (
            <div className="text-sm text-muted">No estimates yet</div>
          )}
          {sprint.goal && (
            <div className="mt-4">
              <h4 className="text-xs font-medium text-muted uppercase tracking-wider mb-1">Goal</h4>
              <p className="text-sm text-foreground">{sprint.goal}</p>
            </div>
          )}
        </div>

        {/* Standup Feed Column */}
        <div className="flex-1 border-r border-border overflow-hidden">
          <StandupFeed sprintId={sprintId} />
        </div>

        {/* Issues List Column */}
        <div className="flex-1 overflow-auto">
          {issues.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <p className="text-muted">No issues in this sprint</p>
            </div>
          ) : (
            <table className="w-full">
              <thead className="sticky top-0 bg-background border-b border-border">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted uppercase tracking-wider w-24">ID</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted uppercase tracking-wider">Title</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-muted uppercase tracking-wider w-32">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {issues.map((issue) => (
                  <tr
                    key={issue.id}
                    className="hover:bg-border/30 cursor-pointer transition-colors"
                    onClick={() => onIssueClick(issue.id)}
                  >
                    <td className="px-4 py-3 text-sm font-mono text-muted">
                      {issue.display_id}
                    </td>
                    <td className="px-4 py-3 text-sm text-foreground">
                      {issue.title}
                    </td>
                    <td className="px-4 py-3">
                      <span className={cn('rounded px-2 py-0.5 text-xs font-medium whitespace-nowrap', issueStatusColors[issue.state])}>
                        {stateLabels[issue.state] || issue.state}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
