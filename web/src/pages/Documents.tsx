import { useState, useMemo, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDocuments } from '@/contexts/DocumentsContext';
import { buildDocumentTree } from '@/lib/documentTree';
import { DocumentTreeItem } from '@/components/DocumentTreeItem';
import { DocumentsListSkeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/cn';

export function DocumentsPage() {
  const { documents, loading, createDocument } = useDocuments();
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();

  // Auto-redirect to last visited document or "Welcome to Ship"
  useEffect(() => {
    if (loading || documents.length === 0) return;

    // Check for last visited document
    const lastVisitedId = localStorage.getItem('ship:lastVisitedDoc');
    if (lastVisitedId && documents.some(d => d.id === lastVisitedId)) {
      navigate(`/docs/${lastVisitedId}`, { replace: true });
      return;
    }

    // Fall back to "Welcome to Ship" document
    const welcomeDoc = documents.find(d => d.title === 'Welcome to Ship');
    if (welcomeDoc) {
      navigate(`/docs/${welcomeDoc.id}`, { replace: true });
      return;
    }

    // Fall back to first document
    navigate(`/docs/${documents[0].id}`, { replace: true });
  }, [loading, documents, navigate]);

  // Build tree structure from flat documents
  const documentTree = useMemo(() => buildDocumentTree(documents), [documents]);

  async function handleCreateDocument(parentId?: string) {
    setCreating(true);
    try {
      const doc = await createDocument(parentId);
      if (doc) {
        navigate(`/docs/${doc.id}`);
      }
    } finally {
      setCreating(false);
    }
  }

  if (loading) {
    return <DocumentsListSkeleton />;
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-lg font-medium text-foreground">Documents</h1>
        <button
          onClick={() => handleCreateDocument()}
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

      {/* Document tree */}
      {documents.length === 0 ? (
        <div className="flex h-64 items-center justify-center">
          <div className="text-center">
            <p className="text-muted">No documents yet</p>
            <p className="mt-1 text-sm text-muted">
              Create your first document to get started
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-0.5">
          {documentTree.map((doc) => (
            <DocumentTreeItem
              key={doc.id}
              document={doc}
              onCreateChild={handleCreateDocument}
            />
          ))}
        </div>
      )}
    </div>
  );
}
