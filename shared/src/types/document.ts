// Document types

// Document visibility for private/workspace documents
export type DocumentVisibility = 'private' | 'workspace';

// Association relationship types for belongs_to array
export type BelongsToType = 'program' | 'project' | 'sprint' | 'parent';

// BelongsTo association entry - unified format for all document relationships
export interface BelongsTo {
  id: string;
  type: BelongsToType;
  // Optional display fields populated by API
  title?: string;
  color?: string;
}

// Cascade warning for incomplete children when closing parent issue
export interface IncompleteChild {
  id: string;
  title: string;
  ticket_number: number;
  state: string;
}

export interface CascadeWarning {
  error: 'incomplete_children';
  message: string;
  incomplete_children: IncompleteChild[];
  confirm_action: string;
}

// Document type enum matching PostgreSQL enum
export type DocumentType =
  | 'wiki'
  | 'issue'
  | 'program'
  | 'project'
  | 'sprint'
  | 'person'
  | 'weekly_plan'
  | 'weekly_retro'
  | 'standup'
  | 'weekly_review';

// Issue states
export type IssueState = 'triage' | 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done' | 'cancelled';

// Issue priorities
export type IssuePriority = 'low' | 'medium' | 'high' | 'urgent';

// Issue source - provenance, never changes after creation
export type IssueSource = 'internal' | 'external' | 'action_items';

// Accountability types for auto-generated action_items issues
export type AccountabilityType =
  | 'standup'
  | 'weekly_plan'
  | 'weekly_retro'
  | 'weekly_review'
  | 'week_start'
  | 'week_issues'
  | 'project_plan'
  | 'project_retro';

// Sprint status - computed from dates, not stored
export type WeekStatus = 'active' | 'upcoming' | 'completed';

// Properties interfaces for each document type
// Each includes index signature for JSONB compatibility
export interface IssueProperties {
  state: IssueState;
  priority: IssuePriority;
  assignee_id?: string | null;
  estimate?: number | null;
  source: IssueSource;
  rejection_reason?: string | null;
  // Due date for issues (ISO date string, e.g., "2025-01-26")
  due_date?: string | null;
  // System-generated accountability issues (cannot be deleted)
  is_system_generated?: boolean;
  // Links to the document this accountability issue is about
  accountability_target_id?: string | null;
  // Type of accountability task
  accountability_type?: AccountabilityType | null;
  [key: string]: unknown;
}

export interface ProgramProperties {
  color: string;
  emoji?: string | null;  // Optional emoji for visual identification
  // RACI accountability fields
  owner_id?: string | null;        // R - Responsible (does the work)
  accountable_id?: string | null;  // A - Accountable (approver for hypotheses/reviews)
  consulted_ids?: string[];        // C - Consulted (provide input, stubbed for now)
  informed_ids?: string[];         // I - Informed (kept in loop, stubbed for now)
  [key: string]: unknown;
}

// ICE score type (1-5 scale for prioritization)
export type ICEScore = 1 | 2 | 3 | 4 | 5;

export interface ProjectProperties {
  // ICE prioritization scores (1-5 scale, null = not yet set)
  impact: ICEScore | null;      // How much will this move the needle?
  confidence: ICEScore | null;  // How certain are we this will achieve the impact?
  ease: ICEScore | null;        // How easy is this to implement? (inverse of effort)
  // RACI accountability fields
  owner_id?: string | null;        // R - Responsible (does the work)
  accountable_id?: string | null;  // A - Accountable (approver for hypotheses/reviews)
  consulted_ids?: string[];        // C - Consulted (provide input, stubbed for now)
  informed_ids?: string[];         // I - Informed (kept in loop, stubbed for now)
  // Visual identification
  color: string;
  emoji?: string | null;
  // Project retro properties - track plan validation and outcomes
  plan_validated?: boolean | null;  // null = not yet determined, true = validated, false = invalidated
  monetary_impact_expected?: string | null;  // Expected monetary value (e.g., "$50K annual savings")
  monetary_impact_actual?: string | null;    // Actual monetary impact after completion
  success_criteria?: string[] | null;        // Array of measurable success criteria
  next_steps?: string | null;                // Recommended follow-up actions
  // Approval tracking for accountability workflow
  plan_approval?: ApprovalTracking | null;  // Approval status for project plan
  retro_approval?: ApprovalTracking | null;       // Approval status for project retro
  [key: string]: unknown;
}

// Plan history entry for tracking plan changes over time
export interface PlanHistoryEntry {
  plan: string;
  timestamp: string;  // ISO 8601 date string
  author_id: string;
  author_name?: string;
}

// Approval tracking state for accountability workflows
export type ApprovalState = null | 'approved' | 'changed_since_approved';

// Approval tracking structure for hypotheses, reviews, and retros
export interface ApprovalTracking {
  state: ApprovalState;                   // null = pending, 'approved' = current version approved, 'changed_since_approved' = needs re-review
  approved_by: string | null;             // User ID who approved
  approved_at: string | null;             // ISO 8601 timestamp of approval
  approved_version_id: number | null;     // document_history.id that was approved
}

