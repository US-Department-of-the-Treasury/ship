import { useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { UnifiedEditor } from '@/components/UnifiedEditor';
import type { UnifiedDocument, SidebarData } from '@/components/UnifiedEditor';
import { useAuth } from '@/hooks/useAuth';
import { useAssignableMembersQuery } from '@/hooks/useTeamMembersQuery';
import { useProgramsQuery } from '@/hooks/useProgramsQuery';
import { useProjectsQuery } from '@/hooks/useProjectsQuery';
import { useDocumentConversion } from '@/hooks/useDocumentConversion';
import { apiGet, apiPatch, apiDelete, apiPost } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { issueKeys } from '@/hooks/useIssuesQuery';
import { projectKeys } from '@/hooks/useProjectsQuery';

interface DocumentResponse extends Record<string, unknown> {
  id: string;
  title: string;
  document_type: string;
  properties?: Record<string, unknown>;
  workspace_id?: string;
  created_at?: string;
  updated_at?: string;
  created_by?: string | null;
  converted_to_id?: string | null;
  converted_from_id?: string | null;
  // Flattened properties from API
  state?: string;
  priority?: string;
  assignee_id?: string | null;
  assignee_name?: string | null;
  estimate?: number | null;
  source?: 'internal' | 'external';
  program_id?: string | null;
  sprint_id?: string | null;
  color?: string;
  impact?: number;
  confidence?: number;
  ease?: number;
  owner_id?: string | null;
  owner?: { id: string; name: string; email: string } | null;
  start_date?: string;
  end_date?: string;
  status?: string;
  hypothesis?: string;
  visibility?: 'private' | 'workspace';
  parent_id?: string | null;
  ticket_number?: number;
  // Multi-parent associations (junction table)
  belongs_to?: Array<{
    id: string;
    type: 'program' | 'project' | 'sprint' | 'parent';
    title?: string;
    color?: string;
  }>;
}

/**
 * UnifiedDocumentPage - Renders any document type via /documents/:id route
 *
 * This page fetches a document by ID regardless of type and renders it
 * using the UnifiedEditor component with the appropriate sidebar data.
 */
export function UnifiedDocumentPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { showToast } = useToast();

  // Fetch the document by ID
  const { data: document, isLoading, error } = useQuery<DocumentResponse>({
    queryKey: ['document', id],
    queryFn: async () => {
      const response = await apiGet(`/api/documents/${id}`);
      if (!response.ok) {
        if (response.status === 404) {
          throw new Error('Document not found');
        }
        throw new Error('Failed to fetch document');
      }
      return response.json();
    },
    enabled: !!id,
    retry: false,
  });

  // Fetch team members for sidebar data
  const { data: teamMembersData = [] } = useAssignableMembersQuery();
  const teamMembers = useMemo(() => teamMembersData.map(m => ({
    id: m.id,
    user_id: m.user_id,
    name: m.name,
    email: m.email || '',
  })), [teamMembersData]);

  // Fetch programs for sidebar data
  const { data: programsData = [] } = useProgramsQuery();
  const programs = useMemo(() => programsData.map(p => ({
    id: p.id,
    name: p.name,
    color: p.color,
    emoji: p.emoji,
  })), [programsData]);

  // Fetch projects for issue sidebar (multi-association)
  const { data: projectsData = [] } = useProjectsQuery();
  const projects = useMemo(() => projectsData.map(p => ({
    id: p.id,
    title: p.title,
    color: p.color,
  })), [projectsData]);

  // Handler for when associations change (invalidate document query to refetch)
  const handleAssociationChange = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ['document', id] });
  }, [queryClient, id]);

  // Document conversion (issue <-> project)
  const { convert, undoConversion, isConverting } = useDocumentConversion({
    navigateAfterConvert: true,
  });

  // Conversion callbacks that use the current document
  const handleConvert = useCallback(() => {
    if (!document || !id) return;
    const sourceType = document.document_type as 'issue' | 'project';
    convert(id, sourceType, document.title);
  }, [convert, document, id]);

  const handleUndoConversion = useCallback(async () => {
    if (!document || !id) return;

    try {
      const res = await apiPost(`/api/documents/${id}/undo-conversion`, {});

      if (res.ok) {
        // Invalidate caches to refresh the UI
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: issueKeys.lists() }),
          queryClient.invalidateQueries({ queryKey: projectKeys.lists() }),
          queryClient.invalidateQueries({ queryKey: ['document', id] }),
        ]);
        showToast('Conversion undone successfully', 'success');
      } else {
        const error = await res.json();
        showToast(error.error || 'Failed to undo conversion', 'error');
      }
    } catch (err) {
      showToast('Failed to undo conversion', 'error');
    }
  }, [document, id, queryClient, showToast]);

  // Handle document type change via DocumentTypeSelector
  const handleTypeChange = useCallback(async (newType: string) => {
    if (!document || !id) return;

    const currentType = document.document_type;

    // Only issue <-> project conversions are supported
    const isValidConversion =
      (currentType === 'issue' && newType === 'project') ||
      (currentType === 'project' && newType === 'issue');

    if (!isValidConversion) {
      showToast(`Converting ${currentType} to ${newType} is not supported`, 'error');
      return;
    }

    try {
      const res = await apiPost(`/api/documents/${id}/convert`, { target_type: newType });

      if (res.ok) {
        const data = await res.json();

        // Invalidate caches
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: issueKeys.lists() }),
          queryClient.invalidateQueries({ queryKey: projectKeys.lists() }),
          queryClient.invalidateQueries({ queryKey: ['document', id] }),
        ]);

        // Navigate to the new document
        navigate(`/documents/${data.id}`, { replace: true });
      } else {
        const error = await res.json();
        showToast(error.error || 'Failed to convert document', 'error');
      }
    } catch (err) {
      showToast('Failed to convert document', 'error');
    }
  }, [document, id, navigate, queryClient, showToast]);

  // Handle WebSocket notification that document was converted
  const handleDocumentConverted = useCallback((newDocId: string, _newDocType: 'issue' | 'project') => {
    // Navigate to the converted document
    navigate(`/documents/${newDocId}`, { replace: true });
  }, [navigate]);

  // Update mutation - pass documentId as variable to avoid stale closure issues after navigation
  const updateMutation = useMutation({
    mutationFn: async ({ documentId, updates }: { documentId: string; updates: Partial<DocumentResponse> }) => {
      const response = await apiPatch(`/api/documents/${documentId}`, updates);
      if (!response.ok) {
        throw new Error('Failed to update document');
      }
      return response.json();
    },
    onSuccess: (_, { documentId }) => {
      queryClient.invalidateQueries({ queryKey: ['document', documentId] });
      // Also invalidate type-specific queries for list views
      if (document?.document_type) {
        queryClient.invalidateQueries({ queryKey: [document.document_type + 's', 'list'] });
        if (document.document_type === 'wiki') {
          queryClient.invalidateQueries({ queryKey: ['documents', 'wiki'] });
        }
      }
    },
  });

  // Delete mutation - pass documentId as variable to avoid stale closure issues
  const deleteMutation = useMutation({
    mutationFn: async (documentId: string) => {
      const response = await apiDelete(`/api/documents/${documentId}`);
      if (!response.ok) {
        throw new Error('Failed to delete document');
      }
    },
    onSuccess: () => {
      navigate('/docs');
    },
  });

  // Handle update
  const handleUpdate = useCallback(async (updates: Partial<UnifiedDocument>) => {
    if (!id) return;
    await updateMutation.mutateAsync({ documentId: id, updates: updates as Partial<DocumentResponse> });
  }, [updateMutation, id]);

  // Handle delete
  const handleDelete = useCallback(async () => {
    if (!id) return;
    if (!window.confirm('Are you sure you want to delete this document?')) return;
    await deleteMutation.mutateAsync(id);
  }, [deleteMutation, id]);

  // Handle back navigation
  const handleBack = useCallback(() => {
    // Navigate to type-specific list or docs
    if (document?.document_type === 'issue') {
      navigate('/issues');
    } else if (document?.document_type === 'project') {
      navigate('/projects');
    } else if (document?.document_type === 'sprint') {
      navigate('/sprints');
    } else if (document?.document_type === 'program') {
      navigate('/programs');
    } else {
      navigate('/docs');
    }
  }, [document, navigate]);

  // Build sidebar data based on document type
  const sidebarData: SidebarData = useMemo(() => {
    if (!document) return {};

    switch (document.document_type) {
      case 'wiki':
        return {
          teamMembers,
        };
      case 'issue':
        return {
          teamMembers,
          programs,
          projects,
          onAssociationChange: handleAssociationChange,
          onConvert: handleConvert,
          onUndoConversion: handleUndoConversion,
          isConverting,
          isUndoing: isConverting,
        };
      case 'project':
        return {
          programs,
          people: teamMembers,
          onConvert: handleConvert,
          onUndoConversion: handleUndoConversion,
          isConverting,
          isUndoing: isConverting,
        };
      case 'sprint':
        return {};
      default:
        return {};
    }
  }, [document, teamMembers, programs, projects, handleAssociationChange, handleConvert, handleUndoConversion, isConverting]);

  // Transform API response to UnifiedDocument format
  const unifiedDocument: UnifiedDocument | null = useMemo(() => {
    if (!document) return null;

    return {
      id: document.id,
      title: document.title,
      document_type: document.document_type as UnifiedDocument['document_type'],
      created_at: document.created_at,
      updated_at: document.updated_at,
      created_by: document.created_by,
      properties: document.properties,
      // Spread flattened properties based on type
      ...(document.document_type === 'issue' && {
        state: document.state || 'backlog',
        priority: document.priority || 'medium',
        estimate: document.estimate,
        assignee_id: document.assignee_id,
        assignee_name: document.assignee_name,
        program_id: document.program_id,
        sprint_id: document.sprint_id,
        source: document.source,
        converted_from_id: document.converted_from_id,
        display_id: document.ticket_number ? `#${document.ticket_number}` : undefined,
        belongs_to: document.belongs_to,
      }),
      ...(document.document_type === 'project' && {
        impact: document.impact ?? 5,
        confidence: document.confidence ?? 5,
        ease: document.ease ?? 5,
        color: document.color || '#3b82f6',
        emoji: null,
        program_id: document.program_id,
        owner: document.owner,
        owner_id: document.owner_id,
        converted_from_id: document.converted_from_id,
      }),
      ...(document.document_type === 'sprint' && {
        start_date: document.start_date || '',
        end_date: document.end_date || '',
        status: (document.status as 'planned' | 'active' | 'completed') || 'planned',
        program_id: document.program_id,
        hypothesis: document.hypothesis || '',
      }),
      ...(document.document_type === 'wiki' && {
        parent_id: document.parent_id,
        visibility: document.visibility,
      }),
    } as UnifiedDocument;
  }, [document]);

  // Loading state
  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted">Loading...</div>
      </div>
    );
  }

  // Error state
  if (error || !document) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4">
        <div className="text-muted">
          {error?.message || 'Document not found'}
        </div>
        <button
          onClick={() => navigate('/docs')}
          className="text-sm text-accent hover:underline"
        >
          Go to Documents
        </button>
      </div>
    );
  }

  if (!user || !unifiedDocument) {
    return null;
  }

  return (
    <UnifiedEditor
      document={unifiedDocument}
      sidebarData={sidebarData}
      onUpdate={handleUpdate}
      onTypeChange={handleTypeChange}
      onDocumentConverted={handleDocumentConverted}
      onBack={handleBack}
      backLabel="Back to documents"
      onDelete={handleDelete}
      showTypeSelector={true}
    />
  );
}
