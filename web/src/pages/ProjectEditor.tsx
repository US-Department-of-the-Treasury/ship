import { useState, useEffect, useCallback, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Editor } from '@/components/Editor';
import { useAuth } from '@/hooks/useAuth';
import { useProjects, Project } from '@/contexts/ProjectsContext';
import { usePrograms } from '@/contexts/ProgramsContext';
import { useDocuments } from '@/contexts/DocumentsContext';
import { cn, getContrastTextColor } from '@/lib/cn';
import { EditorSkeleton } from '@/components/ui/Skeleton';
import { useAutoSave } from '@/hooks/useAutoSave';
import { EmojiPickerPopover } from '@/components/EmojiPicker';
import { PersonCombobox, Person } from '@/components/PersonCombobox';
import { Tooltip } from '@/components/ui/Tooltip';
import { TabBar } from '@/components/ui/TabBar';
import { ProjectRetro } from '@/components/ProjectRetro';
import { KanbanBoard } from '@/components/KanbanBoard';
import { apiPatch } from '@/lib/api';
import { IncompleteDocumentBanner } from '@/components/IncompleteDocumentBanner';
import { computeICEScore } from '@ship/shared';
import { useToast } from '@/components/ui/Toast';
import { issueKeys } from '@/hooks/useIssuesQuery';
import { projectKeys, useProjectIssuesQuery, useProjectSprintsQuery, ProjectIssue, ProjectSprint } from '@/hooks/useProjectsQuery';
import { apiPost } from '@/lib/api';
import { issueStatusColors, priorityColors } from '@/lib/statusColors';
import { useSprintsQuery } from '@/hooks/useSprintsQuery';

const API_URL = import.meta.env.VITE_API_URL ?? '';

const PROJECT_COLORS = [
  '#6366f1', // Indigo
  '#8b5cf6', // Violet
  '#ec4899', // Pink
  '#f43f5e', // Rose
  '#ef4444', // Red
  '#f97316', // Orange
  '#eab308', // Yellow
  '#22c55e', // Green
  '#14b8a6', // Teal
  '#06b6d4', // Cyan
  '#3b82f6', // Blue
];

