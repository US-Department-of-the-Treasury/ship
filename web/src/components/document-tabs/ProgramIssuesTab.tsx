import { IssuesList } from '@/components/IssuesList';
import type { DocumentTabProps } from '@/lib/document-tabs';

/**
 * ProgramIssuesTab - Shows issues associated with a program
 *
 * This is the "Issues" tab content when viewing a program document.
 */
export default function ProgramIssuesTab({ documentId }: DocumentTabProps) {
  return (
    <IssuesList
      lockedProgramId={documentId}
      showProgramFilter={false}
      showProjectFilter={true}
      enableKeyboardNavigation={false}
      showBacklogPicker={true}
      showCreateButton={true}
      createButtonTestId="program-new-issue"
      allowShowAllIssues={true}
      inheritedContext={{
        programId: documentId,
      }}
    />
  );
}
