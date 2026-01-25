/**
 * Global upload tracker for navigation warnings
 * Used by both React components (via subscription) and non-React code (TipTap plugins)
 */

interface UploadInfo {
  id: string;
  filename: string;
  progress: number;
}

// Global state
const activeUploads = new Map<string, UploadInfo>();
const listeners = new Set<() => void>();

/**
 * Register a new upload
 */
export function registerUpload(id: string, filename: string): void {
  activeUploads.set(id, { id, filename, progress: 0 });
  notifyListeners();
}

/**
 * Update upload progress
 */
export function updateUploadProgress(id: string, progress: number): void {
  const upload = activeUploads.get(id);
  if (upload) {
    upload.progress = progress;
    notifyListeners();
  }
}

/**
 * Unregister a completed/failed upload
 */
export function unregisterUpload(id: string): void {
  activeUploads.delete(id);
  notifyListeners();
}

/**
 * Get current upload count
 */
export function getUploadCount(): number {
  return activeUploads.size;
}

/**
 * Get all active uploads
 */
export function getActiveUploads(): UploadInfo[] {
  return Array.from(activeUploads.values());
}

/**
 * Subscribe to upload changes (for React components)
 */
export function subscribeToUploads(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function notifyListeners(): void {
  listeners.forEach((listener) => listener());
}
