import { z } from 'zod';
import type {
  DocumentVisibility, BelongsToType, DocumentType, IssueState, IssuePriority,
  IssueSource, AccountabilityType, WeekStatus, ICEScore, ApprovalState,
  BelongsTo, IncompleteChild, CascadeWarning, PlanHistoryEntry, ApprovalTracking,
  IssueProperties, ProgramProperties, ProjectProperties, WeekProperties,
  PersonProperties, WikiProperties, WeeklyPlanProperties, WeeklyRetroProperties,
  StandupProperties, WeeklyReviewProperties, Document,
  WikiDocumentV1, IssueDocumentV1, ProgramDocumentV1, ProjectDocumentV1,
  WeekDocumentV1, PersonDocumentV1, WeeklyPlanDocumentV1, WeeklyRetroDocumentV1,
  StandupDocumentV1, WeeklyReviewDocumentV1,
} from '../types/document.js';

// ─── Type Alignment Utility ─────────────────────────────────────────────────
// Bidirectional check: ensures z.infer<Schema> and the TS interface are assignable
// in both directions. Catches missing fields, extra fields, and type mismatches.
type AssertMutuallyAssignable<A, B> =
  [A] extends [B] ? ([B] extends [A] ? true : never) : never;

// ─── Enum / Literal Schemas ──────────────────────────────────────────────────

export const DocumentVisibilitySchema = z.enum(['private', 'workspace']);

export const BelongsToTypeSchema = z.enum(['program', 'project', 'sprint', 'parent']);

export const DocumentTypeSchema = z.enum([
  'wiki',
  'issue',
  'program',
  'project',
  'sprint',
  'person',
  'weekly_plan',
  'weekly_retro',
  'standup',
  'weekly_review',
]);

export const IssueStateSchema = z.enum([
  'triage',
  'backlog',
  'todo',
  'in_progress',
  'in_review',
  'done',
  'cancelled',
]);

export const IssuePrioritySchema = z.enum(['none', 'low', 'medium', 'high', 'urgent']);

export const IssueSourceSchema = z.enum(['internal', 'external', 'action_items']);

export const AccountabilityTypeSchema = z.enum([
  'standup',
  'weekly_plan',
  'weekly_retro',
  'weekly_review',
  'week_start',
  'week_issues',
  'project_plan',
  'project_retro',
  'changes_requested_plan',
  'changes_requested_retro',
]);

export const WeekStatusSchema = z.enum(['active', 'upcoming', 'completed']);

export const ICEScoreSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);

export const ApprovalStateSchema = z.union([
  z.null(),
  z.literal('approved'),
  z.literal('changed_since_approved'),
  z.literal('changes_requested'),
]);

// ─── Helper / Association Schemas ────────────────────────────────────────────

export const BelongsToSchema = z.object({
  id: z.string(),
  type: BelongsToTypeSchema,
  title: z.string().optional(),
  color: z.string().optional(),
});

export const IncompleteChildSchema = z.object({
  id: z.string(),
  title: z.string(),
  ticket_number: z.number(),
  state: z.string(),
});

export const CascadeWarningSchema = z.object({
  error: z.literal('incomplete_children'),
  message: z.string(),
  incomplete_children: z.array(IncompleteChildSchema),
  confirm_action: z.string(),
});

export const PlanHistoryEntrySchema = z.object({
  plan: z.string(),
  timestamp: z.string(),
  author_id: z.string(),
  author_name: z.string().optional(),
});

export const ApprovalTrackingSchema = z.object({
  state: ApprovalStateSchema,
  approved_by: z.string().nullable(),
  approved_at: z.string().nullable(),
  approved_version_id: z.number().nullable(),
  feedback: z.string().nullable().optional(),
  comment: z.string().nullable().optional(),
});

// ─── Property Schemas ────────────────────────────────────────────────────────

export const IssuePropertiesSchema = z
  .object({
    state: IssueStateSchema,
    priority: IssuePrioritySchema,
    assignee_id: z.string().nullable().optional(),
    estimate: z.number().nullable().optional(),
    source: IssueSourceSchema,
    rejection_reason: z.string().nullable().optional(),
    due_date: z.string().nullable().optional(),
    is_system_generated: z.boolean().optional(),
    accountability_target_id: z.string().nullable().optional(),
    accountability_type: AccountabilityTypeSchema.nullable().optional(),
  })
  .passthrough();

