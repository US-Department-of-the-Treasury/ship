/**
 * Activity schemas - 30-day activity data for programs, projects, and sprints
 */

import { z, registry } from '../registry.js';
import { UuidSchema, DateSchema } from './common.js';

// ============== Activity Response ==============

export const ActivityDaySchema = z.object({
  date: DateSchema,
  count: z.number().int().openapi({
    description: 'Number of document changes on this day',
  }),
}).openapi('ActivityDay');

registry.register('ActivityDay', ActivityDaySchema);

export const ActivityResponseSchema = z.object({
  days: z.array(ActivityDaySchema).openapi({
    description: 'Last 30 days of activity counts',
  }),
}).openapi('ActivityResponse');

registry.register('ActivityResponse', ActivityResponseSchema);

// ============== Register Activity Endpoints ==============

registry.registerPath({
  method: 'get',
  path: '/activity/{entityType}/{entityId}',
  tags: ['Activity'],
  summary: 'Get entity activity',
  description: 'Get 30 days of activity counts for an entity and its children.',
  request: {
    params: z.object({
      entityType: z.enum(['program', 'project', 'sprint']).openapi({
        description: 'Type of entity to get activity for',
      }),
      entityId: UuidSchema,
    }),
  },
  responses: {
    200: {
      description: 'Activity data',
      content: {
        'application/json': {
          schema: ActivityResponseSchema,
        },
      },
    },
    400: {
      description: 'Invalid entity type',
    },
    404: {
      description: 'Entity not found',
    },
  },
});
