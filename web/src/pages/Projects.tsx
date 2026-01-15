import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { SelectableList, RowRenderProps, UseSelectionReturn } from '@/components/SelectableList';
import { DocumentListToolbar } from '@/components/DocumentListToolbar';
import { useProjects, Project } from '@/contexts/ProjectsContext';
import { usePrograms } from '@/contexts/ProgramsContext';
import { useAuth } from '@/hooks/useAuth';
import { useColumnVisibility, ColumnDefinition } from '@/hooks/useColumnVisibility';
import { useListFilters } from '@/hooks/useListFilters';
import { IssuesListSkeleton } from '@/components/ui/Skeleton';
import { OfflineEmptyState, useOfflineEmptyState } from '@/components/OfflineEmptyState';
import { Combobox } from '@/components/ui/Combobox';
import { useToast } from '@/components/ui/Toast';
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from '@/components/ui/ContextMenu';
import { FilterTabs } from '@/components/FilterTabs';
import { cn } from '@/lib/cn';

// All available columns with metadata
const ALL_COLUMNS: ColumnDefinition[] = [
  { key: 'title', label: 'Title', hideable: false }, // Cannot hide title
  { key: 'impact', label: 'I', hideable: true },
  { key: 'confidence', label: 'C', hideable: true },
  { key: 'ease', label: 'E', hideable: true },
  { key: 'score', label: 'Score', hideable: true },
  { key: 'program', label: 'Program', hideable: true },
  { key: 'owner', label: 'Owner', hideable: true },
  { key: 'updated', label: 'Updated', hideable: true },
];

const SORT_OPTIONS = [
  { value: 'ice_score', label: 'ICE Score' },
  { value: 'impact', label: 'Impact' },
  { value: 'confidence', label: 'Confidence' },
  { value: 'ease', label: 'Ease' },
  { value: 'title', label: 'Title' },
  { value: 'updated', label: 'Updated' },
];

