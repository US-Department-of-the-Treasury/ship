import { useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Editor } from '@/components/Editor';
import { useAuth } from '@/hooks/useAuth';
import { useDocuments, WikiDocument } from '@/contexts/DocumentsContext';
import { useAutoSave } from '@/hooks/useAutoSave';
import { PersonCombobox } from '@/components/PersonCombobox';
import { VisibilityDropdown } from '@/components/VisibilityDropdown';
import { BacklinksPanel } from '@/components/editor/BacklinksPanel';
import { useAssignableMembersQuery } from '@/hooks/useTeamMembersQuery';
import { getIsOnline } from '@/lib/queryClient';

export function DocumentEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { documents, loading: documentsLoading, createDocument, updateDocument: contextUpdateDocument, deleteDocument, refreshDocuments } = useDocuments();

  // Use TanStack Query for team members (supports offline via cache)
  // Use assignable members only - pending users can't own documents
  const { data: teamMembersData = [] } = useAssignableMembersQuery();
  const teamMembers = teamMembersData.map(m => ({
    id: m.id,
    user_id: m.user_id,
    name: m.name,
    email: m.email || '',
  }));

  // Get the current document from context (TanStack Query cache)
  const contextDocument = documents.find(d => d.id === id) || null;

  // Track the latest contextDocument in a ref for async timeout checks
  const contextDocumentRef = useRef(contextDocument);
  contextDocumentRef.current = contextDocument;

  // Track if we've already tried to refresh for this document ID
  const hasTriedRefreshRef = useRef<string | null>(null);

  // Redirect if document not found after loading
  // Skip redirect for temp IDs (pending offline creation) - give cache time to sync
  // Skip redirect when offline - document might be in cache but API call would fail
  // First try refreshing the documents list before redirecting
  useEffect(() => {
    const shouldHandleMissingDocument = !documentsLoading && id && !contextDocument && !id.startsWith('temp-') && getIsOnline();

    if (shouldHandleMissingDocument) {
      // If we haven't tried refreshing for this specific document ID yet, try it first
      if (hasTriedRefreshRef.current !== id) {
        hasTriedRefreshRef.current = id;
        // Refresh the documents list, then redirect if still not found
        refreshDocuments()
          .then(() => {
            // Wait a moment for React to process the update
            setTimeout(() => {
              // Check if document was found after refresh
              if (!contextDocumentRef.current) {
                navigate('/docs');
              }
            }, 300);
          })
          .catch(() => {
            // On error, redirect to docs list
            navigate('/docs');
          });
        return;
      }

      // We've already refreshed and still don't have the document
      // Wait a short time to allow optimistic updates to propagate, then redirect
      const timeoutId = setTimeout(() => {
        // Re-check using ref to get the latest value
        if (!contextDocumentRef.current) {
          navigate('/docs');
        }
      }, 300);
      return () => clearTimeout(timeoutId);
    }
  }, [documentsLoading, id, contextDocument, navigate, refreshDocuments]);

  // For temp IDs (offline-created documents), create a placeholder while waiting for cache sync
  const document = contextDocument || (id?.startsWith('temp-') ? {
    id: id,
    title: 'Untitled',
    document_type: 'wiki',
    parent_id: null,
    position: 0,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    visibility: 'workspace' as const,
    _pending: true,
  } : null);

  // Track last visited document for auto-open on /docs
  useEffect(() => {
    if (id && document) {
      localStorage.setItem('ship:lastVisitedDoc', id);
    }
  }, [id, document]);

  // Update handler using shared context (supports offline via TanStack Query)
  const handleUpdateDocument = useCallback(async (updates: Partial<WikiDocument>) => {
    if (!id) return;
    await contextUpdateDocument(id, updates);
  }, [id, contextUpdateDocument]);

  // Throttled title save with stale response handling
  const throttledTitleSave = useAutoSave({
    onSave: async (title: string) => {
      if (title) await handleUpdateDocument({ title });
    },
  });

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

  // Create sub-document (for slash commands)
  const handleCreateSubDocument = useCallback(async () => {
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

  // Get effective maintainer (explicit or fallback to creator)
  const maintainerId = (document.properties as { maintainer_id?: string | null })?.maintainer_id || document.created_by;

  // Handle maintainer change
  const handleMaintainerChange = (userId: string | null) => {
    handleUpdateDocument({
      properties: { ...document.properties, maintainer_id: userId },
    });
  };

  // Handle visibility change
  const handleVisibilityChange = (visibility: 'private' | 'workspace') => {
    handleUpdateDocument({ visibility });
  };

  // Check if user can change visibility (creator or admin)
  const canChangeVisibility = document.created_by === user?.id;

  // Format date for display
  const formatDate = (date: Date | string | undefined) => {
    if (!date) return '—';
    const d = new Date(date);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  };

  const formatDateTime = (date: Date | string | undefined) => {
    if (!date) return '—';
    const d = new Date(date);
    return d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  return (
    <Editor
      documentId={document.id}
      userName={user.name}
      initialTitle={document.title}
      onTitleChange={throttledTitleSave}
      onBack={handleBack}
      backLabel={parentDocument?.title || undefined}
      onDelete={handleDelete}
      onCreateSubDocument={handleCreateSubDocument}
      onNavigateToDocument={handleNavigateToDocument}
      sidebar={
        <div className="space-y-4 p-4">
          <PropertyRow label="Maintainer">
            <PersonCombobox
              people={teamMembers}
              value={maintainerId || null}
              onChange={handleMaintainerChange}
              placeholder="Select maintainer..."
            />
          </PropertyRow>

          <PropertyRow label="Visibility">
            <VisibilityDropdown
              value={document.visibility || 'workspace'}
              onChange={handleVisibilityChange}
              disabled={!canChangeVisibility}
            />
          </PropertyRow>

          <PropertyRow label="Created">
            <p className="text-sm text-foreground">{formatDate(document.created_at)}</p>
          </PropertyRow>

          <PropertyRow label="Updated">
            <p className="text-sm text-foreground">{formatDateTime(document.updated_at)}</p>
          </PropertyRow>

          <BacklinksPanel documentId={document.id} />
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
