/**
 * Weekly Plans & Retros schemas - Personal weekly plan and retro documents
 */

import { z, registry } from '../registry.js';
import { UuidSchema, DateTimeSchema, DateSchema } from './common.js';

// ============== Weekly Plan ==============

export const WeeklyPlanResponseSchema = z.object({
  id: UuidSchema,
  title: z.string(),
  document_type: z.literal('weekly_plan'),
  content: z.record(z.unknown()).nullable(),
  properties: z.record(z.unknown()).nullable(),
  person_name: z.string().nullable().optional(),
  project_name: z.string().nullable().optional(),
  created_at: DateTimeSchema,
  updated_at: DateTimeSchema,
}).openapi('WeeklyPlan');

registry.register('WeeklyPlan', WeeklyPlanResponseSchema);

export const CreateWeeklyPlanSchema = z.object({
  person_id: UuidSchema.openapi({ description: 'Person document ID' }),
  project_id: UuidSchema.optional().openapi({ description: 'Optional legacy project reference' }),
  week_number: z.number().int().min(1).openapi({ description: 'Sprint/week number' }),
}).openapi('CreateWeeklyPlan');

registry.register('CreateWeeklyPlan', CreateWeeklyPlanSchema);

// ============== Weekly Retro ==============

export const WeeklyRetroResponseSchema = z.object({
  id: UuidSchema,
  title: z.string(),
  document_type: z.literal('weekly_retro'),
  content: z.record(z.unknown()).nullable(),
  properties: z.record(z.unknown()).nullable(),
  person_name: z.string().nullable().optional(),
  project_name: z.string().nullable().optional(),
  created_at: DateTimeSchema,
  updated_at: DateTimeSchema,
}).openapi('WeeklyRetro');

registry.register('WeeklyRetro', WeeklyRetroResponseSchema);

export const CreateWeeklyRetroSchema = z.object({
  person_id: UuidSchema.openapi({ description: 'Person document ID' }),
  project_id: UuidSchema.optional().openapi({ description: 'Optional legacy project reference' }),
  week_number: z.number().int().min(1).openapi({ description: 'Sprint/week number' }),
}).openapi('CreateWeeklyRetro');

registry.register('CreateWeeklyRetro', CreateWeeklyRetroSchema);

// ============== Content History ==============

export const ContentHistoryEntrySchema = z.object({
  id: UuidSchema,
  old_content: z.record(z.unknown()).nullable(),
  new_content: z.record(z.unknown()).nullable(),
  created_at: DateTimeSchema,
  changed_by: z.object({
    id: UuidSchema,
    name: z.string(),
  }).nullable(),
}).openapi('ContentHistoryEntry');

registry.register('ContentHistoryEntry', ContentHistoryEntrySchema);

// ============== Allocation Grid ==============

export const AllocationWeekSchema = z.object({
  number: z.number().int(),
  name: z.string(),
  startDate: DateSchema,
  endDate: DateSchema,
  isCurrent: z.boolean(),
}).openapi('AllocationWeek');

registry.register('AllocationWeek', AllocationWeekSchema);

export const WeekStatusSchema = z.object({
  isAllocated: z.boolean(),
  planId: UuidSchema.nullable(),
  planStatus: z.enum(['done', 'due', 'late', 'future']),
  retroId: UuidSchema.nullable(),
  retroStatus: z.enum(['done', 'due', 'late', 'future']),
}).openapi('WeekStatus');

registry.register('WeekStatus', WeekStatusSchema);

export const AllocationPersonSchema = z.object({
  id: UuidSchema,
  name: z.string(),
  weeks: z.record(WeekStatusSchema).openapi({
    description: 'Map of week number to allocation/status data',
  }),
}).openapi('AllocationPerson');

registry.register('AllocationPerson', AllocationPersonSchema);

export const AllocationGridResponseSchema = z.object({
  projectId: UuidSchema,
  projectTitle: z.string(),
  currentSprintNumber: z.number().int(),
  weeks: z.array(AllocationWeekSchema),
  people: z.array(AllocationPersonSchema),
}).openapi('AllocationGridResponse');

registry.register('AllocationGridResponse', AllocationGridResponseSchema);

// ============== Register Weekly Plan Endpoints ==============

