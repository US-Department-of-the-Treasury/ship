import { IssuesList } from '@/components/IssuesList';
import type { DocumentTabProps } from '@/lib/document-tabs';

/**
 * ProjectIssuesTab - Shows issues associated with a project
 *
 * This is the "Issues" tab content when viewing a project document.
 */
export default function ProjectIssuesTab({ documentId, document }: DocumentTabProps) {
  // Get program_id from belongs_to array (project's parent program via document_associations)
  const belongsTo = (document as { belongs_to?: Array<{ id: string; type: string }> }).belongs_to;
  const programId = belongsTo?.find(b => b.type === 'program')?.id;

  return (
    <IssuesList
      lockedProjectId={documentId}
      showProgramFilter={false}
      showProjectFilter={false}
      enableKeyboardNavigation={false}
      showBacklogPicker={true}
      showCreateButton={true}
      allowShowAllIssues={true}
      inheritedContext={{
        projectId: documentId,
        programId,
      }}
    />
  );
}
