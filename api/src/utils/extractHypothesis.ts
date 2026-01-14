/**
 * Extract hypothesis content from TipTap JSON document structure.
 *
 * Looks for H2 headings with text "Hypothesis" (case-insensitive)
 * and extracts the content between that heading and the next H2.
 *
 * Returns the extracted text as a plain string, or null if no hypothesis found.
 */

interface TipTapNode {
  type: string;
  content?: TipTapNode[];
  text?: string;
  attrs?: Record<string, unknown>;
}

interface TipTapDoc {
  type: 'doc';
  content?: TipTapNode[];
}

/**
 * Extract plain text from a TipTap node tree
 */
function extractText(nodes: TipTapNode[]): string {
  let text = '';
  for (const node of nodes) {
    if (node.type === 'text' && node.text) {
      text += node.text;
    } else if (node.content) {
      text += extractText(node.content);
    }
    // Add newlines after block elements
    if (['paragraph', 'heading', 'bulletList', 'orderedList', 'listItem', 'blockquote'].includes(node.type)) {
      text += '\n';
    }
  }
  return text;
}

/**
 * Check if a node is an H2 heading with "Hypothesis" text
 */
function isHypothesisHeading(node: TipTapNode): boolean {
  if (node.type !== 'heading') return false;
  if (node.attrs?.level !== 2) return false;

  const text = extractText(node.content || []).trim().toLowerCase();
  return text === 'hypothesis';
}

/**
 * Check if a node is any H2 heading
 */
function isH2Heading(node: TipTapNode): boolean {
  return node.type === 'heading' && node.attrs?.level === 2;
}

/**
 * Extract hypothesis content from TipTap document JSON.
 *
 * Finds the first H2 "Hypothesis" heading and extracts all content
 * until the next H2 heading (or end of document).
 *
 * @param content - TipTap JSON document
 * @returns Extracted hypothesis text, or null if no hypothesis section found
 */
export function extractHypothesisFromContent(content: unknown): string | null {
  if (!content || typeof content !== 'object') return null;

  const doc = content as TipTapDoc;
  if (doc.type !== 'doc' || !Array.isArray(doc.content)) return null;

  const nodes = doc.content;
  let hypothesisStartIndex = -1;

  // Find the Hypothesis H2 heading
  for (let i = 0; i < nodes.length; i++) {
    if (isHypothesisHeading(nodes[i]!)) {
      hypothesisStartIndex = i;
      break;
    }
  }

  if (hypothesisStartIndex === -1) return null;

  // Find the end (next H2 or end of document)
  let hypothesisEndIndex = nodes.length;
  for (let i = hypothesisStartIndex + 1; i < nodes.length; i++) {
    if (isH2Heading(nodes[i]!)) {
      hypothesisEndIndex = i;
      break;
    }
  }

  // Extract content between heading and end
  const contentNodes = nodes.slice(hypothesisStartIndex + 1, hypothesisEndIndex);
  if (contentNodes.length === 0) return null;

  const text = extractText(contentNodes).trim();
  return text || null;
}

/**
 * Extract success criteria content from TipTap document JSON.
 *
 * Finds the first H2 "Success Criteria" heading and extracts all content
 * until the next H2 heading (or end of document).
 *
 * @param content - TipTap JSON document
 * @returns Extracted success criteria text, or null if no section found
 */
export function extractSuccessCriteriaFromContent(content: unknown): string | null {
  if (!content || typeof content !== 'object') return null;

  const doc = content as TipTapDoc;
  if (doc.type !== 'doc' || !Array.isArray(doc.content)) return null;

  const nodes = doc.content;
  let startIndex = -1;

  // Find the Success Criteria H2 heading (case-insensitive)
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i]!;
    if (node.type === 'heading' && node.attrs?.level === 2) {
      const text = extractText(node.content || []).trim().toLowerCase();
      if (text === 'success criteria') {
        startIndex = i;
        break;
      }
    }
  }

  if (startIndex === -1) return null;

  // Find the end (next H2 or end of document)
  let endIndex = nodes.length;
  for (let i = startIndex + 1; i < nodes.length; i++) {
    if (isH2Heading(nodes[i]!)) {
      endIndex = i;
      break;
    }
  }

  // Extract content between heading and end
  const contentNodes = nodes.slice(startIndex + 1, endIndex);
  if (contentNodes.length === 0) return null;

  const text = extractText(contentNodes).trim();
  return text || null;
}
