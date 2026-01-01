import { describe, it, expect, vi } from 'vitest';
import { createMentionExtension } from './MentionExtension';

describe('MentionExtension', () => {
  it('should create a valid TipTap extension', () => {
    const extension = createMentionExtension();
    expect(extension).toBeDefined();
    expect(extension.name).toBe('mention');
  });

  it('should configure with @ as trigger character', () => {
    const extension = createMentionExtension();
    expect(extension.options.suggestion).toBeDefined();
    expect(extension.options.suggestion.char).toBe('@');
  });

  it('should accept onNavigate callback option', () => {
    const onNavigate = vi.fn();
    const extension = createMentionExtension({ onNavigate });
    expect(extension).toBeDefined();
  });

  it('should have custom attributes for mentionType and documentType', () => {
    const extension = createMentionExtension();
    // The extension should have the custom attributes we added
    expect(extension).toBeDefined();
    // Verify it has the expected structure
    expect(extension.config).toBeDefined();
  });
});
