import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Editor } from '@/components/Editor';
import { useAuth } from '@/hooks/useAuth';
import { useIssues, Issue } from '@/contexts/IssuesContext';

interface TeamMember {
  id: string;
  name: string;
}

interface Project {
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
  const [projects, setProjects] = useState<Project[]>([]);
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [relatedDataLoading, setRelatedDataLoading] = useState(true);

  // Get the current issue from context
  const issue = issues.find(i => i.id === id) || null;

  // Fetch related data (projects, team members) with cancellation
  useEffect(() => {
    if (!id) return;

    // Reset state for new issue
    setProjects([]);
    setTeamMembers([]);
    setSprints([]);
    setRelatedDataLoading(true);

    let cancelled = false;

    async function fetchRelatedData() {
      try {
        const [projectsRes, userRes] = await Promise.all([
          fetch(`${API_URL}/api/projects`, { credentials: 'include' }),
          fetch(`${API_URL}/api/auth/me`, { credentials: 'include' }),
        ]);

        if (cancelled) return;

        if (projectsRes.ok) {
          setProjects(await projectsRes.json());
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

  // Fetch sprints when issue's project changes with cancellation
  useEffect(() => {
    if (!issue?.project_id) {
      setSprints([]);
      return;
    }

    let cancelled = false;

    fetch(`${API_URL}/api/projects/${issue.project_id}/sprints`, { credentials: 'include' })
      .then(res => res.ok ? res.json() : [])
      .then(data => { if (!cancelled) setSprints(data); })
      .catch(() => { if (!cancelled) setSprints([]); });

    return () => { cancelled = true; };
  }, [issue?.project_id]);

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
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted">Loading...</div>
      </div>
    );
  }

  if (!issue || !user) {
    return null;
  }

  const handleProjectChange = async (projectId: string | null) => {
    await handleUpdateIssue({ project_id: projectId, sprint_id: null } as Partial<Issue>);
    // Sprints will be fetched automatically via the useEffect when issue.project_id changes
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
              <select
                value={issue.assignee_id || ''}
                onChange={(e) => handleUpdateIssue({ assignee_id: e.target.value || null })}
                className="w-full rounded bg-border px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option key="unassigned" value="">Unassigned</option>
                {teamMembers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </PropertyRow>

            <PropertyRow label="Project">
              <select
                value={issue.project_id || ''}
                onChange={(e) => handleProjectChange(e.target.value || null)}
                className="w-full rounded bg-border px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option key="no-project" value="">No Project</option>
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.prefix} - {p.name}
                  </option>
                ))}
              </select>
            </PropertyRow>

            {issue.project_id && (
              <PropertyRow label="Sprint">
                <select
                  value={issue.sprint_id || ''}
                  onChange={(e) => handleUpdateIssue({ sprint_id: e.target.value || null })}
                  className="w-full rounded bg-border px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                >
                  <option key="no-sprint" value="">No Sprint</option>
                  {sprints.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name} ({s.status})
                    </option>
                  ))}
                </select>
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
