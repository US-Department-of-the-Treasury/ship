import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Editor } from '@/components/Editor';
import { ProjectSidebar } from '@/components/sidebars/ProjectSidebar';
import { useAuth } from '@/hooks/useAuth';
import { useProjects, Project } from '@/contexts/ProjectsContext';
import { usePrograms } from '@/contexts/ProgramsContext';
import { useDocuments } from '@/contexts/DocumentsContext';
import { cn } from '@/lib/cn';
import { EditorSkeleton } from '@/components/ui/Skeleton';
import { useAutoSave } from '@/hooks/useAutoSave';
import { Person } from '@/components/PersonCombobox';
import { TabBar } from '@/components/ui/TabBar';
import { ProjectRetro } from '@/components/ProjectRetro';
import { IssuesList } from '@/components/IssuesList';
import { IncompleteDocumentBanner } from '@/components/IncompleteDocumentBanner';
import { useToast } from '@/components/ui/Toast';
import { issueKeys } from '@/hooks/useIssuesQuery';
import { projectKeys, useProjectSprintsQuery, ProjectSprint } from '@/hooks/useProjectsQuery';
import { apiPost } from '@/lib/api';
import { ConversionDialog } from '@/components/dialogs/ConversionDialog';

const API_URL = import.meta.env.VITE_API_URL ?? '';

