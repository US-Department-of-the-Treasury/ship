/**
 * Team schemas - Team grid, people, and capacity management
 */

import { z, registry } from '../registry.js';
import { UuidSchema, DateSchema } from './common.js';

// ============== Person ==============

export const PersonSchema = z.object({
  personId: UuidSchema.openapi({ description: 'Person document ID (used for allocations)' }),
  id: UuidSchema.nullable().openapi({ description: 'User ID (null for pending users)' }),
  name: z.string(),
  email: z.string().email().nullable(),
  isArchived: z.boolean(),
  isPending: z.boolean().openapi({ description: 'User has not accepted invite yet' }),
}).openapi('Person');

registry.register('Person', PersonSchema);

// ============== Sprint Period ==============

export const SprintPeriodSchema = z.object({
  number: z.number().int(),
  name: z.string().openapi({ example: 'Week 5' }),
  startDate: DateSchema,
  endDate: DateSchema,
  isCurrent: z.boolean(),
}).openapi('SprintPeriod');

registry.register('SprintPeriod', SprintPeriodSchema);

// ============== Team Grid ==============

export const TeamGridAssociationSchema = z.object({
  programs: z.array(z.object({
    id: UuidSchema,
    name: z.string(),
    emoji: z.string().nullable(),
    color: z.string(),
    issueCount: z.number().int(),
  })),
  issues: z.array(z.object({
    id: UuidSchema,
    title: z.string(),
    displayId: z.string(),
    state: z.string(),
  })),
}).openapi('TeamGridAssociation');

export const TeamGridResponseSchema = z.object({
  users: z.array(PersonSchema),
  sprints: z.array(SprintPeriodSchema),
  associations: z.record(z.record(TeamGridAssociationSchema)).openapi({
    description: 'Map of user_id -> sprint_number -> associations',
  }),
}).openapi('TeamGridResponse');

registry.register('TeamGridResponse', TeamGridResponseSchema);

// ============== Register Team Endpoints ==============

registry.registerPath({
  method: 'get',
  path: '/team/grid',
  tags: ['Team'],
  summary: 'Get team grid data',
  description: 'Get team members with their sprint associations for the allocation grid.',
  request: {
    query: z.object({
      fromSprint: z.coerce.number().int().optional().openapi({
        description: 'Start of sprint range (default: current - 7)',
      }),
      toSprint: z.coerce.number().int().optional().openapi({
        description: 'End of sprint range (default: current + 7)',
      }),
      includeArchived: z.coerce.boolean().optional().openapi({
        description: 'Include archived team members',
      }),
    }),
  },
  responses: {
    200: {
      description: 'Team grid data',
      content: {
        'application/json': {
          schema: TeamGridResponseSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/team',
  tags: ['Team'],
  summary: 'List team members',
  description: 'List all person documents in the workspace.',
  request: {
    query: z.object({
      includeArchived: z.coerce.boolean().optional(),
    }),
  },
  responses: {
    200: {
      description: 'List of team members',
      content: {
        'application/json': {
          schema: z.array(PersonSchema),
        },
      },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/team/{id}',
  tags: ['Team'],
  summary: 'Get team member',
  description: 'Get a specific person document by ID.',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
  },
  responses: {
    200: {
      description: 'Person details',
      content: {
        'application/json': {
          schema: PersonSchema,
        },
      },
    },
    404: {
      description: 'Person not found',
    },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/team/{id}',
  tags: ['Team'],
  summary: 'Update team member',
  description: 'Update a person document (name, role, capacity, etc.).',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
    body: {
      content: {
        'application/json': {
          schema: z.object({
            name: z.string().min(1).max(200).optional(),
            role: z.string().max(100).optional(),
            capacity_hours: z.number().positive().optional().nullable(),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Updated person',
      content: {
        'application/json': {
          schema: PersonSchema,
        },
      },
    },
    404: {
      description: 'Person not found',
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/team/{id}/archive',
  tags: ['Team'],
  summary: 'Archive team member',
  description: 'Archive a person document (soft delete).',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
  },
  responses: {
    200: {
      description: 'Person archived',
    },
    404: {
      description: 'Person not found',
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/team/{id}/restore',
  tags: ['Team'],
  summary: 'Restore team member',
  description: 'Restore an archived person document.',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
  },
  responses: {
    200: {
      description: 'Person restored',
    },
    404: {
      description: 'Person not found',
    },
  },
});
