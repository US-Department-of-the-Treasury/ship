/**
 * Dashboard schemas - My work and overview data
 */

import { z, registry } from '../registry.js';
import { UuidSchema } from './common.js';

// ============== Work Item ==============

export const UrgencySchema = z.enum(['overdue', 'this_sprint', 'later']).openapi({
  description: 'Urgency level for work items',
});

export const WorkItemSchema = z.object({
  id: UuidSchema,
  title: z.string(),
  type: z.enum(['issue', 'project', 'sprint']),
  urgency: UrgencySchema,
  // Issue-specific
  state: z.string().optional(),
  priority: z.string().optional(),
  ticket_number: z.number().int().optional(),
  sprint_id: UuidSchema.nullable().optional(),
  sprint_name: z.string().nullable().optional(),
  // Project-specific
  ice_score: z.number().nullable().optional(),
  inferred_status: z.string().optional(),
  // Sprint-specific
  sprint_number: z.number().int().optional(),
  days_remaining: z.number().int().optional(),
  // Common
  program_name: z.string().nullable().optional(),
}).openapi('WorkItem');

registry.register('WorkItem', WorkItemSchema);

// ============== My Work Response ==============

export const MyWorkResponseSchema = z.object({
  items: z.array(WorkItemSchema),
  currentSprintNumber: z.number().int(),
  daysRemaining: z.number().int().openapi({
    description: 'Days remaining in current sprint',
  }),
}).openapi('MyWorkResponse');

registry.register('MyWorkResponse', MyWorkResponseSchema);

// ============== Register Dashboard Endpoints ==============

registry.registerPath({
  method: 'get',
  path: '/dashboard/my-work',
  tags: ['Dashboard'],
  summary: 'Get my work items',
  description: 'Returns work items for the current user organized by urgency: issues assigned, projects owned, and active sprints.',
  responses: {
    200: {
      description: 'Work items organized by urgency',
      content: {
        'application/json': {
          schema: MyWorkResponseSchema,
        },
      },
    },
  },
});

// ============== My Focus ==============

export const PlanItemSchema = z.object({
  text: z.string(),
  checked: z.boolean(),
}).openapi('PlanItem');

registry.register('PlanItem', PlanItemSchema);

export const FocusPlanSchema = z.object({
  id: UuidSchema.nullable(),
  week_number: z.number().int(),
  items: z.array(PlanItemSchema),
}).openapi('FocusPlan');

registry.register('FocusPlan', FocusPlanSchema);

export const RecentActivityItemSchema = z.object({
  id: UuidSchema,
  title: z.string(),
  ticket_number: z.number().int(),
  state: z.string(),
  updated_at: z.string(),
}).openapi('RecentActivityItem');

registry.register('RecentActivityItem', RecentActivityItemSchema);

export const FocusProjectSchema = z.object({
  id: UuidSchema,
  title: z.string(),
  program_name: z.string().nullable(),
  plan: FocusPlanSchema,
  previous_plan: FocusPlanSchema,
  recent_activity: z.array(RecentActivityItemSchema),
}).openapi('FocusProject');

registry.register('FocusProject', FocusProjectSchema);

export const MyFocusResponseSchema = z.object({
  person_id: UuidSchema,
  current_week_number: z.number().int(),
  week_start: z.string().openapi({ description: 'ISO date string (YYYY-MM-DD)' }),
  week_end: z.string().openapi({ description: 'ISO date string (YYYY-MM-DD)' }),
  projects: z.array(FocusProjectSchema),
}).openapi('MyFocusResponse');

registry.register('MyFocusResponse', MyFocusResponseSchema);

registry.registerPath({
  method: 'get',
  path: '/dashboard/my-focus',
  tags: ['Dashboard'],
  summary: 'Get my project focus for the current week',
  description: 'Returns the current user\'s project context: allocated projects, current and previous week plans with parsed items, and recent issue activity.',
  responses: {
    200: {
      description: 'Project focus data for the current user',
      content: {
        'application/json': {
          schema: MyFocusResponseSchema,
        },
      },
    },
    404: {
      description: 'Person not found for current user',
    },
  },
});
