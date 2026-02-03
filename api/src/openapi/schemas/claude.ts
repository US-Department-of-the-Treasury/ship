/**
 * Claude Context API - Provides context for Claude skills
 *
 * These endpoints provide comprehensive context for intelligent questioning
 * during standups, sprint reviews, and project retrospectives.
 */

import { z, registry } from '../registry.js';
import { UuidSchema, DateTimeSchema } from './common.js';

// ============== Context Types ==============

export const ContextTypeSchema = z.enum(['standup', 'review', 'retro']).openapi({
  description: 'Type of context to fetch',
});

// ============== Issue Stats ==============

export const IssueStatsSchema = z.object({
  total: z.number().int(),
  completed: z.number().int(),
  in_progress: z.number().int(),
  todo: z.number().int().optional(),
  planned_at_start: z.number().int().optional(),
  added_mid_sprint: z.number().int().optional(),
  cancelled: z.number().int().optional(),
  active: z.number().int().optional(),
}).openapi('IssueStats');

registry.register('IssueStats', IssueStatsSchema);

// ============== Standup Context ==============

export const StandupContextSchema = z.object({
  sprint: z.object({
    id: UuidSchema,
    title: z.string(),
    sprint_number: z.number().int(),
    status: z.string(),
    plan: z.string().nullable(),
  }),
  program: z.object({
    id: UuidSchema.nullable(),
    name: z.string().nullable(),
    description: z.string().nullable(),
    goals: z.string().nullable(),
  }).nullable(),
  project: z.object({
    id: UuidSchema.nullable(),
    name: z.string().nullable(),
    plan: z.string().nullable(),
    ice_impact: z.number().nullable(),
    ice_confidence: z.number().nullable(),
    ice_ease: z.number().nullable(),
  }).nullable(),
  issues: z.object({
    stats: IssueStatsSchema,
    active: z.array(z.object({
      id: UuidSchema,
      title: z.string(),
      state: z.string(),
      ticket_number: z.number().int(),
    })),
  }),
  recent_standups: z.array(z.object({
    id: UuidSchema,
    content: z.record(z.unknown()).nullable(),
    created_at: DateTimeSchema,
    author_name: z.string(),
  })),
  clarifying_questions_context: z.string().nullable(),
}).openapi('StandupContext');

registry.register('StandupContext', StandupContextSchema);

// ============== Review Context ==============

export const ReviewContextSchema = z.object({
  sprint: z.object({
    id: UuidSchema,
    title: z.string(),
    sprint_number: z.number().int(),
    plan: z.string().nullable(),
  }),
  program: z.object({
    id: UuidSchema.nullable(),
    name: z.string().nullable(),
  }).nullable(),
  project: z.object({
    id: UuidSchema.nullable(),
    name: z.string().nullable(),
    plan: z.string().nullable(),
  }).nullable(),
  issues: z.object({
    stats: IssueStatsSchema,
    completed: z.array(z.object({
      id: UuidSchema,
      title: z.string(),
      ticket_number: z.number().int(),
      was_planned: z.boolean(),
    })),
    incomplete: z.array(z.object({
      id: UuidSchema,
      title: z.string(),
      state: z.string(),
      ticket_number: z.number().int(),
    })),
  }),
  previous_review: z.object({
    plan_validated: z.boolean().nullable(),
    content: z.record(z.unknown()).nullable(),
  }).nullable(),
}).openapi('ReviewContext');

registry.register('ReviewContext', ReviewContextSchema);

// ============== Retro Context ==============

export const RetroContextSchema = z.object({
  project: z.object({
    id: UuidSchema,
    title: z.string(),
    plan: z.string().nullable(),
    ice_impact: z.number().nullable(),
    ice_confidence: z.number().nullable(),
    ice_ease: z.number().nullable(),
    monetary_impact_expected: z.string().nullable(),
  }),
  program: z.object({
    id: UuidSchema.nullable(),
    name: z.string().nullable(),
  }).nullable(),
  sprints: z.array(z.object({
    id: UuidSchema,
    title: z.string(),
    sprint_number: z.number().int(),
    plan_validated: z.boolean().nullable(),
  })),
  issues: z.object({
    stats: IssueStatsSchema,
    all: z.array(z.object({
      id: UuidSchema,
      title: z.string(),
      state: z.string(),
      ticket_number: z.number().int(),
    })),
  }),
}).openapi('RetroContext');

registry.register('RetroContext', RetroContextSchema);

// ============== Register Claude Endpoints ==============

registry.registerPath({
  method: 'get',
  path: '/claude/context',
  tags: ['Claude'],
  summary: 'Get context for Claude skills',
  description: 'Returns comprehensive context for Claude to ask intelligent questions during standups, reviews, and retros.',
  request: {
    query: z.object({
      context_type: ContextTypeSchema,
      sprint_id: UuidSchema.optional().openapi({
        description: 'Required for standup and review context',
      }),
      project_id: UuidSchema.optional().openapi({
        description: 'Required for retro context',
      }),
    }),
  },
  responses: {
    200: {
      description: 'Context data (shape depends on context_type)',
      content: {
        'application/json': {
          schema: z.union([StandupContextSchema, ReviewContextSchema, RetroContextSchema]),
        },
      },
    },
    400: {
      description: 'Missing required parameter for context_type',
    },
  },
});
