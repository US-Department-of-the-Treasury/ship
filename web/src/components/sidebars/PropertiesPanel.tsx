/**
 * PropertiesPanel - Unified sidebar component that renders type-specific properties
 *
 * This component consolidates the 4 type-specific sidebars into a single entry point.
 * It adapts based on document_type while maintaining the same rendering patterns.
 */
import { useMemo, useCallback, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { WikiSidebar } from '@/components/sidebars/WikiSidebar';
import { IssueSidebar } from '@/components/sidebars/IssueSidebar';
import { ProjectSidebar } from '@/components/sidebars/ProjectSidebar';
import { WeekSidebar } from '@/components/sidebars/WeekSidebar';
import { ProgramSidebar } from '@/components/sidebars/ProgramSidebar';
import { ContentHistoryPanel } from '@/components/ContentHistoryPanel';
import { PlanQualityAssistant, RetroQualityAssistant } from '@/components/sidebars/QualityAssistant';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useAuth } from '@/hooks/useAuth';
import { apiGet, apiPost } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useReviewQueue } from '@/contexts/ReviewQueueContext';
import type { Person } from '@/components/PersonCombobox';
import type { BelongsTo, ApprovalTracking } from '@ship/shared';

// Document types that have properties panels
export type PanelDocumentType = 'wiki' | 'issue' | 'project' | 'sprint' | 'program' | 'weekly_plan' | 'weekly_retro';

// Base document interface
interface BaseDocument {
  id: string;
  title: string;
  document_type: string;
  created_at?: string;
  updated_at?: string;
  created_by?: string | null;
  properties?: Record<string, unknown>;
}

// Wiki document properties
interface WikiDocument extends BaseDocument {
  document_type: 'wiki';
  parent_id?: string | null;
  visibility?: 'private' | 'workspace';
}

// Issue document properties
interface IssueDocument extends BaseDocument {
  document_type: 'issue';
  state: string;
  priority: string;
  estimate: number | null;
  assignee_id: string | null;
  assignee_name?: string | null;
  assignee_archived?: boolean;
  program_id: string | null;
  sprint_id: string | null;
  source?: 'internal' | 'external';
  rejection_reason?: string | null;
  converted_from_id?: string | null;
  belongs_to?: BelongsTo[];
}

// Project document properties
interface ProjectDocument extends BaseDocument {
  document_type: 'project';
  impact: number | null;
  confidence: number | null;
  ease: number | null;
  ice_score?: number | null;
  color: string;
  emoji: string | null;
  program_id: string | null;
  owner?: { id: string; name: string; email: string } | null;
  owner_id?: string | null;
  // RACI fields
  accountable_id?: string | null;
  consulted_ids?: string[];
  informed_ids?: string[];
  sprint_count?: number;
  issue_count?: number;
  converted_from_id?: string | null;
  // Approval tracking
  plan?: string | null;
  plan_approval?: ApprovalTracking | null;
  retro_approval?: ApprovalTracking | null;
  has_retro?: boolean;
}

// Sprint document properties
interface SprintDocument extends BaseDocument {
  document_type: 'sprint';
  status: 'planning' | 'active' | 'completed';
  program_id: string | null;
  program_name?: string;
  program_accountable_id?: string | null;
  issue_count?: number;
  completed_count?: number;
  plan?: string;
  owner?: { id: string; name: string; email: string } | null;
  owner_id?: string | null;
  // Approval tracking
  plan_approval?: ApprovalTracking | null;
  review_approval?: ApprovalTracking | null;
  accountable_id?: string | null;
  has_review?: boolean;
}

// Program document properties
interface ProgramDocument extends BaseDocument {
  document_type: 'program';
  color?: string;
  emoji?: string | null;
  owner_id?: string | null;
  // RACI fields
  accountable_id?: string | null;
  consulted_ids?: string[];
  informed_ids?: string[];
}