// ICE score range (1-5)
const ICE_VALUES = [1, 2, 3, 4, 5] as const;

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
  const [ownerError, setOwnerError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'details' | 'issues' | 'sprints' | 'retro'>('details');
  const [issuesViewMode, setIssuesViewMode] = useState<'list' | 'kanban'>(() => {
    if (id) {
      const saved = localStorage.getItem(`project-${id}-view`);
      if (saved === 'kanban') return 'kanban';
    }
    return 'list';
  });
  const [showConvertDialog, setShowConvertDialog] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [isUndoing, setIsUndoing] = useState(false);

  // Inline issue creation state
  const [showInlineIssueInput, setShowInlineIssueInput] = useState(false);
  const [newIssueTitle, setNewIssueTitle] = useState('');
  const [isCreatingIssue, setIsCreatingIssue] = useState(false);

  // Modal issue creation state
  const [showCreateIssueModal, setShowCreateIssueModal] = useState(false);

  // Direct-fetched project (when not found in context cache)
  const [directFetchedProject, setDirectFetchedProject] = useState<Project | null>(null);
  const [directFetchLoading, setDirectFetchLoading] = useState(false);
  const [directFetchFailed, setDirectFetchFailed] = useState(false);

  // Get the current project from context, or use direct-fetched project
  const contextProject = projects.find(p => p.id === id) || null;
  const project = contextProject || directFetchedProject;

  // Fetch project issues
  const { data: projectIssues = [], isLoading: issuesLoading } = useProjectIssuesQuery(id);

  // Fetch project sprints
  const { data: projectSprints = [], isLoading: sprintsLoading } = useProjectSprintsQuery(id);

  // Fetch sprints for the project's program (used in modal)
  const { data: sprintsData } = useSprintsQuery(project?.program_id || undefined);
  const availableSprints = sprintsData?.sprints || [];

  // Issues list sorting state
  const [sortColumn, setSortColumn] = useState<'ticket_number' | 'title' | 'state' | 'priority' | 'assignee_name' | 'updated_at'>('priority');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');

  // Persist view mode to localStorage
  useEffect(() => {
    if (id) {
      localStorage.setItem(`project-${id}-view`, issuesViewMode);
    }
  }, [id, issuesViewMode]);

  // Sort issues
  const sortedIssues = useMemo(() => {
    const priorityOrder = { urgent: 1, high: 2, medium: 3, low: 4, none: 5 };
    const stateOrder = { in_progress: 1, in_review: 2, todo: 3, backlog: 4, triage: 5, done: 6, cancelled: 7 };

    return [...projectIssues].sort((a, b) => {
      let comparison = 0;

      switch (sortColumn) {
        case 'ticket_number':
          comparison = a.ticket_number - b.ticket_number;
          break;
        case 'title':
          comparison = a.title.localeCompare(b.title);
          break;
        case 'state':
          comparison = (stateOrder[a.state as keyof typeof stateOrder] || 99) -
                       (stateOrder[b.state as keyof typeof stateOrder] || 99);
          break;
        case 'priority':
          comparison = (priorityOrder[a.priority as keyof typeof priorityOrder] || 99) -
                       (priorityOrder[b.priority as keyof typeof priorityOrder] || 99);
          break;
        case 'assignee_name':
          comparison = (a.assignee_name || 'zzz').localeCompare(b.assignee_name || 'zzz');
          break;
        case 'updated_at':
          comparison = new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
          break;
      }

      return sortDirection === 'asc' ? comparison : -comparison;
    });
  }, [projectIssues, sortColumn, sortDirection]);

  // Handle column header click for sorting
  const handleSort = useCallback((column: typeof sortColumn) => {
    if (sortColumn === column) {
      setSortDirection(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  }, [sortColumn]);

  // Handle issue state update from kanban drag-drop
  const handleUpdateIssue = useCallback(async (issueId: string, updates: { state: string }) => {
    try {
      const res = await apiPatch(`/api/issues/${issueId}`, updates);
      if (res.ok) {
        // Invalidate project issues to refresh the list
        queryClient.invalidateQueries({ queryKey: projectKeys.issues(id!) });
      } else {
        const error = await res.json();
        showToast(error.error || 'Failed to update issue', 'error');
      }
    } catch (err) {
      console.error('Failed to update issue:', err);
      showToast('Failed to update issue', 'error');
    }
  }, [id, queryClient, showToast]);

  // Handle inline issue creation
  const handleCreateInlineIssue = useCallback(async () => {
    if (!newIssueTitle.trim() || !id || isCreatingIssue) return;

    setIsCreatingIssue(true);
    try {
      // Create the issue with backlog state and program from project
      const res = await apiPost('/api/issues', {
        title: newIssueTitle.trim(),
        state: 'backlog',
        program_id: project?.program_id || null,
      });

      if (res.ok) {
        const newIssue = await res.json();

        // Create association to link issue to this project
        await apiPost(`/api/documents/${newIssue.id}/associations`, {
          related_id: id,
          relationship_type: 'project',
        });

        // Invalidate project issues to refresh the list
        queryClient.invalidateQueries({ queryKey: projectKeys.issues(id) });
        queryClient.invalidateQueries({ queryKey: issueKeys.lists() });

        // Clear input and hide
        setNewIssueTitle('');
        setShowInlineIssueInput(false);
        showToast('Issue created', 'success');
      } else {
        const error = await res.json();
        showToast(error.error || 'Failed to create issue', 'error');
      }
    } catch (err) {
      console.error('Failed to create issue:', err);
      showToast('Failed to create issue', 'error');
    } finally {
      setIsCreatingIssue(false);
    }
  }, [newIssueTitle, id, isCreatingIssue, project?.program_id, queryClient, showToast]);

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

  const handleOwnerChange = (ownerId: string | null) => {
    setOwnerError(null);
    handleUpdateProject({ owner_id: ownerId } as Partial<Project>);
  };

  // Compute ICE score from current values
  const iceScore = computeICEScore(displayProject.impact, displayProject.confidence, displayProject.ease);

  return (
    <div className="flex h-full flex-col">
      {/* Tab bar for switching between Details, Issues, and Retro */}
      <div className="border-b border-border px-4">
        <TabBar
          tabs={[
            { id: 'details', label: 'Details' },
            { id: 'issues', label: `Issues${projectIssues.length > 0 ? ` (${projectIssues.length})` : ''}` },
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
        <div className="space-y-4 p-4">
          {/* Undo Conversion Banner - show when this project was converted from another document */}
          {displayProject.converted_from_id && (
            <div className="mb-4 rounded-lg border border-blue-500/30 bg-blue-500/10 p-3">
              <p className="mb-2 text-sm text-blue-300">This project was promoted from an issue.</p>
              <button
                onClick={handleUndoConversion}
                disabled={isUndoing}
                className="w-full rounded bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center justify-center gap-2"
              >
                {isUndoing ? (
                  <>
                    <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                    </svg>
                    Undoing...
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M7.707 3.293a1 1 0 010 1.414L5.414 7H11a7 7 0 017 7v2a1 1 0 11-2 0v-2a5 5 0 00-5-5H5.414l2.293 2.293a1 1 0 11-1.414 1.414l-4-4a1 1 0 010-1.414l4-4a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    Undo Conversion
                  </>
                )}
              </button>
              <p className="mt-1 text-xs text-blue-300/70 text-center">Restore the original issue</p>
            </div>
          )}

          {/* ICE Score Display */}
          <div className="rounded-lg border border-border bg-accent/10 p-3">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-medium text-muted uppercase tracking-wide">ICE Score</span>
              <span className="text-2xl font-bold text-accent tabular-nums">{iceScore}</span>
            </div>
            <div className="text-xs text-muted">
              {displayProject.impact} × {displayProject.confidence} × {displayProject.ease} = {iceScore}
            </div>
          </div>

          {/* Impact Slider */}
          <PropertyRow
            label="Impact"
            tooltip={`Expected value in next 12 months:\n5 - More than $1b\n4 - More than $100m\n3 - More than $10m\n2 - More than $1m\n1 - More than $100k`}
          >
            <p className="text-xs text-muted mb-2">How much value will this deliver?</p>
            <ICESlider
              value={displayProject.impact}
              onChange={(value) => handleUpdateProject({ impact: value })}
              aria-label="Impact"
            />
          </PropertyRow>

          {/* Confidence Slider */}
          <PropertyRow
            label="Confidence"
            tooltip={`How likely is this to succeed?\n5 - 100% certain, trivial complexity\n4 - 80% certain, familiar territory\n3 - 60% certain, somewhat complex\n2 - 40% certain, somewhat novel\n1 - 20% certain, pathfinding required`}
          >
            <p className="text-xs text-muted mb-2">How sure are we about the outcome?</p>
            <ICESlider
              value={displayProject.confidence}
              onChange={(value) => handleUpdateProject({ confidence: value })}
              aria-label="Confidence"
            />
          </PropertyRow>

          {/* Ease Slider */}
          <PropertyRow
            label="Ease"
            tooltip={`Labor hours to deliver:\n5 - Less than 1 week\n4 - Less than 1 month\n3 - Less than 1 quarter\n2 - Less than 1 year\n1 - More than 1 year`}
          >
            <p className="text-xs text-muted mb-2">How easy is this to implement?</p>
            <ICESlider
              value={displayProject.ease}
              onChange={(value) => handleUpdateProject({ ease: value })}
              aria-label="Ease"
            />
          </PropertyRow>

          {/* Owner */}
          <PropertyRow label="Owner">
            <PersonCombobox
              people={people}
              value={displayProject.owner?.id || null}
              onChange={handleOwnerChange}
              placeholder="Select owner..."
            />
            {ownerError && (
              <p className="mt-1 text-xs text-red-500">{ownerError}</p>
            )}
          </PropertyRow>

          {/* Icon (Emoji) */}
          <PropertyRow label="Icon">
            <EmojiPickerPopover
              value={displayProject.emoji}
              onChange={(emoji) => handleUpdateProject({ emoji })}
            >
              <div
                className="flex h-10 w-10 items-center justify-center rounded-lg text-lg cursor-pointer hover:ring-2 hover:ring-accent transition-all"
                style={{ backgroundColor: displayProject.color, color: getContrastTextColor(displayProject.color) }}
              >
                {displayProject.emoji || displayProject.title?.[0]?.toUpperCase() || '?'}
              </div>
            </EmojiPickerPopover>
            <p className="mt-1 text-xs text-muted">Click to change</p>
          </PropertyRow>

          {/* Color */}
          <PropertyRow label="Color">
            <div className="flex flex-wrap gap-1.5">
              {PROJECT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => handleUpdateProject({ color: c })}
                  className={cn(
                    'h-6 w-6 rounded-full transition-transform',
                    displayProject.color === c ? 'ring-2 ring-white ring-offset-1 ring-offset-background scale-110' : 'hover:scale-105'
                  )}
                  style={{ backgroundColor: c }}
                  aria-label={`Select ${c} color`}
                />
              ))}
            </div>
          </PropertyRow>

          {/* Program (Optional) */}
          <PropertyRow label="Program">
            <select
              value={displayProject.program_id || ''}
              onChange={(e) => handleUpdateProject({ program_id: e.target.value || null })}
              className="w-full h-9 text-sm bg-transparent border border-border rounded-md px-2 text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
            >
              <option value="">No program</option>
              {programs.map((program) => (
                <option key={program.id} value={program.id}>
                  {program.emoji ? `${program.emoji} ` : ''}{program.name}
                </option>
              ))}
            </select>
          </PropertyRow>

          {/* Stats */}
          <div className="pt-4 border-t border-border space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted">Sprints</span>
              <span className="text-foreground">{displayProject.sprint_count}</span>
            </div>
            <div className="flex items-center justify-between text-xs">
              <span className="text-muted">Issues</span>
              <span className="text-foreground">{displayProject.issue_count}</span>
            </div>
          </div>

          {/* Document Conversion */}
          <div className="pt-4 mt-4 border-t border-border">
            <button
              onClick={() => setShowConvertDialog(true)}
              className="w-full rounded bg-border px-3 py-2 text-sm font-medium text-muted hover:bg-border/80 hover:text-foreground transition-colors flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.707-10.293a1 1 0 00-1.414-1.414l-3 3a1 1 0 000 1.414l3 3a1 1 0 001.414-1.414L9.414 11H13a1 1 0 100-2H9.414l1.293-1.293z" clipRule="evenodd" />
              </svg>
              Convert to Issue
            </button>
            <p className="mt-1 text-xs text-muted text-center">Convert this project into an issue</p>
          </div>
        </div>
            }
          />
        ) : activeTab === 'issues' ? (
          <div className="h-full flex flex-col">
            {/* Toolbar with add button and view toggle */}
            <div className="flex items-center justify-between gap-2 px-4 py-2 border-b border-border">
              {/* Add issue buttons */}
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setShowInlineIssueInput(true)}
                  className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium text-muted hover:text-foreground hover:bg-accent/10 rounded transition-colors"
                  aria-label="Add new issue"
                >
                  <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                  </svg>
                  Add Issue
                </button>
                <button
                  onClick={() => setShowCreateIssueModal(true)}
                  className="flex items-center gap-1.5 px-2 py-1 text-xs font-medium bg-accent text-white rounded hover:bg-accent/90 transition-colors"
                  aria-label="Create new issue with full form"
                >
                  <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M6 2a2 2 0 00-2 2v12a2 2 0 002 2h8a2 2 0 002-2V7.414A2 2 0 0015.414 6L12 2.586A2 2 0 0010.586 2H6zm5 6a1 1 0 10-2 0v2H7a1 1 0 100 2h2v2a1 1 0 102 0v-2h2a1 1 0 100-2h-2V8z" clipRule="evenodd" />
                  </svg>
                  New Issue
                </button>
              </div>

              {/* View toggle */}
              <div className="flex items-center rounded-md bg-border/30 p-0.5">
                <button
                  onClick={() => setIssuesViewMode('list')}
                  className={cn(
                    'flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded transition-colors',
                    issuesViewMode === 'list'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted hover:text-foreground'
                  )}
                  aria-pressed={issuesViewMode === 'list'}
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M3 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm0 4a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1z" clipRule="evenodd" />
                  </svg>
                  List
                </button>
                <button
                  onClick={() => setIssuesViewMode('kanban')}
                  className={cn(
                    'flex items-center gap-1.5 px-2 py-1 text-xs font-medium rounded transition-colors',
                    issuesViewMode === 'kanban'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted hover:text-foreground'
                  )}
                  aria-pressed={issuesViewMode === 'kanban'}
                >
                  <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                    <path d="M5 3a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2V5a2 2 0 00-2-2H5zm0 2h3v10H5V5zm5 0h3v10h-3V5zm5 0h0v10h0V5z" />
                  </svg>
                  Board
                </button>
              </div>
            </div>

            {/* Inline issue creation input */}
            {showInlineIssueInput && (
              <div className="px-4 py-2 border-b border-border bg-accent/5">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={newIssueTitle}
                    onChange={(e) => setNewIssueTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && newIssueTitle.trim()) {
                        handleCreateInlineIssue();
                      } else if (e.key === 'Escape') {
                        setShowInlineIssueInput(false);
                        setNewIssueTitle('');
                      }
                    }}
                    placeholder="Issue title..."
                    className="flex-1 bg-transparent border border-border rounded px-2 py-1.5 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent"
                    autoFocus
                    disabled={isCreatingIssue}
                  />
                  <button
                    onClick={handleCreateInlineIssue}
                    disabled={!newIssueTitle.trim() || isCreatingIssue}
                    className="px-3 py-1.5 text-xs font-medium bg-accent text-white rounded hover:bg-accent/90 disabled:opacity-50 transition-colors"
                  >
                    {isCreatingIssue ? 'Creating...' : 'Create'}
                  </button>
                  <button
                    onClick={() => {
                      setShowInlineIssueInput(false);
                      setNewIssueTitle('');
                    }}
                    disabled={isCreatingIssue}
                    className="px-2 py-1.5 text-xs text-muted hover:text-foreground transition-colors"
                  >
                    Cancel
                  </button>
                </div>
                <p className="mt-1 text-xs text-muted">Press Enter to create, Escape to cancel</p>
              </div>
            )}

            {/* View content */}
            <div className="flex-1 overflow-hidden">
              {issuesViewMode === 'list' ? (
                <ProjectIssuesList
                  issues={sortedIssues}
                  loading={issuesLoading}
                  sortColumn={sortColumn}
                  sortDirection={sortDirection}
                  onSort={handleSort}
                  onIssueClick={(issueId) => navigate(`/issues/${issueId}`)}
                />
              ) : (
                <KanbanBoard
                  issues={projectIssues}
                  onUpdateIssue={handleUpdateIssue}
                  onIssueClick={(issueId) => navigate(`/issues/${issueId}`)}
                />
              )}
            </div>
          </div>
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

      {/* Create Issue Modal */}
      <CreateIssueModal
        isOpen={showCreateIssueModal}
        onClose={() => setShowCreateIssueModal(false)}
        projectId={id!}
        projectTitle={displayProject.title}
        programId={displayProject.program_id}
        people={people}
        sprints={availableSprints}
        onIssueCreated={() => {
          queryClient.invalidateQueries({ queryKey: projectKeys.issues(id!) });
          queryClient.invalidateQueries({ queryKey: issueKeys.lists() });
          showToast('Issue created', 'success');
        }}
      />

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

