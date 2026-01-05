import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { KanbanBoard } from '@/components/KanbanBoard';
import { SelectableList, RowRenderProps, UseSelectionReturn } from '@/components/SelectableList';
import { useIssues, Issue } from '@/contexts/IssuesContext';
import { useBulkUpdateIssues } from '@/hooks/useIssuesQuery';
import { IssuesListSkeleton } from '@/components/ui/Skeleton';
import { Combobox } from '@/components/ui/Combobox';
import { useToast } from '@/components/ui/Toast';
import { ContextMenu, ContextMenuItem, ContextMenuSeparator, ContextMenuSubmenu } from '@/components/ui/ContextMenu';
import { cn } from '@/lib/cn';
import { issueStatusColors, priorityColors } from '@/lib/statusColors';

const SORT_OPTIONS = [
  { value: 'updated', label: 'Updated' },
  { value: 'created', label: 'Created' },
  { value: 'priority', label: 'Priority' },
  { value: 'title', label: 'Title' },
];

type ViewMode = 'list' | 'kanban';

const STATE_LABELS: Record<string, string> = {
  triage: 'Needs Triage',
  backlog: 'Backlog',
  todo: 'Todo',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
  cancelled: 'Cancelled',
};

const SOURCE_STYLES: Record<string, string> = {
  internal: 'bg-blue-500/20 text-blue-300',
  external: 'bg-purple-500/20 text-purple-300',
};

const PRIORITY_LABELS: Record<string, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  none: 'No Priority',
};

const PRIORITY_COLORS: Record<string, string> = {
  ...priorityColors,
  none: 'text-muted',
};

