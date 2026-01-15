import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { Editor } from '@/components/Editor';
import { useAuth } from '@/hooks/useAuth';
import { useIssues, Issue } from '@/contexts/IssuesContext';
import { useDocuments } from '@/contexts/DocumentsContext';
import { Combobox } from '@/components/ui/Combobox';
import { EditorSkeleton } from '@/components/ui/Skeleton';
import { useAutoSave } from '@/hooks/useAutoSave';
import { useProgramsQuery } from '@/hooks/useProgramsQuery';
import { useAssignableMembersQuery } from '@/hooks/useTeamMembersQuery';
import { apiPost } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';

interface TeamMember {
  id: string;
  user_id: string;
  name: string;
}

interface Program {
  id: string;
  name: string;
  emoji?: string | null;
  color: string;
}

interface Sprint {
  id: string;
  name: string;
  status: string;
  sprint_number: number;
}

// Compute sprint dates from sprint number (1-week sprints)
function computeSprintDates(sprintNumber: number, workspaceStartDate: Date): { start: Date; end: Date } {
  const start = new Date(workspaceStartDate);
  start.setDate(start.getDate() + (sprintNumber - 1) * 7);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

// Format date range for display (e.g., "Jan 6 - Jan 19")
function formatDateRange(start: Date, end: Date): string {
  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const startMonth = monthNames[start.getMonth()];
  const endMonth = monthNames[end.getMonth()];

  if (startMonth === endMonth) {
    return `${startMonth} ${start.getDate()} - ${end.getDate()}`;
  }
  return `${startMonth} ${start.getDate()} - ${endMonth} ${end.getDate()}`;
}

const API_URL = import.meta.env.VITE_API_URL ?? '';

// Map Program from query to the format needed by combobox
interface ProgramOption {
  id: string;
  name: string;
  prefix: string;
  color: string;
}

interface RejectionDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onReject: (reason: string) => void;
}

function RejectionDialog({ isOpen, onClose, onReject }: RejectionDialogProps) {
  const [reason, setReason] = useState('');

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" role="dialog" aria-modal="true">
      <div className="w-full max-w-md rounded-lg bg-background p-6 shadow-lg">
        <h2 className="mb-4 text-lg font-semibold text-foreground">Reject Issue</h2>
        <p className="mb-4 text-sm text-muted">Please provide a reason for rejecting this issue:</p>
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason for rejection..."
          className="mb-4 w-full rounded border border-border bg-border/50 px-3 py-2 text-sm text-foreground placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-accent"
          rows={3}
        />
        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded px-3 py-1.5 text-sm text-muted hover:text-foreground transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => {
              if (reason.trim()) {
                onReject(reason.trim());
                setReason('');
              }
            }}
            disabled={!reason.trim()}
            className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50 transition-colors"
          >
            Reject
          </button>
        </div>
      </div>
    </div>
  );
}

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

const STATES = [
  { value: 'triage', label: 'Needs Triage' },
  { value: 'backlog', label: 'Backlog' },
  { value: 'todo', label: 'Todo' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'in_review', label: 'In Review' },
  { value: 'done', label: 'Done' },
  { value: 'cancelled', label: 'Cancelled' },
];

