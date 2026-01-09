import { useState, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { usePrograms, Program } from '@/contexts/ProgramsContext';
import { SelectableList, RowRenderProps } from '@/components/SelectableList';
import { DocumentListToolbar } from '@/components/DocumentListToolbar';
import { OfflineEmptyState, useOfflineEmptyState } from '@/components/OfflineEmptyState';
import { useColumnVisibility, ColumnDefinition } from '@/hooks/useColumnVisibility';
import { getContrastTextColor } from '@/lib/cn';

// Column definitions for programs list
const ALL_COLUMNS: ColumnDefinition[] = [
  { key: 'name', label: 'Name', hideable: false },
  { key: 'owner', label: 'Owner', hideable: true },
  { key: 'issue_count', label: 'Issues', hideable: true },
  { key: 'sprint_count', label: 'Sprints', hideable: true },
  { key: 'created', label: 'Created', hideable: true },
  { key: 'updated', label: 'Updated', hideable: true },
];

// Sort options
const SORT_OPTIONS = [
  { value: 'name', label: 'Name' },
  { value: 'created', label: 'Created' },
  { value: 'updated', label: 'Updated' },
  { value: 'issue_count', label: 'Issues' },
];

// localStorage key
const COLUMN_VISIBILITY_KEY = 'programs-column-visibility';

export function ProgramsPage() {
  const navigate = useNavigate();
  const { programs, loading, createProgram } = usePrograms();
  const isOfflineEmpty = useOfflineEmptyState(programs, loading);
  const [creating, setCreating] = useState(false);
  const [sortBy, setSortBy] = useState<string>('name');

  // Column visibility
  const {
    visibleColumns,
    columns,
    hiddenCount,
    toggleColumn,
  } = useColumnVisibility({
    columns: ALL_COLUMNS,
    storageKey: COLUMN_VISIBILITY_KEY,
  });

  // Sort programs
  const sortedPrograms = useMemo(() => {
    const sorted = [...programs];
    switch (sortBy) {
      case 'name':
        sorted.sort((a, b) => a.name.localeCompare(b.name));
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
      case 'issue_count':
        sorted.sort((a, b) => (b.issue_count ?? 0) - (a.issue_count ?? 0));
        break;
    }
    return sorted;
  }, [programs, sortBy]);

  const handleCreateProgram = async () => {
    if (creating) return;
    setCreating(true);

    try {
      const program = await createProgram();
      if (program) {
        navigate(`/programs/${program.id}`);
      }
    } catch (err) {
      console.error('Failed to create program:', err);
    } finally {
      setCreating(false);
    }
  };

  // Render function for program rows
  const renderProgramRow = useCallback((program: Program, { isSelected }: RowRenderProps) => (
    <ProgramRowContent program={program} visibleColumns={visibleColumns} />
  ), [visibleColumns]);

  // Empty state
  const emptyState = useMemo(() => (
    <div className="text-center">
      <p className="text-muted">No programs yet</p>
      <button
        onClick={handleCreateProgram}
        disabled={creating}
        className="mt-2 text-sm text-accent hover:underline disabled:opacity-50"
      >
        Create your first program
      </button>
    </div>
  ), [creating, handleCreateProgram]);

  // Show offline empty state when offline with no cached data
  if (isOfflineEmpty) {
    return (
      <div className="flex h-full flex-col items-center justify-center">
        <OfflineEmptyState resourceName="programs" />
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-6 py-4">
        <h1 className="text-xl font-semibold text-foreground">Programs</h1>
        <DocumentListToolbar
          sortOptions={SORT_OPTIONS}
          sortBy={sortBy}
          onSortChange={setSortBy}
          allColumns={ALL_COLUMNS}
          visibleColumns={visibleColumns}
          onToggleColumn={toggleColumn}
          hiddenCount={hiddenCount}
          showColumnPicker={true}
          createButton={{
            label: creating ? 'Creating...' : 'New Program',
            onClick: handleCreateProgram,
          }}
        />
      </div>

      {/* Programs List */}
      <div className="flex-1 overflow-auto">
        <SelectableList
          items={sortedPrograms}
          loading={loading}
          renderRow={renderProgramRow}
          columns={columns}
          emptyState={emptyState}
          onItemClick={(program) => navigate(`/programs/${program.id}`)}
          selectable={false} // Will enable in story 3
          ariaLabel="Programs list"
        />
      </div>
    </div>
  );
}

/**
 * ProgramRowContent - Renders the content cells for a program row
 */
interface ProgramRowContentProps {
  program: Program;
  visibleColumns: Set<string>;
}

function ProgramRowContent({ program, visibleColumns }: ProgramRowContentProps) {
  return (
    <>
      {/* Name (with emoji/color badge) */}
      {visibleColumns.has('name') && (
        <td className="px-4 py-3" role="gridcell">
          <div className="flex items-center gap-3">
            <div
              className="flex h-8 w-8 items-center justify-center rounded-md text-sm flex-shrink-0"
              style={{ backgroundColor: program.color, color: getContrastTextColor(program.color) }}
            >
              {program.emoji || program.name?.[0]?.toUpperCase() || '?'}
            </div>
            <span className="text-sm text-foreground font-medium truncate">{program.name}</span>
          </div>
        </td>
      )}
      {/* Owner */}
      {visibleColumns.has('owner') && (
        <td className="px-4 py-3 text-sm text-muted" role="gridcell">
          {program.owner ? (
            <div className="flex items-center gap-2">
              <div className="flex h-5 w-5 items-center justify-center rounded-full bg-accent text-[10px] font-medium text-white flex-shrink-0">
                {getInitials(program.owner.name)}
              </div>
              <span className="truncate">{program.owner.name}</span>
            </div>
          ) : (
            <span className="text-muted/50">—</span>
          )}
        </td>
      )}
      {/* Issue Count */}
      {visibleColumns.has('issue_count') && (
        <td className="px-4 py-3 text-sm text-muted" role="gridcell">
          {program.issue_count ?? 0}
        </td>
      )}
      {/* Sprint Count */}
      {visibleColumns.has('sprint_count') && (
        <td className="px-4 py-3 text-sm text-muted" role="gridcell">
          {program.sprint_count ?? 0}
        </td>
      )}
      {/* Created */}
      {visibleColumns.has('created') && (
        <td className="px-4 py-3 text-sm text-muted" role="gridcell">
          {program.created_at ? formatDate(program.created_at) : '—'}
        </td>
      )}
      {/* Updated */}
      {visibleColumns.has('updated') && (
        <td className="px-4 py-3 text-sm text-muted" role="gridcell">
          {program.updated_at ? formatDate(program.updated_at) : '—'}
        </td>
      )}
    </>
  );
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map(part => part[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
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
