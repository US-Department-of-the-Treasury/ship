import { useState, useMemo } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { useDocuments } from '@/contexts/DocumentsContext';
import { buildDocumentTree } from '@/lib/documentTree';
import { DocumentTreeItem } from '@/components/DocumentTreeItem';
import { DocumentsListSkeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/cn';

type VisibilityFilter = 'all' | 'workspace' | 'private';

export function DocumentsPage() {
  const { documents, loading, createDocument } = useDocuments();
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

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

  // Build tree structure from filtered documents
  const documentTree = useMemo(() => buildDocumentTree(filteredDocuments), [filteredDocuments]);

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

  if (loading) {
    return <DocumentsListSkeleton />;
  }

  return (
    <div className="p-6 max-w-4xl">
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
      </div>

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
      ) : (
        <div className="space-y-0.5">
          {documentTree.map((doc) => (
            <DocumentTreeItem
              key={doc.id}
              document={doc}
              onCreateChild={handleCreateDocument}
            />
          ))}
        </div>
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
