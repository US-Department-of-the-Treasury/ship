import { useState, useMemo, useCallback } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useDocuments, WikiDocument } from '@/contexts/DocumentsContext';
import { buildDocumentTree } from '@/lib/documentTree';
import { DocumentTreeItem } from '@/components/DocumentTreeItem';
import { DocumentsListSkeleton } from '@/components/ui/Skeleton';
import { OfflineEmptyState, useOfflineEmptyState } from '@/components/OfflineEmptyState';
import { useToast } from '@/components/ui/Toast';
import { getPendingMutations, removePendingMutation } from '@/lib/queryClient';
import { useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/cn';
import { SelectableList, RowRenderProps, UseSelectionReturn } from '@/components/SelectableList';
import { useColumnVisibility, ColumnDefinition } from '@/hooks/useColumnVisibility';
import { DocumentListToolbar } from '@/components/DocumentListToolbar';
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from '@/components/ui/ContextMenu';

// View mode type
type ViewMode = 'tree' | 'list';

// Column definitions for list view
const ALL_COLUMNS: ColumnDefinition[] = [
  { key: 'title', label: 'Title', hideable: false },
  { key: 'visibility', label: 'Visibility', hideable: true },
  { key: 'created_by', label: 'Created By', hideable: true },
  { key: 'created', label: 'Created', hideable: true },
  { key: 'updated', label: 'Updated', hideable: true },
];

// Sort options for list view
const SORT_OPTIONS = [
  { value: 'title', label: 'Title' },
  { value: 'created', label: 'Created' },
  { value: 'updated', label: 'Updated' },
];

// localStorage keys
const VIEW_MODE_KEY = 'documents-view-mode';
const COLUMN_VISIBILITY_KEY = 'documents-column-visibility';

type VisibilityFilter = 'all' | 'workspace' | 'private';

export function DocumentsPage() {
  const { documents, loading, createDocument, deleteDocument } = useDocuments();
  const isOfflineEmpty = useOfflineEmptyState(documents, loading);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const queryClient = useQueryClient();

  // View mode state with localStorage persistence (default to tree)
  const [viewMode, setViewModeState] = useState<ViewMode>(() => {
    try {
      const stored = localStorage.getItem(VIEW_MODE_KEY);
      if (stored === 'list' || stored === 'tree') {
        return stored;
      }
    } catch {
      // Ignore localStorage errors
    }
    return 'tree'; // Default to tree view
  });

  const setViewMode = useCallback((mode: ViewMode) => {
    setViewModeState(mode);
    try {
      localStorage.setItem(VIEW_MODE_KEY, mode);
    } catch {
      // Ignore localStorage errors
    }
  }, []);

  // Sort state for list view
  const [sortBy, setSortBy] = useState<string>('title');

  // Selection state for list view
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Context menu state for list view
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; selection: UseSelectionReturn } | null>(null);

  // Column visibility for list view
  const {
    visibleColumns,
    columns,
    hiddenCount,
    toggleColumn,
  } = useColumnVisibility({
    columns: ALL_COLUMNS,
    storageKey: COLUMN_VISIBILITY_KEY,
  });

  // Get filter from URL params
  const filterParam = searchParams.get('filter');
  const visibilityFilter: VisibilityFilter =
    filterParam === 'workspace' || filterParam === 'private' ? filterParam : 'all';

  // Filter documents by visibility and search
  const filteredDocuments = useMemo(() => {
    let filtered = documents;

    // Filter by visibility
    if (visibilityFilter === 'workspace') {
      filtered = filtered.filter(d => d.visibility !== 'private');
    } else if (visibilityFilter === 'private') {
      filtered = filtered.filter(d => d.visibility === 'private');
    }

    // Filter by search
    if (search.trim()) {
      const searchLower = search.toLowerCase();
      filtered = filtered.filter(d =>
        d.title.toLowerCase().includes(searchLower)
      );
    }

    return filtered;
  }, [documents, visibilityFilter, search]);

  // Build tree structure from filtered documents (for tree view)
  const documentTree = useMemo(() => buildDocumentTree(filteredDocuments), [filteredDocuments]);

  // Sort documents for list view
  const sortedDocuments = useMemo(() => {
    if (viewMode !== 'list') return filteredDocuments;

    const sorted = [...filteredDocuments];
    switch (sortBy) {
      case 'title':
        sorted.sort((a, b) => a.title.localeCompare(b.title));
        break;
      case 'created':
        sorted.sort((a, b) => {
          const aDate = a.created_at ? new Date(a.created_at).getTime() : 0;
          const bDate = b.created_at ? new Date(b.created_at).getTime() : 0;
          return bDate - aDate; // Newest first
        });
        break;
      case 'updated':
        sorted.sort((a, b) => {
          const aDate = a.updated_at ? new Date(a.updated_at).getTime() : 0;
          const bDate = b.updated_at ? new Date(b.updated_at).getTime() : 0;
          return bDate - aDate; // Newest first
        });
        break;
    }
    return sorted;
  }, [filteredDocuments, sortBy, viewMode]);

  // Render function for document rows in list view
  const renderDocumentRow = useCallback((doc: WikiDocument, { isSelected }: RowRenderProps) => (
    <DocumentRowContent document={doc} visibleColumns={visibleColumns} />
  ), [visibleColumns]);

  async function handleCreateDocument(parentId?: string) {
    setCreating(true);
    try {
      const doc = await createDocument(parentId);
      if (doc) {
        navigate(`/docs/${doc.id}`);
      }
    } finally {
      setCreating(false);
    }
  }

  function handleFilterChange(filter: VisibilityFilter) {
    if (filter === 'all') {
      searchParams.delete('filter');
    } else {
      searchParams.set('filter', filter);
    }
    setSearchParams(searchParams);
  }

  // Delete with undo support
  const handleDeleteWithUndo = useCallback(async (id: string) => {
    // Find the document before deleting to enable undo
    const docToDelete = documents.find(d => d.id === id);
    if (!docToDelete) return;

    // Perform the delete
    const success = await deleteDocument(id);
    if (!success) return;

    // Show toast with undo action
    showToast(
      `"${docToDelete.title || 'Untitled'}" deleted`,
      'info',
      5000,
      {
        label: 'Undo',
        onClick: () => {
          // Find and remove the pending delete mutation
          const pendingMutations = getPendingMutations();
          const deleteMutation = pendingMutations.find(
            m => m.type === 'delete' && m.resource === 'document' && m.resourceId === id
          );
          if (deleteMutation) {
            removePendingMutation(deleteMutation.id);
          }

          // Restore the document to the query cache
          queryClient.setQueryData<WikiDocument[]>(
            ['documents', 'wiki'],
            (old) => old ? [docToDelete, ...old] : [docToDelete]
          );
        }
      }
    );
  }, [documents, deleteDocument, showToast, queryClient]);

  // Bulk delete handler
  const handleBulkDelete = useCallback(async () => {
    const idsToDelete = Array.from(selectedIds);
    if (idsToDelete.length === 0) return;

    const count = idsToDelete.length;
    const docsToDelete = documents.filter(d => selectedIds.has(d.id));

    // Delete all selected documents
    await Promise.all(idsToDelete.map(id => deleteDocument(id)));

    // Clear selection and context menu
    setSelectedIds(new Set());
    setContextMenu(null);

    // Show toast with undo
    showToast(
      `${count} document${count === 1 ? '' : 's'} deleted`,
      'info',
      5000,
      {
        label: 'Undo',
        onClick: () => {
          // Remove pending delete mutations
          const pendingMutations = getPendingMutations();
          idsToDelete.forEach(id => {
            const deleteMutation = pendingMutations.find(
              m => m.type === 'delete' && m.resource === 'document' && m.resourceId === id
            );
            if (deleteMutation) {
              removePendingMutation(deleteMutation.id);
            }
          });

          // Restore documents to cache
          queryClient.setQueryData<WikiDocument[]>(
            ['documents', 'wiki'],
            (old) => old ? [...docsToDelete, ...old] : docsToDelete
          );
        }
      }
    );
  }, [selectedIds, documents, deleteDocument, showToast, queryClient]);

  // Context menu handler
  const handleContextMenu = useCallback((e: React.MouseEvent, _item: WikiDocument, selection: UseSelectionReturn) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, selection });
  }, []);

  // Show offline empty state when offline with no cached data
  if (isOfflineEmpty) {
    return (
      <div className="p-6">
        <OfflineEmptyState resourceName="documents" />
      </div>
    );
  }

  if (loading) {
    return <DocumentsListSkeleton />;
  }

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-lg font-medium text-foreground">Documents</h1>
        <button
          onClick={() => handleCreateDocument()}
          disabled={creating}
          className={cn(
            'rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white',
            'transition-colors hover:bg-accent/90',
            'disabled:opacity-50',
            'focus:outline-none focus:ring-2 focus:ring-accent focus:ring-offset-2 focus:ring-offset-background'
          )}
        >
          {creating ? 'Creating...' : 'New Document'}
        </button>
      </div>

      {/* Search and Filter */}
      <div className="mb-6 flex gap-4">
        {/* Search */}
        <div className="flex-1">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search documents..."
            className={cn(
              'w-full rounded-md border border-border bg-background px-3 py-2 text-sm',
              'placeholder:text-muted',
              'focus:outline-none focus:ring-1 focus:ring-accent'
            )}
          />
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 rounded-md border border-border p-1">
          <FilterTab
            label="All"
            active={visibilityFilter === 'all'}
            onClick={() => handleFilterChange('all')}
          />
          <FilterTab
            label="Workspace"
            icon={<GlobeIcon className="h-3.5 w-3.5" />}
            active={visibilityFilter === 'workspace'}
            onClick={() => handleFilterChange('workspace')}
          />
          <FilterTab
            label="Private"
            icon={<LockIcon className="h-3.5 w-3.5" />}
            active={visibilityFilter === 'private'}
            onClick={() => handleFilterChange('private')}
          />
        </div>

        {/* View toggle */}
        <div className="flex gap-1 rounded-md border border-border p-1">
          <button
            onClick={() => setViewMode('tree')}
            className={cn(
              'flex items-center gap-1.5 rounded px-2.5 py-1 text-sm transition-colors',
              viewMode === 'tree'
                ? 'bg-border text-foreground'
                : 'text-muted hover:bg-border/50 hover:text-foreground'
            )}
            title="Tree view"
          >
            <TreeIcon className="h-3.5 w-3.5" />
            Tree
          </button>
          <button
            onClick={() => setViewMode('list')}
            className={cn(
              'flex items-center gap-1.5 rounded px-2.5 py-1 text-sm transition-colors',
              viewMode === 'list'
                ? 'bg-border text-foreground'
                : 'text-muted hover:bg-border/50 hover:text-foreground'
            )}
            title="List view"
          >
            <ListIcon className="h-3.5 w-3.5" />
            List
          </button>
        </div>
      </div>

      {/* List view toolbar (sort, column picker) */}
      {viewMode === 'list' && (
        <div className="mb-4">
          <DocumentListToolbar
            sortOptions={SORT_OPTIONS}
            sortBy={sortBy}
            onSortChange={setSortBy}
            allColumns={ALL_COLUMNS}
            visibleColumns={visibleColumns}
            onToggleColumn={toggleColumn}
            hiddenCount={hiddenCount}
            showColumnPicker={true}
          />
        </div>
      )}

      {/* Bulk action bar for list view */}
      {viewMode === 'list' && selectedIds.size > 0 && (
        <DocumentBulkActionBar
          selectedCount={selectedIds.size}
          onDelete={handleBulkDelete}
          onClearSelection={() => setSelectedIds(new Set())}
        />
      )}

      {/* Document list */}
      {filteredDocuments.length === 0 ? (
        <div className="flex h-64 items-center justify-center">
          <div className="text-center">
            {documents.length === 0 ? (
              <>
                <p className="text-muted">No documents yet</p>
                <p className="mt-1 text-sm text-muted">
                  Create your first document to get started
                </p>
              </>
            ) : (
              <>
                <p className="text-muted">No documents found</p>
                <p className="mt-1 text-sm text-muted">
                  Try adjusting your search or filter
                </p>
              </>
            )}
          </div>
        </div>
      ) : viewMode === 'tree' ? (
        <ul role="tree" aria-label="Documents" className="space-y-0.5">
          {documentTree.map((doc) => (
            <DocumentTreeItem
              key={doc.id}
              document={doc}
              onCreateChild={handleCreateDocument}
              onDelete={handleDeleteWithUndo}
            />
          ))}
        </ul>
      ) : (
        <>
          <div className="rounded-lg border border-border overflow-hidden">
            <SelectableList
              items={sortedDocuments}
              getItemId={(doc) => doc.id}
              renderRow={(doc, props) => renderDocumentRow(doc, props)}
              columns={columns}
              onItemClick={(doc) => navigate(`/docs/${doc.id}`)}
              selectable={true}
              onSelectionChange={(ids) => setSelectedIds(ids)}
              onContextMenu={handleContextMenu}
              ariaLabel="Documents list"
            />
          </div>

          {/* Context menu */}
          {contextMenu && (
            <ContextMenu x={contextMenu.x} y={contextMenu.y} onClose={() => setContextMenu(null)}>
              <ContextMenuItem onClick={handleBulkDelete} destructive>
                <TrashIcon className="h-4 w-4" />
                Delete {selectedIds.size > 1 ? `${selectedIds.size} documents` : 'document'}
              </ContextMenuItem>
            </ContextMenu>
          )}
        </>
      )}
    </div>
  );
}