function PropertyRow({ label, tooltip, children }: { label: string; tooltip?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 flex items-center gap-1">
        <label className="text-xs font-medium text-muted">{label}</label>
        {tooltip && (
          <Tooltip content={tooltip} side="right" delayDuration={200}>
            <button
              type="button"
              className="text-muted/60 hover:text-muted transition-colors"
              aria-label={`More info about ${label}`}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 20 20" fill="currentColor">
                <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a.75.75 0 000 1.5h.253a.25.25 0 01.244.304l-.459 2.066A1.75 1.75 0 0010.747 15H11a.75.75 0 000-1.5h-.253a.25.25 0 01-.244-.304l.459-2.066A1.75 1.75 0 009.253 9H9z" clipRule="evenodd" />
              </svg>
            </button>
          </Tooltip>
        )}
      </div>
      {children}
    </div>
  );
}

// ICE Slider component (1-5 segmented buttons)
function ICESlider({
  value,
  onChange,
  'aria-label': ariaLabel,
}: {
  value: number | null;
  onChange: (value: number) => void;
  'aria-label': string;
}) {
  return (
    <div className="flex gap-1" role="group" aria-label={ariaLabel}>
      {ICE_VALUES.map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          aria-pressed={value === v}
          className={cn(
            'flex-1 py-1.5 text-sm font-medium rounded transition-colors',
            value === v
              ? 'bg-accent text-white'
              : 'bg-border/50 text-muted hover:bg-border hover:text-foreground'
          )}
        >
          {v}
        </button>
      ))}
    </div>
  );
}

