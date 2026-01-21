import { IssuesList } from '@/components/IssuesList';
import type { DocumentTabProps } from '@/lib/document-tabs';

/**
 * ProjectIssuesTab - Shows issues associated with a project
 *
 * This is the "Issues" tab content when viewing a project document.
 */
export default function ProjectIssuesTab({ documentId, document }: DocumentTabProps) {
  return (
    <IssuesList
      lockedProjectId={documentId}
      showProgramFilter={false}
      showProjectFilter={false}
      enableKeyboardNavigation={false}
      inheritedContext={{
        projectId: documentId,
        programId: (document.program_id as string) || undefined,
      }}
    />
  );
}
