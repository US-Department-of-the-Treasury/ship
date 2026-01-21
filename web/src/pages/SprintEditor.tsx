import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Editor } from '@/components/Editor';
import { useAuth } from '@/hooks/useAuth';
import { useDocuments } from '@/contexts/DocumentsContext';
import { EditorSkeleton } from '@/components/ui/Skeleton';
import { useAutoSave } from '@/hooks/useAutoSave';
import { IncompleteDocumentBanner } from '@/components/IncompleteDocumentBanner';
import { SprintSidebar } from '@/components/sidebars/SprintSidebar';
import { cn } from '@/lib/cn';

interface Sprint {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
  status: 'planning' | 'active' | 'completed';
  program_id: string | null;
  program_name?: string;
  program_prefix?: string;
  issue_count: number;
  completed_count: number;
  is_complete: boolean | null;
  missing_fields: string[];
  hypothesis?: string;
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

  return (
    <div className="flex h-full flex-col">
      {/* Incomplete document warning banner */}
      <IncompleteDocumentBanner
        documentId={sprint.id}
        isComplete={sprint.is_complete}
        missingFields={sprint.missing_fields}
      />

      <div className="flex-1 overflow-hidden">
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
          'rounded px-1.5 py-0.5 text-[10px] font-medium uppercase text-white whitespace-nowrap',
          STATUS_OPTIONS.find(s => s.value === sprint.status)?.color || 'bg-gray-500'
        )}>
          {sprint.status}
        </span>
      }
      sidebar={
        <SprintSidebar
          sprint={sprint}
          onUpdate={updateSprint}
          highlightedFields={sprint.missing_fields}
        />
      }
    />
      </div>
    </div>
  );
}
