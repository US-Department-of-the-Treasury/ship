/**
 * Standup schemas - Standalone daily updates (date-based)
 */

import { z, registry } from '../registry.js';
import { UuidSchema, DateTimeSchema, DateSchema } from './common.js';

// ============== Standup Response ==============

export const StandupResponseSchema = z.object({
  id: UuidSchema,
  title: z.string(),
  document_type: z.literal('standup'),
  content: z.record(z.unknown()).nullable(),
  properties: z.record(z.unknown()).nullable().openapi({
    description: 'Properties including author_id and date',
  }),
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
  date: DateSchema.openapi({ description: 'Date for the standup (YYYY-MM-DD)' }),
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
  summary: 'List standups for current user',
  description: 'Get standups for the current user within a date range.',
  request: {
    query: z.object({
      date_from: DateSchema.openapi({ description: 'Start date (YYYY-MM-DD)' }),
      date_to: DateSchema.openapi({ description: 'End date (YYYY-MM-DD)' }),
    }),
  },
  responses: {
    200: {
      description: 'List of standups in the date range',
      content: {
        'application/json': {
          schema: z.array(StandupResponseSchema),
        },
      },
    },
    400: {
      description: 'Missing required date_from or date_to params',
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/standups',
  tags: ['Standups'],
  summary: 'Create standup (idempotent)',
  description: 'Create a standalone standup for the current user on a given date. Returns existing standup if one already exists for that date.',
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
    200: {
      description: 'Existing standup returned (idempotent)',
      content: {
        'application/json': {
          schema: StandupResponseSchema,
        },
      },
    },
    201: {
      description: 'New standup created',
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