function FilterTab({
  label,
  icon,
  active,
  onClick
}: {
  label: string;
  icon?: React.ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 rounded px-2.5 py-1 text-sm transition-colors',
        active
          ? 'bg-border text-foreground'
          : 'text-muted hover:bg-border/50 hover:text-foreground'
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg className={className || 'h-4 w-4'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
      />
    </svg>
  );
}

function GlobeIcon({ className }: { className?: string }) {
  return (
    <svg className={className || 'h-4 w-4'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9"
      />
    </svg>
  );
}

function TreeIcon({ className }: { className?: string }) {
  return (
    <svg className={className || 'h-4 w-4'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M3 7h4m0 0V3m0 4l4 4m-4-4l4-4M3 17h4m0 0v-4m0 4l4 4m-4-4l4-4M13 7h8M13 12h8M13 17h8"
      />
    </svg>
  );
}

function ListIcon({ className }: { className?: string }) {
  return (
    <svg className={className || 'h-4 w-4'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M4 6h16M4 12h16M4 18h16"
      />
    </svg>
  );
}

function DocumentRowContent({ document, visibleColumns }: { document: WikiDocument; visibleColumns: Set<string> }) {
  return (
    <>
      {/* Title */}
      {visibleColumns.has('title') && (
        <td className="px-4 py-3 text-sm font-medium text-foreground" role="gridcell">
          {document.title || 'Untitled'}
        </td>
      )}
      {/* Visibility */}
      {visibleColumns.has('visibility') && (
        <td className="px-4 py-3" role="gridcell">
          <span className={cn(
            'inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs',
            document.visibility === 'private'
              ? 'bg-amber-500/10 text-amber-600'
              : 'bg-blue-500/10 text-blue-600'
          )}>
            {document.visibility === 'private' ? (
              <LockIcon className="h-3 w-3" />
            ) : (
              <GlobeIcon className="h-3 w-3" />
            )}
            {document.visibility === 'private' ? 'Private' : 'Workspace'}
          </span>
        </td>
      )}
      {/* Created By */}
      {visibleColumns.has('created_by') && (
        <td className="px-4 py-3 text-sm text-muted" role="gridcell">
          {document.created_by || '-'}
        </td>
      )}
      {/* Created */}
      {visibleColumns.has('created') && (
        <td className="px-4 py-3 text-sm text-muted" role="gridcell">
          {document.created_at
            ? new Date(document.created_at).toLocaleDateString()
            : '-'}
        </td>
      )}
      {/* Updated */}
      {visibleColumns.has('updated') && (
        <td className="px-4 py-3 text-sm text-muted" role="gridcell">
          {document.updated_at
            ? new Date(document.updated_at).toLocaleDateString()
            : '-'}
        </td>
      )}
    </>
  );
}

function TrashIcon({ className }: { className?: string }) {
  return (
    <svg className={className || 'h-4 w-4'} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
      />
    </svg>
  );
}

/**
 * DocumentBulkActionBar - Bulk action bar for documents (Delete only for now)
 */
interface DocumentBulkActionBarProps {
  selectedCount: number;
  onDelete: () => void;
  onClearSelection: () => void;
}

function DocumentBulkActionBar({
  selectedCount,
  onDelete,
  onClearSelection,
}: DocumentBulkActionBarProps) {
  return (
    <div className="mb-4 flex items-center gap-3 rounded-lg border border-border bg-background/80 px-4 py-2 shadow-sm">
      <span className="text-sm text-muted">
        {selectedCount} selected
      </span>
      <div className="h-4 w-px bg-border" />
      <button
        onClick={onDelete}
        className="flex items-center gap-1.5 rounded px-2 py-1 text-sm text-red-600 hover:bg-red-50 transition-colors"
      >
        <TrashIcon className="h-4 w-4" />
        Delete
      </button>
      <div className="flex-1" />
      <button
        onClick={onClearSelection}
        className="text-sm text-muted hover:text-foreground transition-colors"
      >
        Clear selection
      </button>
    </div>
  );
}