// Weekly plan document properties
interface WeeklyPlanDocument extends BaseDocument {
  document_type: 'weekly_plan';
  properties?: {
    person_id?: string;
    project_id?: string;
    week_number?: number;
    submitted_at?: string | null;
  };
}

// Weekly retro document properties
interface WeeklyRetroDocument extends BaseDocument {
  document_type: 'weekly_retro';
  properties?: {
    person_id?: string;
    project_id?: string;
    week_number?: number;
    submitted_at?: string | null;
  };
}

// Union type for all documents
export type PanelDocument = WikiDocument | IssueDocument | ProjectDocument | SprintDocument | ProgramDocument | WeeklyPlanDocument | WeeklyRetroDocument;

// Props for wiki panel
interface WikiPanelProps {
  teamMembers: Person[];
  currentUserId?: string;
}

// Props for issue panel
interface IssuePanelProps {
  teamMembers: Array<{ id: string; user_id: string; name: string }>;
  programs: Array<{ id: string; name: string; color?: string }>;
  projects?: Array<{ id: string; title: string; color?: string }>;
  onConvert?: () => void;
  onUndoConversion?: () => void;
  onAccept?: () => Promise<void>;
  onReject?: (reason: string) => Promise<void>;
  isConverting?: boolean;
  isUndoing?: boolean;
  onAssociationChange?: () => void;
}

// Props for project panel
interface ProjectPanelProps {
  programs: Array<{ id: string; name: string; color: string; emoji?: string | null }>;
  people: Person[];
  onConvert?: () => void;
  onUndoConversion?: () => void;
  isConverting?: boolean;
  isUndoing?: boolean;
  /** Whether current user can approve (is accountable or workspace admin) */
  canApprove?: boolean;
  /** Map of user ID to name for displaying approver */
  userNames?: Record<string, string>;
  /** Callback when approval state changes */
  onApprovalUpdate?: () => void;
}

// Props for sprint panel
interface SprintPanelProps {
  people?: Array<{ id: string; user_id: string; name: string }>;
  existingSprints?: Array<{ owner?: { id: string; name: string; email: string } | null }>;
  /** Whether current user can approve (is accountable or workspace admin) */
  canApprove?: boolean;
  /** Map of user ID to name for displaying approver */
  userNames?: Record<string, string>;
  /** Callback when approval state changes */
  onApprovalUpdate?: () => void;
}

// Props for program panel
interface ProgramPanelProps {
  people: Person[];
}

// Combined props type that includes all panel-specific props
type PanelSpecificProps = WikiPanelProps | IssuePanelProps | ProjectPanelProps | SprintPanelProps | ProgramPanelProps;

interface PropertiesPanelProps {
  /** The document to render properties for */
  document: PanelDocument;
  /** Type-specific data required for rendering */
  panelProps: PanelSpecificProps;
  /** Handler for document updates */
  onUpdate: (updates: Partial<PanelDocument>) => Promise<void>;
  /** Fields to highlight as missing (e.g., after type conversion) */
  highlightedFields?: string[];
}

// OPM 5-level performance rating scale
const OPM_RATINGS = [
  { value: 5, label: 'Outstanding', color: 'text-green-500' },
  { value: 4, label: 'Exceeds Expectations', color: 'text-blue-500' },
  { value: 3, label: 'Fully Successful', color: 'text-muted' },
  { value: 2, label: 'Minimally Satisfactory', color: 'text-orange-500' },
  { value: 1, label: 'Unacceptable', color: 'text-red-500' },
] as const;

/**
 * WeeklyDocumentSidebar - Renders sidebar for weekly_plan/weekly_retro documents
 * with human-readable names instead of UUIDs.
 * In review mode (?review=true&sprintId=X), shows approve/rate controls.
 */