export function ProjectEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
  const { projects, loading, updateProject: contextUpdateProject } = useProjects();
  const { programs } = usePrograms();
  const { createDocument } = useDocuments();
  const [people, setPeople] = useState<Person[]>([]);
  const [activeTab, setActiveTab] = useState<'details' | 'issues' | 'sprints' | 'retro'>('details');
  const [showConvertDialog, setShowConvertDialog] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [isUndoing, setIsUndoing] = useState(false);

  // Direct-fetched project (when not found in context cache)
  const [directFetchedProject, setDirectFetchedProject] = useState<Project | null>(null);
  const [directFetchLoading, setDirectFetchLoading] = useState(false);
  const [directFetchFailed, setDirectFetchFailed] = useState(false);

  // Get the current project from context, or use direct-fetched project
  const contextProject = projects.find(p => p.id === id) || null;
  const project = contextProject || directFetchedProject;

  // Fetch project sprints
  const { data: projectSprints = [], isLoading: sprintsLoading } = useProjectSprintsQuery(id);

  // Fetch team members for owner selection (filter out pending users)
  useEffect(() => {
    fetch(`${API_URL}/api/team/people`, { credentials: 'include' })
      .then(res => res.ok ? res.json() : [])
      .then((data: Person[]) => setPeople(data.filter(p => p.user_id)))
      .catch(console.error);
  }, []);

  // Fetch project directly by ID if not in context (handles converted documents)
  useEffect(() => {
    // Skip if we already have the project from context
    if (contextProject) {
      setDirectFetchedProject(null);
      setDirectFetchFailed(false);
      return;
    }

    // Skip if no ID or temp ID (offline creation)
    if (!id || id.startsWith('temp-')) return;

    // Skip if still loading from context
    if (loading) return;

    // Skip if already fetching or already failed
    if (directFetchLoading || directFetchFailed) return;

    setDirectFetchLoading(true);

    fetch(`${API_URL}/api/projects/${id}`, { credentials: 'include' })
      .then(res => {
        // Check if redirected (document was converted)
        // res.url contains the final URL after any redirects
        const requestedUrl = `${API_URL}/api/projects/${id}`;
        if (res.url && res.url !== requestedUrl) {
          // Parse the final URL to extract doc type and ID
          const match = res.url.match(/\/api\/(projects|issues|documents)\/([a-f0-9-]+)/);
          if (match) {
            const [, docType, newId] = match;
            if (docType === 'issues') {
              // Project was converted to issue - redirect to issue editor
              navigate(`/issues/${newId}`, { replace: true });
              return null;
            }
          }
        }
        if (!res.ok) {
          throw new Error('Project not found');
        }
        return res.json();
      })
      .then(data => {
        if (data === null) return; // Handled by redirect
        setDirectFetchedProject(data);
        setDirectFetchLoading(false);
      })
      .catch(() => {
        setDirectFetchFailed(true);
        setDirectFetchLoading(false);
      });
  }, [id, contextProject, loading, directFetchLoading, directFetchFailed, navigate]);

  // Redirect only if direct fetch failed (project truly doesn't exist)
  // Skip redirect for temp IDs (pending offline creation)
  useEffect(() => {
    if (directFetchFailed && !id?.startsWith('temp-')) {
      navigate('/projects');
    }
  }, [directFetchFailed, id, navigate]);

  // Update handler using shared context
  const handleUpdateProject = useCallback(async (updates: Partial<Project>) => {
    if (!id) return;
    await contextUpdateProject(id, updates);
  }, [id, contextUpdateProject]);

  // Create sub-document (for slash commands)
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
    showToast(`This project was converted to a ${docTypeLabel}. Redirecting...`, 'info');
    // Navigate to the new document
    const route = newDocType === 'project' ? `/projects/${newDocId}` : `/issues/${newDocId}`;
    navigate(route, { replace: true });
  }, [navigate, showToast]);

  // Convert project to issue
  const handleConvert = useCallback(async () => {
    if (!id) return;
    setIsConverting(true);
    try {
      const res = await apiPost(`/api/documents/${id}/convert`, { target_type: 'issue' });
      if (res.ok) {
        const data = await res.json();
        // Invalidate both caches to reflect the conversion
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: issueKeys.lists() }),
          queryClient.invalidateQueries({ queryKey: projectKeys.lists() }),
        ]);
        // Navigate to the new issue (API returns document at root level)
        navigate(`/issues/${data.id}`, { replace: true });
      } else {
        const error = await res.json();
        console.error('Failed to convert project:', error);
        showToast(error.error || 'Failed to convert project to issue', 'error');
        setIsConverting(false);
        setShowConvertDialog(false);
      }
    } catch (err) {
      console.error('Failed to convert project:', err);
      showToast('Failed to convert project to issue', 'error');
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

  // Throttled title save
  const throttledTitleSave = useAutoSave({
    onSave: async (title: string) => {
      if (title) await handleUpdateProject({ title });
    },
  });

  // Loading if: context loading, OR direct fetch loading, OR (not in context AND not fetched AND not failed)
  const needsDirectFetch = !contextProject && !directFetchedProject && !directFetchFailed && !id?.startsWith('temp-');
  const isLoading = loading || directFetchLoading || (!loading && needsDirectFetch);

  if (isLoading) {
    return <EditorSkeleton />;
  }

  // For temp IDs (offline-created projects), create a placeholder
  const displayProject = project || (id?.startsWith('temp-') ? {
    id: id,
    title: 'Untitled',
    impact: 3,
    confidence: 3,
    ease: 3,
    ice_score: 27,
    color: '#6366f1',
    emoji: null,
    program_id: null,
    owner: null,
    sprint_count: 0,
    issue_count: 0,
    archived_at: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    is_complete: null,
    missing_fields: [],
    inferred_status: 'backlog' as const,
    converted_from_id: null,
    _pending: true,
  } : null);

  if (!displayProject || !user) {
    return null;
  }

  return (
    <div className="flex h-full flex-col">
      {/* Tab bar for switching between Details, Issues, and Retro */}
      <div className="border-b border-border px-4">
        <TabBar
          tabs={[
            { id: 'details', label: 'Details' },
            { id: 'issues', label: `Issues${displayProject.issue_count > 0 ? ` (${displayProject.issue_count})` : ''}` },
            { id: 'sprints', label: `Sprints${projectSprints.length > 0 ? ` (${projectSprints.length})` : ''}` },
            { id: 'retro', label: 'Retro' },
          ]}
          activeTab={activeTab}
          onTabChange={(tabId) => setActiveTab(tabId as 'details' | 'issues' | 'sprints' | 'retro')}
        />
      </div>

      {/* Incomplete document warning banner */}
      <IncompleteDocumentBanner
        documentId={displayProject.id}
        isComplete={displayProject.is_complete}
        missingFields={displayProject.missing_fields}
      />

      {/* Content area */}
      <div className="flex-1 overflow-hidden">
        {activeTab === 'details' ? (
          <Editor
            documentId={displayProject.id}
            userName={user.name}
            initialTitle={displayProject.title}
            onTitleChange={throttledTitleSave}
            onBack={() => navigate('/projects')}
            roomPrefix="project"
            placeholder="Describe this project..."
            onCreateSubDocument={handleCreateSubDocument}
            onNavigateToDocument={handleNavigateToDocument}
            onDocumentConverted={handleDocumentConverted}
            sidebar={
              <ProjectSidebar
                project={displayProject}
                programs={programs}
                people={people}
                onUpdate={handleUpdateProject}
                onConvert={() => setShowConvertDialog(true)}
                onUndoConversion={handleUndoConversion}
                isConverting={isConverting}
                isUndoing={isUndoing}
              />
            }
          />
        ) : activeTab === 'issues' ? (
          <IssuesList
            lockedProjectId={displayProject.id}
            showProgramFilter={false}
            showProjectFilter={false}
            enableKeyboardNavigation={false}
            urlParamPrefix="issues"
            inheritedContext={{
              projectId: displayProject.id,
              programId: displayProject.program_id || undefined,
            }}
          />
        ) : activeTab === 'sprints' ? (
          <ProjectSprintsList
            sprints={projectSprints}
            loading={sprintsLoading}
            onSprintClick={(sprintId) => navigate(`/sprints/${sprintId}/view`)}
          />
        ) : (
          <ProjectRetro projectId={displayProject.id} />
        )}
      </div>

      {/* Conversion Dialog */}
      <ConversionDialog
        isOpen={showConvertDialog}
        onClose={() => setShowConvertDialog(false)}
        onConvert={handleConvert}
        sourceType="project"
        title={displayProject.title}
        isConverting={isConverting}
      />
    </div>
  );
}