export function IssuesPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { issues: allIssues, loading, createIssue: contextCreateIssue, updateIssue: contextUpdateIssue } = useIssues();
  const bulkUpdate = useBulkUpdateIssues();
  const { showToast } = useToast();
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [sortBy, setSortBy] = useState<string>('updated');
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; selection: UseSelectionReturn } | null>(null);

  const stateFilter = searchParams.get('state') || '';

  // Filter issues client-side based on state filter
  const issues = useMemo(() => {
    if (!stateFilter) return allIssues;
    const states = stateFilter.split(',');
    return allIssues.filter(issue => states.includes(issue.state));
  }, [allIssues, stateFilter]);

  const handleCreateIssue = useCallback(async () => {
    const issue = await contextCreateIssue();
    if (issue) {
      navigate(`/issues/${issue.id}`);
    }
  }, [contextCreateIssue, navigate]);

  const setFilter = (state: string) => {
    setSearchParams((prev) => {
      if (state) {
        prev.set('state', state);
      } else {
        prev.delete('state');
      }
      return prev;
    });
  };

  const handleUpdateIssue = async (id: string, updates: { state: string }) => {
    await contextUpdateIssue(id, updates);
  };

  // Bulk action handlers - use selection from contextMenu state
  const handleBulkArchive = useCallback(() => {
    if (!contextMenu) return;
    const ids = Array.from(contextMenu.selection.selectedIds);
    const count = ids.length;
    bulkUpdate.mutate({ ids, action: 'archive' }, {
      onSuccess: () => showToast(`${count} issue${count === 1 ? '' : 's'} archived`, 'success'),
      onError: () => showToast('Failed to archive issues', 'error'),
    });
    contextMenu.selection.clearSelection();
    setContextMenu(null);
  }, [contextMenu, bulkUpdate, showToast]);

  const handleBulkDelete = useCallback(() => {
    if (!contextMenu) return;
    const ids = Array.from(contextMenu.selection.selectedIds);
    const count = ids.length;
    bulkUpdate.mutate({ ids, action: 'delete' }, {
      onSuccess: () => showToast(`${count} issue${count === 1 ? '' : 's'} deleted`, 'success'),
      onError: () => showToast('Failed to delete issues', 'error'),
    });
    contextMenu.selection.clearSelection();
    setContextMenu(null);
  }, [contextMenu, bulkUpdate, showToast]);

  const handleBulkMoveToSprint = useCallback((sprintId: string | null) => {
    if (!contextMenu) return;
    const ids = Array.from(contextMenu.selection.selectedIds);
    const count = ids.length;
    bulkUpdate.mutate({ ids, action: 'update', updates: { sprint_id: sprintId } }, {
      onSuccess: () => showToast(`${count} issue${count === 1 ? '' : 's'} moved`, 'success'),
      onError: () => showToast('Failed to move issues', 'error'),
    });
    contextMenu.selection.clearSelection();
    setContextMenu(null);
  }, [contextMenu, bulkUpdate, showToast]);

  const handleBulkChangeStatus = useCallback((status: string) => {
    if (!contextMenu) return;
    const ids = Array.from(contextMenu.selection.selectedIds);
    const count = ids.length;
    const statusLabel = STATE_LABELS[status] || status;
    bulkUpdate.mutate({ ids, action: 'update', updates: { state: status } }, {
      onSuccess: () => showToast(`${count} issue${count === 1 ? '' : 's'} changed to ${statusLabel}`, 'success'),
      onError: () => showToast('Failed to update issues', 'error'),
    });
    contextMenu.selection.clearSelection();
    setContextMenu(null);
  }, [contextMenu, bulkUpdate, showToast]);

  // Context menu handler - receives selection from SelectableList
  const handleContextMenu = useCallback((e: React.MouseEvent, _item: Issue, selection: UseSelectionReturn) => {
    setContextMenu({ x: e.clientX, y: e.clientY, selection });
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
        return;
      }

      // "c" to create issue
      if (e.key === 'c' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        handleCreateIssue();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleCreateIssue]);

  // Column definitions for the issues list
  const columns = useMemo(() => [
    { key: 'id', label: 'ID' },
    { key: 'title', label: 'Title' },
    { key: 'status', label: 'Status' },
    { key: 'source', label: 'Source' },
    { key: 'priority', label: 'Priority' },
    { key: 'assignee', label: 'Assignee' },
    { key: 'updated', label: 'Updated' },
  ], []);

  // Render function for issue rows
  const renderIssueRow = useCallback((issue: Issue, { isSelected }: RowRenderProps) => (
    <IssueRowContent issue={issue} isSelected={isSelected} />
  ), []);

  // Empty state for the list
  const emptyState = useMemo(() => (
    <div className="text-center">
      <p className="text-muted">No issues yet</p>
      <button
        onClick={handleCreateIssue}
        className="mt-2 text-sm text-accent hover:underline"
      >
        Create your first issue
      </button>
    </div>
  ), [handleCreateIssue]);

  if (loading) {
    return <IssuesListSkeleton />;
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <h1 className="text-xl font-semibold text-foreground">Issues</h1>
        <div className="flex items-center gap-3">
          {/* Sort dropdown */}
          <div className="w-32">
            <Combobox
              options={SORT_OPTIONS}
              value={sortBy}
              onChange={(v) => setSortBy(v || 'updated')}
              placeholder="Sort by"
              aria-label="Sort issues by"
              id="issues-sort"
              allowClear={false}
            />
          </div>
          {/* View toggle */}
          <div className="flex rounded-md border border-border" role="group" aria-label="View mode">
            <button
              onClick={() => setViewMode('list')}
              aria-label="List view"
              aria-pressed={viewMode === 'list'}
              className={cn(
                'px-3 py-1 text-sm transition-colors',
                viewMode === 'list' ? 'bg-border text-foreground' : 'text-muted hover:text-foreground'
              )}
            >
              <ListIcon aria-hidden="true" />
            </button>
            <button
              onClick={() => setViewMode('kanban')}
              aria-label="Kanban view"
              aria-pressed={viewMode === 'kanban'}
              className={cn(
                'px-3 py-1 text-sm transition-colors',
                viewMode === 'kanban' ? 'bg-border text-foreground' : 'text-muted hover:text-foreground'
              )}
            >
              <KanbanIcon aria-hidden="true" />
            </button>
          </div>
          <button
            onClick={handleCreateIssue}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent/90 transition-colors"
          >
            New Issue
          </button>
        </div>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 border-b border-border px-6 py-2" role="tablist" aria-label="Issue filters">
        <FilterTab label="All" active={!stateFilter} onClick={() => setFilter('')} id="filter-all" />
        <FilterTab label="Needs Triage" active={stateFilter === 'triage'} onClick={() => setFilter('triage')} id="filter-triage" />
        <FilterTab label="Active" active={stateFilter === 'todo,in_progress,in_review'} onClick={() => setFilter('todo,in_progress,in_review')} id="filter-active" />
        <FilterTab label="Backlog" active={stateFilter === 'backlog'} onClick={() => setFilter('backlog')} id="filter-backlog" />
        <FilterTab label="Done" active={stateFilter === 'done'} onClick={() => setFilter('done')} id="filter-done" />
        <FilterTab label="Cancelled" active={stateFilter === 'cancelled'} onClick={() => setFilter('cancelled')} id="filter-cancelled" />
      </div>

      {/* Content */}
      {viewMode === 'kanban' ? (
        <KanbanBoard
          issues={issues}
          onUpdateIssue={handleUpdateIssue}
          onIssueClick={(id) => navigate(`/issues/${id}`)}
        />
      ) : (
        <div className="flex-1 overflow-auto">
          <SelectableList
            items={issues}
            renderRow={renderIssueRow}
            columns={columns}
            emptyState={emptyState}
            onItemClick={(issue) => navigate(`/issues/${issue.id}`)}
            onContextMenu={handleContextMenu}
            ariaLabel="Issues list"
          />
        </div>
      )}

      {/* Context Menu */}
      {contextMenu && contextMenu.selection.hasSelection && (
        <ContextMenu x={contextMenu.x} y={contextMenu.y} onClose={() => setContextMenu(null)}>
          <div className="px-3 py-1.5 text-xs text-muted border-b border-border mb-1">
            {contextMenu.selection.selectedCount} selected
          </div>
          <ContextMenuItem onClick={handleBulkArchive}>
            <ArchiveIcon className="h-4 w-4" />
            Archive
          </ContextMenuItem>
          <ContextMenuSubmenu label="Change Status">
            <ContextMenuItem onClick={() => handleBulkChangeStatus('backlog')}>Backlog</ContextMenuItem>
            <ContextMenuItem onClick={() => handleBulkChangeStatus('todo')}>Todo</ContextMenuItem>
            <ContextMenuItem onClick={() => handleBulkChangeStatus('in_progress')}>In Progress</ContextMenuItem>
            <ContextMenuItem onClick={() => handleBulkChangeStatus('done')}>Done</ContextMenuItem>
          </ContextMenuSubmenu>
          <ContextMenuSubmenu label="Move to Sprint">
            <ContextMenuItem onClick={() => handleBulkMoveToSprint(null)}>No Sprint</ContextMenuItem>
          </ContextMenuSubmenu>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={handleBulkDelete} destructive>
            <TrashIcon className="h-4 w-4" />
            Delete
          </ContextMenuItem>
        </ContextMenu>
      )}
    </div>
  );
}

