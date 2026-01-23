import { useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { UnifiedEditor } from '@/components/UnifiedEditor';
import type { UnifiedDocument, SidebarData } from '@/components/UnifiedEditor';
import { useAuth } from '@/hooks/useAuth';
import { apiPatch, apiDelete } from '@/lib/api';
import type { DocumentTabProps } from '@/lib/document-tabs';

/**
 * SprintOverviewTab - Renders the sprint document in the UnifiedEditor
 *
 * This is the "Overview" tab content when viewing a sprint document.
 * Shows the sprint hypothesis and description.
 */
export default function SprintOverviewTab({ documentId, document }: DocumentTabProps) {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();

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
      queryClient.invalidateQueries({ queryKey: ['sprints'] });
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
      navigate('/sprints');
    },
  });

  // Handle back navigation
  const handleBack = useCallback(() => {
    navigate('/sprints');
  }, [navigate]);

  // Handle update - map frontend field names to API field names
  const handleUpdate = useCallback(async (updates: Partial<UnifiedDocument>) => {
    // Map 'status' to 'sprint_status' for the API
    const apiUpdates: Record<string, unknown> = { ...updates };
    if ('status' in apiUpdates) {
      apiUpdates.sprint_status = apiUpdates.status;
      delete apiUpdates.status;
    }
    await updateMutation.mutateAsync(apiUpdates as Partial<UnifiedDocument>);
  }, [updateMutation]);

  // Handle delete
  const handleDelete = useCallback(async () => {
    if (!window.confirm('Are you sure you want to delete this sprint?')) return;
    await deleteMutation.mutateAsync();
  }, [deleteMutation]);

  // Build sidebar data (sprints don't have complex sidebar needs)
  const sidebarData: SidebarData = useMemo(() => ({}), []);

  // Transform to UnifiedDocument format
  const unifiedDocument: UnifiedDocument = useMemo(() => ({
    id: document.id,
    title: document.title,
    document_type: 'sprint',
    created_at: document.created_at,
    updated_at: document.updated_at,
    created_by: document.created_by as string | undefined,
    properties: document.properties as Record<string, unknown> | undefined,
    start_date: (document.start_date as string) || '',
    end_date: (document.end_date as string) || '',
    status: ((document.sprint_status as string) || 'planning') as 'planning' | 'active' | 'completed',
    program_id: document.program_id as string | undefined,
    hypothesis: (document.hypothesis as string) || '',
  }), [document]);

  if (!user) return null;

  return (
    <UnifiedEditor
      document={unifiedDocument}
      sidebarData={sidebarData}
      onUpdate={handleUpdate}
      onBack={handleBack}
      backLabel="Back to sprints"
      onDelete={handleDelete}
      showTypeSelector={false}
    />
  );
}