function WeeklyDocumentSidebar({
  document,
}: {
  document: WeeklyPlanDocument | WeeklyRetroDocument;
}) {
  const [searchParams] = useSearchParams();
  const isReviewMode = searchParams.get('review') === 'true';
  const sprintId = searchParams.get('sprintId');

  const docProperties = document.properties || {};
  const weekNumber = docProperties.week_number as number | undefined;
  const personId = docProperties.person_id as string | undefined;
  const projectId = docProperties.project_id as string | undefined;

  const isRetro = document.document_type === 'weekly_retro';
  const reviewQueue = useReviewQueue();
  const queueActive = reviewQueue?.state.active ?? false;

  // Review action state (local only — approval data comes from queries)
  const [selectedRating, setSelectedRating] = useState<number | null>(null);
  const [approving, setApproving] = useState(false);
  // Local override after approve/unapprove action (cleared on navigation)
  const [localApprovalOverride, setLocalApprovalOverride] = useState<{ state: string | null; at: string | null } | null>(null);

  // Fetch person name
  const { data: personDoc } = useQuery<{ title: string }>({
    queryKey: ['document', personId],
    queryFn: async () => {
      const res = await apiGet(`/api/documents/${personId}`);
      if (!res.ok) throw new Error('Failed to fetch person');
      return res.json();
    },
    enabled: !!personId,
  });

  // Fetch project name
  const { data: projectDoc } = useQuery<{ title: string }>({
    queryKey: ['document', projectId],
    queryFn: async () => {
      const res = await apiGet(`/api/documents/${projectId}`);
      if (!res.ok) throw new Error('Failed to fetch project');
      return res.json();
    },
    enabled: !!projectId,
  });

  // Fetch sprint data with approval state + approver name in a single query
  const { data: sprintData } = useQuery<{ id: string; properties: Record<string, unknown>; approverName?: string }>({
    queryKey: ['sprint-approval-v2', sprintId || `lookup-${projectId}-${weekNumber}`],
    queryFn: async () => {
      let sid = sprintId;
      if (!sid) {
        const lookupRes = await apiGet(`/api/weeks/lookup?project_id=${projectId}&sprint_number=${weekNumber}`);
        if (!lookupRes.ok) throw new Error('Sprint not found');
        const lookup = await lookupRes.json();
        sid = lookup.id;
      }
      const res = await apiGet(`/api/documents/${sid}`);
      if (!res.ok) throw new Error('Failed to fetch sprint');
      const data = await res.json();

      // Resolve approver name if there's an approval
      const props = data.properties || {};
      const approval = isRetro ? props.review_approval : props.plan_approval;
      if (approval?.approved_by) {
        const personRes = await fetch(`${import.meta.env.VITE_API_URL ?? ''}/api/weeks/lookup-person?user_id=${approval.approved_by}`, { credentials: 'include' });
        if (personRes.ok) {
          const person = await personRes.json();
          data.approverName = person.title;
        }
      }
      return data;
    },
    enabled: !!sprintId || (!!projectId && !!weekNumber),
  });

  const effectiveSprintId = sprintData?.id || sprintId || null;

  // Derive approval state from sprint data (or local override after action)
  const sprintProps = sprintData?.properties || {};
  const planApproval = sprintProps.plan_approval as { state?: string; approved_by?: string; approved_at?: string } | null;
  const reviewApproval = sprintProps.review_approval as { state?: string; approved_by?: string; approved_at?: string } | null;
  const reviewRating = sprintProps.review_rating as { value?: number } | null;

  const approvalState = localApprovalOverride !== null
    ? localApprovalOverride.state
    : (isRetro ? reviewApproval?.state : planApproval?.state) || null;
  const approvedAt = localApprovalOverride !== null
    ? localApprovalOverride.at
    : (isRetro ? reviewApproval?.approved_at : planApproval?.approved_at) || null;
  const approverName = sprintData?.approverName || null;
  const currentRating = reviewRating?.value || null;

  const personName = personDoc?.title || (personId ? `${personId.substring(0, 8)}...` : null);
  const projectName = projectDoc?.title || (projectId ? `${projectId.substring(0, 8)}...` : null);

  async function handleApprovePlan() {
    if (!effectiveSprintId || approving) return;
    setApproving(true);
    try {
      const res = await apiPost(`/api/weeks/${effectiveSprintId}/approve-plan`);
      if (res.ok) {
        setLocalApprovalOverride({ state: 'approved', at: new Date().toISOString() });
        if (queueActive) reviewQueue?.advance();
      } else {
        console.error('Failed to approve plan:', res.status, await res.text().catch(() => ''));
      }
    } catch (err) {
      console.error('Error approving plan:', err);
    } finally {
      setApproving(false);
    }
  }

  async function handleUnapprovePlan() {
    if (!effectiveSprintId || approving) return;
    setApproving(true);
    try {
      const res = await apiPost(`/api/weeks/${effectiveSprintId}/unapprove-plan`);
      if (res.ok) {
        setLocalApprovalOverride({ state: null, at: null });
      } else {
        console.error('Failed to unapprove plan:', res.status, await res.text().catch(() => ''));
      }
    } catch (err) {
      console.error('Error unapproving plan:', err);
    } finally {
      setApproving(false);
    }
  }

  async function handleRateRetro() {
    if (!effectiveSprintId || !selectedRating || approving) return;
    setApproving(true);
    try {
      const res = await apiPost(`/api/weeks/${effectiveSprintId}/approve-review`, { rating: selectedRating });
      if (res.ok) {
        setLocalApprovalOverride({ state: 'approved', at: new Date().toISOString() });
        if (queueActive) reviewQueue?.advance();
      } else {
        console.error('Failed to rate retro:', res.status, await res.text().catch(() => ''));
      }
    } catch (err) {
      console.error('Error rating retro:', err);
    } finally {
      setApproving(false);
    }
  }

  function formatApprovalDate(dateStr: string): string {
    const d = new Date(dateStr);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) +
      ' at ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  return (
    <div className="space-y-4 p-4">
      {/* Header */}
      <div className="border-b border-border pb-3">
        <h3 className="text-sm font-medium text-foreground">
          {isRetro ? 'Weekly Retro' : 'Weekly Plan'}
        </h3>
        {weekNumber && (
          <p className="text-sm text-muted mt-1">Week {weekNumber}</p>
        )}
      </div>

      {/* Queue progress + navigation */}
      {isReviewMode && queueActive && reviewQueue && (
        <div className="border-b border-border pb-3">
          <div className="flex items-center justify-between mb-2">
            <span className="rounded bg-accent/20 px-2 py-0.5 text-xs font-medium text-accent">
              {reviewQueue.state.currentIndex + 1} of {reviewQueue.state.queue.length}
            </span>
            <button
              onClick={reviewQueue.exit}
              className="text-xs text-muted hover:text-foreground transition-colors"
            >
              Exit Review
            </button>
          </div>
          <div className="flex gap-2">
            <button
              onClick={reviewQueue.skip}
              className="flex-1 rounded border border-border py-1.5 text-xs text-muted hover:text-foreground hover:bg-border/50 transition-colors"
            >
              Skip
            </button>
          </div>
        </div>
      )}

      {/* Approval status (always shown) + controls (review mode only) */}
      {effectiveSprintId && (
        <div className="border-b border-border pb-4">
          {isRetro ? (
            <div>
              <label className="text-xs font-medium text-muted mb-2 block">Performance Rating</label>
              {/* Read-only rating display when not in review mode */}
              {!isReviewMode && currentRating ? (
                <div className="mb-2">
                  <div className="flex items-center gap-2">
                    <span className={cn('text-sm font-bold', OPM_RATINGS.find(r => r.value === currentRating)?.color)}>
                      {currentRating}/5
                    </span>
                    <span className="text-xs text-muted">
                      {OPM_RATINGS.find(r => r.value === currentRating)?.label}
                    </span>
                  </div>
                  {approvedAt && (
                    <p className="text-[11px] text-muted mt-1">
                      Rated {formatApprovalDate(approvedAt)}
                      {approverName ? ` by ${approverName}` : ''}
                    </p>
                  )}
                </div>
              ) : !isReviewMode && !currentRating ? (
                <p className="text-xs text-muted italic mb-2">Not yet rated</p>
              ) : null}
              {/* Editable rating controls in review mode */}
              {isReviewMode && (
                <>
                  <div className="flex gap-1 mb-3">
                    {OPM_RATINGS.map(r => (
                      <button
                        key={r.value}
                        onClick={() => setSelectedRating(r.value)}
                        className={cn(
                          'flex-1 flex flex-col items-center gap-0.5 rounded py-1.5 text-xs transition-all',
                          selectedRating === r.value
                            ? 'bg-accent/20 ring-1 ring-accent'
                            : 'bg-border/30 hover:bg-border/50'
                        )}
                        title={r.label}
                      >
                        <span className={cn('font-bold', r.color)}>{r.value}</span>
                        <span className="text-[9px] text-muted leading-tight">{r.label.split(' ')[0]}</span>
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={handleRateRetro}
                    disabled={!selectedRating || approving}
                    className={cn(
                      'w-full rounded py-2 text-sm font-medium transition-colors',
                      approvalState === 'approved' && currentRating
                        ? 'bg-green-600/20 text-green-400'
                        : selectedRating
                          ? 'bg-green-600 text-white hover:bg-green-500 cursor-pointer'
                          : 'bg-border/30 text-muted cursor-not-allowed'
                    )}
                  >
                    {approvalState === 'approved' && currentRating ? 'Rated & Approved' : currentRating ? 'Update Rating' : 'Rate & Approve'}
                  </button>
                </>
              )}
            </div>
          ) : (
            <div>
              <label className="text-xs font-medium text-muted mb-2 block">Plan Approval</label>
              {approvalState === 'approved' ? (
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="inline-flex items-center gap-1 rounded bg-green-600/20 px-2 py-1 text-xs font-medium text-green-400">
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><path d="M20 6L9 17l-5-5" /></svg>
                      Approved
                    </span>
                  </div>
                  {approvedAt && (
                    <p className="text-[11px] text-muted">
                      {formatApprovalDate(approvedAt)}
                      {approverName ? ` by ${approverName}` : ''}
                    </p>
                  )}
                  {isReviewMode && (
                    <button
                      onClick={handleUnapprovePlan}
                      disabled={approving}
                      className="mt-2 w-full rounded border border-border py-1.5 text-xs text-muted hover:text-foreground hover:bg-border/50 transition-colors"
                    >
                      Undo Approval
                    </button>
                  )}
                </div>
              ) : approvalState === 'changed_since_approved' ? (
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="inline-flex items-center gap-1 rounded bg-orange-600/20 px-2 py-1 text-xs font-medium text-orange-400">
                      Changed since approved
                    </span>
                  </div>
                  {isReviewMode && (
                    <button
                      onClick={handleApprovePlan}
                      disabled={approving}
                      className="mt-2 w-full rounded bg-orange-600 py-2 text-sm font-medium text-white hover:bg-orange-500 cursor-pointer transition-colors"
                    >
                      Re-approve Plan
                    </button>
                  )}
                </div>
              ) : (
                <div>
                  <p className="text-xs text-muted italic mb-2">Not yet approved</p>
                  {isReviewMode && (
                    <button
                      onClick={handleApprovePlan}
                      disabled={approving}
                      className="w-full rounded bg-green-600 py-2 text-sm font-medium text-white hover:bg-green-500 cursor-pointer transition-colors"
                    >
                      Approve Plan
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Person */}
      {personId && (
        <div>
          <label className="text-xs font-medium text-muted mb-1 block">Person</label>
          <p className="text-sm text-foreground">{personName}</p>
        </div>
      )}

      {/* Project */}
      {projectId && (
        <div>
          <label className="text-xs font-medium text-muted mb-1 block">Project</label>
          <a
            href={`/documents/${projectId}/weeks`}
            className="text-sm text-accent hover:underline"
          >
            {projectName}
          </a>
        </div>
      )}

      {/* AI Quality Assistant */}
      {isRetro ? (
        <RetroQualityAssistantWrapper
          documentId={document.id}
          content={(document as BaseDocument & { content: Record<string, unknown> }).content || {}}
          personId={personId}
          weekNumber={weekNumber}
        />
      ) : (
        <PlanQualityAssistant
          documentId={document.id}
          content={(document as BaseDocument & { content: Record<string, unknown> }).content || {}}
        />
      )}

      {/* Content History Panel */}
      <ContentHistoryPanel
        documentId={document.id}
        documentType={document.document_type as 'weekly_plan' | 'weekly_retro'}
      />
    </div>
  );
}

/** Wrapper that fetches plan content for the retro quality assistant */
function RetroQualityAssistantWrapper({
  documentId,
  content,
  personId,
  weekNumber,
}: {
  documentId: string;
  content: Record<string, unknown>;
  personId?: string;
  weekNumber?: number;
}) {
  // Fetch the corresponding weekly plan for comparison
  const { data: planContent } = useQuery<Record<string, unknown> | null>({
    queryKey: ['weekly-plan-for-retro', personId, weekNumber],
    queryFn: async () => {
      if (!personId || !weekNumber) return null;
      const res = await apiGet(`/api/weekly-plans?person_id=${personId}&week_number=${weekNumber}`);
      if (!res.ok) return null;
      const plans = await res.json();
      if (plans.length > 0 && plans[0].content) return plans[0].content;
      return null;
    },
    enabled: !!personId && !!weekNumber,
    staleTime: 60 * 1000,
  });

  return (
    <RetroQualityAssistant
      documentId={documentId}
      content={content}
      planContent={planContent ?? null}
    />
  );
}

/**
 * PropertiesPanel - Unified component that renders the appropriate sidebar
 * based on document_type.
 *
 * Usage:
 * ```tsx
 * <PropertiesPanel
 *   document={myDocument}
 *   panelProps={typeSpecificProps}
 *   onUpdate={handleUpdate}
 * />
 * ```
 */
export function PropertiesPanel({
  document,
  panelProps,
  onUpdate,
  highlightedFields = [],
}: PropertiesPanelProps) {
  const { isWorkspaceAdmin } = useWorkspace();
  const { user } = useAuth();

  // Compute canApprove: user is workspace admin OR is the accountable person
  // For sprints, approval uses program's accountable_id (program_accountable_id)
  // For projects, approval uses the project's accountable_id
  const canApprove = useMemo(() => {
    if (isWorkspaceAdmin) return true;
    if (!user?.id) return false;

    // Check document's accountable_id (used by projects)
    const docWithAccountable = document as { accountable_id?: string | null };
    if (docWithAccountable.accountable_id === user.id) return true;

    // For sprints, also check program_accountable_id (inherited from program)
    if (document.document_type === 'sprint') {
      const sprintDoc = document as SprintDocument;
      if (sprintDoc.program_accountable_id === user.id) return true;
    }

    return false;
  }, [isWorkspaceAdmin, user?.id, document]);

  // Build userNames from people in panelProps (for displaying approver names)
  const userNames = useMemo(() => {
    const names: Record<string, string> = {};
    // Try to get people from various panel props
    const props = panelProps as { people?: Array<{ id?: string; user_id?: string; name: string }> };
    if (props.people) {
      props.people.forEach(p => {
        if (p.user_id) names[p.user_id] = p.name;
        if (p.id) names[p.id] = p.name;
      });
    }
    return names;
  }, [panelProps]);

  // Callback for when approval state changes - trigger a refetch
  const handleApprovalUpdate = useCallback(() => {
    // The parent component should handle refreshing the document
    // For now, we rely on optimistic updates in the ApprovalButton
  }, []);

  const panel = useMemo(() => {
    switch (document.document_type) {
      case 'wiki': {
        const wikiProps = panelProps as WikiPanelProps;
        return (
          <WikiSidebar
            document={document as WikiDocument}
            teamMembers={wikiProps.teamMembers || []}
            currentUserId={wikiProps.currentUserId}
            onUpdate={onUpdate as (updates: Partial<WikiDocument>) => Promise<void>}
          />
        );
      }

      case 'issue': {
        const issueProps = panelProps as IssuePanelProps;
        return (
          <IssueSidebar
            issue={document as IssueDocument}
            teamMembers={issueProps.teamMembers || []}
            programs={issueProps.programs || []}
            projects={issueProps.projects || []}
            onUpdate={onUpdate as (updates: Partial<IssueDocument>) => Promise<void>}
            onConvert={issueProps.onConvert}
            onUndoConversion={issueProps.onUndoConversion}
            onAccept={issueProps.onAccept}
            onReject={issueProps.onReject}
            isConverting={issueProps.isConverting}
            isUndoing={issueProps.isUndoing}
            highlightedFields={highlightedFields}
            onAssociationChange={issueProps.onAssociationChange}
          />
        );
      }

      case 'project': {
        const projectProps = panelProps as ProjectPanelProps;
        return (
          <ProjectSidebar
            project={document as ProjectDocument}
            programs={projectProps.programs || []}
            people={projectProps.people || []}
            onUpdate={onUpdate as (updates: Partial<ProjectDocument>) => Promise<void>}
            onConvert={projectProps.onConvert}
            onUndoConversion={projectProps.onUndoConversion}
            isConverting={projectProps.isConverting}
            isUndoing={projectProps.isUndoing}
            highlightedFields={highlightedFields}
            canApprove={canApprove}
            userNames={userNames}
            onApprovalUpdate={handleApprovalUpdate}
          />
        );
      }

      case 'sprint': {
        const sprintProps = panelProps as SprintPanelProps;
        return (
          <WeekSidebar
            sprint={document as SprintDocument}
            onUpdate={onUpdate as (updates: Partial<SprintDocument>) => Promise<void>}
            highlightedFields={highlightedFields}
            people={sprintProps.people}
            existingSprints={sprintProps.existingSprints}
            canApprove={canApprove}
            userNames={userNames}
            onApprovalUpdate={handleApprovalUpdate}
          />
        );
      }

      case 'program': {
        const programProps = panelProps as ProgramPanelProps;
        return (
          <ProgramSidebar
            program={document as ProgramDocument}
            people={programProps.people || []}
            onUpdate={onUpdate as (updates: Partial<ProgramDocument>) => Promise<void>}
            highlightedFields={highlightedFields}
          />
        );
      }

      case 'weekly_plan':
      case 'weekly_retro': {
        // Weekly plan and retro documents get a minimal sidebar with history panel
        // Names are fetched via WeeklyDocumentSidebar component
        return (
          <WeeklyDocumentSidebar
            document={document as WeeklyPlanDocument | WeeklyRetroDocument}
          />
        );
      }

      default:
        // TypeScript narrows to never here since all cases are handled
        // Cast to BaseDocument to access document_type for the fallback display
        return (
          <div className="p-4">
            <p className="text-xs text-muted">
              Document type: {(document as BaseDocument).document_type}
            </p>
          </div>
        );
    }
  }, [document, panelProps, onUpdate, highlightedFields, canApprove, userNames, handleApprovalUpdate]);

  return panel;
}

// Re-export types for convenience
export type {
  WikiDocument,
  IssueDocument,
  ProjectDocument,
  SprintDocument,
  ProgramDocument,
  WikiPanelProps,
  IssuePanelProps,
  ProjectPanelProps,
  SprintPanelProps,
  ProgramPanelProps,
};
