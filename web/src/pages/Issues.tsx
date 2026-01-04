import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { KanbanBoard } from '@/components/KanbanBoard';
import { useIssues, Issue } from '@/contexts/IssuesContext';
import { useBulkUpdateIssues } from '@/hooks/useIssuesQuery';
import { useSelection } from '@/hooks/useSelection';
import { IssuesListSkeleton } from '@/components/ui/Skeleton';
import { Combobox } from '@/components/ui/Combobox';
import { useToast } from '@/components/ui/Toast';
import { ContextMenu, ContextMenuItem, ContextMenuSeparator, ContextMenuSubmenu } from '@/components/ui/ContextMenu';
import { cn } from '@/lib/cn';

const SORT_OPTIONS = [
  { value: 'updated', label: 'Updated' },
  { value: 'created', label: 'Created' },
  { value: 'priority', label: 'Priority' },
  { value: 'title', label: 'Title' },
];

type ViewMode = 'list' | 'kanban';

const STATE_LABELS: Record<string, string> = {
  backlog: 'Backlog',
  todo: 'Todo',
  in_progress: 'In Progress',
  done: 'Done',
  cancelled: 'Cancelled',
};

const PRIORITY_LABELS: Record<string, string> = {
  urgent: 'Urgent',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  none: 'No Priority',
};