const PRIORITIES = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
  { value: 'none', label: 'No Priority' },
];

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
  const { issues, loading: issuesLoading, updateIssue: contextUpdateIssue, refreshIssues } = useIssues();
  const { createDocument } = useDocuments();
  const [sprints, setSprints] = useState<Sprint[]>([]);
  const [workspaceSprintStartDate, setWorkspaceSprintStartDate] = useState<Date | null>(null);

  // Direct-fetched issue (when not found in context cache)
  const [directFetchedIssue, setDirectFetchedIssue] = useState<Issue | null>(null);
  const [directFetchLoading, setDirectFetchLoading] = useState(false);
  const [directFetchFailed, setDirectFetchFailed] = useState(false);

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
  const [sprintError, setSprintError] = useState<string | null>(null);
  const [showRejectDialog, setShowRejectDialog] = useState(false);
  const [showConvertDialog, setShowConvertDialog] = useState(false);
  const [isConverting, setIsConverting] = useState(false);
  const [isUndoing, setIsUndoing] = useState(false);

  // Use TanStack Query for programs and team members (supports offline via cache)
  const { data: programsData = [], isLoading: programsLoading } = useProgramsQuery();
  // Use assignable members only - pending users can't be assigned to issues
  const { data: teamMembersData = [], isLoading: teamMembersLoading } = useAssignableMembersQuery();

  // Map programs to the format needed by combobox
  const programs: ProgramOption[] = programsData.map(p => ({
    id: p.id,
    name: p.name,
    prefix: p.name.substring(0, 3).toUpperCase(), // Generate prefix from name
    color: p.color,
  }));

  // Map team members to format with user_id
  const teamMembers = teamMembersData.map(m => ({
    id: m.id,
    user_id: m.user_id,
    name: m.name,
  }));

  // Get the current issue from context, or use direct-fetched issue
  const contextIssue = issues.find(i => i.id === id) || null;
  const issue = contextIssue || directFetchedIssue;

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
  }, [id, contextIssue, issuesLoading, directFetchLoading, directFetchFailed]);

  // Fetch sprints when issue's program changes with cancellation
  useEffect(() => {
    if (!issue?.program_id) {
      setSprints([]);
      setWorkspaceSprintStartDate(null);
      return;
    }

    let cancelled = false;

    fetch(`${API_URL}/api/programs/${issue.program_id}/sprints`, { credentials: 'include' })
      .then(res => res.ok ? res.json() : { sprints: [], workspace_sprint_start_date: null })
      .then(data => {
        if (!cancelled) {
          setSprints(data.sprints || []);
          if (data.workspace_sprint_start_date) {
            setWorkspaceSprintStartDate(new Date(data.workspace_sprint_start_date));
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSprints([]);
          setWorkspaceSprintStartDate(null);
        }
      });

    return () => { cancelled = true; };
  }, [issue?.program_id]);

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
        setShowRejectDialog(false);
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
        // Navigate to the new project
        navigate(`/projects/${data.new_document.id}`, { replace: true });
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

  // Throttled title save with stale response handling
  const throttledTitleSave = useAutoSave({
    onSave: async (title: string) => {
      if (title) await handleUpdateIssue({ title });
    },
  });

  // Only wait for issues to load - programs/team can load in background
  // This allows the page to render with cached data when offline
  // Also wait for direct fetch if we're fetching an issue not in context
  // We're loading if: issues are loading, OR (not in context AND not fetched AND not failed)
  const needsDirectFetch = !contextIssue && !directFetchedIssue && !directFetchFailed && !id?.startsWith('temp-');
  const loading = issuesLoading || directFetchLoading || (!issuesLoading && needsDirectFetch);

  if (loading) {
    return <EditorSkeleton />;
  }

  // For temp IDs (offline-created issues), create a placeholder issue while waiting for cache sync
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
    _pending: true,
  } : null);

  if (!displayIssue || !user) {
    return null;
  }

  const handleProgramChange = async (programId: string | null) => {
    await handleUpdateIssue({ program_id: programId, sprint_id: null } as Partial<Issue>);
    // Sprints will be fetched automatically via the useEffect when issue.program_id changes
  };

  // Handle back navigation - return to context if available, otherwise issues list
  const handleBack = useCallback(() => {
    if (navContext.from === 'program' && navContext.programId) {
      navigate(`/programs/${navContext.programId}`);
    } else {
      navigate('/issues');
    }
  }, [navigate, navContext]);

  // Escape key handler - return to previous context
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
      headerBadge={
        <span className="rounded bg-border px-2 py-0.5 text-xs font-mono font-medium text-muted whitespace-nowrap" data-testid="ticket-number">
          {displayIssue.display_id}
        </span>
      }
      sidebar={
        <div className="space-y-4 p-4">
          {/* Undo Conversion Banner - show when this issue was converted from another document */}
          {displayIssue.converted_from_id && (
            <div className="mb-4 rounded-lg border border-blue-500/30 bg-blue-500/10 p-3">
              <p className="mb-2 text-sm text-blue-300">This issue was converted from a project.</p>
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
              <p className="mt-1 text-xs text-blue-300/70 text-center">Restore the original project</p>
            </div>
          )}

          {/* Triage Actions - only show for issues in triage state */}
          {displayIssue.state === 'triage' && (
            <div className="mb-4 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
              <p className="mb-3 text-sm font-medium text-amber-300">Needs Triage</p>
              <div className="flex gap-2">
                <button
                  onClick={handleAccept}
                  className="flex-1 rounded bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 transition-colors"
                >
                  Accept
                </button>
                <button
                  onClick={() => setShowRejectDialog(true)}
                  className="flex-1 rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700 transition-colors"
                >
                  Reject
                </button>
              </div>
            </div>
          )}

          <PropertyRow label="Status">
              <select
                value={displayIssue.state}
                onChange={(e) => handleUpdateIssue({ state: e.target.value })}
                aria-label="Status"
                className="w-full rounded bg-border px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
              >
                {STATES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </PropertyRow>

            <PropertyRow label="Priority">
              <select
                value={displayIssue.priority}
                onChange={(e) => handleUpdateIssue({ priority: e.target.value })}
                aria-label="Priority"
                className="w-full rounded bg-border px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
              >
                {PRIORITIES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </PropertyRow>

            <PropertyRow label="Estimate">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  step="0.5"
                  min="0"
                  placeholder="—"
                  aria-label="Estimate in hours"
                  value={displayIssue.estimate ?? ''}
                  onChange={(e) => {
                    const value = e.target.value ? parseFloat(e.target.value) : null;
                    handleUpdateIssue({ estimate: value });
                    if (value) setSprintError(null);
                  }}
                  className="w-20 rounded bg-border px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
                />
                <span className="text-xs text-muted">hours</span>
              </div>
            </PropertyRow>

            <PropertyRow label="Assignee">
              <Combobox
                options={(() => {
                  const options = teamMembers.map((m) => ({ value: m.user_id, label: m.name }));
                  // If current assignee is archived and not in the active team members list, add them
                  if (displayIssue.assignee_id && displayIssue.assignee_archived && displayIssue.assignee_name) {
                    const exists = options.some(o => o.value === displayIssue.assignee_id);
                    if (!exists) {
                      options.unshift({ value: displayIssue.assignee_id, label: `${displayIssue.assignee_name} (archived)` });
                    }
                  }
                  return options;
                })()}
                value={displayIssue.assignee_id}
                onChange={(value) => handleUpdateIssue({ assignee_id: value })}
                placeholder="Unassigned"
                clearLabel="Unassigned"
                searchPlaceholder="Search people..."
                emptyText="No people found"
                aria-label="Assignee"
              />
            </PropertyRow>

            <PropertyRow label="Program">
              <Combobox
                options={programs.map((p) => ({ value: p.id, label: p.name, description: '' }))}
                value={displayIssue.program_id}
                onChange={handleProgramChange}
                placeholder="No Program"
                clearLabel="No Program"
                searchPlaceholder="Search programs..."
                emptyText="No programs found"
                aria-label="Program"
              />
            </PropertyRow>

            {displayIssue.program_id && (
              <PropertyRow label="Sprint">
                <Combobox
                  options={sprints.map((s) => {
                    let dateRange = '';
                    if (workspaceSprintStartDate) {
                      const { start, end } = computeSprintDates(s.sprint_number, workspaceSprintStartDate);
                      dateRange = formatDateRange(start, end);
                    }
                    return { value: s.id, label: s.name, description: dateRange };
                  })}
                  value={displayIssue.sprint_id}
                  onChange={(value) => {
                    if (value && !displayIssue.estimate) {
                      setSprintError('Please add an estimate before assigning to a sprint');
                      return;
                    }
                    setSprintError(null);
                    handleUpdateIssue({ sprint_id: value });
                  }}
                  placeholder="No Sprint"
                  clearLabel="No Sprint"
                  searchPlaceholder="Search sprints..."
                  emptyText="No sprints found"
                  aria-label="Sprint"
                />
                {sprintError && (
                  <p className="mt-1 text-xs text-red-500">{sprintError}</p>
                )}
              </PropertyRow>
            )}

            <PropertyRow label="Source">
              <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium whitespace-nowrap ${
                displayIssue.source === 'external' ? 'bg-purple-500/20 text-purple-300' : 'bg-blue-500/20 text-blue-300'
              }`}>
                {displayIssue.source === 'external' ? 'External' : 'Internal'}
              </span>
            </PropertyRow>

            {displayIssue.state === 'cancelled' && displayIssue.rejection_reason && (
              <PropertyRow label="Rejection Reason">
                <span className="text-sm text-red-300">{displayIssue.rejection_reason}</span>
              </PropertyRow>
            )}

            {/* Document Conversion */}
            <div className="pt-4 mt-4 border-t border-border">
              <button
                onClick={() => setShowConvertDialog(true)}
                className="w-full rounded bg-accent/20 px-3 py-2 text-sm font-medium text-accent hover:bg-accent/30 transition-colors flex items-center justify-center gap-2"
              >
                <svg className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor">
                  <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-8.707l-3-3a1 1 0 00-1.414 1.414L10.586 9H7a1 1 0 100 2h3.586l-1.293 1.293a1 1 0 101.414 1.414l3-3a1 1 0 000-1.414z" clipRule="evenodd" />
                </svg>
                Promote to Project
              </button>
              <p className="mt-1 text-xs text-muted text-center">Convert this issue into a project</p>
            </div>
        </div>
      }
    />
    <RejectionDialog
      isOpen={showRejectDialog}
      onClose={() => setShowRejectDialog(false)}
      onReject={handleReject}
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

function PropertyRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted">{label}</label>
      {children}
    </div>
  );
}
