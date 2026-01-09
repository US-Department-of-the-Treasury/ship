import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Editor } from '@/components/Editor';
import { useAuth } from '@/hooks/useAuth';
import { useDocuments } from '@/contexts/DocumentsContext';
import { cn } from '@/lib/cn';
import { EditorSkeleton } from '@/components/ui/Skeleton';
import { useAutoSave } from '@/hooks/useAutoSave';

interface Sprint {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: 'planned' | 'active' | 'completed';
  program_id: string;
  program_name?: string;
  program_prefix?: string;
  issue_count: number;
  completed_count: number;
}

const API_URL = import.meta.env.VITE_API_URL ?? '';

const STATUS_OPTIONS = [
  { value: 'planned', label: 'Planned', color: 'bg-gray-500' },
  { value: 'active', label: 'Active', color: 'bg-blue-500' },
  { value: 'completed', label: 'Completed', color: 'bg-green-500' },
];

export function SprintEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { createDocument } = useDocuments();
  const [sprint, setSprint] = useState<Sprint | null>(null);
  const [loading, setLoading] = useState(true);

  // Create sub-document (for slash commands) - creates a wiki doc linked to this sprint
  const handleCreateSubDocument = useCallback(async () => {
    if (!id) return null;
    const newDoc = await createDocument(id);
    if (newDoc) {
      return { id: newDoc.id, title: newDoc.title };
    }
    return null;
  }, [createDocument, id]);

  // Navigate to document (for slash commands and mentions)
  const handleNavigateToDocument = useCallback((docId: string) => {
    navigate(`/docs/${docId}`);
  }, [navigate]);

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
          navigate('/programs');
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

  // Throttled title save with stale response handling
  const throttledTitleSave = useAutoSave({
    onSave: async (name: string) => {
      if (name) await updateSprint({ name });
    },
  });

  if (loading) {
    return <EditorSkeleton />;
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
      onTitleChange={throttledTitleSave}
      onBack={() => navigate(sprint.program_id ? `/programs/${sprint.program_id}` : '/programs')}
      roomPrefix="sprint"
      placeholder="Add sprint goals, notes, or description..."
      onCreateSubDocument={handleCreateSubDocument}
      onNavigateToDocument={handleNavigateToDocument}
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

            {sprint.program_name && (
              <PropertyRow label="Program">
                <button
                  onClick={() => navigate(`/programs/${sprint.program_id}`)}
                  className="w-full rounded bg-border/50 px-2 py-1.5 text-left text-sm text-foreground hover:bg-border transition-colors"
                >
                  {sprint.program_name}
                </button>
              </PropertyRow>
            )}

            <div className="border-t border-border pt-4">
              <button
                onClick={() => navigate(`/sprints/${sprint.id}/view`)}
                className="w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors"
              >
                Plan Sprint
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
