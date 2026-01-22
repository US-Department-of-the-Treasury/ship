import type { DocumentTabProps } from '@/lib/document-tabs';

/**
 * SprintStandupsTab - Sprint standups view
 *
 * This tab shows the daily standup entries for the sprint,
 * allowing team members to view and add standup updates.
 *
 * TODO: Extract actual standups content from SprintViewPage
 * See story: sprint-review-tab
 */
export default function SprintStandupsTab({ documentId, document }: DocumentTabProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-muted">
      <div className="text-lg font-medium">Standups</div>
      <div className="text-sm">Sprint: {document.title}</div>
      <div className="text-xs text-muted/60">
        Standups view will be extracted from SprintViewPage
      </div>
    </div>
  );
}
