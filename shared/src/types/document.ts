// Document types

// Document type enum matching PostgreSQL enum
export type DocumentType =
  | 'wiki'
  | 'issue'
  | 'program'
  | 'project'
  | 'sprint'
  | 'person'
  | 'sprint_plan'
  | 'sprint_retro';

// Issue states
export type IssueState = 'backlog' | 'todo' | 'in_progress' | 'in_review' | 'done';

// Issue priorities
export type IssuePriority = 'low' | 'medium' | 'high' | 'urgent';

// Issue source - provenance, never changes after creation
export type IssueSource = 'internal' | 'feedback';

// Feedback status - tracks lifecycle for feedback-sourced issues
export type FeedbackStatus = 'draft' | 'submitted' | null;

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
  feedback_status?: FeedbackStatus;
  rejection_reason?: string | null;
  [key: string]: unknown;
}

export interface ProgramProperties {
  prefix: string;
  color: string;
  [key: string]: unknown;
}

export interface ProjectProperties {
  prefix: string;
  color: string;
  [key: string]: unknown;
}

export interface SprintProperties {
  sprint_number: number;  // References implicit 2-week window, dates computed from this
  owner_id: string;       // REQUIRED - person accountable for this sprint
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

// Union of all properties types
export type DocumentProperties =
  | IssueProperties
  | ProgramProperties
  | ProjectProperties
  | SprintProperties
  | PersonProperties
  | WikiProperties
  | SprintPlanProperties
  | SprintRetroProperties;

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
    prefix: string;
    color?: string;
  };
}

// Helper type for sprint creation
export interface CreateSprintInput extends CreateDocumentInput {
  document_type: 'sprint';
  properties?: Partial<SprintProperties>;
}

// Default property values
export const DEFAULT_ISSUE_PROPERTIES: IssueProperties = {
  state: 'backlog',
  priority: 'medium',
  source: 'internal',
  assignee_id: null,
  feedback_status: null,
  rejection_reason: null,
};

export const DEFAULT_PROGRAM_PROPERTIES: Partial<ProgramProperties> = {
  color: '#6366f1',
};

// Note: Sprint properties require sprint_number and owner_id at creation time
// There is no sensible default - these must be provided

// Helper functions for computing sprint dates and status from sprint_number

/**
 * Compute sprint start and end dates from sprint number and workspace start date.
 * Each sprint is a 14-day window (days 0-13).
 */
export function computeSprintDates(sprintNumber: number, workspaceStartDate: Date): { start: Date; end: Date } {
  const start = new Date(workspaceStartDate);
  start.setDate(start.getDate() + (sprintNumber - 1) * 14);
  // Reset time to start of day
  start.setHours(0, 0, 0, 0);

  const end = new Date(start);
  end.setDate(end.getDate() + 13); // 14 days total (0-13)
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
 * Get the current sprint number based on workspace start date.
 */
export function getCurrentSprintNumber(workspaceStartDate: Date): number {
  const today = new Date();
  const daysSinceStart = Math.floor((today.getTime() - workspaceStartDate.getTime()) / (1000 * 60 * 60 * 24));
  return Math.max(1, Math.floor(daysSinceStart / 14) + 1);
}
