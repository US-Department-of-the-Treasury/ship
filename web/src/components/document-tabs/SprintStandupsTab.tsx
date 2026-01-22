import { StandupFeed } from '@/components/StandupFeed';
import type { DocumentTabProps } from '@/lib/document-tabs';

/**
 * SprintStandupsTab - Sprint standups view
 *
 * This tab shows the daily standup entries for the sprint,
 * allowing team members to view and add standup updates.
 *
 * Extracted from SprintViewPage.tsx standups tab content.
 */
export default function SprintStandupsTab({ documentId }: DocumentTabProps) {
  return <StandupFeed sprintId={documentId} />;
}
