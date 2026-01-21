import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { KanbanBoard } from '@/components/KanbanBoard';
import { SelectableList, RowRenderProps, UseSelectionReturn } from '@/components/SelectableList';
import { BulkActionBar } from '@/components/BulkActionBar';
import { DocumentListToolbar } from '@/components/DocumentListToolbar';
import { Issue } from '@/contexts/IssuesContext';
import { useBulkUpdateIssues, useIssuesQuery, useCreateIssue, issueKeys, getProgramId, getProgramTitle, getProjectId, getProjectTitle, getSprintId, getSprintTitle } from '@/hooks/useIssuesQuery';
import type { BelongsTo } from '@ship/shared';
import { projectKeys, useProjectsQuery } from '@/hooks/useProjectsQuery';
import { useQueryClient } from '@tanstack/react-query';
import { useAssignableMembersQuery } from '@/hooks/useTeamMembersQuery';
import { useColumnVisibility, ColumnDefinition } from '@/hooks/useColumnVisibility';
import { useListFilters, ViewMode } from '@/hooks/useListFilters';
import { useGlobalListNavigation } from '@/hooks/useGlobalListNavigation';
import { IssuesListSkeleton } from '@/components/ui/Skeleton';
import { Combobox } from '@/components/ui/Combobox';
import { useToast } from '@/components/ui/Toast';
import { ContextMenu, ContextMenuItem, ContextMenuSeparator, ContextMenuSubmenu } from '@/components/ui/ContextMenu';
import { cn } from '@/lib/cn';
import { FilterTabs, FilterTab } from '@/components/FilterTabs';
import { apiPost } from '@/lib/api';
import { ConversionDialog } from '@/components/dialogs/ConversionDialog';

// Re-export Issue type for convenience
export type { Issue } from '@/contexts/IssuesContext';

// All available columns with metadata
export const ALL_COLUMNS: ColumnDefinition[] = [
  { key: 'id', label: 'ID', hideable: true },
  { key: 'title', label: 'Title', hideable: false }, // Cannot hide title
  { key: 'status', label: 'Status', hideable: true },
  { key: 'source', label: 'Source', hideable: true },
  { key: 'program', label: 'Program', hideable: true },
  { key: 'priority', label: 'Priority', hideable: true },
  { key: 'assignee', label: 'Assignee', hideable: true },
  { key: 'updated', label: 'Updated', hideable: true },
];

export const SORT_OPTIONS = [
  { value: 'updated', label: 'Updated' },
  { value: 'created', label: 'Created' },
  { value: 'priority', label: 'Priority' },
  { value: 'title', label: 'Title' },
];

export const STATE_LABELS: Record<string, string> = {
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
  urgent: 'text-red-400',
  high: 'text-orange-400',
  medium: 'text-yellow-400',
  low: 'text-blue-400',
  none: 'text-muted',
};

const STATUS_COLORS: Record<string, string> = {
  triage: 'bg-yellow-500/20 text-yellow-300',
  backlog: 'bg-zinc-500/20 text-zinc-300',
  todo: 'bg-blue-500/20 text-blue-300',
  in_progress: 'bg-amber-500/20 text-amber-300',
  in_review: 'bg-purple-500/20 text-purple-300',
  done: 'bg-green-500/20 text-green-300',
  cancelled: 'bg-red-500/20 text-red-300',
};

// Default filter tabs for issues
export const DEFAULT_FILTER_TABS: FilterTab[] = [
  { id: '', label: 'All' },
  { id: 'triage', label: 'Needs Triage' },
  { id: 'todo,in_progress,in_review', label: 'Active' },
  { id: 'backlog', label: 'Backlog' },
  { id: 'done', label: 'Done' },
  { id: 'cancelled', label: 'Cancelled' },
];

