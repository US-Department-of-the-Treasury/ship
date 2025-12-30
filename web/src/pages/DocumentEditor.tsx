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
  const { documents, loading: documentsLoading, updateDocument: contextUpdateDocument } = useDocuments();

  // Get the current document from context
  const document = documents.find(d => d.id === id) || null;

  // Redirect if document not found after loading
  useEffect(() => {
    if (!documentsLoading && id && !document) {
      navigate('/docs');
    }
  }, [documentsLoading, id, document, navigate]);

  // Update handler using shared context
  const handleUpdateDocument = useCallback(async (updates: Partial<WikiDocument>) => {
    if (!id) return;
    await contextUpdateDocument(id, updates);
  }, [id, contextUpdateDocument]);

  // Debounce title updates
  const [titleTimeout, setTitleTimeout] = useState<ReturnType<typeof setTimeout> | null>(null);
  const debouncedTitleChange = useCallback((newTitle: string) => {
    if (!newTitle) return;
    if (titleTimeout) clearTimeout(titleTimeout);
    setTitleTimeout(setTimeout(() => handleUpdateDocument({ title: newTitle }), 500));
  }, [handleUpdateDocument, titleTimeout]);

  if (documentsLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted">Loading...</div>
      </div>
    );
  }

  if (!document || !user) {
    return null;
  }

  return (
    <Editor
      documentId={document.id}
      userName={user.name}
      initialTitle={document.title}
      onTitleChange={debouncedTitleChange}
      onBack={() => navigate('/docs')}
      sidebar={
        <div className="space-y-4 p-4">
          <p className="text-xs text-muted">Todo: Permissions, Maintainer, etc.</p>
        </div>
      }
    />
  );
}