const PRIORITY_COLORS: Record<string, string> = {
  urgent: 'text-red-400',
  high: 'text-orange-400',
  medium: 'text-yellow-400',
  low: 'text-blue-400',
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
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const tableRef = useRef<HTMLTableElement>(null);

  const stateFilter = searchParams.get('state') || '';
  const prevStateFilter = useRef(stateFilter);

  // Filter issues client-side based on state filter
  const issues = useMemo(() => {
    if (!stateFilter) return allIssues;
    const states = stateFilter.split(',');
    return allIssues.filter(issue => states.includes(issue.state));
  }, [allIssues, stateFilter]);

  // Selection state
  const selection = useSelection({
    items: issues,
    getItemId: (issue) => issue.id,
    hoveredId,
  });

  // Clear selection when filter changes
  useEffect(() => {
    if (prevStateFilter.current !== stateFilter) {
      selection.clearSelection();
      prevStateFilter.current = stateFilter;
    }
  }, [stateFilter, selection]);

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

  // Bulk action handlers
  const handleBulkArchive = useCallback(() => {
    const ids = Array.from(selection.selectedIds);
    const count = ids.length;
    bulkUpdate.mutate({ ids, action: 'archive' }, {
      onSuccess: () => showToast(`${count} issue${count === 1 ? '' : 's'} archived`, 'success'),
      onError: () => showToast('Failed to archive issues', 'error'),
    });
    selection.clearSelection();
    setContextMenu(null);
  }, [selection, bulkUpdate, showToast]);

  const handleBulkDelete = useCallback(() => {
    const ids = Array.from(selection.selectedIds);
    const count = ids.length;
    bulkUpdate.mutate({ ids, action: 'delete' }, {
      onSuccess: () => showToast(`${count} issue${count === 1 ? '' : 's'} deleted`, 'success'),
      onError: () => showToast('Failed to delete issues', 'error'),
    });
    selection.clearSelection();
    setContextMenu(null);
  }, [selection, bulkUpdate, showToast]);

  const handleBulkMoveToSprint = useCallback((sprintId: string | null) => {
    const ids = Array.from(selection.selectedIds);
    const count = ids.length;
    bulkUpdate.mutate({ ids, action: 'update', updates: { sprint_id: sprintId } }, {
      onSuccess: () => showToast(`${count} issue${count === 1 ? '' : 's'} moved`, 'success'),
      onError: () => showToast('Failed to move issues', 'error'),
    });
    selection.clearSelection();
    setContextMenu(null);
  }, [selection, bulkUpdate, showToast]);

  const handleBulkChangeStatus = useCallback((status: string) => {
    const ids = Array.from(selection.selectedIds);
    const count = ids.length;
    const statusLabel = STATE_LABELS[status] || status;
    bulkUpdate.mutate({ ids, action: 'update', updates: { state: status } }, {
      onSuccess: () => showToast(`${count} issue${count === 1 ? '' : 's'} changed to ${statusLabel}`, 'success'),
      onError: () => showToast('Failed to update issues', 'error'),
    });
    selection.clearSelection();
    setContextMenu(null);
  }, [selection, bulkUpdate, showToast]);

  // Context menu handler
  const handleContextMenu = useCallback((e: React.MouseEvent, issueId: string) => {
    e.preventDefault();
    // If right-clicked item is not selected, select only that item
    if (!selection.isSelected(issueId)) {
      selection.clearSelection();
      selection.handleClick(issueId, e);
    }
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, [selection]);

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

      // Shift+Arrow extends selection (Superhuman-style)
      // Only handle globally if the table doesn't have focus (otherwise table's onKeyDown handles it)
      if (e.shiftKey && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
        const tableHasFocus = tableRef.current?.contains(document.activeElement);
        if (!tableHasFocus && (hoveredId || selection.hasSelection)) {
          e.preventDefault();
          selection.extendSelection(e.key === 'ArrowDown' ? 'down' : 'up');
        }
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleCreateIssue, hoveredId, selection]);

  if (loading) {
    return <IssuesListSkeleton />;
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
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
        <FilterTab label="Active" active={stateFilter === 'todo,in_progress'} onClick={() => setFilter('todo,in_progress')} id="filter-active" />
        <FilterTab label="Backlog" active={stateFilter === 'backlog'} onClick={() => setFilter('backlog')} id="filter-backlog" />
        <FilterTab label="Done" active={stateFilter === 'done'} onClick={() => setFilter('done')} id="filter-done" />
      </div>

      {/* Content */}
      {viewMode === 'kanban' ? (
        <KanbanBoard
          issues={issues}
          onUpdateIssue={handleUpdateIssue}
          onIssueClick={(id) => navigate(`/issues/${id}`)}
          selectedIds={selection.selectedIds}
          onSelectionChange={(ids) => {
            // Sync kanban selection with our selection state
            if (ids.size === 0) {
              selection.clearSelection();
            }
          }}
          onCheckboxClick={(id, e) => selection.handleClick(id, e)}
        />
      ) : (
        <div className="flex-1 overflow-auto">
          {issues.length === 0 ? (
            <div className="flex h-full items-center justify-center">
              <div className="text-center">
                <p className="text-muted">No issues yet</p>
                <button
                  onClick={handleCreateIssue}
                  className="mt-2 text-sm text-accent hover:underline"
                >
                  Create your first issue
                </button>
              </div>
            </div>
          ) : (
            <table
              ref={tableRef}
              className="w-full"
              role="grid"
              aria-multiselectable="true"
              aria-label="Issues list"
              tabIndex={0}
              onKeyDown={selection.handleKeyDown}
            >
              <thead className="sticky top-0 bg-background z-10">
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="w-10 px-2 py-2" aria-label="Selection"></th>
                  <th className="px-4 py-2 font-medium">ID</th>
                  <th className="px-4 py-2 font-medium">Title</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">Priority</th>
                  <th className="px-4 py-2 font-medium">Assignee</th>
                  <th className="px-4 py-2 font-medium">Updated</th>
                </tr>
              </thead>
              <tbody>
                {issues.map((issue) => (
                  <SelectableRow
                    key={issue.id}
                    issue={issue}
                    isSelected={selection.isSelected(issue.id)}
                    isFocused={selection.isFocused(issue.id)}
                    onCheckboxClick={(e) => selection.handleClick(issue.id, e)}
                    onRowClick={() => navigate(`/issues/${issue.id}`)}
                    onFocus={() => selection.setFocusedId(issue.id)}
                    onMouseEnter={() => setHoveredId(issue.id)}
                    onMouseLeave={() => setHoveredId(null)}
                    onContextMenu={(e) => handleContextMenu(e, issue.id)}
                  />
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Selection announcer for screen readers */}
      <div
        id="selection-announcer"
        role="status"
        aria-live="polite"
        aria-atomic="true"
        className="sr-only"
      >
        {selection.hasSelection ? `${selection.selectedCount} items selected` : ''}
      </div>

      {/* Context Menu */}
      {contextMenu && selection.hasSelection && (
        <ContextMenu x={contextMenu.x} y={contextMenu.y} onClose={() => setContextMenu(null)}>
          <div className="px-3 py-1.5 text-xs text-muted border-b border-border mb-1">
            {selection.selectedCount} selected
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

interface SelectableRowProps {
  issue: Issue;
  isSelected: boolean;
  isFocused: boolean;
  onCheckboxClick: (e: React.MouseEvent) => void;
  onRowClick: () => void;
  onFocus: () => void;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}

function SelectableRow({ issue, isSelected, isFocused, onCheckboxClick, onRowClick, onFocus, onMouseEnter, onMouseLeave, onContextMenu }: SelectableRowProps) {
  return (
    <tr
      role="row"
      aria-selected={isSelected}
      tabIndex={isFocused ? 0 : -1}
      onFocus={onFocus}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onContextMenu={onContextMenu}
      data-selected={isSelected}
      className={cn(
        'group cursor-pointer border-b border-border/50 transition-colors',
        isSelected && 'bg-accent/10',
        isFocused && 'ring-2 ring-accent ring-inset',
        !isSelected && 'hover:bg-border/30'
      )}
    >
      {/* Checkbox cell */}
      <td className="w-10 px-2 py-3" role="gridcell">
        <div
          className={cn(
            'flex items-center justify-center transition-opacity',
            isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
          )}
        >
          <button
            type="button"
            role="checkbox"
            aria-checked={isSelected}
            onClick={(e) => {
              e.stopPropagation();
              onCheckboxClick(e);
            }}
            aria-label={`Select issue #${issue.ticket_number}`}
            className={cn(
              'h-4 w-4 rounded flex items-center justify-center transition-all',
              'border focus:outline-none focus:ring-2 focus:ring-accent/50',
              isSelected
                ? 'bg-accent border-accent text-white'
                : 'border-muted/50 hover:border-muted bg-transparent'
            )}
          >
            {isSelected && (
              <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={3}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
            )}
          </button>
        </div>
      </td>
      {/* ID */}
      <td
        className="px-4 py-3 text-sm text-muted"
        onClick={onRowClick}
        role="gridcell"
      >
        #{issue.ticket_number}
      </td>
      {/* Title */}
      <td
        className="px-4 py-3 text-sm text-foreground"
        onClick={onRowClick}
        role="gridcell"
      >
        {issue.title}
      </td>
      {/* Status */}
      <td className="px-4 py-3" onClick={onRowClick} role="gridcell">
        <StatusBadge state={issue.state} />
      </td>
      {/* Priority */}
      <td className="px-4 py-3" onClick={onRowClick} role="gridcell">
        <PriorityBadge priority={issue.priority} />
      </td>
      {/* Assignee */}
      <td
        className="px-4 py-3 text-sm text-muted"
        onClick={onRowClick}
        role="gridcell"
      >
        {issue.assignee_name || 'Unassigned'}
      </td>
      {/* Updated */}
      <td
        className="px-4 py-3 text-sm text-muted"
        onClick={onRowClick}
        role="gridcell"
      >
        {issue.updated_at ? formatDate(issue.updated_at) : '-'}
      </td>
    </tr>
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
  const colors: Record<string, string> = {
    backlog: 'bg-gray-500/20 text-gray-400',
    todo: 'bg-blue-500/20 text-blue-400',
    in_progress: 'bg-yellow-500/20 text-yellow-400',
    done: 'bg-green-500/20 text-green-400',
    cancelled: 'bg-red-500/20 text-red-400',
  };

  const label = STATE_LABELS[state] || state;

  return (
    <span
      data-status-indicator
      data-status={state}
      aria-label={`Status: ${label}`}
      className={cn('inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium', colors[state] || colors.backlog)}
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
