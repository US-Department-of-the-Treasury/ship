/**
 * Transform issue reference patterns in TipTap JSON content to clickable links.
 *
 * Detects patterns:
 * - #123
 * - issue #123
 * - ISS-123
 *
 * Replaces with TipTap link marks pointing to /issues/:id
 */

import { pool } from '../db/client.js';

interface TipTapNode {
  type: string;
  content?: TipTapNode[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
  attrs?: Record<string, unknown>;
}

interface TipTapDoc {
  type: 'doc';
  content?: TipTapNode[];
}

interface IssueInfo {
  id: string;
  ticket_number: number;
}

// Pattern to match issue references: #123, issue #123, ISS-123
// Captures the full match and the number
const ISSUE_PATTERN = /(?:#(\d+)|issue\s+#?(\d+)|ISS-(\d+))/gi;

/**
 * Look up issues by ticket numbers in a workspace
 */
async function lookupIssuesByTicketNumbers(
  workspaceId: string,
  ticketNumbers: number[]
): Promise<Map<number, IssueInfo>> {
  if (ticketNumbers.length === 0) return new Map();

  const result = await pool.query(
    `SELECT id, ticket_number FROM documents
     WHERE workspace_id = $1
       AND document_type = 'issue'
       AND ticket_number = ANY($2::int[])`,
    [workspaceId, ticketNumbers]
  );

  const issueMap = new Map<number, IssueInfo>();
  for (const row of result.rows) {
    issueMap.set(row.ticket_number, {
      id: row.id,
      ticket_number: row.ticket_number,
    });
  }

  return issueMap;
}

/**
 * Extract ticket numbers from text
 */
function extractTicketNumbers(text: string): number[] {
  const numbers: number[] = [];
  let match;
  const pattern = new RegExp(ISSUE_PATTERN.source, 'gi');

  while ((match = pattern.exec(text)) !== null) {
    // Match groups: #123 → [1], issue #123 → [2], ISS-123 → [3]
    const num = parseInt(match[1] ?? match[2] ?? match[3] ?? '', 10);
    if (!isNaN(num) && !numbers.includes(num)) {
      numbers.push(num);
    }
  }

  return numbers;
}

/**
 * Recursively extract all ticket numbers from TipTap content
 */
function extractAllTicketNumbers(nodes: TipTapNode[]): number[] {
  const numbers: number[] = [];

  for (const node of nodes) {
    if (node.type === 'text' && node.text) {
      numbers.push(...extractTicketNumbers(node.text));
    }
    if (node.content) {
      numbers.push(...extractAllTicketNumbers(node.content));
    }
  }

  return [...new Set(numbers)];
}

/**
 * Transform text node by replacing issue patterns with link marks
 */
function transformTextNode(
  text: string,
  issueMap: Map<number, IssueInfo>
): TipTapNode[] {
  const result: TipTapNode[] = [];
  let lastIndex = 0;
  const pattern = new RegExp(ISSUE_PATTERN.source, 'gi');
  let match;

  while ((match = pattern.exec(text)) !== null) {
    const num = parseInt(match[1] ?? match[2] ?? match[3] ?? '', 10);
    const issue = issueMap.get(num);

    // Add text before the match
    if (match.index > lastIndex) {
      result.push({
        type: 'text',
        text: text.slice(lastIndex, match.index),
      });
    }

    // If issue exists, add as link; otherwise, add as plain text
    if (issue) {
      result.push({
        type: 'text',
        text: match[0],
        marks: [
          {
            type: 'link',
            attrs: {
              href: `/issues/${issue.id}`,
              target: '_self',
            },
          },
        ],
      });
    } else {
      result.push({
        type: 'text',
        text: match[0],
      });
    }

    lastIndex = match.index + match[0].length;
  }

  // Add remaining text
  if (lastIndex < text.length) {
    result.push({
      type: 'text',
      text: text.slice(lastIndex),
    });
  }

  return result;
}

/**
 * Recursively transform nodes
 */
function transformNodes(
  nodes: TipTapNode[],
  issueMap: Map<number, IssueInfo>
): TipTapNode[] {
  const result: TipTapNode[] = [];

  for (const node of nodes) {
    if (node.type === 'text' && node.text) {
      // Don't transform text that already has marks (like existing links)
      if (node.marks && node.marks.length > 0) {
        result.push(node);
      } else {
        // Transform this text node
        const transformed = transformTextNode(node.text, issueMap);
        result.push(...transformed);
      }
    } else if (node.content) {
      // Recursively transform child content
      result.push({
        ...node,
        content: transformNodes(node.content, issueMap),
      });
    } else {
      result.push(node);
    }
  }

  return result;
}

/**
 * Transform issue reference patterns in TipTap JSON content to clickable links.
 *
 * @param content - TipTap JSON document
 * @param workspaceId - Workspace ID for issue lookup
 * @returns Transformed TipTap JSON with issue links
 */
export async function transformIssueLinks(
  content: unknown,
  workspaceId: string
): Promise<unknown> {
  if (!content || typeof content !== 'object') return content;

  const doc = content as TipTapDoc;
  if (doc.type !== 'doc' || !Array.isArray(doc.content)) return content;

  // Extract all ticket numbers from content
  const ticketNumbers = extractAllTicketNumbers(doc.content);
  if (ticketNumbers.length === 0) return content;

  // Look up which issues exist
  const issueMap = await lookupIssuesByTicketNumbers(workspaceId, ticketNumbers);
  if (issueMap.size === 0) return content;

  // Transform the content
  return {
    ...doc,
    content: transformNodes(doc.content, issueMap),
  };
}
