import { describe, it, expect } from 'vitest';
import {
  extractHypothesisFromContent,
  extractSuccessCriteriaFromContent,
  extractVisionFromContent,
  extractGoalsFromContent,
  checkDocumentCompleteness,
} from '../utils/extractHypothesis.js';

describe('extractHypothesisFromContent', () => {
  describe('successful extraction', () => {
    it('extracts hypothesis content from H2 section', () => {
      const content = {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: 'Hypothesis' }],
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'This is the hypothesis content.' }],
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Multiple paragraphs work too.' }],
          },
        ],
      };

      const result = extractHypothesisFromContent(content);
      expect(result).toContain('This is the hypothesis content.');
      expect(result).toContain('Multiple paragraphs work too.');
    });

    it('extracts content until next H2 heading', () => {
      const content = {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: 'Hypothesis' }],
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Hypothesis text here.' }],
          },
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: 'Success Criteria' }],
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'This should not be included.' }],
          },
        ],
      };

      const result = extractHypothesisFromContent(content);
      expect(result).toBe('Hypothesis text here.');
      expect(result).not.toContain('This should not be included');
    });

    it('is case-insensitive for heading text', () => {
      const content = {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: 'HYPOTHESIS' }],
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Content here.' }],
          },
        ],
      };

      const result = extractHypothesisFromContent(content);
      expect(result).toBe('Content here.');
    });

    it('extracts content to end of document if no next H2', () => {
      const content = {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: 'Hypothesis' }],
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'First paragraph.' }],
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Last paragraph.' }],
          },
        ],
      };

      const result = extractHypothesisFromContent(content);
      expect(result).toContain('First paragraph.');
      expect(result).toContain('Last paragraph.');
    });
  });

  describe('edge cases', () => {
    it('returns null when no Hypothesis heading found', () => {
      const content = {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Just a paragraph.' }],
          },
        ],
      };

      const result = extractHypothesisFromContent(content);
      expect(result).toBeNull();
    });

    it('returns null when Hypothesis section is empty', () => {
      const content = {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: 'Hypothesis' }],
          },
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: 'Next Section' }],
          },
        ],
      };

      const result = extractHypothesisFromContent(content);
      expect(result).toBeNull();
    });

    it('returns null for invalid content types', () => {
      expect(extractHypothesisFromContent(null)).toBeNull();
      expect(extractHypothesisFromContent(undefined)).toBeNull();
      expect(extractHypothesisFromContent('string')).toBeNull();
      expect(extractHypothesisFromContent(123)).toBeNull();
      expect(extractHypothesisFromContent([])).toBeNull();
    });

    it('returns null when content is not a doc type', () => {
      const content = {
        type: 'paragraph',
        content: [{ type: 'text', text: 'Not a doc' }],
      };

      const result = extractHypothesisFromContent(content);
      expect(result).toBeNull();
    });

    it('handles nested text nodes correctly', () => {
      const content = {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: 'Hypothesis' }],
          },
          {
            type: 'paragraph',
            content: [
              { type: 'text', text: 'This is ' },
              { type: 'text', text: 'bold text', marks: [{ type: 'bold' }] },
              { type: 'text', text: ' in a paragraph.' },
            ],
          },
        ],
      };

      const result = extractHypothesisFromContent(content);
      expect(result).toBe('This is bold text in a paragraph.');
    });

    it('ignores H3 and other heading levels', () => {
      const content = {
        type: 'doc',
        content: [
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: 'Hypothesis' }],
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Hypothesis content.' }],
          },
          {
            type: 'heading',
            attrs: { level: 3 },
            content: [{ type: 'text', text: 'Subsection' }],
          },
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'Still part of hypothesis.' }],
          },
          {
            type: 'heading',
            attrs: { level: 2 },
            content: [{ type: 'text', text: 'Next Section' }],
          },
        ],
      };

      const result = extractHypothesisFromContent(content);
      expect(result).toContain('Hypothesis content.');
      expect(result).toContain('Still part of hypothesis.');
      expect(result).not.toContain('Next Section');
    });
  });
});

describe('extractSuccessCriteriaFromContent', () => {
  it('extracts success criteria from H2 section', () => {
    const content = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Success Criteria' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Criteria 1: Complete feature X' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Criteria 2: Test coverage > 80%' }],
        },
      ],
    };

    const result = extractSuccessCriteriaFromContent(content);
    expect(result).toContain('Criteria 1: Complete feature X');
    expect(result).toContain('Criteria 2: Test coverage > 80%');
  });

  it('is case-insensitive', () => {
    const content = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'SUCCESS CRITERIA' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Some criteria' }],
        },
      ],
    };

    const result = extractSuccessCriteriaFromContent(content);
    expect(result).toBe('Some criteria');
  });

  it('returns null when not found', () => {
    const content = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'No success criteria here' }],
        },
      ],
    };

    const result = extractSuccessCriteriaFromContent(content);
    expect(result).toBeNull();
  });
});

describe('extractVisionFromContent', () => {
  it('extracts vision from H2 section', () => {
    const content = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Vision' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Our vision is to revolutionize government software.' }],
        },
      ],
    };

    const result = extractVisionFromContent(content);
    expect(result).toBe('Our vision is to revolutionize government software.');
  });

  it('is case-insensitive', () => {
    const content = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'VISION' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Vision content' }],
        },
      ],
    };

    const result = extractVisionFromContent(content);
    expect(result).toBe('Vision content');
  });

  it('returns null when not found', () => {
    const content = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'No vision section' }],
        },
      ],
    };

    const result = extractVisionFromContent(content);
    expect(result).toBeNull();
  });
});

