/**
 * GitHub Reference Detection Service
 *
 * Extracts Ship issue references (#123 format) from PR titles and bodies.
 * Used to link GitHub PRs to Ship issues.
 */

/**
 * Extract issue references (#N format) from text.
 * Returns an array of unique ticket numbers (as integers).
 *
 * Examples:
 * - "Fix #123" -> [123]
 * - "Fixes #123 and #456" -> [123, 456]
 * - "PR for #123, also fixes #123" -> [123] (deduped)
 * - "Version 1.2.3" -> [] (not a reference)
 * - "See issue #0" -> [] (0 is not valid)
 */
export function extractIssueReferences(text: string | null | undefined): number[] {
  if (!text) {
    return [];
  }

  // Match # followed by one or more digits
  // Use lookbehind to ensure # isn't preceded by alphanumeric (to avoid v1.2.3#456)
  // The (?<![a-zA-Z0-9]) is a negative lookbehind
  const pattern = /(?<![a-zA-Z0-9])#(\d+)/g;

  const matches: number[] = [];
  let match;

  while ((match = pattern.exec(text)) !== null) {
    const captured = match[1];
    if (!captured) continue;
    const ticketNumber = parseInt(captured, 10);
    // Only include valid ticket numbers (positive integers)
    if (ticketNumber > 0 && !matches.includes(ticketNumber)) {
      matches.push(ticketNumber);
    }
  }

  return matches.sort((a, b) => a - b);
}

/**
 * Extract issue references from a PR's title and body combined.
 * Returns deduplicated, sorted array of ticket numbers.
 */
export function extractPRIssueReferences(
  title: string | null | undefined,
  body: string | null | undefined
): number[] {
  const titleRefs = extractIssueReferences(title);
  const bodyRefs = extractIssueReferences(body);

  // Combine and dedupe
  const allRefs = [...new Set([...titleRefs, ...bodyRefs])];
  return allRefs.sort((a, b) => a - b);
}
