import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Editor } from '@/components/Editor';
import { useAuth } from '@/hooks/useAuth';
import { useIssues, Issue } from '@/contexts/IssuesContext';
import { Combobox } from '@/components/ui/Combobox';
import { EditorSkeleton } from '@/components/ui/Skeleton';

interface TeamMember {
  id: string;
  name: string;
}

interface Program {
  id: string;
  name: string;
  prefix: string;
  color: string;
}

interface Sprint {
  id: string;
  name: string;
  status: string;
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

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
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [programs, setPrograms] = useState<Program[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [relatedDataLoading, setRelatedDataLoading] = useState(true);

  // Get the current issue from context
  const issue = issues.find(i => i.id === id) || null;

  // Fetch related data (programs, team members) with cancellation
  useEffect(() => {
    if (!id) return;

    // Reset state for new issue
    setPrograms([]);
    setTeamMembers([]);
    setSprints([]);
    setRelatedDataLoading(true);

    let cancelled = false;

    async function fetchRelatedData() {
      try {
        const [programsRes, userRes] = await Promise.all([
          fetch(`${API_URL}/api/programs`, { credentials: 'include' }),
          fetch(`${API_URL}/api/auth/me`, { credentials: 'include' }),
        ]);

        if (cancelled) return;

        if (programsRes.ok) {
          setPrograms(await programsRes.json());
        }

        if (userRes.ok) {
          const userData = await userRes.json();
          setTeamMembers([{ id: userData.id, name: userData.name }]);
        }
      } catch (err) {
        if (!cancelled) console.error('Failed to fetch related data:', err);
      } finally {
        if (!cancelled) setRelatedDataLoading(false);
      }
    }

    fetchRelatedData();
    return () => { cancelled = true; };
  }, [id]);

  // Fetch sprints when issue's program changes with cancellation
  useEffect(() => {
    if (!issue?.program_id) {
      setSprints([]);
      return;
    }

    let cancelled = false;

    fetch(`${API_URL}/api/programs/${issue.program_id}/sprints`, { credentials: 'include' })
      .then(res => res.ok ? res.json() : [])
      .then(data => { if (!cancelled) setSprints(data); })
      .catch(() => { if (!cancelled) setSprints([]); });

    return () => { cancelled = true; };
  }, [issue?.program_id]);

  // Redirect if issue not found after loading
  useEffect(() => {
    if (!issuesLoading && id && !issue) {
      navigate('/issues');
    }
  }, [issuesLoading, id, issue, navigate]);

  // Update handler using shared context
  const handleUpdateIssue = useCallback(async (updates: Partial<Issue>) => {
    if (!id) return;
    await contextUpdateIssue(id, updates);
  }, [id, contextUpdateIssue]);

  const handleTitleChange = useCallback((newTitle: string) => {
    handleUpdateIssue({ title: newTitle });
  }, [handleUpdateIssue]);

  const loading = issuesLoading || relatedDataLoading;

  if (loading) {
    return <EditorSkeleton />;
  }

  if (!issue || !user) {
    return null;
  }

  const handleProgramChange = async (programId: string | null) => {
    await handleUpdateIssue({ program_id: programId, sprint_id: null } as Partial<Issue>);
    // Sprints will be fetched automatically via the useEffect when issue.program_id changes
  };

  return (
    <Editor
      documentId={issue.id}
      userName={user.name}
      initialTitle={issue.title}
      onTitleChange={handleTitleChange}
      onBack={() => navigate('/issues')}
      roomPrefix="issue"
      placeholder="Add a description..."
      headerBadge={
        <span className="rounded bg-border px-2 py-0.5 text-xs font-mono font-medium text-muted">
          {issue.display_id}
        </span>
      }
      sidebar={
        <div className="space-y-4 p-4">
          <PropertyRow label="Status">
              <select
                value={issue.state}
                onChange={(e) => handleUpdateIssue({ state: e.target.value })}
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
                value={issue.priority}
                onChange={(e) => handleUpdateIssue({ priority: e.target.value })}
                className="w-full rounded bg-border px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
              >
                {PRIORITIES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </PropertyRow>

            <PropertyRow label="Assignee">
              <Combobox
                options={teamMembers.map((m) => ({ value: m.id, label: m.name }))}
                value={issue.assignee_id}
                onChange={(value) => handleUpdateIssue({ assignee_id: value })}
                placeholder="Unassigned"
                clearLabel="Unassigned"
                searchPlaceholder="Search people..."
                emptyText="No people found"
              />
            </PropertyRow>

            <PropertyRow label="Program">
              <Combobox
                options={programs.map((p) => ({ value: p.id, label: p.name, description: p.prefix }))}
                value={issue.program_id}
                onChange={handleProgramChange}
                placeholder="No Program"
                clearLabel="No Program"
                searchPlaceholder="Search programs..."
                emptyText="No programs found"
              />
            </PropertyRow>

            {issue.program_id && (
              <PropertyRow label="Sprint">
                <Combobox
                  options={sprints.map((s) => ({ value: s.id, label: s.name, description: s.status }))}
                  value={issue.sprint_id}
                  onChange={(value) => handleUpdateIssue({ sprint_id: value })}
                  placeholder="No Sprint"
                  clearLabel="No Sprint"
                  searchPlaceholder="Search sprints..."
                  emptyText="No sprints found"
                />
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