export const ProgramPropertiesSchema = z
  .object({
    color: z.string(),
    emoji: z.string().nullable().optional(),
    owner_id: z.string().nullable().optional(),
    accountable_id: z.string().nullable().optional(),
    consulted_ids: z.array(z.string()).optional(),
    informed_ids: z.array(z.string()).optional(),
  })
  .passthrough();

const ReviewRatingSchema = z.object({
  value: z.number(),
  rated_by: z.string(),
  rated_at: z.string(),
});

export const ProjectPropertiesSchema = z
  .object({
    impact: ICEScoreSchema.nullable(),
    confidence: ICEScoreSchema.nullable(),
    ease: ICEScoreSchema.nullable(),
    owner_id: z.string().nullable().optional(),
    accountable_id: z.string().nullable().optional(),
    consulted_ids: z.array(z.string()).optional(),
    informed_ids: z.array(z.string()).optional(),
    color: z.string(),
    emoji: z.string().nullable().optional(),
    plan_validated: z.boolean().nullable().optional(),
    monetary_impact_expected: z.string().nullable().optional(),
    monetary_impact_actual: z.string().nullable().optional(),
    success_criteria: z.array(z.string()).nullable().optional(),
    next_steps: z.string().nullable().optional(),
    plan_approval: ApprovalTrackingSchema.nullable().optional(),
    retro_approval: ApprovalTrackingSchema.nullable().optional(),
    has_design_review: z.boolean().nullable().optional(),
    design_review_notes: z.string().nullable().optional(),
  })
  .passthrough();

export const WeekPropertiesSchema = z
  .object({
    sprint_number: z.number(),
    owner_id: z.string(),
    status: z.enum(['planning', 'active', 'completed']).optional(),
    plan: z.string().nullable().optional(),
    success_criteria: z.array(z.string()).nullable().optional(),
    confidence: z.number().nullable().optional(),
    plan_history: z.array(PlanHistoryEntrySchema).nullable().optional(),
    plan_approval: ApprovalTrackingSchema.nullable().optional(),
    review_approval: ApprovalTrackingSchema.nullable().optional(),
    review_rating: ReviewRatingSchema.nullable().optional(),
  })
  .passthrough();

export const PersonPropertiesSchema = z
  .object({
    email: z.string().nullable().optional(),
    role: z.string().nullable().optional(),
    capacity_hours: z.number().nullable().optional(),
    reports_to: z.string().nullable().optional(),
  })
  .passthrough();

export const WikiPropertiesSchema = z
  .object({
    maintainer_id: z.string().nullable().optional(),
  })
  .passthrough();

export const WeeklyPlanPropertiesSchema = z
  .object({
    person_id: z.string(),
    project_id: z.string(),
    week_number: z.number(),
    submitted_at: z.string().nullable().optional(),
  })
  .passthrough();

export const WeeklyRetroPropertiesSchema = z
  .object({
    person_id: z.string(),
    project_id: z.string(),
    week_number: z.number(),
    submitted_at: z.string().nullable().optional(),
  })
  .passthrough();

export const StandupPropertiesSchema = z
  .object({
    author_id: z.string(),
  })
  .passthrough();

export const WeeklyReviewPropertiesSchema = z
  .object({
    sprint_id: z.string(),
    owner_id: z.string(),
    plan_validated: z.boolean().nullable(),
  })
  .passthrough();

export const DocumentPropertiesSchema = z.union([
  IssuePropertiesSchema,
  ProgramPropertiesSchema,
  ProjectPropertiesSchema,
  WeekPropertiesSchema,
  PersonPropertiesSchema,
  WikiPropertiesSchema,
  WeeklyPlanPropertiesSchema,
  WeeklyRetroPropertiesSchema,
  StandupPropertiesSchema,
  WeeklyReviewPropertiesSchema,
]);

// ─── Base Document Schema ────────────────────────────────────────────────────