export interface IssuesListProps {
  /** Issues to display. Optional when using locked filters (will self-fetch). */
  issues?: Issue[];
  /** Whether data is loading */
  loading?: boolean;
  /** Callback to update an issue */
  onUpdateIssue?: (id: string, updates: Partial<Issue>) => Promise<Issue | null>;
  /** Callback to create a new issue */
  onCreateIssue?: () => Promise<Issue | null>;
  /** Callback to refresh issues */
  onRefreshIssues?: () => Promise<void>;
  /** Storage key prefix for persisting view state (column visibility, etc.) */
  storageKeyPrefix?: string;
  /** Filter tabs to show. Pass null to hide filter tabs entirely. */
  filterTabs?: FilterTab[] | null;
  /** Initial state filter */
  initialStateFilter?: string;
  /** Called when state filter changes */
  onStateFilterChange?: (filter: string) => void;
  /** Whether to show program filter dropdown */
  showProgramFilter?: boolean;
  /** Whether to show project filter dropdown (default: true) */
  showProjectFilter?: boolean;
  /** Whether to show sprint filter dropdown (default: true) */
  showSprintFilter?: boolean;
  /** Locked program filter - cannot be changed by user, triggers self-fetch */
  lockedProgramId?: string;
  /** Locked project filter - cannot be changed by user, triggers self-fetch */
  lockedProjectId?: string;
  /** Locked sprint filter - cannot be changed by user, triggers self-fetch */
  lockedSprintId?: string;
  /** Context to inherit when creating new issues (derived from locked filters if not provided) */
  inheritedContext?: {
    programId?: string;
    projectId?: string;
    sprintId?: string;
    assigneeId?: string;
  };
  /** Whether to show the create button */
  showCreateButton?: boolean;
  /** Label for the create button */
  createButtonLabel?: string;
  /** Available view modes */
  viewModes?: ViewMode[];
  /** Initial view mode */
  initialViewMode?: ViewMode;
  /** Columns to show by default (if not persisted) */
  defaultColumns?: string[];
  /** Whether to enable keyboard navigation (j/k/Enter) */
  enableKeyboardNavigation?: boolean;
  /** Empty state content */
  emptyState?: React.ReactNode;
  /** Whether to show promote to project option in context menu */
  showPromoteToProject?: boolean;
  /** Custom class name for the container */
  className?: string;
  /** Header content (rendered above toolbar) - mutually exclusive with hideHeader */
  headerContent?: React.ReactNode;
  /** Whether to hide the header/toolbar entirely */
  hideHeader?: boolean;
  /** Additional toolbar content (rendered in toolbar) */
  toolbarContent?: React.ReactNode;
}

/**
 * IssuesList - Reusable component for displaying issues in list or kanban view
 *
 * Features:
 * - List and Kanban view modes with toggle
 * - Multi-select with bulk actions (archive, delete, change status, assign, move to sprint)
 * - Column visibility picker (list view only)
 * - State filter tabs
 * - Program filter dropdown
 * - Keyboard navigation (j/k for focus, x for select, Enter to open)
 * - Context menu with single and bulk actions
 * - Promote to project action
 */
