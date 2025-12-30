import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Editor } from '@/components/Editor';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/cn';

interface Sprint {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: 'planned' | 'active' | 'completed';
  project_id: string;
  project_name?: string;
  project_prefix?: string;
  issue_count: number;
  completed_count: number;
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const STATUS_OPTIONS = [
  { value: 'planned', label: 'Planned', color: 'bg-gray-500' },
  { value: 'active', label: 'Active', color: 'bg-blue-500' },
  { value: 'completed', label: 'Completed', color: 'bg-green-500' },
];

export function SprintEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [sprint, setSprint] = useState<Sprint | null>(null);
  const [loading, setLoading] = useState(true);

  // Fetch sprint with cancellation and state reset
  useEffect(() => {
    if (!id) return;

    // Reset state for new sprint
    setSprint(null);
    setLoading(true);

    let cancelled = false;

    async function fetchSprint() {
      try {
        const res = await fetch(`${API_URL}/api/sprints/${id}`, { credentials: 'include' });

        if (cancelled) return;

        if (res.ok) {
          setSprint(await res.json());
        } else if (res.status === 404) {
          navigate('/projects');
          return;
        }
      } catch (err) {
        if (!cancelled) console.error('Failed to fetch sprint:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    fetchSprint();
    return () => { cancelled = true; };
  }, [id, navigate]);

  const updateSprint = useCallback(async (updates: Partial<Sprint>) => {
    if (!id) return;
    try {
      const res = await fetch(`${API_URL}/api/sprints/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        const data = await res.json();
        setSprint(data);
      }
    } catch (err) {
      console.error('Failed to update sprint:', err);
    }
  }, [id]);

  const handleTitleChange = useCallback((newTitle: string) => {
    updateSprint({ title: newTitle } as any);
  }, [updateSprint]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted">Loading...</div>
      </div>
    );
  }

  if (!sprint || !user) {
    return null;
  }

  const progress = sprint.issue_count > 0
    ? Math.round((sprint.completed_count / sprint.issue_count) * 100)
    : 0;

  return (
    <Editor
      documentId={sprint.id}
      userName={user.name}
      initialTitle={sprint.name}
      onTitleChange={handleTitleChange}
      onBack={() => navigate(sprint.project_id ? `/projects/${sprint.project_id}` : '/projects')}
      roomPrefix="sprint"
      placeholder="Add sprint goals, notes, or description..."
      headerBadge={
        <span className={cn(
          'rounded px-1.5 py-0.5 text-[10px] font-medium uppercase text-white',
          STATUS_OPTIONS.find(s => s.value === sprint.status)?.color || 'bg-gray-500'
        )}>
          {sprint.status}
        </span>
      }
      sidebar={
        <div className="space-y-4 p-4">
          <PropertyRow label="Status">
              <select
                value={sprint.status}
                onChange={(e) => updateSprint({ sprint_status: e.target.value } as any)}
                className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:border-accent focus:outline-none"
              >
                {STATUS_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </PropertyRow>

            <PropertyRow label="Start Date">
              <input
                type="date"
                value={sprint.start_date}
                onChange={(e) => updateSprint({ start_date: e.target.value })}
                className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:border-accent focus:outline-none"
              />
            </PropertyRow>

            <PropertyRow label="End Date">
              <input
                type="date"
                value={sprint.end_date}
                onChange={(e) => updateSprint({ end_date: e.target.value })}
                className="w-full rounded border border-border bg-background px-2 py-1.5 text-sm text-foreground focus:border-accent focus:outline-none"
              />
            </PropertyRow>

            <PropertyRow label="Progress">
              <div className="space-y-1">
                <div className="h-2 w-full overflow-hidden rounded-full bg-border">
                  <div
                    className="h-full bg-accent transition-all"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <p className="text-xs text-muted">
                  {sprint.completed_count} of {sprint.issue_count} issues completed ({progress}%)
                </p>
              </div>
            </PropertyRow>

            {sprint.project_name && (
              <PropertyRow label="Project">
                <button
                  onClick={() => navigate(`/projects/${sprint.project_id}`)}
                  className="w-full rounded bg-border/50 px-2 py-1.5 text-left text-sm text-foreground hover:bg-border transition-colors"
                >
                  {sprint.project_name}
                </button>
              </PropertyRow>
            )}

            <div className="border-t border-border pt-4">
              <button
                onClick={() => navigate(`/sprints/${sprint.id}/view`)}
                className="w-full rounded-md bg-border px-3 py-2 text-sm text-foreground hover:bg-border/80 transition-colors"
              >
                View Sprint Issues
              </button>
            </div>
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
