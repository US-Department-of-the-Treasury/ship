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
