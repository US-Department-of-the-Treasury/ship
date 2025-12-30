import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Editor } from '@/components/Editor';
import { useAuth } from '@/hooks/useAuth';

interface Issue {
  id: string;
  title: string;
  state: string;
  priority: string;
  ticket_number: number;
  assignee_id: string | null;
  assignee_name: string | null;
}

interface TeamMember {
  id: string;
  name: string;
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
  const [issue, setIssue] = useState<Issue | null>(null);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);

  // Fetch issue
  useEffect(() => {
    if (id) {
      fetchIssue();
      fetchTeamMembers();
    }
  }, [id]);

  async function fetchIssue() {
    try {
      const res = await fetch(`${API_URL}/api/issues/${id}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setIssue(data);
      } else if (res.status === 404) {
        navigate('/issues');
      }
    } catch (err) {
      console.error('Failed to fetch issue:', err);
    } finally {
      setLoading(false);
    }
  }

  async function fetchTeamMembers() {
    try {
      const res = await fetch(`${API_URL}/api/auth/me`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        // For now, just use the current user as team member
        setTeamMembers([{ id: data.id, name: data.name }]);
      }
    } catch (err) {
      console.error('Failed to fetch team:', err);
    }
  }

  // Update handlers
  const updateIssue = useCallback(async (updates: Partial<Issue>) => {
    if (!id) return;
    try {
      const res = await fetch(`${API_URL}/api/issues/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        const data = await res.json();
        setIssue(data);
      }
    } catch (err) {
      console.error('Failed to update issue:', err);
    }
  }, [id]);

  const handleTitleChange = useCallback((newTitle: string) => {
    updateIssue({ title: newTitle });
  }, [updateIssue]);

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
        <span className="rounded bg-border px-2 py-0.5 text-xs font-medium text-muted">
          #{issue.ticket_number}
        </span>
      }
      sidebar={
        <aside className="w-64 border-l border-border p-4">
          <div className="space-y-4">
            <PropertyRow label="Status">
              <select
                value={issue.state}
                onChange={(e) => updateIssue({ state: e.target.value })}
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
                onChange={(e) => updateIssue({ priority: e.target.value })}
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
                onChange={(e) => updateIssue({ assignee_id: e.target.value || null })}
                className="w-full rounded bg-border px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="">Unassigned</option>
                {teamMembers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </PropertyRow>
          </div>
        </aside>
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
