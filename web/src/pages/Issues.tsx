import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { KanbanBoard } from '@/components/KanbanBoard';
import { SelectableList, RowRenderProps, UseSelectionReturn } from '@/components/SelectableList';
import { BulkActionBar } from '@/components/BulkActionBar';
import { DocumentListToolbar } from '@/components/DocumentListToolbar';
import { useIssues, Issue } from '@/contexts/IssuesContext';
import { useBulkUpdateIssues } from '@/hooks/useIssuesQuery';
import { useColumnVisibility, ColumnDefinition } from '@/hooks/useColumnVisibility';
import { useListFilters, ViewMode } from '@/hooks/useListFilters';
import { IssuesListSkeleton } from '@/components/ui/Skeleton';
import { OfflineEmptyState, useOfflineEmptyState } from '@/components/OfflineEmptyState';
import { Combobox } from '@/components/ui/Combobox';
import { useToast } from '@/components/ui/Toast';
import { ContextMenu, ContextMenuItem, ContextMenuSeparator, ContextMenuSubmenu } from '@/components/ui/ContextMenu';
import { cn } from '@/lib/cn';
import { issueStatusColors, priorityColors } from '@/lib/statusColors';

// All available columns with metadata
const ALL_COLUMNS: ColumnDefinition[] = [
  { key: 'id', label: 'ID', hideable: true },
  { key: 'title', label: 'Title', hideable: false }, // Cannot hide title
  { key: 'status', label: 'Status', hideable: true },
  { key: 'source', label: 'Source', hideable: true },
  { key: 'program', label: 'Program', hideable: true },
  { key: 'priority', label: 'Priority', hideable: true },
  { key: 'assignee', label: 'Assignee', hideable: true },
  { key: 'updated', label: 'Updated', hideable: true },
];

