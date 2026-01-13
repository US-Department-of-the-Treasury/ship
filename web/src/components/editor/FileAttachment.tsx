/**
 * TipTap File Attachment Extension
 * Handles file attachments (PDF, DOCX, etc.) as embedded cards with download links
 */
import { Node, mergeAttributes } from '@tiptap/core';
import { ReactNodeViewRenderer, NodeViewWrapper } from '@tiptap/react';
import { uploadFile, isAllowedFileType, getMimeTypeFromExtension } from '@/services/upload';
import { useState, useEffect } from 'react';

const API_URL = import.meta.env.VITE_API_URL ?? '';

// File type icons mapping
const FILE_ICONS: Record<string, string> = {
  'application/pdf': '📄',
  'application/msword': '📝',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '📝',
  'application/vnd.ms-excel': '📊',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '📊',
  'application/vnd.ms-powerpoint': '📽️',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': '📽️',
  'text/plain': '📃',
  'text/csv': '📊',
  'text/markdown': '📃',
  'application/zip': '📦',
  'application/x-zip-compressed': '📦',
};

const DEFAULT_ICON = '📎';

function getFileIcon(mimeType: string): string {
  return FILE_ICONS[mimeType] || DEFAULT_ICON;
}

function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

// React component for rendering file attachment
function FileAttachmentComponent({ node }: { node: any }) {
  const { filename, url, size, mimeType, uploading } = node.attrs;
  const [uploadProgress, setUploadProgress] = useState(uploading ? 0 : 100);

  const fileIcon = getFileIcon(mimeType);
  const formattedSize = size ? formatFileSize(size) : '';

  return (
    <NodeViewWrapper className="file-attachment-wrapper" data-file-attachment>
      <div className="file-attachment" contentEditable={false}>
        <div className="file-attachment-icon">{fileIcon}</div>
        <div className="file-attachment-info">
          <div className="file-attachment-name">{filename}</div>
          {formattedSize && (
            <div className="file-attachment-meta">{formattedSize}</div>
          )}
          {uploading && (
            <div className="file-attachment-progress">
              <div className="file-attachment-progress-bar" style={{ width: `${uploadProgress}%` }} />
            </div>
          )}
        </div>
        {!uploading && url && (
          <a
            href={url}
            download={filename}
            target="_blank"
            rel="noopener noreferrer"
            className="file-attachment-download"
            title="Download file"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </a>
        )}
      </div>
    </NodeViewWrapper>
  );
}

export const FileAttachmentExtension = Node.create({
  name: 'fileAttachment',

  group: 'block',

  atom: true,

  addAttributes() {
    return {
      filename: {
        default: '',
      },
      url: {
        default: '',
      },
      size: {
        default: 0,
      },
      mimeType: {
        default: '',
      },
      uploading: {
        default: false,
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-file-attachment]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-file-attachment': '' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(FileAttachmentComponent);
  },

  addCommands() {
    return {
      setFileAttachment:
        (options: { filename: string; url: string; size: number; mimeType: string }) =>
        ({ commands }: any) =>
          commands.insertContent({
            type: this.name,
            attrs: options,
          }),
    } as any;
  },
});

/**
 * Trigger file picker for file upload
 */
export function triggerFileUpload(editor: any) {
  const input = document.createElement('input');
  input.type = 'file';
  // No accept restriction - allow any file type (blocklist enforced in isAllowedFileType)
  input.multiple = false;

  input.onchange = async () => {
    const file = input.files?.[0];
    if (!file) return;

    // Check if file type is blocked (executables/scripts are blocked for security)
    if (!isAllowedFileType(file.type, file.name)) {
      const ext = file.name.slice(file.name.lastIndexOf('.')).toLowerCase();
      console.error('File type blocked:', { name: file.name, type: file.type, extension: ext });
      alert(`Cannot upload "${ext}" files.\n\nExecutable files and scripts are blocked for security reasons.`);
      return;
    }

    // Get effective MIME type (use extension fallback if browser returns empty)
    const effectiveMimeType = file.type || getMimeTypeFromExtension(file.name) || 'application/octet-stream';

    // Insert placeholder with uploading state
    const pos = editor.state.selection.from;
    editor
      .chain()
      .focus()
      .setFileAttachment({
        filename: file.name,
        url: '',
        size: file.size,
        mimeType: effectiveMimeType,
        uploading: true,
      })
      .run();

    try {
      // Upload file
      const result = await uploadFile(file, (progress) => {
        console.log(`Upload progress: ${progress.progress}%`);
      });

      // Find and update the attachment node
      const { state, view } = editor;
      let attachmentPos: number | null = null;

      state.doc.descendants((node: any, nodePos: number) => {
        if (
          node.type.name === 'fileAttachment' &&
          node.attrs.filename === file.name &&
          node.attrs.uploading === true
        ) {
          attachmentPos = nodePos;
          return false; // Stop searching
        }
        return true;
      });

      if (attachmentPos !== null) {
        const cdnUrl = result.cdnUrl.startsWith('http')
          ? result.cdnUrl
          : `${API_URL}${result.cdnUrl}`;

        // Update the node with the CDN URL and remove uploading state
        const transaction = state.tr.setNodeMarkup(attachmentPos, undefined, {
          filename: file.name,
          url: cdnUrl,
          size: file.size,
          mimeType: file.type,
          uploading: false,
        });
        view.dispatch(transaction);
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      console.error('File upload failed:', { filename: file.name, error: errorMessage, fullError: error });
      alert(`Upload failed: ${errorMessage}\n\nPlease try again.`);

      // Remove the failed upload node
      const { state, view } = editor;
      let attachmentPos: number | null = null;

      state.doc.descendants((node: any, nodePos: number) => {
        if (
          node.type.name === 'fileAttachment' &&
          node.attrs.filename === file.name &&
          node.attrs.uploading === true
        ) {
          attachmentPos = nodePos;
          return false;
        }
        return true;
      });

      if (attachmentPos !== null) {
        const transaction = state.tr.delete(attachmentPos, attachmentPos + 1);
        view.dispatch(transaction);
      }
    }
  };

  input.click();
}
