import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Editor } from '@/components/Editor';
import { useAuth } from '@/hooks/useAuth';
import { useIssues, Issue } from '@/contexts/IssuesContext';
import { Combobox } from '@/components/ui/Combobox';
import { EditorSkeleton } from '@/components/ui/Skeleton';
import { useAutoSave } from '@/hooks/useAutoSave';
import { useProgramsQuery } from '@/hooks/useProgramsQuery';
import { useTeamMembersQuery } from '@/hooks/useTeamMembersQuery';

interface Sprint {
  id: string;
  name: string;
  status: string;
}

const API_URL = import.meta.env.VITE_API_URL ?? '';

// Map Program from query to the format needed by combobox
interface ProgramOption {
  id: string;
  name: string;
  prefix: string;
  color: string;
}

const STATES = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'todo', label: 'Todo' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'done', label: 'Done' },
  { value: 'cancelled', label: 'Cancelled' },
];

const PRIORITIES = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
  { value: 'none', label: 'No Priority' },
];

export function IssueEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { issues, loading: issuesLoading, updateIssue: contextUpdateIssue } = useIssues();
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [sprintError, setSprintError] = useState<string | null>(null);

  // Use TanStack Query for programs and team members (supports offline via cache)
  const { data: programsData = [], isLoading: programsLoading } = useProgramsQuery();
  const { data: teamMembersData = [], isLoading: teamMembersLoading } = useTeamMembersQuery();

  // Map programs to the format needed by combobox
  const programs: ProgramOption[] = programsData.map(p => ({
    id: p.id,
    name: p.name,
    prefix: p.name.substring(0, 3).toUpperCase(), // Generate prefix from name
    color: p.color,
  }));

  // Map team members to format with user_id
  const teamMembers = teamMembersData.map(m => ({
    id: m.id,
    user_id: m.user_id,
    name: m.name,
  }));

  // Get the current issue from context
  const issue = issues.find(i => i.id === id) || null;

  // Fetch sprints when issue's program changes with cancellation
  useEffect(() => {
    if (!issue?.program_id) {
      setSprints([]);
      return;
    }

    let cancelled = false;

    fetch(`${API_URL}/api/programs/${issue.program_id}/sprints`, { credentials: 'include' })
      .then(res => res.ok ? res.json() : { sprints: [] })
      .then(data => { if (!cancelled) setSprints(data.sprints || []); })
      .catch(() => { if (!cancelled) setSprints([]); });

    return () => { cancelled = true; };
  }, [issue?.program_id]);

  // Redirect if issue not found after loading
  // Skip redirect for temp IDs (pending offline creation) - give cache time to sync
  useEffect(() => {
    if (!issuesLoading && id && !issue && !id.startsWith('temp-')) {
      navigate('/issues');
    }
  }, [issuesLoading, id, issue, navigate]);

  // Update handler using shared context
  const handleUpdateIssue = useCallback(async (updates: Partial<Issue>) => {
    if (!id) return;
    await contextUpdateIssue(id, updates);
  }, [id, contextUpdateIssue]);

  // Throttled title save with stale response handling
  const throttledTitleSave = useAutoSave({
    onSave: async (title: string) => {
      if (title) await handleUpdateIssue({ title });
    },
  });

  // Only wait for issues to load - programs/team can load in background
  // This allows the page to render with cached data when offline
  const loading = issuesLoading;

  if (loading) {
    return <EditorSkeleton />;
  }

  // For temp IDs (offline-created issues), create a placeholder issue while waiting for cache sync
  const displayIssue = issue || (id?.startsWith('temp-') ? {
    id: id,
    title: 'Untitled',
    state: 'backlog',
    priority: 'none',
    ticket_number: -1,
    display_id: 'PENDING',
    assignee_id: null,
    assignee_name: null,
    estimate: null,
    program_id: null,
    sprint_id: null,
    program_name: null,
    program_prefix: null,
    sprint_name: null,
    source: 'internal' as const,
    rejection_reason: null,
    _pending: true,
  } : null);

  if (!displayIssue || !user) {
    return null;
  }

  const handleProgramChange = async (programId: string | null) => {
    await handleUpdateIssue({ program_id: programId, sprint_id: null } as Partial<Issue>);
    // Sprints will be fetched automatically via the useEffect when issue.program_id changes
  };

  return (
    <Editor
      documentId={displayIssue.id}
      userName={user.name}
      initialTitle={displayIssue.title}
      onTitleChange={throttledTitleSave}
      onBack={() => navigate('/issues')}
      roomPrefix="issue"
      placeholder="Add a description..."
      headerBadge={
        <span className="rounded bg-border px-2 py-0.5 text-xs font-mono font-medium text-muted" data-testid="ticket-number">
          {displayIssue.display_id}
        </span>
      }
      sidebar={
        <div className="space-y-4 p-4">
          <PropertyRow label="Status">
              <select
                value={displayIssue.state}
                onChange={(e) => handleUpdateIssue({ state: e.target.value })}
                aria-label="Status"
                className="w-full rounded bg-border px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
              >
                {STATES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </PropertyRow>

            <PropertyRow label="Priority">
              <select
                value={displayIssue.priority}
                onChange={(e) => handleUpdateIssue({ priority: e.target.value })}
                aria-label="Priority"
                className="w-full rounded bg-border px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
              >
                {PRIORITIES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </PropertyRow>

            <PropertyRow label="Estimate">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  placeholder="—"
                  aria-label="Estimate in hours"
                  value={displayIssue.estimate ?? ''}
                  onChange={(e) => {
                    const value = e.target.value ? parseFloat(e.target.value) : null;
                    handleUpdateIssue({ estimate: value });
                    if (value) setSprintError(null);
                  }}
                  className="w-20 rounded bg-border px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                />
                <span className="text-xs text-muted">hours</span>
              </div>
            </PropertyRow>

            <PropertyRow label="Assignee">
              <Combobox
                options={teamMembers.map((m) => ({ value: m.user_id, label: m.name }))}
                value={displayIssue.assignee_id}
                onChange={(value) => handleUpdateIssue({ assignee_id: value })}
                placeholder="Unassigned"
                clearLabel="Unassigned"
                searchPlaceholder="Search people..."
                emptyText="No people found"
                aria-label="Assignee"
              />
            </PropertyRow>

            <PropertyRow label="Program">
              <Combobox
                options={programs.map((p) => ({ value: p.id, label: p.name, description: p.prefix }))}
                value={displayIssue.program_id}
                onChange={handleProgramChange}
                placeholder="No Program"
                clearLabel="No Program"
                searchPlaceholder="Search programs..."
                emptyText="No programs found"
                aria-label="Program"
              />
            </PropertyRow>

            {displayIssue.program_id && (
              <PropertyRow label="Sprint">
                <Combobox
                  options={sprints.map((s) => ({ value: s.id, label: s.name, description: s.status }))}
                  value={displayIssue.sprint_id}
                  onChange={(value) => {
                    if (value && !displayIssue.estimate) {
                      setSprintError('Please add an estimate before assigning to a sprint');
                      return;
                    }
                    setSprintError(null);
                    handleUpdateIssue({ sprint_id: value });
                  }}
                  placeholder="No Sprint"
                  clearLabel="No Sprint"
                  searchPlaceholder="Search sprints..."
                  emptyText="No sprints found"
                  aria-label="Sprint"
                />
                {sprintError && (
                  <p className="mt-1 text-xs text-red-500">{sprintError}</p>
                )}
              </PropertyRow>
            )}
        </div>
      }
    />
  );
}

function PropertyRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted">{label}</label>
      {children}
    </div>
  );
}