// Conversion dialog component
interface ConversionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onConvert: () => void;
  sourceType: 'issue' | 'project';
  title: string;
  isConverting?: boolean;
}

function ConversionDialog({ isOpen, onClose, onConvert, sourceType, title, isConverting }: ConversionDialogProps) {
  // Handle Escape key
  useEffect(() => {
    if (!isOpen || isConverting) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isConverting, onClose]);

  if (!isOpen) return null;

  const targetType = sourceType === 'issue' ? 'project' : 'issue';
  const actionLabel = sourceType === 'issue' ? 'Promote to Project' : 'Convert to Issue';

  // Handle click outside dialog
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !isConverting) {
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" role="dialog" aria-modal="true" onClick={handleBackdropClick}>
      <div className="w-full max-w-md rounded-lg bg-background p-6 shadow-lg">
        <h2 className="mb-4 text-lg font-semibold text-foreground">{actionLabel}</h2>
        <p className="mb-4 text-sm text-foreground">
          Convert <strong>"{title}"</strong> from {sourceType} to {targetType}?
        </p>
        <div className="mb-4 rounded bg-amber-500/10 border border-amber-500/30 p-3">
          <p className="text-sm text-amber-300 font-medium mb-2">What will happen:</p>
          <ul className="text-xs text-muted space-y-1">
            <li>• A new {targetType} will be created with the same title and content</li>
            <li>• The original {sourceType} will be archived</li>
            <li>• Links to the old {sourceType} will redirect to the new {targetType}</li>
            {sourceType === 'issue' && (
              <li>• Issue properties (state, priority, assignee) will be reset</li>
            )}
            {sourceType === 'project' && (
              <>
                <li>• Project properties (ICE scores, owner) will be reset</li>
                <li>• Child issues will be orphaned (unlinked from project)</li>
              </>
            )}
          </ul>
        </div>
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            disabled={isConverting}
            className="rounded px-3 py-1.5 text-sm text-muted hover:text-foreground transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={onConvert}
            disabled={isConverting}
            className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50 transition-colors flex items-center gap-2"
          >
            {isConverting ? (
              <>
                <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Converting...
              </>
            ) : (
              actionLabel
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

// Project Issues List component - sortable table of child issues
interface ProjectIssuesListProps {
  issues: ProjectIssue[];
  loading: boolean;
  sortColumn: 'ticket_number' | 'title' | 'state' | 'priority' | 'assignee_name' | 'updated_at';
  sortDirection: 'asc' | 'desc';
  onSort: (column: ProjectIssuesListProps['sortColumn']) => void;
  onIssueClick: (issueId: string) => void;
}

function ProjectIssuesList({
  issues,
  loading,
  sortColumn,
  sortDirection,
  onSort,
  onIssueClick,
}: ProjectIssuesListProps) {
  // Column header with sort indicator
  const SortHeader = ({
    column,
    label,
    className = '',
  }: {
    column: ProjectIssuesListProps['sortColumn'];
    label: string;
    className?: string;
  }) => (
    <th
      className={cn(
        'px-3 py-2 text-left text-xs font-medium text-muted uppercase tracking-wide cursor-pointer hover:text-foreground transition-colors select-none',
        className
      )}
      onClick={() => onSort(column)}
    >
      <div className="flex items-center gap-1">
        {label}
        {sortColumn === column && (
          <svg
            className={cn('w-3 h-3 transition-transform', sortDirection === 'desc' && 'rotate-180')}
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        )}
      </div>
    </th>
  );

  // Format state label for display
  const formatState = (state: string) => {
    return state.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  };

  // Format priority label for display
  const formatPriority = (priority: string) => {
    return priority.charAt(0).toUpperCase() + priority.slice(1);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <div className="flex items-center gap-2 text-muted">
          <svg className="w-5 h-5 animate-spin" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
          </svg>
          Loading issues...
        </div>
      </div>
    );
  }

  if (issues.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-48 text-muted">
        <svg className="w-12 h-12 mb-3 opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <p className="text-sm font-medium">No issues in this project</p>
        <p className="text-xs mt-1">Add issues to this project from the issue sidebar</p>
      </div>
    );
  }

  return (
    <div className="h-full overflow-auto">
      <table className="w-full">
        <thead className="sticky top-0 bg-background border-b border-border">
          <tr>
            <SortHeader column="ticket_number" label="#" className="w-16" />
            <SortHeader column="title" label="Title" />
            <SortHeader column="state" label="Status" className="w-28" />
            <SortHeader column="priority" label="Priority" className="w-24" />
            <SortHeader column="assignee_name" label="Assignee" className="w-32" />
          </tr>
        </thead>
        <tbody>
          {issues.map((issue) => (
            <tr
              key={issue.id}
              onClick={() => onIssueClick(issue.id)}
              className="border-b border-border/50 hover:bg-accent/5 cursor-pointer transition-colors"
            >
              <td className="px-3 py-2 text-sm text-muted tabular-nums">
                {issue.ticket_number}
              </td>
              <td className="px-3 py-2 text-sm text-foreground truncate max-w-md">
                {issue.title}
              </td>
              <td className="px-3 py-2">
                <span className={cn(
                  'inline-flex px-2 py-0.5 text-xs font-medium rounded',
                  issueStatusColors[issue.state] || 'bg-gray-500/20 text-gray-300'
                )}>
                  {formatState(issue.state)}
                </span>
              </td>
              <td className="px-3 py-2">
                <span className={cn(
                  'text-xs font-medium',
                  priorityColors[issue.priority] || 'text-muted'
                )}>
                  {formatPriority(issue.priority)}
                </span>
              </td>
              <td className="px-3 py-2 text-sm text-muted truncate">
                {issue.assignee_name || '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// Create Issue Modal component
interface CreateIssueModalProps {
  isOpen: boolean;
  onClose: () => void;
  projectId: string;
  projectTitle: string;
  programId: string | null;
  people: Person[];
  sprints: { id: string; name: string; sprint_number: number }[];
  onIssueCreated: () => void;
}

const PRIORITIES = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
  { value: 'none', label: 'None' },
];

function CreateIssueModal({
  isOpen,
  onClose,
  projectId,
  projectTitle,
  programId,
  people,
  sprints,
  onIssueCreated,
}: CreateIssueModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState('medium');
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [sprintId, setSprintId] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setTitle('');
      setDescription('');
      setPriority('medium');
      setAssigneeId(null);
      setSprintId('');
      setError(null);
    }
  }, [isOpen]);

  // Handle Escape key
  useEffect(() => {
    if (!isOpen || isSubmitting) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, isSubmitting, onClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      setError('Title is required');
      return;
    }

    setIsSubmitting(true);
    setError(null);

    try {
      // Create the issue
      const res = await apiPost('/api/issues', {
        title: title.trim(),
        state: 'backlog',
        priority,
        assignee_id: assigneeId,
        sprint_id: sprintId || null,
        program_id: programId,
      });

      if (!res.ok) {
        const errData = await res.json();
        throw new Error(errData.error || 'Failed to create issue');
      }

      const newIssue = await res.json();

      // Create association to link issue to the project
      const assocRes = await apiPost(`/api/documents/${newIssue.id}/associations`, {
        related_id: projectId,
        relationship_type: 'project',
      });

      if (!assocRes.ok) {
        console.warn('Failed to create project association');
      }

      // Success
      onIssueCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create issue');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Handle backdrop click
  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget && !isSubmitting) {
      onClose();
    }
  };

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="dialog"
      aria-modal="true"
      onClick={handleBackdropClick}
    >
      <div className="w-full max-w-lg rounded-lg bg-background p-6 shadow-lg max-h-[90vh] overflow-y-auto">
        <h2 className="mb-4 text-lg font-semibold text-foreground">Create Issue</h2>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Project (read-only) */}
          <div>
            <label className="block text-xs font-medium text-muted mb-1">Project</label>
            <div className="w-full h-9 flex items-center px-3 text-sm bg-border/30 border border-border rounded-md text-foreground/70">
              {projectTitle}
            </div>
          </div>

          {/* Title */}
          <div>
            <label htmlFor="issue-title" className="block text-xs font-medium text-muted mb-1">
              Title <span className="text-red-500">*</span>
            </label>
            <input
              id="issue-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Issue title..."
              className="w-full h-9 px-3 text-sm bg-transparent border border-border rounded-md text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent"
              autoFocus
              disabled={isSubmitting}
            />
          </div>

          {/* Description */}
          <div>
            <label htmlFor="issue-description" className="block text-xs font-medium text-muted mb-1">
              Description
            </label>
            <textarea
              id="issue-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Add a description..."
              rows={4}
              className="w-full px-3 py-2 text-sm bg-transparent border border-border rounded-md text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent resize-none"
              disabled={isSubmitting}
            />
          </div>

          {/* Priority */}
          <div>
            <label htmlFor="issue-priority" className="block text-xs font-medium text-muted mb-1">
              Priority
            </label>
            <select
              id="issue-priority"
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="w-full h-9 text-sm bg-transparent border border-border rounded-md px-2 text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
              disabled={isSubmitting}
            >
              {PRIORITIES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>

          {/* Assignee */}
          <div>
            <label className="block text-xs font-medium text-muted mb-1">Assignee</label>
            <PersonCombobox
              people={people}
              value={assigneeId}
              onChange={setAssigneeId}
              placeholder="Select assignee..."
            />
          </div>

          {/* Sprint */}
          <div>
            <label htmlFor="issue-sprint" className="block text-xs font-medium text-muted mb-1">
              Sprint
            </label>
            <select
              id="issue-sprint"
              value={sprintId}
              onChange={(e) => setSprintId(e.target.value)}
              className="w-full h-9 text-sm bg-transparent border border-border rounded-md px-2 text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
              disabled={isSubmitting || sprints.length === 0}
            >
              <option value="">No sprint</option>
              {sprints.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name || `Sprint ${s.sprint_number}`}
                </option>
              ))}
            </select>
            {sprints.length === 0 && (
              <p className="mt-1 text-xs text-muted">No sprints available for this program</p>
            )}
          </div>

          {/* Error message */}
          {error && (
            <div className="rounded bg-red-500/10 border border-red-500/30 p-3">
              <p className="text-sm text-red-400">{error}</p>
            </div>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="rounded px-3 py-1.5 text-sm text-muted hover:text-foreground transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting || !title.trim()}
              className="rounded bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-50 transition-colors flex items-center gap-2"
            >
              {isSubmitting ? (
                <>
                  <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Creating...
                </>
              ) : (
                'Create Issue'
              )}
            </button>
          </div>
        </form>
      </div>
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
    <div className="h-full overflow-auto p-4">
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
