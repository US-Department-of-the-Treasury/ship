import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { CardGrid } from '@/components/CardGrid';
import { ContextMenu, ContextMenuItem, ContextMenuSeparator } from '@/components/ui/ContextMenu';
import { useAuth } from '@/hooks/useAuth';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { api } from '@/lib/api';
import { useToast } from '@/components/ui/Toast';
import { cn } from '@/lib/cn';

const API_URL = import.meta.env.VITE_API_URL ?? '';

interface Person {
  id: string;       // Document ID (for navigation)
  user_id: string;  // User ID (for backend operations)
  name: string;
  email: string;
}

export function TeamDirectoryPage() {
  const navigate = useNavigate();
  const { isSuperAdmin } = useAuth();
  const { currentWorkspace } = useWorkspace();
  const { showToast } = useToast();
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; person: Person } | null>(null);

  useEffect(() => {
    async function fetchPeople() {
      try {
        const response = await fetch(`${API_URL}/api/team/people`, {
          credentials: 'include',
        });
        if (response.ok) {
          const data = await response.json();
          setPeople(data);
        }
      } catch (error) {
        console.error('Failed to fetch people:', error);
      } finally {
        setLoading(false);
      }
    }
    fetchPeople();
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent, person: Person) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, person });
  }, []);

  const handleMenuClick = useCallback((e: React.MouseEvent, person: Person) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setContextMenu({ x: rect.right, y: rect.bottom, person });
  }, []);

  const handleViewProfile = useCallback(() => {
    if (contextMenu) {
      navigate(`/team/${contextMenu.person.id}`);
      setContextMenu(null);
    }
  }, [contextMenu, navigate]);

  const handleEditCapacity = useCallback(() => {
    if (contextMenu) {
      navigate(`/team/${contextMenu.person.id}`);
      setContextMenu(null);
    }
  }, [contextMenu, navigate]);

  const handleRemoveMember = useCallback(async () => {
    if (!contextMenu || !currentWorkspace) return;

    const confirmed = window.confirm(`Are you sure you want to remove ${contextMenu.person.name} from this workspace? This action cannot be undone.`);
    if (!confirmed) {
      setContextMenu(null);
      return;
    }

    try {
      const result = await api.workspaces.removeMember(currentWorkspace.id, contextMenu.person.user_id);
      if (result.success) {
        setPeople(prev => prev.filter(p => p.id !== contextMenu.person.id));
        showToast(`${contextMenu.person.name} removed from workspace`, 'success');
      } else {
        showToast('Failed to remove member', 'error');
      }
    } catch (error) {
      showToast('Failed to remove member', 'error');
    }
    setContextMenu(null);
  }, [contextMenu, currentWorkspace, showToast]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex h-12 items-center border-b border-border px-6">
        <h1 className="text-lg font-medium text-foreground">Team Directory</h1>
        {!loading && <span className="ml-2 text-sm text-muted">({people.length} members)</span>}
      </div>

      {/* List */}
      <div className="flex-1 overflow-auto p-6">
        <CardGrid
          items={people}
          loading={loading}
          columns={{ sm: 1, md: 2, lg: 3, xl: 4 }}
          gap={3}
          renderCard={(person) => (
            <PersonCard
              person={person}
              onContextMenu={(e) => handleContextMenu(e, person)}
              onMenuClick={(e) => handleMenuClick(e, person)}
            />
          )}
          onItemClick={(person) => navigate(`/team/${person.id}`)}
          emptyState={
            <div className="text-center">
              <h2 className="text-xl font-medium text-foreground">No team members</h2>
              <p className="mt-1 text-sm text-muted">Team members will appear here once added</p>
            </div>
          }
        />
      </div>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu x={contextMenu.x} y={contextMenu.y} onClose={() => setContextMenu(null)}>
          <ContextMenuItem onClick={handleViewProfile}>
            <UserIcon className="h-4 w-4" />
            View profile
          </ContextMenuItem>
          <ContextMenuItem onClick={handleEditCapacity}>
            <CapacityIcon className="h-4 w-4" />
            Edit capacity
          </ContextMenuItem>
          {isSuperAdmin && (
            <>
              <ContextMenuSeparator />
              <ContextMenuItem onClick={handleRemoveMember} destructive>
                <RemoveIcon className="h-4 w-4" />
                Remove from workspace
              </ContextMenuItem>
            </>
          )}
        </ContextMenu>
      )}
    </div>
  );
}

function PersonCard({
  person,
  onContextMenu,
  onMenuClick,
}: {
  person: Person;
  onContextMenu: (e: React.MouseEvent) => void;
  onMenuClick: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      className="group relative flex items-center gap-3 rounded-lg border border-border p-4 text-left transition-colors hover:bg-border/30"
      onContextMenu={onContextMenu}
    >
      {/* Avatar */}
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent/80 text-sm font-medium text-white">
        {person.name.charAt(0).toUpperCase()}
      </div>
      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium text-foreground">{person.name}</div>
        <div className="truncate text-sm text-muted">{person.email}</div>
      </div>
      {/* Three-dot menu button */}
      <button
        type="button"
        onClick={onMenuClick}
        className="absolute right-2 top-2 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-border/50 text-muted hover:text-foreground transition-opacity"
        aria-label={`Actions for ${person.name}`}
      >
        <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
          <circle cx="12" cy="5" r="2" />
          <circle cx="12" cy="12" r="2" />
          <circle cx="12" cy="19" r="2" />
        </svg>
      </button>
    </div>
  );
}

// Icons
function UserIcon({ className }: { className?: string }) {
  return (
    <svg className={cn('h-4 w-4', className)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="8" r="4" />
      <path d="M4 20c0-4.4 3.6-8 8-8s8 3.6 8 8" />
    </svg>
  );
}

function CapacityIcon({ className }: { className?: string }) {
  return (
    <svg className={cn('h-4 w-4', className)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="18" rx="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
    </svg>
  );
}

function RemoveIcon({ className }: { className?: string }) {
  return (
    <svg className={cn('h-4 w-4', className)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="10" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  );
}
