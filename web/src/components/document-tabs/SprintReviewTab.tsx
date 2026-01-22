import type { DocumentTabProps } from '@/lib/document-tabs';

/**
 * SprintReviewTab - Sprint review view
 *
 * This tab shows the sprint review interface with metrics,
 * completed issues, and review notes.
 *
 * TODO: Extract actual review content from SprintViewPage
 * See story: sprint-review-tab
 */
export default function SprintReviewTab({ documentId, document }: DocumentTabProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-muted">
      <div className="text-lg font-medium">Sprint Review</div>
      <div className="text-sm">Sprint: {document.title}</div>
      <div className="text-xs text-muted/60">
        Review view will be extracted from SprintViewPage
      </div>
    </div>
  );
}
