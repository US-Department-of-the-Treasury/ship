import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDocuments } from '@/contexts/DocumentsContext';
import { cn } from '@/lib/cn';

export function DocumentsPage() {
  const { documents, loading, createDocument } = useDocuments();
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  async function handleCreateDocument() {
    setCreating(true);
    try {
      const doc = await createDocument();
      if (doc) {
        navigate(`/docs/${doc.id}`);
      }
    } finally {
      setCreating(false);
    }
  }

  function formatDate(dateStr: string) {
    const date = new Date(dateStr);
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted">Loading...</div>
      </div>
    );
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-lg font-medium text-foreground">Documents</h1>
        <button
          onClick={handleCreateDocument}
          disabled={creating}
          className={cn(
            'rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white',
            'transition-colors hover:bg-accent/90',
            'disabled:opacity-50',
            'focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-background'
          )}
        >
          {creating ? 'Creating...' : 'New Document'}
        </button>
      </div>

      {/* Document list */}
      {documents.length === 0 ? (
        <div className="flex h-64 items-center justify-center">
          <div className="text-center">
            <p className="text-muted">No documents yet</p>
            <p className="mt-1 text-sm text-muted/60">
              Create your first document to get started
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-1">
          {documents.map((doc) => (
            <button
              key={doc.id}
              onClick={() => navigate(`/docs/${doc.id}`)}
              className={cn(
                'flex w-full items-center justify-between rounded-md px-3 py-2',
                'text-left transition-colors',
                'hover:bg-border/30',
                'focus:outline-none focus:ring-2 focus:ring-accent focus:ring-inset'
              )}
            >
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded bg-border/30">
                  <svg
                    className="h-4 w-4 text-muted"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={1.5}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                    />
                  </svg>
                </div>
                <span className="text-sm text-foreground">{doc.title || 'Untitled'}</span>
              </div>
              <span className="text-xs text-muted">{formatDate(doc.updated_at)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
