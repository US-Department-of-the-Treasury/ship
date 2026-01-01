import { describe, it, expect, vi } from 'vitest';
import { ImageUploadExtension } from './ImageUpload';

describe('ImageUploadExtension', () => {
  it('should create a valid TipTap extension', () => {
    const extension = ImageUploadExtension.configure();
    expect(extension).toBeDefined();
    expect(extension.name).toBe('imageUpload');
  });

  it('should accept callback options', () => {
    const onUploadStart = vi.fn();
    const onUploadComplete = vi.fn();
    const onUploadError = vi.fn();

    const extension = ImageUploadExtension.configure({
      onUploadStart,
      onUploadComplete,
      onUploadError,
    });

    expect(extension).toBeDefined();
    expect(extension.options.onUploadStart).toBe(onUploadStart);
    expect(extension.options.onUploadComplete).toBe(onUploadComplete);
    expect(extension.options.onUploadError).toBe(onUploadError);
  });

  it('should have default undefined options', () => {
    const extension = ImageUploadExtension.configure();
    expect(extension.options.onUploadStart).toBeUndefined();
    expect(extension.options.onUploadComplete).toBeUndefined();
    expect(extension.options.onUploadError).toBeUndefined();
  });

  it('should register ProseMirror plugins', () => {
    // The extension should add ProseMirror plugins for paste/drop handling
    const extension = ImageUploadExtension.configure();
    expect(extension.config.addProseMirrorPlugins).toBeDefined();
  });
});
