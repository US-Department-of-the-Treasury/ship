import { useMemo } from 'react';
import { IssuesList, DEFAULT_FILTER_TABS } from '@/components/IssuesList';
import { useIssuesQuery, getProjectId } from '@/hooks/useIssuesQuery';
import type { DocumentTabProps } from '@/lib/document-tabs';
import type { FilterTab } from '@/components/FilterTabs';

/**
 * ProgramIssuesTab - Shows issues associated with a program
 *
 * This is the "Issues" tab content when viewing a program document.
 * Includes an "Untriaged" filter tab showing issues without a project assignment.
 */
export default function ProgramIssuesTab({ documentId }: DocumentTabProps) {
  const { data: allIssues = [] } = useIssuesQuery({ programId: documentId });

  const untriagedCount = useMemo(() => {
    return allIssues.filter(issue => !getProjectId(issue)).length;
  }, [allIssues]);

  const filterTabs: FilterTab[] = useMemo(() => {
    const tabs: FilterTab[] = [
      { id: '', label: 'All' },
      { id: '__no_project__', label: 'Untriaged', count: untriagedCount },
      ...DEFAULT_FILTER_TABS.slice(1), // Skip the default 'All' tab, keep the rest
    ];
    return tabs;
  }, [untriagedCount]);

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
      filterTabs={filterTabs}
      inheritedContext={{
        programId: documentId,
      }}
    />
  );
}