export const DocumentSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  document_type: DocumentTypeSchema,
  title: z.string(),
  content: z.record(z.string(), z.unknown()),
  yjs_state: z.instanceof(Uint8Array).nullable().optional(),
  parent_id: z.string().nullable().optional(),
  position: z.number(),
  properties: z.record(z.string(), z.unknown()),
  ticket_number: z.number().nullable().optional(),
  archived_at: z.date().nullable().optional(),
  created_at: z.date(),
  updated_at: z.date(),
  created_by: z.string().nullable().optional(),
  visibility: DocumentVisibilitySchema,
  started_at: z.date().nullable().optional(),
  completed_at: z.date().nullable().optional(),
  cancelled_at: z.date().nullable().optional(),
  reopened_at: z.date().nullable().optional(),
  converted_to_id: z.string().nullable().optional(),
  converted_from_id: z.string().nullable().optional(),
  converted_at: z.date().nullable().optional(),
  converted_by: z.string().nullable().optional(),
  version: z.number().optional(),
});

// ─── Typed Document Variant Schemas (V1) ─────────────────────────────────────

export const WikiDocumentV1Schema = DocumentSchema.extend({
  document_type: z.literal('wiki'),
  properties: WikiPropertiesSchema,
  version: z.literal(1).optional(),
});

export const IssueDocumentV1Schema = DocumentSchema.extend({
  document_type: z.literal('issue'),
  properties: IssuePropertiesSchema,
  ticket_number: z.number(),
  version: z.literal(1).optional(),
});

export const ProgramDocumentV1Schema = DocumentSchema.extend({
  document_type: z.literal('program'),
  properties: ProgramPropertiesSchema,
  version: z.literal(1).optional(),
});

export const ProjectDocumentV1Schema = DocumentSchema.extend({
  document_type: z.literal('project'),
  properties: ProjectPropertiesSchema,
  version: z.literal(1).optional(),
});

export const WeekDocumentV1Schema = DocumentSchema.extend({
  document_type: z.literal('sprint'),
  properties: WeekPropertiesSchema,
  version: z.literal(1).optional(),
});

export const PersonDocumentV1Schema = DocumentSchema.extend({
  document_type: z.literal('person'),
  properties: PersonPropertiesSchema,
  version: z.literal(1).optional(),
});

export const WeeklyPlanDocumentV1Schema = DocumentSchema.extend({
  document_type: z.literal('weekly_plan'),
  properties: WeeklyPlanPropertiesSchema,
  version: z.literal(1).optional(),
});

export const WeeklyRetroDocumentV1Schema = DocumentSchema.extend({
  document_type: z.literal('weekly_retro'),
  properties: WeeklyRetroPropertiesSchema,
  version: z.literal(1).optional(),
});

export const StandupDocumentV1Schema = DocumentSchema.extend({
  document_type: z.literal('standup'),
  properties: StandupPropertiesSchema,
  version: z.literal(1).optional(),
});

export const WeeklyReviewDocumentV1Schema = DocumentSchema.extend({
  document_type: z.literal('weekly_review'),
  properties: WeeklyReviewPropertiesSchema,
  version: z.literal(1).optional(),
});

// ─── Bidirectional Type Checks ──────────────────────────────────────────────
// These compile-time assertions ensure Zod schemas stay in sync with TS interfaces.
// If you add a field to an interface but forget the Zod schema (or vice versa),
// TypeScript will produce a compile error here.

// Enum / literal types
type _Check_DocumentVisibility = AssertMutuallyAssignable<z.infer<typeof DocumentVisibilitySchema>, DocumentVisibility>;
type _Check_BelongsToType = AssertMutuallyAssignable<z.infer<typeof BelongsToTypeSchema>, BelongsToType>;
type _Check_DocumentType = AssertMutuallyAssignable<z.infer<typeof DocumentTypeSchema>, DocumentType>;
type _Check_IssueState = AssertMutuallyAssignable<z.infer<typeof IssueStateSchema>, IssueState>;
type _Check_IssuePriority = AssertMutuallyAssignable<z.infer<typeof IssuePrioritySchema>, IssuePriority>;
type _Check_IssueSource = AssertMutuallyAssignable<z.infer<typeof IssueSourceSchema>, IssueSource>;
type _Check_AccountabilityType = AssertMutuallyAssignable<z.infer<typeof AccountabilityTypeSchema>, AccountabilityType>;
type _Check_WeekStatus = AssertMutuallyAssignable<z.infer<typeof WeekStatusSchema>, WeekStatus>;
type _Check_ICEScore = AssertMutuallyAssignable<z.infer<typeof ICEScoreSchema>, ICEScore>;
type _Check_ApprovalState = AssertMutuallyAssignable<z.infer<typeof ApprovalStateSchema>, ApprovalState>;