export function ProjectsPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const { projects: allProjects, loading, createProject, updateProject, deleteProject, refreshProjects } = useProjects();
  const { programs } = usePrograms();
  const isOfflineEmpty = useOfflineEmptyState(allProjects, loading);
  const { showToast } = useToast();

  // Use shared hooks for list state management
  const { sortBy, setSortBy, viewMode, setViewMode } = useListFilters({
    sortOptions: SORT_OPTIONS,
    defaultSort: 'ice_score',
  });

  const { visibleColumns, columns, hiddenCount, toggleColumn } = useColumnVisibility({
    columns: ALL_COLUMNS,
    storageKey: 'projects-column-visibility',
  });

  const [programFilter, setProgramFilter] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; selection: UseSelectionReturn } | null>(null);

  // Track selection state for BulkActionBar
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const selectionRef = useRef<UseSelectionReturn | null>(null);

  const statusFilter = searchParams.get('status') || '';

  // Compute unique programs from projects for the filter dropdown
  const programOptions = useMemo(() => {
    return programs.map(p => ({ value: p.id, label: p.name }))
      .sort((a, b) => a.label.localeCompare(b.label));
  }, [programs]);

  // Get program name lookup
  const programNameById = useMemo(() => {
    const map = new Map<string, string>();
    programs.forEach(p => map.set(p.id, p.name));
    return map;
  }, [programs]);

  // Filter projects client-side based on status filter AND program filter
  const filteredProjects = useMemo(() => {
    let filtered = allProjects;

    // Apply program filter
    if (programFilter) {
      filtered = filtered.filter(project => project.program_id === programFilter);
    }

    // Apply status filter
    if (statusFilter === 'active') {
      filtered = filtered.filter(project => !project.archived_at);
    } else if (statusFilter === 'archived') {
      filtered = filtered.filter(project => project.archived_at);
    }
    // 'all' or empty = no status filter

    return filtered;
  }, [allProjects, statusFilter, programFilter]);

  // Sort projects
  const projects = useMemo(() => {
    const sorted = [...filteredProjects];

    sorted.sort((a, b) => {
      switch (sortBy) {
        case 'ice_score':
          return b.ice_score - a.ice_score; // Descending
        case 'impact':
          return b.impact - a.impact; // Descending
        case 'confidence':
          return b.confidence - a.confidence; // Descending
        case 'ease':
          return b.ease - a.ease; // Descending
        case 'title':
          return a.title.localeCompare(b.title); // Ascending
        case 'updated':
          return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(); // Descending
        default:
          return b.ice_score - a.ice_score;
      }
    });

    return sorted;
  }, [filteredProjects, sortBy]);

  const handleCreateProject = useCallback(async () => {
    if (!user?.id) {
      showToast('You must be logged in to create a project', 'error');
      return;
    }
    const project = await createProject({ owner_id: user.id });
    if (project) {
      navigate(`/projects/${project.id}`);
    }
  }, [createProject, navigate, user, showToast]);

  const setFilter = (status: string) => {
    setSearchParams((prev) => {
      if (status) {
        prev.set('status', status);
      } else {
        prev.delete('status');
      }
      return prev;
    });
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
  }, [statusFilter, clearSelection]);

  // Bulk action handlers
  const handleBulkArchive = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const count = ids.length;

    // Archive each project
    let success = 0;
    for (const id of ids) {
      const result = await updateProject(id, { archived_at: new Date().toISOString() } as any);
      if (result) success++;
    }

    if (success > 0) {
      showToast(
        `${success} project${success === 1 ? '' : 's'} archived`,
        'success',
        5000,
        {
          label: 'Undo',
          onClick: async () => {
            for (const id of ids) {
              await updateProject(id, { archived_at: null } as any);
            }
            showToast('Archive undone', 'info');
            refreshProjects();
          },
        }
      );
    }
    clearSelection();
  }, [selectedIds, updateProject, showToast, clearSelection, refreshProjects]);

  const handleBulkDelete = useCallback(async () => {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    const count = ids.length;

    let success = 0;
    for (const id of ids) {
      const result = await deleteProject(id);
      if (result) success++;
    }

    if (success > 0) {
      showToast(`${success} project${success === 1 ? '' : 's'} deleted`, 'success');
    }
    clearSelection();
  }, [selectedIds, deleteProject, showToast, clearSelection]);

  // Selection change handler - keeps parent state in sync with SelectableList
  const handleSelectionChange = useCallback((newSelectedIds: Set<string>, selection: UseSelectionReturn) => {
    setSelectedIds(newSelectedIds);
    selectionRef.current = selection;
  }, []);

  // Context menu handler - receives selection from SelectableList
  const handleContextMenu = useCallback((e: React.MouseEvent, _item: Project, selection: UseSelectionReturn) => {
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

      // "c" to create project
      if (e.key === 'c' && !e.metaKey && !e.ctrlKey) {
        e.preventDefault();
        handleCreateProject();
      }
    };

    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [handleCreateProject]);

  // Render function for project rows
  const renderProjectRow = useCallback((project: Project, { isSelected }: RowRenderProps) => (
    <ProjectRowContent project={project} isSelected={isSelected} visibleColumns={visibleColumns} programNameById={programNameById} />
  ), [visibleColumns, programNameById]);

  // Empty state for the list
  const emptyState = useMemo(() => (
    <div className="text-center">
      <p className="text-muted">No projects yet</p>
      <button
        onClick={handleCreateProject}
        className="mt-2 text-sm text-accent hover:underline"
      >
        Create your first project
      </button>
    </div>
  ), [handleCreateProject]);

  // Show offline empty state when offline with no cached data
  if (isOfflineEmpty) {
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <OfflineEmptyState resourceName="projects" />
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
        aria-label="Filter projects by program"
        id="projects-program-filter"
        allowClear={true}
        clearLabel="All Programs"
      />
    </div>
  ) : null;

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <h1 className="text-xl font-semibold text-foreground">Projects</h1>
        <DocumentListToolbar
          sortOptions={SORT_OPTIONS}
          sortBy={sortBy}
          onSortChange={setSortBy}
          viewModes={['list']}
          viewMode={viewMode}
          onViewModeChange={setViewMode}
          allColumns={ALL_COLUMNS}
          visibleColumns={visibleColumns}
          onToggleColumn={toggleColumn}
          hiddenCount={hiddenCount}
          showColumnPicker={true}
          filterContent={programFilterContent}
          createButton={{ label: 'New Project', onClick: handleCreateProject }}
        />
      </div>

      {/* Filter tabs OR Bulk action bar (mutually exclusive) */}
      {selectedIds.size > 0 ? (
        <ProjectsBulkActionBar
          selectedCount={selectedIds.size}
          onClearSelection={clearSelection}
          onArchive={handleBulkArchive}
          onDelete={handleBulkDelete}
        />
      ) : (
        <FilterTabs
          tabs={[
            { id: '', label: 'All' },
            { id: 'active', label: 'Active' },
            { id: 'archived', label: 'Archived' },
          ]}
          activeId={statusFilter}
          onChange={setFilter}
          ariaLabel="Project filters"
        />
      )}

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <SelectableList
          items={projects}
          renderRow={renderProjectRow}
          columns={columns}
          emptyState={emptyState}
          onItemClick={(project) => navigate(`/projects/${project.id}`)}
          onSelectionChange={handleSelectionChange}
          onContextMenu={handleContextMenu}
          ariaLabel="Projects list"
        />
      </div>

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
 * ProjectRowContent - Renders the content cells for a project row
 * Used by SelectableList which handles the <tr>, checkbox, and selection state
 */
interface ProjectRowContentProps {
  project: Project;
  isSelected: boolean;
  visibleColumns: Set<string>;
  programNameById: Map<string, string>;
}

