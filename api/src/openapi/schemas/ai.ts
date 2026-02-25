/**
 * AI analysis schemas - Plan and retro quality feedback
 */

import { z, registry } from '../registry.js';

// ============== Plan Analysis ==============

const PlanItemAnalysisSchema = z.object({
  text: z.string(),
  score: z.number().min(0).max(1),
  feedback: z.string(),
  issues: z.array(z.string()),
}).openapi('PlanItemAnalysis');

const PlanAnalysisResultSchema = z.object({
  overall_score: z.number().min(0).max(1),
  items: z.array(PlanItemAnalysisSchema),
  workload_assessment: z.enum(['light', 'moderate', 'heavy', 'excessive']),
  workload_feedback: z.string(),
}).openapi('PlanAnalysisResult');

registry.register('PlanAnalysisResult', PlanAnalysisResultSchema);

// ============== Retro Analysis ==============

const RetroItemAnalysisSchema = z.object({
  plan_item: z.string(),
  addressed: z.boolean(),
  has_evidence: z.boolean(),
  feedback: z.string(),
}).openapi('RetroItemAnalysis');

const RetroAnalysisResultSchema = z.object({
  overall_score: z.number().min(0).max(1),
  plan_coverage: z.array(RetroItemAnalysisSchema),
  suggestions: z.array(z.string()),
}).openapi('RetroAnalysisResult');

registry.register('RetroAnalysisResult', RetroAnalysisResultSchema);

// ============== AI Status ==============

const AiStatusSchema = z.object({
  available: z.boolean(),
}).openapi('AiStatus');

registry.register('AiStatus', AiStatusSchema);

// ============== Register Endpoints ==============

registry.registerPath({
  method: 'get',
  path: '/ai/status',
  tags: ['AI'],
  summary: 'Check AI analysis availability',
  description: 'Returns whether the AI analysis service is available (Bedrock client initialized).',
  responses: {
    200: {
      description: 'AI availability status',
      content: { 'application/json': { schema: AiStatusSchema } },
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/ai/analyze-plan',
  tags: ['AI'],
  summary: 'Analyze weekly plan quality',
  description: 'Evaluates plan items for verifiability (falsifiability) and workload. Returns per-item scores and feedback. Advisory only — does not block plan submission.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            content: z.record(z.string(), z.unknown()).describe('TipTap JSON content of the weekly plan'),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Plan analysis result (or {error: "ai_unavailable"} if service is down)',
      content: { 'application/json': { schema: PlanAnalysisResultSchema } },
    },
    429: {
      description: 'Rate limit exceeded (max 10 per hour)',
    },
  },
});

registry.registerPath({
  method: 'post',
  path: '/ai/analyze-retro',
  tags: ['AI'],
  summary: 'Analyze weekly retro quality',
  description: 'Compares retro against plan for coverage and evidence. Returns per-item mapping and suggestions. Advisory only — does not block retro submission.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            retro_content: z.record(z.string(), z.unknown()).describe('TipTap JSON content of the weekly retro'),
            plan_content: z.record(z.string(), z.unknown()).describe('TipTap JSON content of the weekly plan for comparison'),
          }),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Retro analysis result (or {error: "ai_unavailable"} if service is down)',
      content: { 'application/json': { schema: RetroAnalysisResultSchema } },
    },
    429: {
      description: 'Rate limit exceeded (max 10 per hour)',
    },
  },
});