registry.registerPath({
  method: 'post',
  path: '/weekly-plans',
  tags: ['Weekly Plans'],
  summary: 'Create or get weekly plan (idempotent)',
  description: 'Creates a weekly plan for a person+week combination, or returns existing one. Uniqueness is by person_id + week_number.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateWeeklyPlanSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Existing weekly plan returned',
      content: {
        'application/json': {
          schema: WeeklyPlanResponseSchema,
        },
      },
    },
    201: {
      description: 'New weekly plan created',
      content: {
        'application/json': {
          schema: WeeklyPlanResponseSchema,
        },
      },
    },
    400: {
      description: 'Invalid input',
    },
    404: {
      description: 'Person not found',
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/weekly-plans',
  tags: ['Weekly Plans'],
  summary: 'Query weekly plans',
  description: 'List weekly plans with optional filtering by person, project, or week number.',
  request: {
    query: z.object({
      person_id: UuidSchema.optional(),
      project_id: UuidSchema.optional(),
      week_number: z.coerce.number().int().optional(),
    }),
  },
  responses: {
    200: {
      description: 'List of weekly plans',
      content: {
        'application/json': {
          schema: z.array(WeeklyPlanResponseSchema),
        },
      },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/weekly-plans/{id}',
  tags: ['Weekly Plans'],
  summary: 'Get weekly plan by ID',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
  },
  responses: {
    200: {
      description: 'Weekly plan document',
      content: {
        'application/json': {
          schema: WeeklyPlanResponseSchema,
        },
      },
    },
    404: {
      description: 'Weekly plan not found',
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/weekly-plans/{id}/history',
  tags: ['Weekly Plans'],
  summary: 'Get weekly plan content history',
  description: 'Get content version history for a weekly plan.',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
  },
  responses: {
    200: {
      description: 'List of content versions',
      content: {
        'application/json': {
          schema: z.array(ContentHistoryEntrySchema),
        },
      },
    },
    404: {
      description: 'Weekly plan not found',
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/weekly-plans/project-allocation-grid/{projectId}',
  tags: ['Weekly Plans'],
  summary: 'Get project allocation grid',
  description: 'Returns people allocated to a project (via sprint assignee_ids), weeks, and plan/retro status per person per week.',
  request: {
    params: z.object({
      projectId: UuidSchema,
    }),
  },
  responses: {
    200: {
      description: 'Allocation grid data',
      content: {
        'application/json': {
          schema: AllocationGridResponseSchema,
        },
      },
    },
    404: {
      description: 'Project not found',
    },
  },
});

// ============== Register Weekly Retro Endpoints ==============

registry.registerPath({
  method: 'post',
  path: '/weekly-retros',
  tags: ['Weekly Retros'],
  summary: 'Create or get weekly retro (idempotent)',
  description: 'Creates a weekly retro for a person+week combination, or returns existing one. Auto-populates with plan items if a plan exists for the same week.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateWeeklyRetroSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Existing weekly retro returned',
      content: {
        'application/json': {
          schema: WeeklyRetroResponseSchema,
        },
      },
    },
    201: {
      description: 'New weekly retro created',
      content: {
        'application/json': {
          schema: WeeklyRetroResponseSchema,
        },
      },
    },
    400: {
      description: 'Invalid input',
    },
    404: {
      description: 'Person not found',
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/weekly-retros',
  tags: ['Weekly Retros'],
  summary: 'Query weekly retros',
  description: 'List weekly retros with optional filtering by person, project, or week number.',
  request: {
    query: z.object({
      person_id: UuidSchema.optional(),
      project_id: UuidSchema.optional(),
      week_number: z.coerce.number().int().optional(),
    }),
  },
  responses: {
    200: {
      description: 'List of weekly retros',
      content: {
        'application/json': {
          schema: z.array(WeeklyRetroResponseSchema),
        },
      },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/weekly-retros/{id}',
  tags: ['Weekly Retros'],
  summary: 'Get weekly retro by ID',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
  },
  responses: {
    200: {
      description: 'Weekly retro document',
      content: {
        'application/json': {
          schema: WeeklyRetroResponseSchema,
        },
      },
    },
    404: {
      description: 'Weekly retro not found',
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/weekly-retros/{id}/history',
  tags: ['Weekly Retros'],
  summary: 'Get weekly retro content history',
  description: 'Get content version history for a weekly retro.',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
  },
  responses: {
    200: {
      description: 'List of content versions',
      content: {
        'application/json': {
          schema: z.array(ContentHistoryEntrySchema),
        },
      },
    },
    404: {
      description: 'Weekly retro not found',
    },
  },
});