// Project Sprints List component
interface ProjectSprintsListProps {
  sprints: ProjectSprint[];
  loading: boolean;
  onSprintClick: (sprintId: string) => void;
}

function ProjectSprintsList({ sprints, loading, onSprintClick }: ProjectSprintsListProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="flex items-center gap-2 text-muted">
          <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Loading sprints...
        </div>
      </div>
    );
  }

  if (sprints.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-muted">
        <svg className="w-12 h-12 mb-3 opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5" />
        </svg>
        <p className="text-sm font-medium">No sprints in this project</p>
        <p className="text-xs mt-1">Link sprints to this project from the sprint editor</p>
      </div>
    );
  }

  // Format date for display
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '—';
    return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  // Get status badge styling
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'active':
        return 'bg-green-500/20 text-green-300';
      case 'completed':
        return 'bg-blue-500/20 text-blue-300';
      case 'planning':
      default:
        return 'bg-gray-500/20 text-gray-300';
    }
  };

  return (
    <div className="h-full overflow-auto p-4 pb-20">
      <div className="space-y-2">
        {sprints.map((sprint) => (
          <div
            key={sprint.id}
            onClick={() => onSprintClick(sprint.id)}
            className="flex items-center gap-4 p-3 rounded-lg border border-border hover:bg-accent/5 cursor-pointer transition-colors"
          >
            {/* Sprint number */}
            <div className="flex-shrink-0 w-10 h-10 rounded-lg bg-accent/20 flex items-center justify-center">
              <span className="text-sm font-bold text-accent">{sprint.sprint_number}</span>
            </div>

            {/* Sprint info */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-medium text-foreground truncate">
                  {sprint.name || `Sprint ${sprint.sprint_number}`}
                </h3>
                <span className={cn(
                  'inline-flex px-2 py-0.5 text-xs font-medium rounded capitalize',
                  getStatusBadge(sprint.status)
                )}>
                  {sprint.status}
                </span>
              </div>
              <div className="flex items-center gap-3 mt-1 text-xs text-muted">
                <span>{formatDate(sprint.start_date)} – {formatDate(sprint.end_date)}</span>
                {sprint.days_remaining !== null && sprint.status === 'active' && (
                  <span className="text-accent">{sprint.days_remaining}d remaining</span>
                )}
              </div>
            </div>

            {/* Progress */}
            <div className="flex-shrink-0 text-right">
              <div className="text-sm font-medium text-foreground">
                {sprint.completed_count}/{sprint.issue_count}
              </div>
              <div className="text-xs text-muted">issues done</div>
            </div>

            {/* Arrow */}
            <svg className="w-4 h-4 text-muted flex-shrink-0" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M7.293 14.707a1 1 0 010-1.414L10.586 10 7.293 6.707a1 1 0 011.414-1.414l4 4a1 1 0 010 1.414l-4 4a1 1 0 01-1.414 0z" clipRule="evenodd" />
            </svg>
          </div>
        ))}
      </div>
    </div>
  );
}