function ProjectRowContent({ project, visibleColumns, programNameById }: ProjectRowContentProps) {
  return (
    <>
      {/* Title with color dot */}
      {visibleColumns.has('title') && (
        <td className="px-4 py-3 text-sm text-foreground" role="gridcell">
          <div className="flex items-center gap-2">
            <div
              className="h-2.5 w-2.5 rounded-full flex-shrink-0"
              style={{ backgroundColor: project.color || '#6366f1' }}
              aria-hidden="true"
            />
            <span className={project.archived_at ? 'text-muted line-through' : ''}>
              {project.title}
            </span>
            {project._pending && (
              <span className="text-xs text-muted">(saving...)</span>
            )}
            {project.is_complete === false && (
              <span className="inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-medium bg-orange-500/10 text-orange-500 border border-orange-500/20 whitespace-nowrap">
                Incomplete
              </span>
            )}
          </div>
        </td>
      )}
      {/* Impact */}
      {visibleColumns.has('impact') && (
        <td className="px-4 py-3 text-sm text-center" role="gridcell">
          <ICEBadge value={project.impact} />
        </td>
      )}
      {/* Confidence */}
      {visibleColumns.has('confidence') && (
        <td className="px-4 py-3 text-sm text-center" role="gridcell">
          <ICEBadge value={project.confidence} />
        </td>
      )}
      {/* Ease */}
      {visibleColumns.has('ease') && (
        <td className="px-4 py-3 text-sm text-center" role="gridcell">
          <ICEBadge value={project.ease} />
        </td>
      )}
      {/* ICE Score */}
      {visibleColumns.has('score') && (
        <td className="px-4 py-3 text-sm text-center font-medium" role="gridcell">
          <span className="inline-flex items-center justify-center rounded bg-accent/20 px-2 py-0.5 text-accent whitespace-nowrap">
            {project.ice_score}
          </span>
        </td>
      )}
      {/* Program */}
      {visibleColumns.has('program') && (
        <td className="px-4 py-3 text-sm text-muted" role="gridcell">
          {project.program_id ? programNameById.get(project.program_id) || '—' : '—'}
        </td>
      )}
      {/* Owner */}
      {visibleColumns.has('owner') && (
        <td className="px-4 py-3 text-sm text-muted" role="gridcell">
          {project.owner?.name || 'Unassigned'}
        </td>
      )}
      {/* Updated */}
      {visibleColumns.has('updated') && (
        <td className="px-4 py-3 text-sm text-muted" role="gridcell">
          {project.updated_at ? formatDate(project.updated_at) : '-'}
        </td>
      )}
    </>
  );
}

function ICEBadge({ value }: { value: number }) {
  const colors = {
    1: 'text-red-400',
    2: 'text-orange-400',
    3: 'text-yellow-400',
    4: 'text-lime-400',
    5: 'text-green-400',
  };
  return (
    <span className={cn('font-medium', colors[value as keyof typeof colors] || 'text-muted')}>
      {value}
    </span>
  );
}

interface ProjectsBulkActionBarProps {
  selectedCount: number;
  onClearSelection: () => void;
  onArchive: () => void;
  onDelete: () => void;
}

function ProjectsBulkActionBar({
  selectedCount,
  onClearSelection,
  onArchive,
  onDelete,
}: ProjectsBulkActionBarProps) {
  if (selectedCount === 0) {
    return null;
  }

  return (
    <div
      role="region"
      aria-label="Bulk actions"
      aria-live="polite"
      className={cn(
        'flex items-center gap-3 border-b border-accent/30 bg-accent/10 px-6 py-2',
        'animate-in slide-in-from-top-2 fade-in duration-150'
      )}
    >
      {/* Selection count */}
      <span className="text-sm font-medium text-foreground">
        {selectedCount} selected
      </span>

      <div className="h-4 w-px bg-border" aria-hidden="true" />

      {/* Archive button */}
      <button
        onClick={onArchive}
        className="flex items-center gap-1.5 rounded px-2.5 py-1.5 text-sm font-medium text-muted hover:bg-border/50 hover:text-foreground transition-colors"
      >
        <ArchiveIcon className="h-4 w-4" />
        Archive
      </button>

      {/* Delete button */}
      <button
        onClick={onDelete}
        className="flex items-center gap-1.5 rounded px-2.5 py-1.5 text-sm font-medium text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors"
      >
        <TrashIcon className="h-4 w-4" />
        Delete
      </button>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Clear selection */}
      <button
        onClick={onClearSelection}
        className="flex items-center gap-1.5 rounded px-2 py-1 text-sm text-muted hover:bg-border/50 hover:text-foreground transition-colors"
        aria-label="Clear selection"
      >
        <XIcon className="h-4 w-4" />
        Clear
      </button>
    </div>
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

function XIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 18L18 6M6 6l12 12" />
    </svg>
  );
}
