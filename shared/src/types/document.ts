// Document types

// Document visibility for private/workspace documents
export type DocumentVisibility = 'private' | 'workspace';

// Document type enum matching PostgreSQL enum
export type DocumentType =
  | 'wiki'
  | 'issue'
  | 'program'
  | 'project'
  | 'sprint'
  | 'person'
  | 'sprint_plan'
  | 'sprint_retro'
  | 'standup'
  | 'sprint_review';

// Issue states
export type IssueState = 'triage' | 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done' | 'cancelled';

// Issue priorities
export type IssuePriority = 'low' | 'medium' | 'high' | 'urgent';

// Issue source - provenance, never changes after creation
export type IssueSource = 'internal' | 'external';

// Sprint status - computed from dates, not stored
export type SprintStatus = 'active' | 'upcoming' | 'completed';

// Properties interfaces for each document type
// Each includes index signature for JSONB compatibility
export interface IssueProperties {
  state: IssueState;
  priority: IssuePriority;
  assignee_id?: string | null;
  estimate?: number | null;
  source: IssueSource;
  rejection_reason?: string | null;
  [key: string]: unknown;
}

export interface ProgramProperties {
  color: string;
  emoji?: string | null;  // Optional emoji for visual identification
  [key: string]: unknown;
}

// ICE score type (1-5 scale for prioritization)
export type ICEScore = 1 | 2 | 3 | 4 | 5;

export interface ProjectProperties {
  // ICE prioritization scores (1-5 scale)
  impact: ICEScore;      // How much will this move the needle?
  confidence: ICEScore;  // How certain are we this will achieve the impact?
  ease: ICEScore;        // How easy is this to implement? (inverse of effort)
  // Required owner for accountability
  owner_id: string;
  // Visual identification
  color: string;
  emoji?: string | null;
  // Project retro properties - track hypothesis validation and outcomes
  hypothesis_validated?: boolean | null;  // null = not yet determined, true = validated, false = invalidated
  monetary_impact_expected?: string | null;  // Expected monetary value (e.g., "$50K annual savings")
  monetary_impact_actual?: string | null;    // Actual monetary impact after completion
  success_criteria?: string[] | null;        // Array of measurable success criteria
  next_steps?: string | null;                // Recommended follow-up actions
  [key: string]: unknown;
}

// Hypothesis history entry for tracking hypothesis changes over time
export interface HypothesisHistoryEntry {
  hypothesis: string;
  timestamp: string;  // ISO 8601 date string
  author_id: string;
  author_name?: string;
}

export interface SprintProperties {
  sprint_number: number;  // References implicit 1-week window, dates computed from this
  owner_id: string;       // REQUIRED - person accountable for this sprint
  // Hypothesis tracking (for Ship-Claude integration)
  hypothesis?: string | null;           // Current hypothesis statement
  success_criteria?: string[] | null;   // Array of measurable success criteria
  confidence?: number | null;           // Confidence level 0-100
  hypothesis_history?: HypothesisHistoryEntry[] | null;  // History of hypothesis changes
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
export type SprintPlanProperties = Record<string, unknown>;
export type SprintRetroProperties = Record<string, unknown>;

// Standup properties - comment-like entries on sprints
export interface StandupProperties {
  author_id: string;  // REQUIRED - who posted this standup
  [key: string]: unknown;
}

// Sprint review properties - one per sprint, tracks hypothesis validation
export interface SprintReviewProperties {
  sprint_id: string;          // REQUIRED - which sprint this reviews
  owner_id: string;           // REQUIRED - who is accountable for this review
  hypothesis_validated: boolean | null;  // null = not yet determined
  [key: string]: unknown;
}

// Union of all properties types
export type DocumentProperties =
  | IssueProperties
  | ProgramProperties
  | ProjectProperties
  | SprintProperties
  | PersonProperties
  | WikiProperties
  | SprintPlanProperties
  | SprintRetroProperties
  | StandupProperties
  | SprintReviewProperties;

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
  program_id?: string | null;
  project_id?: string | null;
  sprint_id?: string | null;
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

export interface SprintDocument extends Document {
  document_type: 'sprint';
  properties: SprintProperties;
}

export interface PersonDocument extends Document {
  document_type: 'person';
  properties: PersonProperties;
}

export interface SprintPlanDocument extends Document {
  document_type: 'sprint_plan';
  properties: SprintPlanProperties;
}

export interface SprintRetroDocument extends Document {
  document_type: 'sprint_retro';
  properties: SprintRetroProperties;
}

export interface StandupDocument extends Document {
  document_type: 'standup';
  properties: StandupProperties;
}

export interface SprintReviewDocument extends Document {
  document_type: 'sprint_review';
  properties: SprintReviewProperties;
}

// Input types for creating/updating documents
export interface CreateDocumentInput {
  document_type?: DocumentType;
  title?: string;
  content?: Record<string, unknown>;
  parent_id?: string | null;
  position?: number;
  program_id?: string | null;
  project_id?: string | null;
  sprint_id?: string | null;
  properties?: Record<string, unknown>;
  visibility?: DocumentVisibility;
}

export interface UpdateDocumentInput {
  title?: string;
  content?: Record<string, unknown>;
  parent_id?: string | null;
  position?: number;
  program_id?: string | null;
  project_id?: string | null;
  sprint_id?: string | null;
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

// Helper type for sprint creation
export interface CreateSprintInput extends CreateDocumentInput {
  document_type: 'sprint';
  properties?: Partial<SprintProperties>;
}

// Helper type for project creation with required owner_id
export interface CreateProjectInput extends CreateDocumentInput {
  document_type: 'project';
  properties: {
    impact?: ICEScore;
    confidence?: ICEScore;
    ease?: ICEScore;
    owner_id: string;  // REQUIRED - person accountable for this project
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
};

export const DEFAULT_PROGRAM_PROPERTIES: Partial<ProgramProperties> = {
  color: '#6366f1',
};

// Default project properties - ICE defaults to middle value (3)
export const DEFAULT_PROJECT_PROPERTIES: Omit<ProjectProperties, 'owner_id'> = {
  impact: 3,
  confidence: 3,
  ease: 3,
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
export function computeSprintStatus(sprintNumber: number, workspaceStartDate: Date): SprintStatus {
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
 */
export function computeICEScore(impact: number, confidence: number, ease: number): number {
  return impact * confidence * ease;
}

/**
 * Compute ICE score from project properties.
 * Convenience wrapper for computeICEScore.
 */
export function computeProjectICEScore(properties: ProjectProperties): number {
  return computeICEScore(properties.impact, properties.confidence, properties.ease);
}
