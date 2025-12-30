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
  const { documents, loading: documentsLoading, updateDocument: contextUpdateDocument, createDocument, deleteDocument } = useDocuments();

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

  // Create sub-document (child of current document)
  const handleCreateSubDocument = useCallback(async () => {
    if (!document) return null;
    const newDoc = await createDocument(document.id);
    return newDoc;
  }, [createDocument, document]);

  // Navigate to a document (for slash commands)
  const handleNavigateToDocument = useCallback((docId: string) => {
    navigate(`/docs/${docId}`);
  }, [navigate]);

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
      onCreateSubDocument={handleCreateSubDocument}
      onNavigateToDocument={handleNavigateToDocument}
      onDelete={handleDelete}
      sidebar={
        <div className="space-y-4 p-4">
          <p className="text-xs text-muted">Todo: Permissions, Maintainer, etc.</p>
        </div>
      }
    />
  );
}
