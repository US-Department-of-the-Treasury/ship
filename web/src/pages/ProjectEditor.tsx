import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
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
import { IncompleteDocumentBanner } from '@/components/IncompleteDocumentBanner';
import { computeICEScore } from '@ship/shared';
import { useToast } from '@/components/ui/Toast';
import { apiPost } from '@/lib/api';

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
  const { projects, loading, updateProject: contextUpdateProject } = useProjects();
  const { programs } = usePrograms();
  const { createDocument } = useDocuments();
  const [people, setPeople] = useState<Person[]>([]);
  const [ownerError, setOwnerError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'details' | 'retro'>('details');
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
  }, [id, navigate, showToast]);

  // Undo conversion (restore original document)
  const handleUndoConversion = useCallback(async () => {
    if (!id) return;
    setIsUndoing(true);
    try {
      const res = await apiPost(`/api/documents/${id}/undo-conversion`, {});
      if (res.ok) {
        const data = await res.json();
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
  }, [id, navigate, showToast]);

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
    _pending: true,
  } : null);

  if (!displayProject || !user) {
    return null;
  }

  const handleOwnerChange = (ownerId: string | null) => {
    if (!ownerId) {
      setOwnerError('Owner is required');
      return;
    }
    setOwnerError(null);
    handleUpdateProject({ owner_id: ownerId } as Partial<Project>);
  };

  // Compute ICE score from current values
  const iceScore = computeICEScore(displayProject.impact, displayProject.confidence, displayProject.ease);

  return (
    <div className="flex h-full flex-col">
      {/* Tab bar for switching between Details and Retro */}
      <div className="border-b border-border px-4">
        <TabBar
          tabs={[
            { id: 'details', label: 'Details' },
            { id: 'retro', label: 'Retro' },
          ]}
          activeTab={activeTab}
          onTabChange={(tabId) => setActiveTab(tabId as 'details' | 'retro')}
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

          {/* Owner (Required) */}
          <PropertyRow label="Owner">
            <PersonCombobox
              people={people}
              value={displayProject.owner?.id || null}
              onChange={handleOwnerChange}
              placeholder="Select owner... (required)"
            />
            {ownerError && (
              <p className="mt-1 text-xs text-red-500">{ownerError}</p>
            )}
            {!displayProject.owner && !ownerError && (
              <p className="mt-1 text-xs text-yellow-500">Owner is required for accountability</p>
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
  value: number;
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