/**
 * IssueRowContent - Renders the content cells for an issue row
 * Used by SelectableList which handles the <tr>, checkbox, and selection state
 */
interface IssueRowContentProps {
  issue: Issue;
  isSelected: boolean;
}

function IssueRowContent({ issue }: IssueRowContentProps) {
  return (
    <>
      {/* ID */}
      <td className="px-4 py-3 text-sm text-muted" role="gridcell">
        #{issue.ticket_number}
      </td>
      {/* Title */}
      <td className="px-4 py-3 text-sm text-foreground" role="gridcell">
        {issue.title}
      </td>
      {/* Status */}
      <td className="px-4 py-3" role="gridcell">
        <StatusBadge state={issue.state} />
      </td>
      {/* Source */}
      <td className="px-4 py-3" role="gridcell">
        <SourceBadge source={issue.source} />
      </td>
      {/* Priority */}
      <td className="px-4 py-3" role="gridcell">
        <PriorityBadge priority={issue.priority} />
      </td>
      {/* Assignee */}
      <td className="px-4 py-3 text-sm text-muted" role="gridcell">
        {issue.assignee_name || 'Unassigned'}
      </td>
      {/* Updated */}
      <td className="px-4 py-3 text-sm text-muted" role="gridcell">
        {issue.updated_at ? formatDate(issue.updated_at) : '-'}
      </td>
    </>
  );
}