export interface WeekProperties {
  sprint_number: number;  // References implicit 1-week window, dates computed from this
  owner_id: string;       // REQUIRED - person accountable for this sprint
  status?: 'planning' | 'active' | 'completed';  // Sprint workflow status (default: 'planning')
  // Plan tracking (for Ship-Claude integration)
  plan?: string | null;           // Current plan statement
  success_criteria?: string[] | null;   // Array of measurable success criteria
  confidence?: number | null;           // Confidence level 0-100
  plan_history?: PlanHistoryEntry[] | null;  // History of plan changes
  // Approval tracking for accountability workflow
  plan_approval?: ApprovalTracking | null;  // Approval status for sprint plan
  review_approval?: ApprovalTracking | null;      // Approval status for sprint review
  [key: string]: unknown;
}

export interface PersonProperties {
  email?: string | null;
  role?: string | null;
  capacity_hours?: number | null;
  [key: string]: unknown;
}

// Wiki properties - optional maintainer
export interface WikiProperties {
  maintainer_id?: string | null;
  [key: string]: unknown;
}
// Weekly plan properties - per-person accountability document
export interface WeeklyPlanProperties {
  person_id: string;       // REQUIRED - person document ID who wrote this plan
  project_id: string;      // REQUIRED - project this plan is for
  week_number: number;     // REQUIRED - week number (same as sprint_number concept)
  submitted_at?: string | null;  // ISO timestamp when first saved with content
  [key: string]: unknown;
}

// Weekly retro properties - per-person retrospective document
export interface WeeklyRetroProperties {
  person_id: string;       // REQUIRED - person document ID who wrote this retro
  project_id: string;      // REQUIRED - project this retro is for
  week_number: number;     // REQUIRED - week number (same as sprint_number concept)
  submitted_at?: string | null;  // ISO timestamp when first saved with content
  [key: string]: unknown;
}

// Standup properties - comment-like entries on sprints
export interface StandupProperties {
  author_id: string;  // REQUIRED - who posted this standup
  [key: string]: unknown;
}

// Weekly review properties - one per week, tracks plan validation
export interface WeeklyReviewProperties {
  sprint_id: string;          // REQUIRED - which sprint/week this reviews
  owner_id: string;           // REQUIRED - who is accountable for this review
  plan_validated: boolean | null;  // null = not yet determined
  [key: string]: unknown;
}

// Union of all properties types
export type DocumentProperties =
  | IssueProperties
  | ProgramProperties
  | ProjectProperties
  | WeekProperties
  | PersonProperties
  | WikiProperties
  | WeeklyPlanProperties
  | WeeklyRetroProperties
  | StandupProperties
  | WeeklyReviewProperties;

// Base document interface
export interface Document {
  id: string;
  workspace_id: string;
  document_type: DocumentType;
  title: string;
  content: Record<string, unknown>;
  yjs_state?: Uint8Array | null;
  parent_id?: string | null;
  position: number;
  // Note: program_id, project_id, and sprint_id removed - use belongs_to array instead
  // These columns were dropped by migrations 027 and 029
  properties: Record<string, unknown>;
  ticket_number?: number | null;
  archived_at?: Date | null;
  created_at: Date;
  updated_at: Date;
  created_by?: string | null;
  // Document visibility (private = creator only, workspace = all members)
  visibility: DocumentVisibility;
  // Status timestamps (primarily for issues)
  started_at?: Date | null;
  completed_at?: Date | null;
  cancelled_at?: Date | null;
  reopened_at?: Date | null;
  // Document conversion tracking (issue <-> project)
  converted_to_id?: string | null;    // Points to new doc (set on archived original)
  converted_from_id?: string | null;  // Points to original (set on new doc)
  converted_at?: Date | null;         // When conversion occurred
  converted_by?: string | null;       // User who performed conversion
}

// Typed document variants for type safety in application code
export interface WikiDocument extends Document {
  document_type: 'wiki';
  properties: WikiProperties;
}

export interface IssueDocument extends Document {
  document_type: 'issue';
  properties: IssueProperties;
  ticket_number: number;
}

export interface ProgramDocument extends Document {
  document_type: 'program';
  properties: ProgramProperties;
}

export interface ProjectDocument extends Document {
  document_type: 'project';
  properties: ProjectProperties;
}

export interface WeekDocument extends Document {
  document_type: 'sprint';
  properties: WeekProperties;
}

export interface PersonDocument extends Document {
  document_type: 'person';
  properties: PersonProperties;
}

export interface WeeklyPlanDocument extends Document {
  document_type: 'weekly_plan';
  properties: WeeklyPlanProperties;
}

export interface WeeklyRetroDocument extends Document {
  document_type: 'weekly_retro';
  properties: WeeklyRetroProperties;
}

