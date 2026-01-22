import type { DocumentTabProps } from '@/lib/document-tabs';

/**
 * SprintPlanningTab - Sprint planning view
 *
 * This tab shows the sprint planning interface where issues can be
 * assigned to the sprint. Content extracted from SprintPlanningPage.
 *
 * TODO: Extract actual planning content from SprintPlanningPage
 * See story: sprint-planning-tab
 */
export default function SprintPlanningTab({ documentId, document }: DocumentTabProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 text-muted">
      <div className="text-lg font-medium">Sprint Planning</div>
      <div className="text-sm">Sprint: {document.title}</div>
      <div className="text-xs text-muted/60">
        Planning view will be extracted from SprintPlanningPage
      </div>
    </div>
  );
}
