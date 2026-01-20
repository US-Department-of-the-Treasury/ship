import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Editor } from '@/components/Editor';
import { IssueSidebar } from '@/components/sidebars/IssueSidebar';
import { useAuth } from '@/hooks/useAuth';
import { useIssues, Issue } from '@/contexts/IssuesContext';
import { useDocuments } from '@/contexts/DocumentsContext';
import { EditorSkeleton } from '@/components/ui/Skeleton';
import { useAutoSave } from '@/hooks/useAutoSave';
import { useProgramsQuery } from '@/hooks/useProgramsQuery';
import { useAssignableMembersQuery } from '@/hooks/useTeamMembersQuery';
import { issueKeys } from '@/hooks/useIssuesQuery';
import { projectKeys, useProjectsQuery } from '@/hooks/useProjectsQuery';
import { useDocumentContextQuery } from '@/hooks/useDocumentContextQuery';
import { DocumentBreadcrumbs } from '@/components/ContextTreeNav';
import { apiPost } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { ConversionDialog } from '@/components/dialogs/ConversionDialog';

const API_URL = import.meta.env.VITE_API_URL ?? '';

// Navigation context passed when navigating from another page
interface NavigationContext {
  from?: 'program';
  programId?: string;
  programName?: string;
}

export function IssueEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const navContext = (location.state as NavigationContext) || {};
  const { user } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const { issues, loading: issuesLoading, updateIssue: contextUpdateIssue, refreshIssues } = useIssues();
  const { createDocument } = useDocuments();

  // Direct-fetched issue (when not found in context cache)
  const [directFetchedIssue, setDirectFetchedIssue] = useState<Issue | null>(null);
  const [directFetchLoading, setDirectFetchLoading] = useState(false);
  const [directFetchFailed, setDirectFetchFailed] = useState(false);

  // Conversion state
  const [showConvertDialog, setShowConvertDialog] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [isUndoing, setIsUndoing] = useState(false);

  // Use TanStack Query for programs, projects, and team members (supports offline via cache)
  const { data: programsData = [] } = useProgramsQuery();
  const { data: projectsData = [] } = useProjectsQuery();
  // Use assignable members only - pending users can't be assigned to issues
  const { data: teamMembersData = [] } = useAssignableMembersQuery();
  // Get document context for breadcrumbs (ancestors + children)
  const { data: documentContext } = useDocumentContextQuery(id);

  // Get the current issue from context, or use direct-fetched issue
  const contextIssue = issues.find(i => i.id === id) || null;
  const issue = contextIssue || directFetchedIssue;

  // Create sub-document (for slash commands) - creates a wiki doc linked to this issue
  const handleCreateSubDocument = useCallback(async () => {
    if (!id) return null;
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

  // Handle document conversion by another user (via WebSocket notification)
  const handleDocumentConverted = useCallback((newDocId: string, newDocType: 'issue' | 'project') => {
    const docTypeLabel = newDocType === 'project' ? 'project' : 'issue';
    showToast(`This issue was converted to a ${docTypeLabel}. Redirecting...`, 'info');
    // Navigate to the new document
    const route = newDocType === 'project' ? `/projects/${newDocId}` : `/issues/${newDocId}`;
    navigate(route, { replace: true });
  }, [navigate, showToast]);

  // Fetch issue directly by ID if not in context (e.g., when navigating from Programs view)
  useEffect(() => {
    // Skip if we already have the issue from context
    if (contextIssue) {
      setDirectFetchedIssue(null);
      setDirectFetchFailed(false);
      return;
    }

    // Skip if no ID or temp ID (offline creation)
    if (!id || id.startsWith('temp-')) return;

    // Skip if still loading from context
    if (issuesLoading) return;

    // Skip if already fetching or already failed
    if (directFetchLoading || directFetchFailed) return;

    setDirectFetchLoading(true);

    fetch(`${API_URL}/api/issues/${id}`, { credentials: 'include' })
      .then(res => {
        // Check if redirected (document was converted)
        // res.url contains the final URL after any redirects
        const requestedUrl = `${API_URL}/api/issues/${id}`;
        if (res.url && res.url !== requestedUrl) {
          // Parse the final URL to extract doc type and ID
          const match = res.url.match(/\/api\/(projects|issues|documents)\/([a-f0-9-]+)/);
          if (match) {
            const [, docType, newId] = match;
            if (docType === 'projects') {
              // Issue was converted to project - redirect to project editor
              navigate(`/projects/${newId}`, { replace: true });
              return null;
            }
          }
        }
        if (!res.ok) {
          throw new Error('Issue not found');
        }
        return res.json();
      })
      .then(data => {
        if (data === null) return; // Handled by redirect
        setDirectFetchedIssue(data);
        setDirectFetchLoading(false);
      })
      .catch(() => {
        setDirectFetchFailed(true);
        setDirectFetchLoading(false);
      });
  }, [id, contextIssue, issuesLoading, directFetchLoading, directFetchFailed, navigate]);

  // Redirect only if direct fetch failed (issue truly doesn't exist)
  // Skip redirect for temp IDs (pending offline creation) - give cache time to sync
  useEffect(() => {
    if (directFetchFailed && !id?.startsWith('temp-')) {
      navigate('/issues');
    }
  }, [directFetchFailed, id, navigate]);

  // Update handler using shared context
  const handleUpdateIssue = useCallback(async (updates: Partial<Issue>) => {
    if (!id) return;
    await contextUpdateIssue(id, updates);
  }, [id, contextUpdateIssue]);

  // Accept triage issue - move to backlog
  const handleAccept = useCallback(async () => {
    if (!id) return;
    try {
      const res = await apiPost(`/api/issues/${id}/accept`);
      if (res.ok) {
        // Refresh to get updated state from server
        await refreshIssues();
      }
    } catch (err) {
      console.error('Failed to accept issue:', err);
    }
  }, [id, refreshIssues]);

  // Reject triage issue - move to cancelled with reason
  const handleReject = useCallback(async (reason: string) => {
    if (!id) return;
    try {
      const res = await apiPost(`/api/issues/${id}/reject`, { reason });
      if (res.ok) {
        // Refresh to get updated state from server
        await refreshIssues();
      }
    } catch (err) {
      console.error('Failed to reject issue:', err);
    }
  }, [id, refreshIssues]);

  // Convert issue to project
  const handleConvert = useCallback(async () => {
    if (!id) return;
    setIsConverting(true);
    try {
      const res = await apiPost(`/api/documents/${id}/convert`, { target_type: 'project' });
      if (res.ok) {
        const data = await res.json();
        // Invalidate both issues and projects caches to reflect the conversion
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: issueKeys.lists() }),
          queryClient.invalidateQueries({ queryKey: projectKeys.lists() }),
        ]);
        // Navigate to the new project (API returns document at root level)
        navigate(`/projects/${data.id}`, { replace: true });
      } else {
        const error = await res.json();
        console.error('Failed to convert issue:', error);
        showToast(error.error || 'Failed to convert issue to project', 'error');
        setIsConverting(false);
        setShowConvertDialog(false);
      }
    } catch (err) {
      console.error('Failed to convert issue:', err);
      showToast('Failed to convert issue to project', 'error');
      setIsConverting(false);
      setShowConvertDialog(false);
    }
  }, [id, navigate, showToast, queryClient]);

  // Undo conversion (restore original document)
  const handleUndoConversion = useCallback(async () => {
    if (!id) return;
    setIsUndoing(true);
    try {
      const res = await apiPost(`/api/documents/${id}/undo-conversion`, {});
      if (res.ok) {
        const data = await res.json();
        // Invalidate both caches to reflect the undo
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: issueKeys.lists() }),
          queryClient.invalidateQueries({ queryKey: projectKeys.lists() }),
        ]);
        showToast('Conversion undone. Original document restored.', 'success');
        // Navigate to the restored document
        const restoredDocType = data.restored_document.document_type;
        const route = restoredDocType === 'project' ? `/projects/${data.restored_document.id}` : `/issues/${data.restored_document.id}`;
        navigate(route, { replace: true });
      } else {
        const error = await res.json();
        console.error('Failed to undo conversion:', error);
        showToast(error.error || 'Failed to undo conversion', 'error');
        setIsUndoing(false);
      }
    } catch (err) {
      console.error('Failed to undo conversion:', err);
      showToast('Failed to undo conversion', 'error');
      setIsUndoing(false);
    }
  }, [id, navigate, showToast, queryClient]);

  // Throttled title save with stale response handling
  const throttledTitleSave = useAutoSave({
    onSave: async (title: string) => {
      if (title) await handleUpdateIssue({ title });
    },
  });

  // Handle back navigation - return to context if available, otherwise issues list
  // NOTE: This hook must be defined BEFORE early returns to avoid "Rendered more hooks" error
  const handleBack = useCallback(() => {
    if (navContext.from === 'program' && navContext.programId) {
      navigate(`/programs/${navContext.programId}`);
    } else {
      navigate('/issues');
    }
  }, [navigate, navContext]);

  // Escape key handler - return to previous context
  // NOTE: This hook must be defined BEFORE early returns to avoid "Rendered more hooks" error
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle Escape when not in an input field
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }
      if (e.key === 'Escape') {
        handleBack();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleBack]);

  // Only wait for issues to load - programs/team can load in background
  // This allows the page to render with cached data when offline
  // Also wait for direct fetch if we're fetching an issue not in context
  // We're loading if: issues are loading, OR (not in context AND not fetched AND not failed)
  const needsDirectFetch = !contextIssue && !directFetchedIssue && !directFetchFailed && !id?.startsWith('temp-');
  const loading = issuesLoading || directFetchLoading || (!issuesLoading && needsDirectFetch);

  if (loading) {
    return <EditorSkeleton />;
  }

  // For temp IDs (optimistic issues), create a placeholder issue while waiting for server response
  const displayIssue = issue || (id?.startsWith('temp-') ? {
    id: id,
    title: 'Untitled',
    state: 'backlog',
    priority: 'none',
    ticket_number: -1,
    display_id: 'PENDING',
    assignee_id: null,
    assignee_name: null,
    estimate: null,
    program_id: null,
    sprint_id: null,
    program_name: null,
    program_prefix: null,
    sprint_name: null,
    source: 'internal' as const,
    rejection_reason: null,
    converted_from_id: null,
    belongs_to: [],
  } : null);

  if (!displayIssue || !user) {
    return null;
  }

  // Breadcrumb label based on navigation context
  const backLabel = navContext.from === 'program' && navContext.programName
    ? navContext.programName
    : undefined;

  return (
    <>
    <Editor
      documentId={displayIssue.id}
      userName={user.name}
      initialTitle={displayIssue.title}
      onTitleChange={throttledTitleSave}
      onBack={handleBack}
      backLabel={backLabel}
      roomPrefix="issue"
      placeholder="Add a description..."
      onCreateSubDocument={handleCreateSubDocument}
      onNavigateToDocument={handleNavigateToDocument}
      onDocumentConverted={handleDocumentConverted}
      breadcrumbs={documentContext?.breadcrumbs && documentContext.breadcrumbs.length > 1 ? (
        <DocumentBreadcrumbs items={documentContext.breadcrumbs} />
      ) : undefined}
      headerBadge={
        <span className="rounded bg-border px-2 py-0.5 text-xs font-mono font-medium text-muted whitespace-nowrap" data-testid="ticket-number">
          {displayIssue.display_id}
        </span>
      }
      sidebar={
        <IssueSidebar
          issue={displayIssue}
          teamMembers={teamMembersData}
          programs={programsData}
          projects={projectsData}
          onUpdate={handleUpdateIssue}
          onAssociationChange={refreshIssues}
          onConvert={() => setShowConvertDialog(true)}
          onUndoConversion={handleUndoConversion}
          onAccept={handleAccept}
          onReject={handleReject}
          isConverting={isConverting}
          isUndoing={isUndoing}
        />
      }
    />
    <ConversionDialog
      isOpen={showConvertDialog}
      onClose={() => setShowConvertDialog(false)}
      onConvert={handleConvert}
      sourceType="issue"
      title={displayIssue.title}
      isConverting={isConverting}
    />
    </>
  );
}
