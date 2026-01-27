import { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { UnifiedEditor } from '@/components/UnifiedEditor';
import type { UnifiedDocument, SidebarData } from '@/components/UnifiedEditor';
import { useAuth } from '@/hooks/useAuth';
import { useAssignableMembersQuery } from '@/hooks/useTeamMembersQuery';
import { useProgramsQuery } from '@/hooks/useProgramsQuery';
import { apiPatch, apiDelete, apiPost } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { issueKeys } from '@/hooks/useIssuesQuery';
import { projectKeys } from '@/hooks/useProjectsQuery';
import type { DocumentTabProps } from '@/lib/document-tabs';

/**
 * ProjectDetailsTab - Renders the project document in the UnifiedEditor
 *
 * This is the "Details" tab content when viewing a project document.
 */
export default function ProjectDetailsTab({ documentId, document }: DocumentTabProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { showToast } = useToast();

  // Fetch team members for sidebar
  const { data: teamMembersData = [] } = useAssignableMembersQuery();
  const teamMembers = useMemo(() => teamMembersData.map(m => ({
    id: m.id,
    user_id: m.user_id,
    name: m.name,
    email: m.email || '',
  })), [teamMembersData]);

  // Fetch programs for sidebar
  const { data: programsData = [] } = useProgramsQuery();
  const programs = useMemo(() => programsData.map(p => ({
    id: p.id,
    name: p.name,
    color: p.color,
    emoji: p.emoji,
  })), [programsData]);

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: async (updates: Partial<UnifiedDocument>) => {
      const response = await apiPatch(`/api/documents/${documentId}`, updates);
      if (!response.ok) {
        throw new Error('Failed to update document');
      }
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['document', documentId] });
      queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: async () => {
      const response = await apiDelete(`/api/documents/${documentId}`);
      if (!response.ok) {
        throw new Error('Failed to delete document');
      }
    },
    onSuccess: () => {
      navigate('/projects');
    },
  });

  // Handle type change (project <-> issue conversion)
  const handleTypeChange = useCallback(async (newType: string) => {
    const isValidConversion = newType === 'issue';
    if (!isValidConversion) {
      showToast(`Converting project to ${newType} is not supported`, 'error');
      return;
    }

    try {
      const res = await apiPost(`/api/documents/${documentId}/convert`, { target_type: newType });
      if (res.ok) {
        const data = await res.json();
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: issueKeys.lists() }),
          queryClient.invalidateQueries({ queryKey: projectKeys.lists() }),
          queryClient.invalidateQueries({ queryKey: ['document', documentId] }),
        ]);
        navigate(`/documents/${data.id}`, { replace: true });
      } else {
        const error = await res.json();
        showToast(error.error || 'Failed to convert document', 'error');
      }
    } catch (err) {
      showToast('Failed to convert document', 'error');
    }
  }, [documentId, navigate, queryClient, showToast]);

  // Handle conversion callbacks
  const handleConvert = useCallback(async () => {
    await handleTypeChange('issue');
  }, [handleTypeChange]);

  const handleUndoConversion = useCallback(async () => {
    try {
      const res = await apiPost(`/api/documents/${documentId}/undo-conversion`, {});
      if (res.ok) {
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: issueKeys.lists() }),
          queryClient.invalidateQueries({ queryKey: projectKeys.lists() }),
          queryClient.invalidateQueries({ queryKey: ['document', documentId] }),
        ]);
        showToast('Conversion undone successfully', 'success');
      } else {
        const error = await res.json();
        showToast(error.error || 'Failed to undo conversion', 'error');
      }
    } catch (err) {
      showToast('Failed to undo conversion', 'error');
    }
  }, [documentId, queryClient, showToast]);

  // Handle WebSocket notification
  const handleDocumentConverted = useCallback((newDocId: string) => {
    navigate(`/documents/${newDocId}`, { replace: true });
  }, [navigate]);

  // Handle back navigation
  const handleBack = useCallback(() => {
    navigate('/projects');
  }, [navigate]);

  // Handle update
  const handleUpdate = useCallback(async (updates: Partial<UnifiedDocument>) => {
    await updateMutation.mutateAsync(updates);
  }, [updateMutation]);

  // Handle delete
  const handleDelete = useCallback(async () => {
    if (!window.confirm('Are you sure you want to delete this project?')) return;
    await deleteMutation.mutateAsync();
  }, [deleteMutation]);

  // Build sidebar data
  const sidebarData: SidebarData = useMemo(() => ({
    programs,
    people: teamMembers,
    onConvert: handleConvert,
    onUndoConversion: handleUndoConversion,
    isConverting: updateMutation.isPending,
    isUndoing: updateMutation.isPending,
  }), [programs, teamMembers, handleConvert, handleUndoConversion, updateMutation.isPending]);

  // Get program_id from belongs_to array (project's parent program via document_associations)
  const belongsTo = (document as { belongs_to?: Array<{ id: string; type: string }> }).belongs_to;
  const programId = belongsTo?.find(b => b.type === 'program')?.id;

  // Transform to UnifiedDocument format
  const unifiedDocument: UnifiedDocument = useMemo(() => ({
    id: document.id,
    title: document.title,
    document_type: 'project',
    created_at: document.created_at,
    updated_at: document.updated_at,
    created_by: document.created_by as string | undefined,
    properties: document.properties as Record<string, unknown> | undefined,
    impact: (document.impact as number) ?? 5,
    confidence: (document.confidence as number) ?? 5,
    ease: (document.ease as number) ?? 5,
    color: (document.color as string) || '#3b82f6',
    emoji: null,
    program_id: programId,
    owner: document.owner as { id: string; name: string; email: string } | null,
    owner_id: document.owner_id as string | undefined,
    converted_from_id: document.converted_from_id as string | undefined,
  }), [document, programId]);

  if (!user) return null;

  return (
    <UnifiedEditor
      document={unifiedDocument}
      sidebarData={sidebarData}
      onUpdate={handleUpdate}
      onTypeChange={handleTypeChange}
      onDocumentConverted={handleDocumentConverted}
      onBack={handleBack}
      backLabel="Back to projects"
      onDelete={handleDelete}
      showTypeSelector={true}
    />
  );
}