const SORT_OPTIONS = [
  { value: 'updated', label: 'Updated' },
  { value: 'created', label: 'Created' },
  { value: 'priority', label: 'Priority' },
  { value: 'title', label: 'Title' },
];

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
  const { issues: allIssues, loading, createIssue: contextCreateIssue, updateIssue: contextUpdateIssue, refreshIssues } = useIssues();
  const isOfflineEmpty = useOfflineEmptyState(allIssues, loading);
  const bulkUpdate = useBulkUpdateIssues();
  const { showToast } = useToast();

  // Use shared hooks for list state management
  const { sortBy, setSortBy, viewMode, setViewMode } = useListFilters({
    sortOptions: SORT_OPTIONS,
    defaultSort: 'updated',
  });

  const { visibleColumns, columns, hiddenCount, toggleColumn } = useColumnVisibility({
    columns: ALL_COLUMNS,
    storageKey: 'issues-column-visibility',
  });

  const [programFilter, setProgramFilter] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; selection: UseSelectionReturn } | null>(null);

  // Track selection state for BulkActionBar
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectionRef = useRef<UseSelectionReturn | null>(null);

  const stateFilter = searchParams.get('state') || '';

  // Compute unique programs from issues for the filter dropdown
  const programOptions = useMemo(() => {
    const programMap = new Map<string, string>();
    allIssues.forEach(issue => {
      if (issue.program_id && issue.program_name) {
        programMap.set(issue.program_id, issue.program_name);
      }
    });
    return Array.from(programMap.entries())
      .map(([id, name]) => ({ value: id, label: name }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [allIssues]);

  // Filter issues client-side based on state filter AND program filter
  const issues = useMemo(() => {
    let filtered = allIssues;

    // Apply program filter
    if (programFilter) {
      filtered = filtered.filter(issue => issue.program_id === programFilter);
    }

    // Apply state filter
    if (stateFilter) {
      const states = stateFilter.split(',');
      filtered = filtered.filter(issue => states.includes(issue.state));
    }

    return filtered;
  }, [allIssues, stateFilter, programFilter]);

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

  // Clear selection helper
  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    selectionRef.current?.clearSelection();
    setContextMenu(null);
  }, []);

  // Clear selection when filter changes
  useEffect(() => {
    clearSelection();
  }, [stateFilter, clearSelection]);

  // Bulk action handlers - work with both context menu and BulkActionBar
  const handleBulkArchive = useCallback(() => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const count = ids.length;

    // Store original states for undo
    const originalStates = ids.map(id => {
      const issue = allIssues.find(i => i.id === id);
      return { id, state: issue?.state || 'backlog' };
    });

    bulkUpdate.mutate({ ids, action: 'archive' }, {
      onSuccess: () => {
        showToast(
          `${count} issue${count === 1 ? '' : 's'} archived`,
          'success',
          5000,
          {
            label: 'Undo',
            onClick: () => {
              // Restore by clearing archived_at
              bulkUpdate.mutate({
                ids,
                action: 'restore',
              }, {
                onSuccess: () => {
                  showToast('Archive undone', 'info');
                  refreshIssues();
                },
              });
            },
          }
        );
      },
      onError: () => showToast('Failed to archive issues', 'error'),
    });
    clearSelection();
  }, [selectedIds, allIssues, bulkUpdate, showToast, clearSelection, refreshIssues]);

  const handleBulkDelete = useCallback(() => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const count = ids.length;

    // Store original issues for undo
    const deletedIssues = ids.map(id => allIssues.find(i => i.id === id)).filter(Boolean);

    bulkUpdate.mutate({ ids, action: 'delete' }, {
      onSuccess: () => {
        showToast(
          `${count} issue${count === 1 ? '' : 's'} deleted`,
          'success',
          5000,
          {
            label: 'Undo',
            onClick: () => {
              // Restore by un-deleting (setting deleted_at to null)
              bulkUpdate.mutate({ ids, action: 'restore' }, {
                onSuccess: () => {
                  showToast('Delete undone', 'info');
                  refreshIssues();
                },
                onError: () => showToast('Failed to undo delete', 'error'),
              });
            },
          }
        );
      },
      onError: () => showToast('Failed to delete issues', 'error'),
    });
    clearSelection();
  }, [selectedIds, allIssues, bulkUpdate, showToast, clearSelection, refreshIssues]);

  const handleBulkMoveToSprint = useCallback((sprintId: string | null) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const count = ids.length;
    bulkUpdate.mutate({ ids, action: 'update', updates: { sprint_id: sprintId } }, {
      onSuccess: () => showToast(`${count} issue${count === 1 ? '' : 's'} moved`, 'success'),
      onError: () => showToast('Failed to move issues', 'error'),
    });
    clearSelection();
  }, [selectedIds, bulkUpdate, showToast, clearSelection]);

  const handleBulkChangeStatus = useCallback((status: string) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const count = ids.length;
    const statusLabel = STATE_LABELS[status] || status;
    bulkUpdate.mutate({ ids, action: 'update', updates: { state: status } }, {
      onSuccess: () => showToast(`${count} issue${count === 1 ? '' : 's'} changed to ${statusLabel}`, 'success'),
      onError: () => showToast('Failed to update issues', 'error'),
    });
    clearSelection();
  }, [selectedIds, bulkUpdate, showToast, clearSelection]);

  // Selection change handler - keeps parent state in sync with SelectableList
  const handleSelectionChange = useCallback((newSelectedIds: Set<string>, selection: UseSelectionReturn) => {
    setSelectedIds(newSelectedIds);
    selectionRef.current = selection;
  }, []);

  // Kanban checkbox click handler - manages selection directly
  const handleKanbanCheckboxClick = useCallback((id: string, e: React.MouseEvent) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (e.metaKey || e.ctrlKey) {
        // Cmd/Ctrl+click to toggle individual item
        if (newSet.has(id)) {
          newSet.delete(id);
        } else {
          newSet.add(id);
        }
      } else {
        // Simple click - toggle this item
        if (newSet.has(id)) {
          newSet.delete(id);
        } else {
          newSet.add(id);
        }
      }
      return newSet;
    });
  }, []);

  // Kanban context menu handler - receives { x, y, issueId } from KanbanBoard
  const handleKanbanContextMenu = useCallback((event: { x: number; y: number; issueId: string }) => {
    // Select the issue if not already selected (single-select behavior for context menu)
    if (!selectedIds.has(event.issueId)) {
      setSelectedIds(new Set([event.issueId]));
    }
    // Create a mock selection object that works with existing context menu rendering
    const effectiveIds = selectedIds.has(event.issueId) ? selectedIds : new Set([event.issueId]);
    const mockSelection: UseSelectionReturn = {
      selectedIds: effectiveIds,
      focusedId: event.issueId,
      selectedCount: effectiveIds.size,
      hasSelection: effectiveIds.size > 0,
      isSelected: (id: string) => effectiveIds.has(id),
      isFocused: (id: string) => id === event.issueId,
      toggleSelection: () => {},
      toggleInGroup: () => {},
      selectAll: () => {},
      clearSelection: () => setSelectedIds(new Set()),
      selectRange: () => {},
      setFocusedId: () => {},
      moveFocus: () => {},
      extendSelection: () => {},
      handleClick: () => {},
      handleKeyDown: () => {},
    };
    selectionRef.current = mockSelection;
    setContextMenu({ x: event.x, y: event.y, selection: mockSelection });
  }, [selectedIds]);

  // Context menu handler - receives selection from SelectableList
  const handleContextMenu = useCallback((e: React.MouseEvent, _item: Issue, selection: UseSelectionReturn) => {
    selectionRef.current = selection;
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

  // Render function for issue rows
  const renderIssueRow = useCallback((issue: Issue, { isSelected }: RowRenderProps) => (
    <IssueRowContent issue={issue} isSelected={isSelected} visibleColumns={visibleColumns} />
  ), [visibleColumns]);

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

  // Show offline empty state when offline with no cached data
  if (isOfflineEmpty) {
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <OfflineEmptyState resourceName="issues" />
      </div>
    );
  }

  if (loading) {
    return <IssuesListSkeleton />;
  }

  // Program filter for toolbar
  const programFilterContent = programOptions.length > 0 ? (
    <div className="w-40">
      <Combobox
        options={programOptions}
        value={programFilter}
        onChange={setProgramFilter}
        placeholder="All Programs"
        aria-label="Filter issues by program"
        id="issues-program-filter"
        allowClear={true}
        clearLabel="All Programs"
      />
    </div>
  ) : null;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <h1 className="text-xl font-semibold text-foreground">Issues</h1>
        <DocumentListToolbar
          sortOptions={SORT_OPTIONS}
          sortBy={sortBy}
          onSortChange={setSortBy}
          viewModes={['list', 'kanban']}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          allColumns={ALL_COLUMNS}
          visibleColumns={visibleColumns}
          onToggleColumn={toggleColumn}
          hiddenCount={hiddenCount}
          showColumnPicker={viewMode === 'list'}
          filterContent={programFilterContent}
          createButton={{ label: 'New Issue', onClick: handleCreateIssue }}
        />
      </div>

      {/* Filter tabs OR Bulk action bar (mutually exclusive) */}
      {selectedIds.size > 0 ? (
        <BulkActionBar
          selectedCount={selectedIds.size}
          onClearSelection={clearSelection}
          onArchive={handleBulkArchive}
          onDelete={handleBulkDelete}
          onChangeStatus={handleBulkChangeStatus}
          onMoveToSprint={handleBulkMoveToSprint}
          loading={bulkUpdate.isPending}
        />
      ) : (
        <div className="flex gap-1 border-b border-border px-6 py-2" role="tablist" aria-label="Issue filters">
          <FilterTab label="All" active={!stateFilter} onClick={() => setFilter('')} id="filter-all" />
          <FilterTab label="Needs Triage" active={stateFilter === 'triage'} onClick={() => setFilter('triage')} id="filter-triage" />
          <FilterTab label="Active" active={stateFilter === 'todo,in_progress,in_review'} onClick={() => setFilter('todo,in_progress,in_review')} id="filter-active" />
          <FilterTab label="Backlog" active={stateFilter === 'backlog'} onClick={() => setFilter('backlog')} id="filter-backlog" />
          <FilterTab label="Done" active={stateFilter === 'done'} onClick={() => setFilter('done')} id="filter-done" />
          <FilterTab label="Cancelled" active={stateFilter === 'cancelled'} onClick={() => setFilter('cancelled')} id="filter-cancelled" />
        </div>
      )}

      {/* Content */}
      {viewMode === 'kanban' ? (
        <KanbanBoard
          issues={issues}
          onUpdateIssue={handleUpdateIssue}
          onIssueClick={(id) => navigate(`/issues/${id}`)}
          selectedIds={selectedIds}
          onCheckboxClick={handleKanbanCheckboxClick}
          onContextMenu={handleKanbanContextMenu}
        />
      ) : (
        <div className="flex-1 overflow-auto">
          <SelectableList
            items={issues}
            renderRow={renderIssueRow}
            columns={columns}
            emptyState={emptyState}
            onItemClick={(issue) => navigate(`/issues/${issue.id}`)}
            onSelectionChange={handleSelectionChange}
            onContextMenu={handleContextMenu}
            ariaLabel="Issues list"
          />
        </div>
      )}

      {/* Context Menu - always shows when contextMenu is set since right-click auto-selects the item */}
      {contextMenu && (
        <ContextMenu x={contextMenu.x} y={contextMenu.y} onClose={() => setContextMenu(null)}>
          <div className="px-3 py-1.5 text-xs text-muted border-b border-border mb-1">
            {Math.max(1, contextMenu.selection.selectedCount)} selected
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
  visibleColumns: Set<string>;
}

function IssueRowContent({ issue, visibleColumns }: IssueRowContentProps) {
  return (
    <>
      {/* ID */}
      {visibleColumns.has('id') && (
        <td className="px-4 py-3 text-sm text-muted" role="gridcell">
          #{issue.ticket_number}
        </td>
      )}
      {/* Title */}
      {visibleColumns.has('title') && (
        <td className="px-4 py-3 text-sm text-foreground" role="gridcell">
          {issue.title}
        </td>
      )}
      {/* Status */}
      {visibleColumns.has('status') && (
        <td className="px-4 py-3" role="gridcell">
          <StatusBadge state={issue.state} />
        </td>
      )}
      {/* Source */}
      {visibleColumns.has('source') && (
        <td className="px-4 py-3" role="gridcell">
          <SourceBadge source={issue.source} />
        </td>
      )}
      {/* Program */}
      {visibleColumns.has('program') && (
        <td className="px-4 py-3 text-sm text-muted" role="gridcell">
          {issue.program_name || '—'}
        </td>
      )}
      {/* Priority */}
      {visibleColumns.has('priority') && (
        <td className="px-4 py-3" role="gridcell">
          <PriorityBadge priority={issue.priority} />
        </td>
      )}
      {/* Assignee */}
      {visibleColumns.has('assignee') && (
        <td className="px-4 py-3 text-sm text-muted" role="gridcell">
          {issue.assignee_name || 'Unassigned'}
        </td>
      )}
      {/* Updated */}
      {visibleColumns.has('updated') && (
        <td className="px-4 py-3 text-sm text-muted" role="gridcell">
          {issue.updated_at ? formatDate(issue.updated_at) : '-'}
        </td>
      )}
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

