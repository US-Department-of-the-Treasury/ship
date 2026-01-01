import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

const API_URL = import.meta.env.VITE_API_URL ?? '';

interface Backlink {
  id: string;
  document_type: string;
  title: string;
  display_id?: string;
}

interface BacklinksPanelProps {
  documentId: string;
}

export function BacklinksPanel({ documentId }: BacklinksPanelProps) {
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!documentId) return;

    let cancelled = false;

    async function fetchBacklinks() {
      try {
        setLoading(true);
        setError(null);

        const response = await fetch(`${API_URL}/api/documents/${documentId}/backlinks`, {
          credentials: 'include',
        });

        if (!response.ok) {
          throw new Error('Failed to fetch backlinks');
        }

        const data = await response.json();

        if (!cancelled) {
          setBacklinks(data);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Error fetching backlinks:', err);
          setError('Failed to load backlinks');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchBacklinks();

    return () => {
      cancelled = true;
    };
  }, [documentId]);

  const handleNavigate = (backlink: Backlink) => {
    // Navigate based on document type
    switch (backlink.document_type) {
      case 'issue':
        navigate(`/issues/${backlink.id}`);
        break;
      case 'wiki':
        navigate(`/docs/${backlink.id}`);
        break;
      case 'program':
        navigate(`/programs/${backlink.id}`);
        break;
      case 'sprint':
        navigate(`/sprints/${backlink.id}`);
        break;
      case 'person':
        navigate(`/team/${backlink.id}`);
        break;
      case 'sprint_plan':
      case 'sprint_retro':
        navigate(`/docs/${backlink.id}`);
        break;
      default:
        navigate(`/docs/${backlink.id}`);
    }
  };

  const getDocumentTypeLabel = (type: string): string => {
    const labels: Record<string, string> = {
      wiki: 'Doc',
      issue: 'Issue',
      program: 'Program',
      project: 'Project',
      sprint: 'Sprint',
      person: 'Person',
      sprint_plan: 'Sprint Plan',
      sprint_retro: 'Sprint Retro',
    };
    return labels[type] || type;
  };

  if (loading) {
    return (
      <div className="space-y-2 p-4">
        <h3 className="text-xs font-medium text-muted">Backlinks</h3>
        <div className="text-xs text-muted">Loading...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-2 p-4">
        <h3 className="text-xs font-medium text-muted">Backlinks</h3>
        <div className="text-xs text-red-500">{error}</div>
      </div>
    );
  }

  return (
    <div className="space-y-2 p-4">
      <h3 className="text-xs font-medium text-muted">Backlinks</h3>

      {backlinks.length === 0 ? (
        <div className="text-xs text-muted">No backlinks</div>
      ) : (
        <div className="space-y-1">
          {backlinks.map((backlink) => (
            <button
              key={backlink.id}
              onClick={() => handleNavigate(backlink)}
              className="w-full rounded px-2 py-1.5 text-left text-xs hover:bg-border transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="rounded bg-border px-1.5 py-0.5 text-[10px] font-medium text-muted">
                  {getDocumentTypeLabel(backlink.document_type)}
                </span>
                {backlink.display_id && (
                  <span className="font-mono text-[10px] text-muted">
                    {backlink.display_id}
                  </span>
                )}
              </div>
              <div className="mt-0.5 truncate text-foreground">
                {backlink.title || 'Untitled'}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
