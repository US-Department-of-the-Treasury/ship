/**
 * Upload Navigation Warning Modal
 * Shows when user tries to navigate away while uploads are in progress
 */
import { useUploadNavigationWarning } from '@/contexts/UploadContext';

export function UploadNavigationWarning() {
  const { isBlocked, uploadCount, proceed, reset } = useUploadNavigationWarning();

  if (!isBlocked) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="w-full max-w-md rounded-lg bg-background p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-foreground">
          Uploads in Progress
        </h2>
        <p className="mt-2 text-sm text-muted">
          You have {uploadCount} upload{uploadCount !== 1 ? 's' : ''} in progress.
          Leaving this page will cancel {uploadCount !== 1 ? 'them' : 'it'}.
        </p>
        <div className="mt-6 flex justify-end gap-3">
          <button
            onClick={reset}
            className="rounded-md px-4 py-2 text-sm font-medium text-foreground hover:bg-muted/20"
          >
            Stay on Page
          </button>
          <button
            onClick={proceed}
            className="rounded-md bg-red-500 px-4 py-2 text-sm font-medium text-white hover:bg-red-600"
          >
            Leave & Cancel Uploads
          </button>
        </div>
      </div>
    </div>
  );
}
