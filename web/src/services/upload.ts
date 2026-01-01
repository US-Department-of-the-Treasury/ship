/**
 * File upload service for images and attachments.
 * Handles upload flow: get presigned URL -> upload to storage -> confirm -> return CDN URL
 */

// In development, Vite proxy handles /api routes (see vite.config.ts)
// In production, use VITE_API_URL or relative URLs
const API_BASE = import.meta.env.VITE_API_URL ?? '';

interface UploadResult {
  fileId: string;
  cdnUrl: string;
}

interface UploadProgress {
  fileId: string;
  progress: number; // 0-100
  status: 'pending' | 'uploading' | 'confirming' | 'complete' | 'error';
  error?: string;
}

type ProgressCallback = (progress: UploadProgress) => void;

/**
 * Get CSRF token for API requests
 */
async function getCsrfToken(): Promise<string> {
  const res = await fetch(`${API_BASE}/api/csrf-token`, { credentials: 'include' });
  if (!res.ok) throw new Error('Failed to get CSRF token');
  const { token } = await res.json();
  return token;
}

/**
 * Upload a file to the server
 * @param file - The file to upload
 * @param onProgress - Optional callback for progress updates
 * @returns The CDN URL of the uploaded file
 */
export async function uploadFile(
  file: File,
  onProgress?: ProgressCallback
): Promise<UploadResult> {
  const csrfToken = await getCsrfToken();

  const progress: UploadProgress = {
    fileId: '',
    progress: 0,
    status: 'pending',
  };

  const updateProgress = (updates: Partial<UploadProgress>) => {
    Object.assign(progress, updates);
    onProgress?.({ ...progress });
  };

  try {
    // Step 1: Request upload URL
    updateProgress({ status: 'pending', progress: 10 });

    const uploadReqRes = await fetch(`${API_BASE}/api/files/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-csrf-token': csrfToken,
      },
      credentials: 'include',
      body: JSON.stringify({
        filename: file.name,
        mimeType: file.type,
        sizeBytes: file.size,
      }),
    });

    if (!uploadReqRes.ok) {
      const error = await uploadReqRes.json();
      throw new Error(error.error || 'Failed to create upload request');
    }

    const { fileId, uploadUrl, s3Key } = await uploadReqRes.json();
    updateProgress({ fileId, progress: 20 });

    // Step 2: Upload file data
    updateProgress({ status: 'uploading', progress: 30 });

    // Check if this is a local upload URL or S3 presigned URL
    const isLocalUpload = uploadUrl.startsWith('/api/files/');
    const fullUploadUrl = isLocalUpload ? `${API_BASE}${uploadUrl}` : uploadUrl;

    const fileBuffer = await file.arrayBuffer();

    if (isLocalUpload) {
      // Local development: upload to our API
      const uploadRes = await fetch(fullUploadUrl, {
        method: 'POST',
        headers: {
          'x-csrf-token': csrfToken,
          'Content-Type': file.type,
        },
        credentials: 'include',
        body: fileBuffer,
      });

      if (!uploadRes.ok) {
        const error = await uploadRes.json();
        throw new Error(error.error || 'Failed to upload file');
      }

      updateProgress({ progress: 90 });

      // For local uploads, the local-upload endpoint already sets status to 'uploaded'
      // Just get the file metadata to return the CDN URL
      const fileRes = await fetch(`${API_BASE}/api/files/${fileId}`, {
        credentials: 'include',
      });

      if (!fileRes.ok) {
        throw new Error('Failed to get file metadata');
      }

      const fileData = await fileRes.json();
      updateProgress({ status: 'complete', progress: 100 });

      return {
        fileId,
        cdnUrl: fileData.cdn_url,
      };
    } else {
      // Production: upload directly to S3
      const uploadRes = await fetch(fullUploadUrl, {
        method: 'PUT',
        headers: {
          'Content-Type': file.type,
        },
        body: fileBuffer,
      });

      if (!uploadRes.ok) {
        throw new Error('Failed to upload to S3');
      }

      updateProgress({ status: 'confirming', progress: 80 });

      // Step 3: Confirm upload
      const confirmRes = await fetch(`${API_BASE}/api/files/${fileId}/confirm`, {
        method: 'POST',
        headers: {
          'x-csrf-token': csrfToken,
        },
        credentials: 'include',
      });

      if (!confirmRes.ok) {
        const error = await confirmRes.json();
        throw new Error(error.error || 'Failed to confirm upload');
      }

      const { cdnUrl } = await confirmRes.json();
      updateProgress({ status: 'complete', progress: 100 });

      return { fileId, cdnUrl };
    }
  } catch (error) {
    updateProgress({
      status: 'error',
      error: error instanceof Error ? error.message : 'Upload failed',
    });
    throw error;
  }
}

/**
 * Upload a file from a data URL (e.g., from clipboard paste)
 */
export async function uploadDataUrl(
  dataUrl: string,
  filename: string,
  onProgress?: ProgressCallback
): Promise<UploadResult> {
  // Convert data URL to File
  const res = await fetch(dataUrl);
  const blob = await res.blob();
  const file = new File([blob], filename, { type: blob.type });

  return uploadFile(file, onProgress);
}

/**
 * Check if a file type is allowed for upload
 */
export function isAllowedFileType(mimeType: string): boolean {
  const allowedTypes = new Set([
    // Images
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/svg+xml',
    // Documents
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    // Text
    'text/plain',
    'text/csv',
    'text/markdown',
    // Archives
    'application/zip',
    'application/x-zip-compressed',
  ]);

  return allowedTypes.has(mimeType);
}

/**
 * Check if a file is an image
 */
export function isImageFile(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}