export interface StandupDocument extends Document {
  document_type: 'standup';
  properties: StandupProperties;
}

export interface WeeklyReviewDocument extends Document {
  document_type: 'weekly_review';
  properties: WeeklyReviewProperties;
}

// Input types for creating/updating documents
export interface CreateDocumentInput {
  document_type?: DocumentType;
  title?: string;
  content?: Record<string, unknown>;
  parent_id?: string | null;
  position?: number;
  // Note: program_id, project_id, and sprint_id removed - use belongs_to array instead
  properties?: Record<string, unknown>;
  visibility?: DocumentVisibility;
}

export interface UpdateDocumentInput {
  title?: string;
  content?: Record<string, unknown>;
  parent_id?: string | null;
  position?: number;
  // Note: program_id, project_id, and sprint_id removed - use belongs_to array instead
  properties?: Record<string, unknown>;
  archived_at?: Date | null;
  visibility?: DocumentVisibility;
}

// Helper type for issue creation with required properties
export interface CreateIssueInput extends CreateDocumentInput {
  document_type: 'issue';
  properties: Partial<IssueProperties>;
}

// Helper type for updating issue properties
export interface UpdateIssueInput extends UpdateDocumentInput {
  properties?: Partial<IssueProperties>;
}

// Helper type for program creation
export interface CreateProgramInput extends CreateDocumentInput {
  document_type: 'program';
  properties: {
    color?: string;
    emoji?: string | null;
  };
}

// Helper type for week/sprint creation
export interface CreateWeekInput extends CreateDocumentInput {
  document_type: 'sprint';
  properties?: Partial<WeekProperties>;
}

// Helper type for project creation (owner_id is optional - can be unassigned)
export interface CreateProjectInput extends CreateDocumentInput {
  document_type: 'project';
  properties: {
    impact?: ICEScore | null;
    confidence?: ICEScore | null;
    ease?: ICEScore | null;
    owner_id?: string | null;  // Optional - can be unassigned
    color?: string;
    emoji?: string | null;
  };
}

// Default property values
export const DEFAULT_ISSUE_PROPERTIES: IssueProperties = {
  state: 'backlog',
  priority: 'medium',
  source: 'internal',
  assignee_id: null,
  rejection_reason: null,
  due_date: null,
  is_system_generated: false,
  accountability_target_id: null,
  accountability_type: null,
};

export const DEFAULT_PROGRAM_PROPERTIES: Partial<ProgramProperties> = {
  color: '#6366f1',
};

// Default project properties - ICE and owner start as null (not yet set)
export const DEFAULT_PROJECT_PROPERTIES: Partial<ProjectProperties> = {
  impact: null,
  confidence: null,
  ease: null,
  owner_id: null,
  color: '#6366f1',
};

// Note: Sprint properties require sprint_number and owner_id at creation time
// There is no sensible default - these must be provided

// Helper functions for computing sprint dates and status from sprint_number

/**
 * Compute sprint start and end dates from sprint number and workspace start date.
 * Each sprint is a 7-day window (days 0-6).
 */
export function computeSprintDates(sprintNumber: number, workspaceStartDate: Date): { start: Date; end: Date } {
  const start = new Date(workspaceStartDate);
  start.setDate(start.getDate() + (sprintNumber - 1) * 7);
  // Reset time to start of day
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 6); // 7 days total (0-6)
  end.setHours(23, 59, 59, 999);

  return { start, end };
}

/**
 * Compute sprint status from sprint number and workspace start date.
 * Status is derived from whether today falls within, before, or after the sprint window.
 */
export function computeWeekStatus(sprintNumber: number, workspaceStartDate: Date): WeekStatus {
  const { start, end } = computeSprintDates(sprintNumber, workspaceStartDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0); // Start of today for comparison

  if (today < start) return 'upcoming';
  if (today > end) return 'completed';
  return 'active';
}

/**
 * Get the current sprint number based on workspace start date (1-week sprints).
 */
export function getCurrentSprintNumber(workspaceStartDate: Date): number {
  const today = new Date();
  const daysSinceStart = Math.floor((today.getTime() - workspaceStartDate.getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(1, Math.floor(daysSinceStart / 7) + 1);
}

// ICE Prioritization helpers

/**
 * Compute ICE score from impact, confidence, and ease values.
 * ICE Score = Impact × Confidence × Ease
 * With 1-5 scale, max score is 125 (5 × 5 × 5).
 * Returns null if any value is null (unset).
 */
export function computeICEScore(impact: number | null, confidence: number | null, ease: number | null): number | null {
  if (impact === null || confidence === null || ease === null) {
    return null;
  }
  return impact * confidence * ease;
}

/**
 * Compute ICE score from project properties.
 * Convenience wrapper for computeICEScore.
 * Returns null if any ICE value is unset.
 */
export function computeProjectICEScore(properties: ProjectProperties): number | null {
  return computeICEScore(properties.impact, properties.confidence, properties.ease);
}