describe('extractGoalsFromContent', () => {
  it('extracts goals from H2 section', () => {
    const content = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Goals' }],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Goal 1: Launch by Q2' }],
                },
              ],
            },
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'Goal 2: Achieve 95% uptime' }],
                },
              ],
            },
          ],
        },
      ],
    };

    const result = extractGoalsFromContent(content);
    expect(result).toContain('Goal 1: Launch by Q2');
    expect(result).toContain('Goal 2: Achieve 95% uptime');
  });

  it('is case-insensitive', () => {
    const content = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'goals' }],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Goals content' }],
        },
      ],
    };

    const result = extractGoalsFromContent(content);
    expect(result).toBe('Goals content');
  });

  it('returns null when not found', () => {
    const content = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'No goals section' }],
        },
      ],
    };

    const result = extractGoalsFromContent(content);
    expect(result).toBeNull();
  });
});

describe('checkDocumentCompleteness', () => {
  describe('project documents', () => {
    it('returns complete when hypothesis and success_criteria are present', () => {
      const properties = {
        hypothesis: 'We believe that X will result in Y.',
        success_criteria: '80% adoption rate within 3 months.',
      };

      const result = checkDocumentCompleteness('project', properties);
      expect(result.isComplete).toBe(true);
      expect(result.missingFields).toEqual([]);
    });

    it('returns incomplete when hypothesis is missing', () => {
      const properties = {
        success_criteria: 'Some criteria',
      };

      const result = checkDocumentCompleteness('project', properties);
      expect(result.isComplete).toBe(false);
      expect(result.missingFields).toContain('Hypothesis');
    });

    it('returns incomplete when success_criteria is missing', () => {
      const properties = {
        hypothesis: 'Some hypothesis',
      };

      const result = checkDocumentCompleteness('project', properties);
      expect(result.isComplete).toBe(false);
      expect(result.missingFields).toContain('Success Criteria');
    });

    it('returns incomplete when both are missing', () => {
      const properties = {};

      const result = checkDocumentCompleteness('project', properties);
      expect(result.isComplete).toBe(false);
      expect(result.missingFields).toContain('Hypothesis');
      expect(result.missingFields).toContain('Success Criteria');
    });

    it('treats empty strings as missing', () => {
      const properties = {
        hypothesis: '   ',
        success_criteria: '',
      };

      const result = checkDocumentCompleteness('project', properties);
      expect(result.isComplete).toBe(false);
      expect(result.missingFields).toHaveLength(2);
    });

    it('handles null properties object', () => {
      const result = checkDocumentCompleteness('project', null);
      expect(result.isComplete).toBe(false);
      expect(result.missingFields).toHaveLength(2);
    });
  });

  describe('sprint documents', () => {
    it('returns complete when all fields present and has linked issues', () => {
      const properties = {
        goal: 'Complete authentication feature',
        start_date: '2024-01-01',
        end_date: '2024-01-14',
      };

      const result = checkDocumentCompleteness('sprint', properties, 5);
      expect(result.isComplete).toBe(true);
      expect(result.missingFields).toEqual([]);
    });

    it('returns incomplete when goal is missing', () => {
      const properties = {
        start_date: '2024-01-01',
        end_date: '2024-01-14',
      };

      const result = checkDocumentCompleteness('sprint', properties, 1);
      expect(result.isComplete).toBe(false);
      expect(result.missingFields).toContain('Goal');
    });

    it('returns incomplete when start_date is missing', () => {
      const properties = {
        goal: 'Some goal',
        end_date: '2024-01-14',
      };

      const result = checkDocumentCompleteness('sprint', properties, 1);
      expect(result.isComplete).toBe(false);
      expect(result.missingFields).toContain('Start Date');
    });

    it('returns incomplete when end_date is missing', () => {
      const properties = {
        goal: 'Some goal',
        start_date: '2024-01-01',
      };

      const result = checkDocumentCompleteness('sprint', properties, 1);
      expect(result.isComplete).toBe(false);
      expect(result.missingFields).toContain('End Date');
    });

    it('returns incomplete when no linked issues', () => {
      const properties = {
        goal: 'Some goal',
        start_date: '2024-01-01',
        end_date: '2024-01-14',
      };

      const result = checkDocumentCompleteness('sprint', properties, 0);
      expect(result.isComplete).toBe(false);
      expect(result.missingFields).toContain('Linked Issues');
    });

    it('returns incomplete with all missing fields', () => {
      const properties = {};

      const result = checkDocumentCompleteness('sprint', properties, 0);
      expect(result.isComplete).toBe(false);
      expect(result.missingFields).toEqual([
        'Goal',
        'Start Date',
        'End Date',
        'Linked Issues',
      ]);
    });

    it('treats empty goal string as missing', () => {
      const properties = {
        goal: '   ',
        start_date: '2024-01-01',
        end_date: '2024-01-14',
      };

      const result = checkDocumentCompleteness('sprint', properties, 1);
      expect(result.isComplete).toBe(false);
      expect(result.missingFields).toContain('Goal');
    });
  });

  describe('other document types', () => {
    it('returns complete for document types without requirements', () => {
      const result = checkDocumentCompleteness('issue', {});
      expect(result.isComplete).toBe(true);
      expect(result.missingFields).toEqual([]);
    });

    it('returns complete for wiki documents', () => {
      const result = checkDocumentCompleteness('wiki', null);
      expect(result.isComplete).toBe(true);
      expect(result.missingFields).toEqual([]);
    });

    it('returns complete for program documents', () => {
      const result = checkDocumentCompleteness('program', {});
      expect(result.isComplete).toBe(true);
      expect(result.missingFields).toEqual([]);
    });
  });
});
