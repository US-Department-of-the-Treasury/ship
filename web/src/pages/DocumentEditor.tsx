import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Editor } from '@/components/Editor';
import { useAuth } from '@/hooks/useAuth';
import { useDocuments, WikiDocument } from '@/contexts/DocumentsContext';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export function DocumentEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { documents, loading: documentsLoading, updateDocument: contextUpdateDocument, deleteDocument } = useDocuments();

  // State for non-wiki documents (fetched directly)
  const [directDocument, setDirectDocument] = useState<WikiDocument | null>(null);
  const [directLoading, setDirectLoading] = useState(false);

  // Get the current document from context first
  const contextDocument = documents.find(d => d.id === id) || null;

  // Fetch document directly if not in wiki context (e.g., person documents)
  useEffect(() => {
    if (!documentsLoading && id && !contextDocument) {
      setDirectLoading(true);
      fetch(`${API_URL}/api/documents/${id}`, { credentials: 'include' })
        .then(res => res.ok ? res.json() : null)
        .then(doc => {
          if (doc) {
            setDirectDocument(doc);
          } else {
            navigate('/docs');
          }
        })
        .catch(() => navigate('/docs'))
        .finally(() => setDirectLoading(false));
    }
  }, [documentsLoading, id, contextDocument, navigate]);

  // Use context document if available, otherwise use directly fetched document
  const document = contextDocument || directDocument;

  // Track last visited document for auto-open on /docs
  useEffect(() => {
    if (id && document) {
      localStorage.setItem('ship:lastVisitedDoc', id);
    }
  }, [id, document]);

  // Update handler - uses context for wiki docs, direct API for others
  const handleUpdateDocument = useCallback(async (updates: Partial<WikiDocument>) => {
    if (!id) return;
    if (contextDocument) {
      // Wiki document - use context
      await contextUpdateDocument(id, updates);
    } else {
      // Non-wiki document - use direct API call
      try {
        const res = await fetch(`${API_URL}/api/documents/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(updates),
        });
        if (res.ok) {
          const updated = await res.json();
          setDirectDocument(prev => prev ? { ...prev, ...updated } : null);
        }
      } catch (err) {
        console.error('Failed to update document:', err);
      }
    }
  }, [id, contextDocument, contextUpdateDocument]);

  // Debounce title updates with cleanup on unmount
  const [titleTimeout, setTitleTimeout] = useState<ReturnType<typeof setTimeout> | null>(null);

  // Clear timeout on unmount to prevent memory leak
  useEffect(() => {
    return () => {
      if (titleTimeout) clearTimeout(titleTimeout);
    };
  }, [titleTimeout]);

  const debouncedTitleChange = useCallback((newTitle: string) => {
    if (!newTitle) return;
    if (titleTimeout) clearTimeout(titleTimeout);
    setTitleTimeout(setTimeout(() => handleUpdateDocument({ title: newTitle }), 500));
  }, [handleUpdateDocument, titleTimeout]);

  // Delete current document
  const handleDelete = useCallback(async () => {
    if (!id || !document) return;
    if (!window.confirm('Are you sure you want to delete this document?')) return;

    const success = await deleteDocument(id);
    if (success) {
      // Navigate to parent or documents list
      if (document.parent_id) {
        navigate(`/docs/${document.parent_id}`);
      } else {
        navigate('/docs');
      }
    }
  }, [id, deleteDocument, document, navigate]);

  if (documentsLoading || directLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted">Loading...</div>
      </div>
    );
  }

  if (!document || !user) {
    return null;
  }

  // Navigate to parent document or documents list
  const handleBack = () => {
    if (document.parent_id) {
      navigate(`/docs/${document.parent_id}`);
    } else {
      navigate('/docs');
    }
  };

  // Get parent document title for breadcrumb
  const parentDocument = document.parent_id
    ? documents.find(d => d.id === document.parent_id)
    : null;

  return (
    <Editor
      documentId={document.id}
      userName={user.name}
      initialTitle={document.title}
      onTitleChange={debouncedTitleChange}
      onBack={handleBack}
      backLabel={parentDocument?.title || undefined}
      onDelete={handleDelete}
      sidebar={
        <div className="space-y-4 p-4">
          <p className="text-xs text-muted">Todo: Permissions, Maintainer, etc.</p>
        </div>
      }
    />
  );
}