// Helper / association types
type _Check_BelongsTo = AssertMutuallyAssignable<z.infer<typeof BelongsToSchema>, BelongsTo>;
type _Check_IncompleteChild = AssertMutuallyAssignable<z.infer<typeof IncompleteChildSchema>, IncompleteChild>;
type _Check_CascadeWarning = AssertMutuallyAssignable<z.infer<typeof CascadeWarningSchema>, CascadeWarning>;
type _Check_PlanHistoryEntry = AssertMutuallyAssignable<z.infer<typeof PlanHistoryEntrySchema>, PlanHistoryEntry>;
type _Check_ApprovalTracking = AssertMutuallyAssignable<z.infer<typeof ApprovalTrackingSchema>, ApprovalTracking>;

// Property types
type _Check_IssueProperties = AssertMutuallyAssignable<z.infer<typeof IssuePropertiesSchema>, IssueProperties>;
type _Check_ProgramProperties = AssertMutuallyAssignable<z.infer<typeof ProgramPropertiesSchema>, ProgramProperties>;
type _Check_ProjectProperties = AssertMutuallyAssignable<z.infer<typeof ProjectPropertiesSchema>, ProjectProperties>;
type _Check_WeekProperties = AssertMutuallyAssignable<z.infer<typeof WeekPropertiesSchema>, WeekProperties>;
type _Check_PersonProperties = AssertMutuallyAssignable<z.infer<typeof PersonPropertiesSchema>, PersonProperties>;
type _Check_WikiProperties = AssertMutuallyAssignable<z.infer<typeof WikiPropertiesSchema>, WikiProperties>;
type _Check_WeeklyPlanProperties = AssertMutuallyAssignable<z.infer<typeof WeeklyPlanPropertiesSchema>, WeeklyPlanProperties>;
type _Check_WeeklyRetroProperties = AssertMutuallyAssignable<z.infer<typeof WeeklyRetroPropertiesSchema>, WeeklyRetroProperties>;
type _Check_StandupProperties = AssertMutuallyAssignable<z.infer<typeof StandupPropertiesSchema>, StandupProperties>;
type _Check_WeeklyReviewProperties = AssertMutuallyAssignable<z.infer<typeof WeeklyReviewPropertiesSchema>, WeeklyReviewProperties>;

// Base document
type _Check_Document = AssertMutuallyAssignable<z.infer<typeof DocumentSchema>, Document>;

// Typed document variants (V1)
type _Check_WikiDocumentV1 = AssertMutuallyAssignable<z.infer<typeof WikiDocumentV1Schema>, WikiDocumentV1>;
type _Check_IssueDocumentV1 = AssertMutuallyAssignable<z.infer<typeof IssueDocumentV1Schema>, IssueDocumentV1>;
type _Check_ProgramDocumentV1 = AssertMutuallyAssignable<z.infer<typeof ProgramDocumentV1Schema>, ProgramDocumentV1>;
type _Check_ProjectDocumentV1 = AssertMutuallyAssignable<z.infer<typeof ProjectDocumentV1Schema>, ProjectDocumentV1>;
type _Check_WeekDocumentV1 = AssertMutuallyAssignable<z.infer<typeof WeekDocumentV1Schema>, WeekDocumentV1>;
type _Check_PersonDocumentV1 = AssertMutuallyAssignable<z.infer<typeof PersonDocumentV1Schema>, PersonDocumentV1>;
type _Check_WeeklyPlanDocumentV1 = AssertMutuallyAssignable<z.infer<typeof WeeklyPlanDocumentV1Schema>, WeeklyPlanDocumentV1>;
type _Check_WeeklyRetroDocumentV1 = AssertMutuallyAssignable<z.infer<typeof WeeklyRetroDocumentV1Schema>, WeeklyRetroDocumentV1>;
type _Check_StandupDocumentV1 = AssertMutuallyAssignable<z.infer<typeof StandupDocumentV1Schema>, StandupDocumentV1>;
type _Check_WeeklyReviewDocumentV1 = AssertMutuallyAssignable<z.infer<typeof WeeklyReviewDocumentV1Schema>, WeeklyReviewDocumentV1>;
