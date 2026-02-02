import { useSearchParams } from 'react-router-dom';
import { IssuesList, DEFAULT_FILTER_TABS } from '@/components/IssuesList';
import { useIssues } from '@/contexts/IssuesContext';

/**
 * IssuesPage - Main issues list page
 *
 * Uses the reusable IssuesList component with all features enabled:
 * - List and Kanban views
 * - State filter tabs
 * - Program filter dropdown
 * - Bulk actions
 * - Keyboard navigation
 * - Promote to project
 */
export function IssuesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { issues, loading, createIssue, updateIssue, refreshIssues } = useIssues();

  const stateFilter = searchParams.get('state') || '';

  const handleStateFilterChange = (filter: string) => {
    setSearchParams((prev) => {
      if (filter) {
        prev.set('state', filter);
      } else {
        prev.delete('state');
      }
      return prev;
    });
  };

  return (
    <IssuesList
      issues={issues}
      loading={loading}
      onUpdateIssue={updateIssue}
      onCreateIssue={createIssue}
      onRefreshIssues={refreshIssues}
      storageKeyPrefix="issues"
      filterTabs={DEFAULT_FILTER_TABS}
      initialStateFilter={stateFilter}
      onStateFilterChange={handleStateFilterChange}
      showProgramFilter={true}
      showCreateButton={true}
      createButtonLabel="New Issue"
      viewModes={['list', 'kanban']}
      enableKeyboardNavigation={true}
      showPromoteToProject={true}
      headerContent={<h1 className="text-xl font-semibold text-foreground">Issues</h1>}
      selectionPersistenceKey="issues"
    />
  );
}
