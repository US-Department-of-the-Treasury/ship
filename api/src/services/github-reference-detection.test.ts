import { describe, it, expect } from 'vitest';
import { extractIssueReferences, extractPRIssueReferences } from './github-reference-detection.js';

describe('extractIssueReferences', () => {
  it('extracts single reference', () => {
    expect(extractIssueReferences('Fix #123')).toEqual([123]);
  });

  it('extracts multiple references', () => {
    expect(extractIssueReferences('Fixes #123 and #456')).toEqual([123, 456]);
  });

  it('deduplicates references', () => {
    expect(extractIssueReferences('PR for #123, also fixes #123')).toEqual([123]);
  });

  it('returns sorted references', () => {
    expect(extractIssueReferences('#456 #123 #789')).toEqual([123, 456, 789]);
  });

  it('handles reference at start of text', () => {
    expect(extractIssueReferences('#42 is the answer')).toEqual([42]);
  });

  it('handles reference at end of text', () => {
    expect(extractIssueReferences('See issue #42')).toEqual([42]);
  });

  it('handles reference in parentheses', () => {
    expect(extractIssueReferences('Fixed bug (#123)')).toEqual([123]);
  });

  it('handles reference with comma', () => {
    expect(extractIssueReferences('#123, #456 and #789')).toEqual([123, 456, 789]);
  });

  it('handles reference after newline', () => {
    expect(extractIssueReferences('First line\n#123 on second line')).toEqual([123]);
  });

  it('ignores version numbers like 1.2.3', () => {
    expect(extractIssueReferences('Version 1.2.3')).toEqual([]);
  });

  it('ignores zero', () => {
    expect(extractIssueReferences('See issue #0')).toEqual([]);
  });

  it('ignores negative numbers', () => {
    expect(extractIssueReferences('See #-123')).toEqual([]);
  });

  it('handles null input', () => {
    expect(extractIssueReferences(null)).toEqual([]);
  });

  it('handles undefined input', () => {
    expect(extractIssueReferences(undefined)).toEqual([]);
  });

  it('handles empty string', () => {
    expect(extractIssueReferences('')).toEqual([]);
  });

  it('handles text with no references', () => {
    expect(extractIssueReferences('No issues here')).toEqual([]);
  });

  it('handles reference in markdown link', () => {
    expect(extractIssueReferences('See [#123](http://example.com)')).toEqual([123]);
  });

  it('handles GitHub-style references', () => {
    expect(extractIssueReferences('Closes #123')).toEqual([123]);
    expect(extractIssueReferences('Resolves #456')).toEqual([456]);
    expect(extractIssueReferences('Fixes #789')).toEqual([789]);
  });

  it('handles large ticket numbers', () => {
    expect(extractIssueReferences('See #99999')).toEqual([99999]);
  });
});

describe('extractPRIssueReferences', () => {
  it('combines references from title and body', () => {
    expect(extractPRIssueReferences('Fix #123', 'Also fixes #456')).toEqual([123, 456]);
  });

  it('deduplicates across title and body', () => {
    expect(extractPRIssueReferences('Fix #123', 'Relates to #123')).toEqual([123]);
  });

  it('handles null title', () => {
    expect(extractPRIssueReferences(null, 'Fix #123')).toEqual([123]);
  });

  it('handles null body', () => {
    expect(extractPRIssueReferences('Fix #123', null)).toEqual([123]);
  });

  it('handles both null', () => {
    expect(extractPRIssueReferences(null, null)).toEqual([]);
  });

  it('returns sorted combined references', () => {
    expect(extractPRIssueReferences('#789', '#123 #456')).toEqual([123, 456, 789]);
  });
});
