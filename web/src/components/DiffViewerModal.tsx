import * as Dialog from '@radix-ui/react-dialog';
import { DiffViewer, tipTapToPlainText } from './DiffViewer';

interface DiffViewerModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  oldContent: Record<string, unknown> | string | null;
  newContent: Record<string, unknown> | string | null;
  oldLabel?: string;
  newLabel?: string;
}

/**
 * DiffViewerModal - Modal component to display content diff
 *
 * Takes TipTap JSON or plain text content and shows the diff
 * between the old (approved) version and the current version.
 */
export function DiffViewerModal({
  open,
  onClose,
  title,
  oldContent,
  newContent,
  oldLabel = 'Approved Version',
  newLabel = 'Current Version',
}: DiffViewerModalProps) {
  // Convert content to plain text if it's TipTap JSON
  const oldText = typeof oldContent === 'string'
    ? oldContent
    : tipTapToPlainText(oldContent);

  const newText = typeof newContent === 'string'
    ? newContent
    : tipTapToPlainText(newContent);

  return (
    <Dialog.Root open={open} onOpenChange={(isOpen) => !isOpen && onClose()}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[100] bg-black/60" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-[101] w-full max-w-2xl max-h-[80vh] -translate-x-1/2 -translate-y-1/2 rounded-lg border border-border bg-background shadow-xl focus:outline-none flex flex-col"
          onEscapeKeyDown={onClose}
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <Dialog.Title className="text-lg font-semibold text-foreground">
              {title}
            </Dialog.Title>
            <button
              onClick={onClose}
              className="rounded-md p-1 text-muted hover:bg-border hover:text-foreground focus:outline-none"
              aria-label="Close"
            >
              <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-auto p-6">
            {/* Legend */}
            <div className="flex gap-4 mb-4 text-sm">
              <div className="flex items-center gap-2">
                <span className="inline-block w-4 h-4 bg-red-100 border border-red-300 rounded dark:bg-red-900/30"></span>
                <span className="text-muted">Removed</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="inline-block w-4 h-4 bg-green-100 border border-green-300 rounded dark:bg-green-900/30"></span>
                <span className="text-muted">Added</span>
              </div>
            </div>

            {/* Labels */}
            <div className="text-xs text-muted mb-2">
              Comparing: <span className="font-medium">{oldLabel}</span> → <span className="font-medium">{newLabel}</span>
            </div>

            {/* Diff Content */}
            <div className="border border-border rounded-md p-4 bg-background">
              {oldText === newText ? (
                <p className="text-muted text-sm">No changes detected.</p>
              ) : !oldText && newText ? (
                <div>
                  <p className="text-muted text-sm mb-2">New content added:</p>
                  <div className="bg-green-100 dark:bg-green-900/30 p-2 rounded font-mono text-sm whitespace-pre-wrap">
                    {newText}
                  </div>
                </div>
              ) : oldText && !newText ? (
                <div>
                  <p className="text-muted text-sm mb-2">Content removed:</p>
                  <div className="bg-red-100 dark:bg-red-900/30 p-2 rounded font-mono text-sm whitespace-pre-wrap line-through">
                    {oldText}
                  </div>
                </div>
              ) : (
                <DiffViewer oldContent={oldText} newContent={newText} />
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="border-t border-border px-6 py-4 flex justify-end">
            <button
              onClick={onClose}
              className="rounded-md bg-border px-4 py-2 text-sm font-medium text-foreground hover:bg-border/80 focus:outline-none focus:ring-2 focus:ring-border focus:ring-offset-2 focus:ring-offset-background"
            >
              Close
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export default DiffViewerModal;
