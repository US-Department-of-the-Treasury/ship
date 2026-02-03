/**
 * Standup schemas - Daily updates attached to sprints
 */

import { z, registry } from '../registry.js';
import { UuidSchema, DateTimeSchema, UserReferenceSchema } from './common.js';

// ============== Standup Response ==============

export const StandupResponseSchema = z.object({
  id: UuidSchema,
  title: z.string(),
  content: z.record(z.unknown()).nullable(),
  author: UserReferenceSchema,
  sprint_id: UuidSchema.openapi({ description: 'Parent sprint ID' }),
  created_at: DateTimeSchema,
  updated_at: DateTimeSchema,
}).openapi('Standup');

registry.register('Standup', StandupResponseSchema);

// ============== Standup Status ==============

export const StandupStatusSchema = z.object({
  due: z.boolean().openapi({
    description: 'True if user has active sprint but has not posted today',
  }),
  lastPosted: DateTimeSchema.nullable().openapi({
    description: 'Timestamp of last standup posted',
  }),
}).openapi('StandupStatus');

registry.register('StandupStatus', StandupStatusSchema);

// ============== Create/Update Standup ==============

export const CreateStandupSchema = z.object({
  sprint_id: UuidSchema.openapi({ description: 'Sprint to attach standup to' }),
  title: z.string().max(200).optional(),
  content: z.record(z.unknown()).optional(),
}).openapi('CreateStandup');

registry.register('CreateStandup', CreateStandupSchema);

export const UpdateStandupSchema = z.object({
  title: z.string().max(200).optional(),
  content: z.record(z.unknown()).optional(),
}).openapi('UpdateStandup');

registry.register('UpdateStandup', UpdateStandupSchema);

// ============== Register Standup Endpoints ==============

registry.registerPath({
  method: 'get',
  path: '/standups/status',
  tags: ['Standups'],
  summary: 'Get standup due status',
  description: 'Check if current user needs to post a standup today.',
  responses: {
    200: {
      description: 'Standup status',
      content: {
        'application/json': {
          schema: StandupStatusSchema,
        },
      },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/standups',
  tags: ['Standups'],
  summary: 'List standups',
  description: 'List standups with optional filtering by sprint.',
  request: {
    query: z.object({
      sprint_id: UuidSchema.optional(),
      author_id: UuidSchema.optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
    }),
  },
  responses: {
    200: {
      description: 'List of standups',
      content: {
        'application/json': {
          schema: z.array(StandupResponseSchema),
        },
      },
    },
  },
});

registry.registerPath({
  method: 'get',
  path: '/standups/{id}',
  tags: ['Standups'],
  summary: 'Get standup by ID',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
  },
  responses: {
    200: {
      description: 'Standup details',
      content: {
        'application/json': {
          schema: StandupResponseSchema,
        },
      },
    },
    404: {
      description: 'Standup not found',
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/standups',
  tags: ['Standups'],
  summary: 'Create standup',
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateStandupSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Created standup',
      content: {
        'application/json': {
          schema: StandupResponseSchema,
        },
      },
    },
    400: {
      description: 'Validation error',
    },
  },
});

registry.registerPath({
  method: 'patch',
  path: '/standups/{id}',
  tags: ['Standups'],
  summary: 'Update standup',
  description: 'Only the author or an admin can update a standup.',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
    body: {
      content: {
        'application/json': {
          schema: UpdateStandupSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Updated standup',
      content: {
        'application/json': {
          schema: StandupResponseSchema,
        },
      },
    },
    403: {
      description: 'Forbidden - only author or admin can update',
    },
    404: {
      description: 'Standup not found',
    },
  },
});

registry.registerPath({
  method: 'delete',
  path: '/standups/{id}',
  tags: ['Standups'],
  summary: 'Delete standup',
  description: 'Only the author or an admin can delete a standup.',
  request: {
    params: z.object({
      id: UuidSchema,
    }),
  },
  responses: {
    204: {
      description: 'Standup deleted',
    },
    403: {
      description: 'Forbidden - only author or admin can delete',
    },
    404: {
      description: 'Standup not found',
    },
  },
});
