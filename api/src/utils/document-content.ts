/**
 * Shared document content helpers.
 *
 * Used by both the accountability service and the heatmap (team.ts)
 * to determine if a plan/retro document has meaningful content.
 * Keep these in sync — both consumers must agree on what "done" means.
 */

// Template headings that don't count as real content
export const TEMPLATE_HEADINGS = [
  'What I plan to accomplish this week',
  'What I delivered this week',
  'Unplanned work',
];

/**
 * Recursively extract text from TipTap JSON content.
 */
export function extractText(node: unknown): string {
  if (!node || typeof node !== 'object') return '';
  const n = node as { type?: string; text?: string; content?: unknown[] };
  if (n.type === 'text' && n.text) return n.text;
  if (Array.isArray(n.content)) return n.content.map(extractText).join('');
  return '';
}

/**
 * Check if document content has meaningful text beyond template headings.
 *
 * A document is considered to have content if, after stripping template
 * headings, there is still non-whitespace text remaining.
 */
export function hasContent(content: unknown): boolean {
  if (!content || typeof content !== 'object') return false;
  const doc = content as { content?: unknown[] };
  if (!Array.isArray(doc.content) || doc.content.length === 0) return false;

  const allText = extractText(content).trim();
  let textWithoutTemplate = allText;
  for (const heading of TEMPLATE_HEADINGS) {
    textWithoutTemplate = textWithoutTemplate.replace(heading, '');
  }
  return textWithoutTemplate.trim().length > 0;
}
