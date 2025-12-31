import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('Drag Handle CSS', () => {
  const cssContent = readFileSync(resolve(__dirname, '../index.css'), 'utf-8');

  it('should define .editor-drag-handle class', () => {
    expect(cssContent).toContain('.editor-drag-handle');
  });

  it('should define .tiptap-wrapper positioning', () => {
    expect(cssContent).toContain('.tiptap-wrapper');
    expect(cssContent).toMatch(/\.tiptap-wrapper\s*\{[^}]*position:\s*relative/);
  });

  it('should define ProseMirror selected node styling', () => {
    expect(cssContent).toContain('.ProseMirror-selectednode');
  });

  it('should define dragging state styling', () => {
    expect(cssContent).toContain('.ProseMirror.dragging');
  });

  it('should have left padding on ProseMirror for drag handle space', () => {
    expect(cssContent).toMatch(/\.ProseMirror\s*\{[^}]*padding-left/);
  });
});