export function IssuesList({
  issues: issuesProp,
  loading: loadingProp = false,
  onUpdateIssue,
  onCreateIssue,
  onRefreshIssues,
  storageKeyPrefix = 'issues-list',
  filterTabs = DEFAULT_FILTER_TABS,
  initialStateFilter = '',
  onStateFilterChange,
  showProgramFilter = false,
  showProjectFilter = true,
  showSprintFilter = true,
  lockedProgramId,
  lockedProjectId,
  lockedSprintId,
  inheritedContext,
  showCreateButton = true,
  createButtonLabel = 'New Issue',
  viewModes = ['list', 'kanban'],
  initialViewMode = 'list',
  defaultColumns,
  enableKeyboardNavigation = true,
  emptyState,
  showPromoteToProject = true,
  className,
  headerContent,
  hideHeader = false,
  toolbarContent,
}: IssuesListProps) {
  const navigate = useNavigate();
  const bulkUpdate = useBulkUpdateIssues();
  const { data: teamMembers = [] } = useAssignableMembersQuery();
  const { data: projects = [] } = useProjectsQuery();
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  // Determine if we should self-fetch based on locked filters
  const shouldSelfFetch = Boolean(lockedProgramId || lockedProjectId || lockedSprintId);

  // Self-fetch issues when using locked filters
  const { data: fetchedIssues, isLoading: isFetchingIssues } = useIssuesQuery(
    shouldSelfFetch ? {
      programId: lockedProgramId,
      projectId: lockedProjectId,
      sprintId: lockedSprintId,
    } : {},
    { enabled: shouldSelfFetch }
  );

  // Internal create issue mutation for self-fetching mode
  const createIssueMutation = useCreateIssue();

  // Compute effective context for issue creation (from inheritedContext or locked filters)
  const effectiveContext = useMemo(() => {
    // Prefer explicit inheritedContext over locked filters
    const projectId = inheritedContext?.projectId ?? lockedProjectId;
    const sprintId = inheritedContext?.sprintId ?? lockedSprintId;
    let programId = inheritedContext?.programId ?? lockedProgramId;

    // Infer program from project if project is set and program isn't
    if (projectId && !programId) {
      const project = projects.find(p => p.id === projectId);
      if (project?.program_id) {
        programId = project.program_id;
      }
    }

    return {
      programId,
      projectId,
      sprintId,
      assigneeId: inheritedContext?.assigneeId,
    };
  }, [inheritedContext, lockedProgramId, lockedProjectId, lockedSprintId, projects]);

  // Build belongs_to array from effective context
  const buildBelongsTo = useCallback((): BelongsTo[] => {
    const belongs_to: BelongsTo[] = [];
    if (effectiveContext.programId) {
      belongs_to.push({ id: effectiveContext.programId, type: 'program' });
    }
    if (effectiveContext.projectId) {
      belongs_to.push({ id: effectiveContext.projectId, type: 'project' });
    }
    if (effectiveContext.sprintId) {
      belongs_to.push({ id: effectiveContext.sprintId, type: 'sprint' });
    }
    return belongs_to;
  }, [effectiveContext]);

  // Use fetched issues when self-fetching, otherwise use the prop
  const issues = shouldSelfFetch ? (fetchedIssues ?? []) : (issuesProp ?? []);
  const loading = shouldSelfFetch ? isFetchingIssues : loadingProp;

  // Use shared hooks for list state management
  const { sortBy, setSortBy, viewMode, setViewMode } = useListFilters({
    sortOptions: SORT_OPTIONS,
    defaultSort: 'updated',
    defaultViewMode: initialViewMode,
  });

  const { visibleColumns, columns, hiddenCount, toggleColumn } = useColumnVisibility({
    columns: ALL_COLUMNS,
    storageKey: `${storageKeyPrefix}-column-visibility`,
    defaultVisible: defaultColumns,
  });

  const [stateFilter, setStateFilter] = useState(initialStateFilter);
  const [programFilter, setProgramFilter] = useState<string | null>(null);
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [sprintFilter, setSprintFilter] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; selection: UseSelectionReturn } | null>(null);

  // Conversion state
  const [convertingIssue, setConvertingIssue] = useState<Issue | null>(null);
  const [isConverting, setIsConverting] = useState(false);

  // Track selection state for BulkActionBar and global keyboard navigation
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectionRef = useRef<UseSelectionReturn | null>(null);
  // Force re-render trigger for when selection ref updates (used by useGlobalListNavigation)
  const [, forceUpdate] = useState(0);

  // Sync state filter with external state
  useEffect(() => {
    setStateFilter(initialStateFilter);
  }, [initialStateFilter]);

  // Compute unique programs from issues for the filter dropdown
  const programOptions = useMemo(() => {
    const programMap = new Map<string, string>();
    issues.forEach(issue => {
      const programId = getProgramId(issue);
      const programName = getProgramTitle(issue);
      if (programId && programName) {
        programMap.set(programId, programName);
      }
    });
    return Array.from(programMap.entries())
      .map(([id, name]) => ({ value: id, label: name }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [issues]);

  // Compute unique projects from issues for the filter dropdown
  const projectOptions = useMemo(() => {
    const projectMap = new Map<string, string>();
    issues.forEach(issue => {
      const projectId = getProjectId(issue);
      const projectName = getProjectTitle(issue);
      if (projectId && projectName) {
        projectMap.set(projectId, projectName);
      }
    });
    return Array.from(projectMap.entries())
      .map(([id, name]) => ({ value: id, label: name }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [issues]);

  // Compute unique sprints from issues for the filter dropdown
  const sprintOptions = useMemo(() => {
    const sprintMap = new Map<string, string>();
    issues.forEach(issue => {
      const sprintId = getSprintId(issue);
      const sprintName = getSprintTitle(issue);
      if (sprintId && sprintName) {
        sprintMap.set(sprintId, sprintName);
      }
    });
    return Array.from(sprintMap.entries())
      .map(([id, name]) => ({ value: id, label: name }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [issues]);

  // Filter issues based on state filter AND program/project/sprint filters
  const filteredIssues = useMemo(() => {
    let result = issues;

    // Apply program filter
    if (programFilter) {
      result = result.filter(issue => getProgramId(issue) === programFilter);
    }

    // Apply project filter
    if (projectFilter) {
      result = result.filter(issue => getProjectId(issue) === projectFilter);
    }

    // Apply sprint filter
    if (sprintFilter) {
      result = result.filter(issue => getSprintId(issue) === sprintFilter);
    }

    // Apply state filter
    if (stateFilter) {
      const states = stateFilter.split(',');
      result = result.filter(issue => states.includes(issue.state));
    }

    return result;
  }, [issues, stateFilter, programFilter, projectFilter, sprintFilter]);

  const handleCreateIssue = useCallback(async () => {
    // When self-fetching with context, use internal creation
    if (shouldSelfFetch) {
      const belongs_to = buildBelongsTo();
      const issue = await createIssueMutation.mutateAsync({ belongs_to });
      if (issue) {
        navigate(`/issues/${issue.id}`);
      }
      return;
    }
    // Otherwise, use external callback
    if (!onCreateIssue) return;
    const issue = await onCreateIssue();
    if (issue) {
      navigate(`/issues/${issue.id}`);
    }
  }, [shouldSelfFetch, buildBelongsTo, createIssueMutation, onCreateIssue, navigate]);

  const handleFilterChange = useCallback((newFilter: string) => {
    setStateFilter(newFilter);
    onStateFilterChange?.(newFilter);
  }, [onStateFilterChange]);

  const handleUpdateIssue = useCallback(async (id: string, updates: { state: string }) => {
    if (onUpdateIssue) {
      await onUpdateIssue(id, updates);
    }
  }, [onUpdateIssue]);

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

  // Bulk action handlers
  const handleBulkArchive = useCallback(() => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const count = ids.length;

    bulkUpdate.mutate({ ids, action: 'archive' }, {
      onSuccess: () => {
        showToast(
          `${count} issue${count === 1 ? '' : 's'} archived`,
          'success',
          5000,
          {
            label: 'Undo',
            onClick: () => {
              bulkUpdate.mutate({ ids, action: 'restore' }, {
                onSuccess: () => {
                  showToast('Archive undone', 'info');
                  onRefreshIssues?.();
                },
              });
            },
          }
        );
      },
      onError: () => showToast('Failed to archive issues', 'error'),
    });
    clearSelection();
  }, [selectedIds, bulkUpdate, showToast, clearSelection, onRefreshIssues]);

  const handleBulkDelete = useCallback(() => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const count = ids.length;

    bulkUpdate.mutate({ ids, action: 'delete' }, {
      onSuccess: () => {
        showToast(
          `${count} issue${count === 1 ? '' : 's'} deleted`,
          'success',
          5000,
          {
            label: 'Undo',
            onClick: () => {
              bulkUpdate.mutate({ ids, action: 'restore' }, {
                onSuccess: () => {
                  showToast('Delete undone', 'info');
                  onRefreshIssues?.();
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
  }, [selectedIds, bulkUpdate, showToast, clearSelection, onRefreshIssues]);

  const handleBulkMoveToSprint = useCallback((sprintId: string | null) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const count = ids.length;
    bulkUpdate.mutate({ ids, action: 'update', updates: { belongs_to: sprintId ? [{ id: sprintId, type: 'sprint' as const }] : [] } }, {
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

  const handleBulkAssign = useCallback((assigneeId: string | null) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const count = ids.length;
    const teamMember = assigneeId ? teamMembers.find(m => m.id === assigneeId) : null;
    const assigneeName = teamMember?.name || 'Unassigned';
    const userId = teamMember?.user_id || null;
    bulkUpdate.mutate({ ids, action: 'update', updates: { assignee_id: userId } }, {
      onSuccess: () => showToast(`${count} issue${count === 1 ? '' : 's'} assigned to ${assigneeName}`, 'success'),
      onError: () => showToast('Failed to assign issues', 'error'),
    });
    clearSelection();
  }, [selectedIds, teamMembers, bulkUpdate, showToast, clearSelection]);

  const handleBulkAssignProject = useCallback((projectId: string | null) => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const count = ids.length;
    const project = projectId ? projects.find(p => p.id === projectId) : null;
    const projectName = project?.title || 'No Project';
    bulkUpdate.mutate({ ids, action: 'update', updates: { belongs_to: projectId ? [{ id: projectId, type: 'project' as const }] : [] } }, {
      onSuccess: () => showToast(`${count} issue${count === 1 ? '' : 's'} assigned to ${projectName}`, 'success'),
      onError: () => showToast('Failed to assign issues to project', 'error'),
    });
    clearSelection();
  }, [selectedIds, projects, bulkUpdate, showToast, clearSelection]);

  // Handle promote to project
  const handlePromoteToProject = useCallback((issue: Issue) => {
    setConvertingIssue(issue);
    setContextMenu(null);
  }, []);

  // Execute the conversion to project
  const executeConversion = useCallback(async () => {
    if (!convertingIssue) return;
    setIsConverting(true);
    try {
      const res = await apiPost(`/api/documents/${convertingIssue.id}/convert`, { target_type: 'project' });
      if (res.ok) {
        const data = await res.json();
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: issueKeys.lists() }),
          queryClient.invalidateQueries({ queryKey: projectKeys.lists() }),
        ]);
        showToast(`Issue promoted to project: ${convertingIssue.title}`, 'success');
        navigate(`/projects/${data.id}`, { replace: true });
      } else {
        const error = await res.json();
        showToast(error.error || 'Failed to convert issue to project', 'error');
        setIsConverting(false);
        setConvertingIssue(null);
      }
    } catch (err) {
      console.error('Failed to convert issue:', err);
      showToast('Failed to convert issue to project', 'error');
      setIsConverting(false);
      setConvertingIssue(null);
    }
  }, [convertingIssue, navigate, showToast, queryClient]);

  // Selection change handler
  const handleSelectionChange = useCallback((newSelectedIds: Set<string>, newSelection: UseSelectionReturn) => {
    setSelectedIds(newSelectedIds);
    selectionRef.current = newSelection;
    forceUpdate(n => n + 1);
  }, []);

  // Global keyboard navigation for j/k and Enter
  useGlobalListNavigation({
    selection: selectionRef.current,
    selectionRef: selectionRef,
    enabled: enableKeyboardNavigation && viewMode === 'list',
    onEnter: useCallback((focusedId: string) => {
      navigate(`/issues/${focusedId}`);
    }, [navigate]),
  });

  // Kanban checkbox click handler
  const handleKanbanCheckboxClick = useCallback((id: string, e: React.MouseEvent) => {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(id)) {
        newSet.delete(id);
      } else {
        newSet.add(id);
      }
      return newSet;
    });
  }, []);

  // Kanban context menu handler
  const handleKanbanContextMenu = useCallback((event: { x: number; y: number; issueId: string }) => {
    if (!selectedIds.has(event.issueId)) {
      setSelectedIds(new Set([event.issueId]));
    }
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

  // Context menu handler for SelectableList
  const handleContextMenu = useCallback((e: React.MouseEvent, _item: Issue, selection: UseSelectionReturn) => {
    selectionRef.current = selection;
    setContextMenu({ x: e.clientX, y: e.clientY, selection });
  }, []);

  // Global keyboard shortcuts
  useEffect(() => {
    if (!onCreateIssue) return;

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
  }, [handleCreateIssue, onCreateIssue]);

  // Render function for issue rows
  const renderIssueRow = useCallback((issue: Issue, { isSelected }: RowRenderProps) => (
    <IssueRowContent issue={issue} isSelected={isSelected} visibleColumns={visibleColumns} />
  ), [visibleColumns]);

  // Default empty state
  const defaultEmptyState = useMemo(() => (
    <div className="text-center">
      <p className="text-muted">No issues found</p>
      {onCreateIssue && (
        <button
          onClick={handleCreateIssue}
          className="mt-2 text-sm text-accent hover:underline"
        >
          Create an issue
        </button>
      )}
    </div>
  ), [handleCreateIssue, onCreateIssue]);

  if (loading) {
    return <IssuesListSkeleton />;
  }

  // Program filter for toolbar (hidden when locked)
  const programFilterContent = showProgramFilter && !lockedProgramId && programOptions.length > 0 ? (
    <div className="w-40">
      <Combobox
        options={programOptions}
        value={programFilter}
        onChange={setProgramFilter}
        placeholder="All Programs"
        aria-label="Filter issues by program"
        id={`${storageKeyPrefix}-program-filter`}
        allowClear={true}
        clearLabel="All Programs"
      />
    </div>
  ) : null;

  // Project filter for toolbar (hidden when locked)
  const projectFilterContent = showProjectFilter && !lockedProjectId && projectOptions.length > 0 ? (
    <div className="w-40">
      <Combobox
        options={projectOptions}
        value={projectFilter}
        onChange={setProjectFilter}
        placeholder="All Projects"
        aria-label="Filter issues by project"
        id={`${storageKeyPrefix}-project-filter`}
        allowClear={true}
        clearLabel="All Projects"
      />
    </div>
  ) : null;

  // Sprint filter for toolbar (hidden when locked)
  const sprintFilterContent = showSprintFilter && !lockedSprintId && sprintOptions.length > 0 ? (
    <div className="w-40">
      <Combobox
        options={sprintOptions}
        value={sprintFilter}
        onChange={setSprintFilter}
        placeholder="All Sprints"
        aria-label="Filter issues by sprint"
        id={`${storageKeyPrefix}-sprint-filter`}
        allowClear={true}
        clearLabel="All Sprints"
      />
    </div>
  ) : null;

  // Combine all filter content
  const combinedFilterContent = (programFilterContent || projectFilterContent || sprintFilterContent || toolbarContent) ? (
    <div className="flex items-center gap-2">
      {programFilterContent}
      {projectFilterContent}
      {sprintFilterContent}
      {toolbarContent}
    </div>
  ) : null;

  return (
    <div className={cn('flex h-full flex-col', className)}>
      {/* Header */}
      {!hideHeader && (
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          {headerContent || <div />}
          <DocumentListToolbar
            sortOptions={SORT_OPTIONS}
            sortBy={sortBy}
            onSortChange={setSortBy}
            viewModes={viewModes}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            allColumns={ALL_COLUMNS}
            visibleColumns={visibleColumns}
            onToggleColumn={toggleColumn}
            hiddenCount={hiddenCount}
            showColumnPicker={viewMode === 'list'}
            filterContent={combinedFilterContent}
            createButton={showCreateButton && onCreateIssue ? {
              label: createButtonLabel,
              onClick: handleCreateIssue
            } : undefined}
          />
        </div>
      )}

      {/* Filter tabs OR Bulk action bar (mutually exclusive) */}
      {selectedIds.size > 0 ? (
        <BulkActionBar
          selectedCount={selectedIds.size}
          onClearSelection={clearSelection}
          onArchive={handleBulkArchive}
          onDelete={handleBulkDelete}
          onChangeStatus={handleBulkChangeStatus}
          onMoveToSprint={handleBulkMoveToSprint}
          onAssign={handleBulkAssign}
          onAssignProject={handleBulkAssignProject}
          teamMembers={teamMembers}
          projects={projects}
          loading={bulkUpdate.isPending}
        />
      ) : filterTabs ? (
        <FilterTabs
          tabs={filterTabs}
          activeId={stateFilter}
          onChange={handleFilterChange}
          ariaLabel="Issue filters"
        />
      ) : null}

      {/* Content */}
      {viewMode === 'kanban' ? (
        <KanbanBoard
          issues={filteredIssues}
          onUpdateIssue={handleUpdateIssue}
          onIssueClick={(id) => navigate(`/issues/${id}`)}
          selectedIds={selectedIds}
          onCheckboxClick={handleKanbanCheckboxClick}
          onContextMenu={handleKanbanContextMenu}
        />
      ) : (
        <div className="flex-1 overflow-auto pb-20">
          <SelectableList
            items={filteredIssues}
            renderRow={renderIssueRow}
            columns={columns}
            emptyState={emptyState || defaultEmptyState}
            onItemClick={(issue) => navigate(`/issues/${issue.id}`)}
            onSelectionChange={handleSelectionChange}
            onContextMenu={handleContextMenu}
            ariaLabel="Issues list"
          />
        </div>
      )}

      {/* Context Menu */}
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
          {showPromoteToProject && contextMenu.selection.selectedCount === 1 && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={() => {
                const selectedId = Array.from(contextMenu.selection.selectedIds)[0];
                const issue = filteredIssues.find(i => i.id === selectedId);
                if (issue) handlePromoteToProject(issue);
              }}>
                <ArrowUpRightIcon className="h-4 w-4" />
                Promote to Project
              </ContextMenuItem>
            </>
          )}
          <ContextMenuSeparator />
          <ContextMenuItem onClick={handleBulkDelete} destructive>
            <TrashIcon className="h-4 w-4" />
            Delete
          </ContextMenuItem>
        </ContextMenu>
      )}

      {/* Conversion confirmation dialog */}
      {convertingIssue && (
        <ConversionDialog
          isOpen={!!convertingIssue}
          onClose={() => setConvertingIssue(null)}
          onConvert={executeConversion}
          sourceType="issue"
          title={convertingIssue.title}
          isConverting={isConverting}
        />
      )}
    </div>
  );
}

/**
 * IssueRowContent - Renders the content cells for an issue row
 */
interface IssueRowContentProps {
  issue: Issue;
  isSelected: boolean;
  visibleColumns: Set<string>;
}

function IssueRowContent({ issue, visibleColumns }: IssueRowContentProps) {
  return (
    <>
      {visibleColumns.has('id') && (
        <td className="px-4 py-3 text-sm text-muted" role="gridcell">
          #{issue.ticket_number}
        </td>
      )}
      {visibleColumns.has('title') && (
        <td className="px-4 py-3 text-sm text-foreground" role="gridcell">
          {issue.title}
        </td>
      )}
      {visibleColumns.has('status') && (
        <td className="px-4 py-3" role="gridcell">
          <StatusBadge state={issue.state} />
        </td>
      )}
      {visibleColumns.has('source') && (
        <td className="px-4 py-3" role="gridcell">
          <SourceBadge source={issue.source} />
        </td>
      )}
      {visibleColumns.has('program') && (
        <td className="px-4 py-3 text-sm text-muted" role="gridcell">
          {getProgramTitle(issue) || '—'}
        </td>
      )}
      {visibleColumns.has('priority') && (
        <td className="px-4 py-3" role="gridcell">
          <PriorityBadge priority={issue.priority} />
        </td>
      )}
      {visibleColumns.has('assignee') && (
        <td className={cn("px-4 py-3 text-sm text-muted", issue.assignee_archived && "opacity-50")} role="gridcell">
          {issue.assignee_name ? (
            <>
              {issue.assignee_name}{issue.assignee_archived && ' (archived)'}
            </>
          ) : 'Unassigned'}
        </td>
      )}
      {visibleColumns.has('updated') && (
        <td className="px-4 py-3 text-sm text-muted" role="gridcell">
          {issue.updated_at ? formatDate(issue.updated_at) : '-'}
        </td>
      )}
    </>
  );
}

// Badge components
export function StatusBadge({ state }: { state: string }) {
  const label = STATE_LABELS[state] || state;
  return (
    <span
      data-status-indicator
      data-status={state}
      aria-label={`Status: ${label}`}
      className={cn('inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-medium whitespace-nowrap', STATUS_COLORS[state] || STATUS_COLORS.backlog)}
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

export function PriorityBadge({ priority }: { priority: string }) {
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
        'inline-flex items-center rounded px-2 py-0.5 text-xs font-medium whitespace-nowrap',
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

// Icons
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

function ArrowUpRightIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 17L17 7M17 7H7M17 7V17" />
    </svg>
  );
}