function FilterTab({ label, active, onClick, id }: { label: string; active: boolean; onClick: () => void; id: string }) {
  return (
    <button
      id={id}
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'rounded-md px-3 py-1 text-sm transition-colors',
        active
          ? 'bg-border text-foreground'
          : 'text-muted hover:bg-border/50 hover:text-foreground'
      )}
    >
      {label}
    </button>
  );
}

function StatusBadge({ state }: { state: string }) {
  const label = STATE_LABELS[state] || state;

  return (
    <span
      data-status-indicator
      data-status={state}
      aria-label={`Status: ${label}`}
      className={cn('inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium', issueStatusColors[state] || issueStatusColors.backlog)}
    >
      <StatusIcon state={state} />
      {label}
      <span className="sr-only">Status: {label}</span>
    </span>
  );
}

function StatusIcon({ state }: { state: string }) {
  const iconProps = { className: 'h-3 w-3', 'aria-hidden': 'true' as const };

  switch (state) {
    case 'triage':
      return (
        <svg {...iconProps} viewBox="0 0 16 16" fill="none" stroke="currentColor">
          <circle cx="8" cy="8" r="6" strokeWidth="1.5" strokeDasharray="3 2" />
        </svg>
      );
    case 'backlog':
      return (
        <svg {...iconProps} viewBox="0 0 16 16" fill="none" stroke="currentColor">
          <circle cx="8" cy="8" r="6" strokeWidth="1.5" />
        </svg>
      );
    case 'todo':
      return (
        <svg {...iconProps} viewBox="0 0 16 16" fill="none" stroke="currentColor">
          <circle cx="8" cy="8" r="6" strokeWidth="1.5" />
          <path d="M8 2 A6 6 0 0 1 8 14" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'in_progress':
      return (
        <svg {...iconProps} viewBox="0 0 16 16" fill="none" stroke="currentColor">
          <circle cx="8" cy="8" r="6" strokeWidth="1.5" />
          <path d="M8 2 A6 6 0 1 1 2 8" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'in_review':
      return (
        <svg {...iconProps} viewBox="0 0 16 16" fill="none" stroke="currentColor">
          <circle cx="8" cy="8" r="6" strokeWidth="1.5" />
          <circle cx="8" cy="8" r="3" fill="currentColor" stroke="none" />
        </svg>
      );
    case 'done':
      return (
        <svg {...iconProps} viewBox="0 0 16 16" fill="currentColor">
          <circle cx="8" cy="8" r="6" />
          <path d="M5.5 8l2 2 3-4" stroke="white" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
    case 'cancelled':
      return (
        <svg {...iconProps} viewBox="0 0 16 16" fill="none" stroke="currentColor">
          <circle cx="8" cy="8" r="6" strokeWidth="1.5" />
          <path d="M5 5l6 6M11 5l-6 6" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      );
    default:
      return (
        <svg {...iconProps} viewBox="0 0 16 16" fill="none" stroke="currentColor">
          <circle cx="8" cy="8" r="6" strokeWidth="1.5" />
        </svg>
      );
  }
}

function PriorityBadge({ priority }: { priority: string }) {
  return (
    <span className={cn('text-sm', PRIORITY_COLORS[priority] || PRIORITY_COLORS.none)}>
      {PRIORITY_LABELS[priority] || priority}
    </span>
  );
}

function SourceBadge({ source }: { source: 'internal' | 'external' }) {
  const label = source === 'internal' ? 'Internal' : 'External';
  return (
    <span
      className={cn(
        'inline-flex items-center rounded px-2 py-0.5 text-xs font-medium',
        SOURCE_STYLES[source] || SOURCE_STYLES.internal
      )}
    >
      {label}
    </span>
  );
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;

  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function ListIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 6h16M4 12h16M4 18h16" />
    </svg>
  );
}

function KanbanIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
    </svg>
  );
}

function ArchiveIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
    </svg>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}
