/**
 * AI-powered plan and retro quality analysis using AWS Bedrock (Claude Opus 4.5).
 *
 * Provides two analysis functions:
 * - analyzePlan: Evaluates weekly plan items for falsifiability and workload
 * - analyzeRetro: Compares retro against plan for coverage and evidence
 *
 * Uses AWS Bedrock's Claude Opus 4.5 model via the standard credential chain.
 * Gracefully degrades when Bedrock is unavailable.
 */

import { BedrockRuntimeClient, InvokeModelCommand } from '@aws-sdk/client-bedrock-runtime';
import { extractText } from '../utils/document-content.js';

const MODEL_ID = 'global.anthropic.claude-opus-4-5-20251101-v1:0';
const REGION = 'us-east-1';

// Lazy-initialize client (fails gracefully if AWS credentials unavailable)
let bedrockClient: BedrockRuntimeClient | null = null;
let clientInitFailed = false;

function getClient(): BedrockRuntimeClient | null {
  if (clientInitFailed) return null;
  if (bedrockClient) return bedrockClient;

  try {
    bedrockClient = new BedrockRuntimeClient({ region: REGION });
    return bedrockClient;
  } catch (err) {
    console.warn('Failed to initialize Bedrock client:', err);
    clientInitFailed = true;
    return null;
  }
}

// Simple in-memory rate limiter
const rateLimits = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 10; // max requests per hour per user
const RATE_WINDOW = 60 * 60 * 1000; // 1 hour in ms

function checkRateLimit(userId: string): boolean {
  const now = Date.now();
  const entry = rateLimits.get(userId);

  if (!entry || now >= entry.resetAt) {
    rateLimits.set(userId, { count: 1, resetAt: now + RATE_WINDOW });
    return true;
  }

  if (entry.count >= RATE_LIMIT) {
    return false;
  }

  entry.count++;
  return true;
}

/** Extract individual plan items from TipTap JSON content */
function extractPlanItems(content: unknown): string[] {
  if (!content || typeof content !== 'object') return [];
  const doc = content as { content?: unknown[] };
  if (!Array.isArray(doc.content)) return [];

  const items: string[] = [];

  function walkNodes(nodes: unknown[]) {
    for (const node of nodes) {
      if (!node || typeof node !== 'object') continue;
      const n = node as { type?: string; content?: unknown[] };

      // Extract text from list items and paragraphs (plan items)
      if (n.type === 'listItem' || n.type === 'taskItem') {
        const text = extractText(n).trim();
        if (text) items.push(text);
      } else if (n.type === 'paragraph' && !isHeading(node)) {
        const text = extractText(n).trim();
        if (text && text.length > 10) items.push(text); // Skip short fragments
      }

      // Recurse into container nodes (but not into already-captured list items)
      if (n.content && n.type !== 'listItem' && n.type !== 'taskItem') {
        walkNodes(n.content);
      }
    }
  }

  function isHeading(node: unknown): boolean {
    if (!node || typeof node !== 'object') return false;
    return (node as { type?: string }).type === 'heading';
  }

  walkNodes(doc.content);
  return items;
}

// Analysis result types
export interface PlanItemAnalysis {
  text: string;
  score: number; // 0-1 falsifiability score
  feedback: string;
  issues: string[];
}

export interface PlanAnalysisResult {
  overall_score: number; // 0-1
  items: PlanItemAnalysis[];
  workload_assessment: 'light' | 'moderate' | 'heavy' | 'excessive';
  workload_feedback: string;
}

export interface RetroItemAnalysis {
  plan_item: string;
  addressed: boolean;
  has_evidence: boolean;
  feedback: string;
}

export interface RetroAnalysisResult {
  overall_score: number; // 0-1
  plan_coverage: RetroItemAnalysis[];
  suggestions: string[];
}

export type AnalysisError = { error: string };

const PLAN_SYSTEM_PROMPT = `You are an AI assistant that evaluates weekly work plans for government employees.

Your job is to assess each plan item on two dimensions:
1. **Verifiability (score 0-1)**: Can an independent observer determine whether this item was completed by examining evidence? A score of 1.0 means the item has a clear, measurable deliverable. A score of 0.0 means it's completely vague.
2. **Workload**: Is the overall plan a reasonable amount of work for a full-time employee's week?

Key criteria for a good plan item:
- It produces a specific, tangible deliverable (document, report, shipped feature, completed calls)
- It has a clear definition of done
- Someone unfamiliar with the work could verify completion

Common problems:
- Activities instead of outcomes: "meet with", "coordinate with", "work on" describe what you'll DO, not what you'll PRODUCE
- Vague scope: "improve X", "investigate Y" have no definition of done
- Too little work: "take 5 calls" in a week is light for a full-time employee

Workload assessment:
- "light": Fewer than 3 significant items or items that represent less than a full week of work
- "moderate": 3-5 significant items representing a solid week of work
- "heavy": More than 5 significant items or items that are very ambitious
- "excessive": Unrealistically large amount of work

Respond ONLY with valid JSON matching this exact structure:
{
  "overall_score": <0-1 average of item scores>,
  "items": [
    {
      "text": "<the plan item text>",
      "score": <0-1>,
      "feedback": "<specific, actionable feedback>",
      "issues": ["<issue tag: not_falsifiable, no_deliverable, too_vague, too_light, etc>"]
    }
  ],
  "workload_assessment": "<light|moderate|heavy|excessive>",
  "workload_feedback": "<brief assessment of overall workload>"
}`;

