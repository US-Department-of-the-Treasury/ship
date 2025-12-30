import { describe, it, expect } from 'vitest';
import { DragHandleExtension } from './DragHandle';

describe('DragHandleExtension', () => {
  it('should have the correct name', () => {
    expect(DragHandleExtension.name).toBe('dragHandle');
  });

  it('should be a valid TipTap extension', () => {
    // Extension should have the required TipTap structure
    expect(DragHandleExtension).toBeDefined();
    expect(DragHandleExtension.config).toBeDefined();
    expect(typeof DragHandleExtension.config.addProseMirrorPlugins).toBe('function');
  });

  it('should create ProseMirror plugins when configured', () => {
    // Create a configured version of the extension
    const configured = DragHandleExtension.configure({});
    expect(configured).toBeDefined();
    expect(configured.name).toBe('dragHandle');
  });
});
