/**
 * TipTap Image Upload Extension
 * Handles paste/drop events for images and manages upload flow
 */
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Node as ProseMirrorNode } from '@tiptap/pm/model';
import { Editor } from '@tiptap/react';
import { uploadFile, isImageFile } from '@/services/upload';

export interface ImageUploadOptions {
  /**
   * Callback when an image upload starts
   */
  onUploadStart?: (file: File) => void;
  /**
   * Callback when an image upload completes
   */
  onUploadComplete?: (cdnUrl: string) => void;
  /**
   * Callback when an image upload fails
   */
  onUploadError?: (error: Error) => void;
}

export const ImageUploadExtension = Extension.create<ImageUploadOptions>({
  name: 'imageUpload',

  addOptions() {
    return {
      onUploadStart: undefined,
      onUploadComplete: undefined,
      onUploadError: undefined,
    };
  },

  addProseMirrorPlugins() {
    const editor = this.editor as Editor;
    const options = this.options;

    return [
      new Plugin({
        key: new PluginKey('imageUpload'),
        props: {
          handlePaste(view, event) {
            const items = Array.from(event.clipboardData?.items || []);
            const imageItem = items.find(
              (item) => item.type.startsWith('image/')
            );

            if (!imageItem) {
              return false;
            }

            event.preventDefault();

            const file = imageItem.getAsFile();
            if (!file) return false;

            handleImageUpload(editor, file, options);
            return true;
          },

          handleDrop(view, event) {
            const files = Array.from(event.dataTransfer?.files || []);
            const imageFiles = files.filter((file) => isImageFile(file.type));

            if (imageFiles.length === 0) {
              return false;
            }

            event.preventDefault();

            // Upload all dropped images
            imageFiles.forEach((file) => {
              handleImageUpload(editor, file, options);
            });

            return true;
          },
        },
      }),
    ];
  },
});

/**
 * Handle image upload and insertion into editor
 */
async function handleImageUpload(
  editor: Editor,
  file: File,
  options: ImageUploadOptions
) {
  options.onUploadStart?.(file);

  // Create a data URL for immediate preview
  const dataUrl = await fileToDataUrl(file);

  // Insert image with data URL for immediate preview
  editor
    .chain()
    .focus()
    .setImage({
      src: dataUrl,
      alt: file.name,
      title: file.name,
    })
    .run();

  try {
    const result = await uploadFile(file, (progress) => {
      // Could update a progress indicator here
      console.log(`Upload progress: ${progress.progress}%`);
    });

    // Replace the data URL with the CDN URL
    // Find and update the image node with matching src
    const { state, view } = editor;
    const { doc } = state;

    let imagePos: number | null = null;

    doc.descendants((node: ProseMirrorNode, pos: number) => {
      if (node.type.name === 'image' && node.attrs.src === dataUrl) {
        imagePos = pos;
        return false; // Stop searching
      }
      return true;
    });

    if (imagePos !== null) {
      // Update the image src to CDN URL
      const transaction = state.tr.setNodeMarkup(imagePos, undefined, {
        ...doc.nodeAt(imagePos)?.attrs,
        src: result.cdnUrl.startsWith('http')
          ? result.cdnUrl
          : result.cdnUrl, // Relative URLs work via Vite proxy
      });
      view.dispatch(transaction);
    }

    options.onUploadComplete?.(result.cdnUrl);
  } catch (error) {
    console.error('Image upload failed:', error);
    options.onUploadError?.(
      error instanceof Error ? error : new Error('Upload failed')
    );

    // Optionally remove the failed image or show error state
    // For now, leave the data URL as fallback
  }
}

/**
 * Convert a File to a data URL
 */
function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * Trigger file picker for image upload
 */
export function triggerImageUpload(
  editor: Editor,
  options: ImageUploadOptions = {}
) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.multiple = true;

  input.onchange = () => {
    const files = Array.from(input.files || []);
    files.forEach((file) => {
      handleImageUpload(editor, file, options);
    });
  };

  input.click();
}