const RETRO_SYSTEM_PROMPT = `You are an AI assistant that evaluates weekly retrospectives for government employees.

Your job is to compare the retro against the weekly plan and assess:
1. **Plan coverage**: Is each plan item addressed in the retro?
2. **Evidence**: For completed items, is there evidence of completion (links, screenshots, specific results, or the deliverable itself)?
3. **Gap explanations**: For incomplete items, is there an explanation of what happened?

Key criteria:
- Every plan item should be mentioned in the retro
- Completed items need evidence (link, screenshot, specific result, or embedded deliverable)
- Incomplete items need an explanation ("X took longer because Y" is fine)
- Simply ignoring a plan item is not acceptable

Respond ONLY with valid JSON matching this exact structure:
{
  "overall_score": <0-1>,
  "plan_coverage": [
    {
      "plan_item": "<text from the plan>",
      "addressed": <true/false>,
      "has_evidence": <true/false>,
      "feedback": "<specific feedback>"
    }
  ],
  "suggestions": ["<actionable suggestion 1>", "<actionable suggestion 2>"]
}`;

async function callBedrock(systemPrompt: string, userPrompt: string): Promise<string | null> {
  const client = getClient();
  if (!client) return null;

  const body = JSON.stringify({
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: 2048,
    system: systemPrompt,
    messages: [
      { role: 'user', content: userPrompt },
    ],
  });

  const command = new InvokeModelCommand({
    modelId: MODEL_ID,
    contentType: 'application/json',
    accept: 'application/json',
    body: new TextEncoder().encode(body),
  });

  const response = await client.send(command);
  const responseBody = JSON.parse(new TextDecoder().decode(response.body));

  if (responseBody.content && responseBody.content[0]?.text) {
    return responseBody.content[0].text;
  }

  return null;
}

/**
 * Analyze a weekly plan for quality (falsifiability and workload).
 */
export async function analyzePlan(content: unknown): Promise<PlanAnalysisResult | AnalysisError> {
  const planItems = extractPlanItems(content);

  if (planItems.length === 0) {
    return {
      overall_score: 0,
      items: [],
      workload_assessment: 'light',
      workload_feedback: 'No plan items found. Add specific, verifiable deliverables for your week.',
    };
  }

  const userPrompt = `Analyze this weekly plan. Here are the plan items:\n\n${planItems.map((item, i) => `${i + 1}. ${item}`).join('\n')}`;

  try {
    const responseText = await callBedrock(PLAN_SYSTEM_PROMPT, userPrompt);
    if (!responseText) {
      return { error: 'ai_unavailable' };
    }

    // Extract JSON from response (handle markdown code blocks)
    const jsonMatch = responseText.match(/```json\s*([\s\S]*?)```/) || responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { error: 'ai_parse_error' };
    }

    const jsonStr = jsonMatch[1] || jsonMatch[0];
    const result = JSON.parse(jsonStr) as PlanAnalysisResult;

    // Validate and clamp scores
    result.overall_score = Math.max(0, Math.min(1, result.overall_score || 0));
    for (const item of result.items) {
      item.score = Math.max(0, Math.min(1, item.score || 0));
    }

    return result;
  } catch (err) {
    console.error('Plan analysis error:', err);
    return { error: 'ai_unavailable' };
  }
}

/**
 * Analyze a weekly retro against its plan for coverage and evidence.
 */
export async function analyzeRetro(
  retroContent: unknown,
  planContent: unknown
): Promise<RetroAnalysisResult | AnalysisError> {
  const planItems = extractPlanItems(planContent);
  const retroText = extractText(retroContent);

  if (planItems.length === 0) {
    return {
      overall_score: 1,
      plan_coverage: [],
      suggestions: ['No plan items found for comparison.'],
    };
  }

  if (!retroText.trim()) {
    return {
      overall_score: 0,
      plan_coverage: planItems.map(item => ({
        plan_item: item,
        addressed: false,
        has_evidence: false,
        feedback: 'This plan item is not addressed in the retro.',
      })),
      suggestions: ['Your retro is empty. Address each item from your plan.'],
    };
  }

  const userPrompt = `Compare this weekly retro against the plan.

PLAN ITEMS:
${planItems.map((item, i) => `${i + 1}. ${item}`).join('\n')}

RETRO CONTENT:
${retroText}`;

  try {
    const responseText = await callBedrock(RETRO_SYSTEM_PROMPT, userPrompt);
    if (!responseText) {
      return { error: 'ai_unavailable' };
    }

    const jsonMatch = responseText.match(/```json\s*([\s\S]*?)```/) || responseText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      return { error: 'ai_parse_error' };
    }

    const jsonStr = jsonMatch[1] || jsonMatch[0];
    const result = JSON.parse(jsonStr) as RetroAnalysisResult;
    result.overall_score = Math.max(0, Math.min(1, result.overall_score || 0));

    return result;
  } catch (err) {
    console.error('Retro analysis error:', err);
    return { error: 'ai_unavailable' };
  }
}

/** Check if Bedrock client is available (for UI to decide whether to render quality assistant) */
export function isAiAvailable(): boolean {
  return getClient() !== null;
}

export { checkRateLimit };
