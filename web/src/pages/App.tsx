import { useState, useEffect, useMemo, useCallback } from 'react';
import { Link, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useFocusOnNavigate } from '@/hooks/useFocusOnNavigate';
import { useWorkspace } from '@/contexts/WorkspaceContext';
import { useDocuments, WikiDocument } from '@/contexts/DocumentsContext';
import { usePrograms, Program } from '@/contexts/ProgramsContext';
import { useIssues, Issue } from '@/contexts/IssuesContext';
import { documentKeys } from '@/hooks/useDocumentsQuery';
import { issueKeys } from '@/hooks/useIssuesQuery';
import { programKeys } from '@/hooks/useProgramsQuery';
import { cn, getContrastTextColor } from '@/lib/cn';
import { buildDocumentTree, DocumentTreeNode } from '@/lib/documentTree';
import { CommandPalette } from '@/components/CommandPalette';
import { SessionTimeoutModal } from '@/components/SessionTimeoutModal';
import { useSessionTimeout } from '@/hooks/useSessionTimeout';
import { OfflineIndicator } from '@/components/OfflineIndicator';
import { PendingSyncCount } from '@/components/PendingSyncCount';
import { PendingSyncIcon } from '@/components/PendingSyncIcon';
import { StaleDataBanner } from '@/components/StaleDataBanner';

type Mode = 'docs' | 'issues' | 'programs' | 'team' | 'settings';

export function AppLayout() {
  const { user, logout, isSuperAdmin, impersonating, endImpersonation } = useAuth();
  const { currentWorkspace, workspaces, switchWorkspace } = useWorkspace();
  const location = useLocation();
  const navigate = useNavigate();
  const { documents, createDocument } = useDocuments();
  const { programs } = usePrograms();
  const { issues, createIssue } = useIssues();
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(() => {
    return localStorage.getItem('ship:leftSidebarCollapsed') === 'true';
  });
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [workspaceSwitcherOpen, setWorkspaceSwitcherOpen] = useState(false);

  // Session timeout handling
  const handleSessionTimeout = useCallback(() => {
    // Redirect to login with expired flag and returnTo URL
    const returnTo = encodeURIComponent(location.pathname + location.search + location.hash);
    window.location.href = `/login?expired=true&returnTo=${returnTo}`;
  }, [location]);

  const {
    showWarning: showTimeoutWarning,
    timeRemaining,
    warningType,
    resetTimer: resetSessionTimer,
  } = useSessionTimeout(handleSessionTimeout);

  // Accessibility: focus management on navigation
  useFocusOnNavigate();

  // Persist sidebar state
  useEffect(() => {
    localStorage.setItem('ship:leftSidebarCollapsed', String(leftSidebarCollapsed));
  }, [leftSidebarCollapsed]);

  // Global Cmd+K keyboard shortcut for command palette
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setCommandPaletteOpen(open => !open);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Determine active mode from path
  const getActiveMode = (): Mode => {
    if (location.pathname.startsWith('/docs')) return 'docs';
    if (location.pathname.startsWith('/issues')) return 'issues';
    if (location.pathname.startsWith('/programs') || location.pathname.startsWith('/sprints') || location.pathname.startsWith('/feedback')) return 'programs';
    if (location.pathname.startsWith('/team')) return 'team';
    if (location.pathname.startsWith('/settings')) return 'settings';
    return 'docs';
  };

  const activeMode = getActiveMode();

  const handleModeClick = (mode: Mode) => {
    switch (mode) {
      case 'docs': navigate('/docs'); break;
      case 'issues': navigate('/issues'); break;
      case 'programs': navigate('/programs'); break;
      case 'team': navigate('/team'); break;
      case 'settings': navigate('/settings'); break;
    }
  };

  const handleCreateIssue = async () => {
    const issue = await createIssue();
    if (issue) {
      navigate(`/issues/${issue.id}`);
    }
  };

  const handleCreateDocument = async () => {
    const doc = await createDocument();
    if (doc) {
      navigate(`/docs/${doc.id}`);
    }
  };

  const handleSwitchWorkspace = async (workspaceId: string) => {
    const success = await switchWorkspace(workspaceId);
    if (success) {
      setWorkspaceSwitcherOpen(false);
      // Refresh the page to reload all data for new workspace
      window.location.href = '/docs';
    }
  };

  return (
    <div className="flex h-screen flex-col bg-background">
      {/* Skip link for keyboard/screen reader users - Section 508 compliance */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:z-50 focus:top-2 focus:left-2 focus:px-4 focus:py-2 focus:bg-accent focus:text-white focus:rounded-md focus:outline-none focus:ring-2 focus:ring-accent-foreground"
      >
        Skip to main content
      </a>

      {/* Offline indicator banner */}
      <div className="flex justify-center">
        <OfflineIndicator />
      </div>

      {/* Stale data banner */}
      <div className="flex justify-center">
        <StaleDataBanner
          queryKey={
            activeMode === 'docs' ? documentKeys.wikiList() :
            activeMode === 'issues' ? issueKeys.lists() :
            activeMode === 'programs' ? programKeys.lists() :
            undefined
          }
        />
      </div>

      {/* Impersonation banner */}
      {impersonating && (
        <div className="flex h-8 items-center justify-between bg-yellow-500 px-4 text-black">
          <span className="text-sm">
            Impersonating <strong>{impersonating.userName}</strong>
          </span>
          <button
            onClick={endImpersonation}
            className="rounded bg-yellow-700 px-2 py-0.5 text-xs text-white hover:bg-yellow-800 transition-colors"
          >
            End Session
          </button>
        </div>
      )}

      <div className="flex flex-1 overflow-hidden">
        {/* Icon Rail - Navigation landmark */}
        <nav className="flex w-12 flex-col items-center border-r border-border bg-background py-3" role="navigation" aria-label="Primary navigation">
          {/* Workspace switcher */}
          <div className="relative mb-4">
            <button
              onClick={() => setWorkspaceSwitcherOpen(!workspaceSwitcherOpen)}
              className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/20 text-accent hover:bg-accent/30 transition-colors"
              title={currentWorkspace?.name || 'Select workspace'}
            >
              {currentWorkspace?.name?.charAt(0).toUpperCase() || 'W'}
            </button>
            {/* Workspace dropdown */}
            {workspaceSwitcherOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setWorkspaceSwitcherOpen(false)}
                />
                <div className="absolute left-full top-0 z-50 ml-2 w-56 rounded-lg border border-border bg-background shadow-lg">
                  <div className="p-2">
                    <div className="px-2 py-1 text-xs font-medium text-muted">Workspaces</div>
                    {workspaces.map((ws) => (
                      <button
                        key={ws.id}
                        onClick={() => handleSwitchWorkspace(ws.id)}
                        className={cn(
                          'flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm transition-colors',
                          ws.id === currentWorkspace?.id
                            ? 'bg-accent/10 text-accent'
                            : 'text-foreground hover:bg-border/30'
                        )}
                      >
                        <span className="truncate">{ws.name}</span>
                        <span className="text-xs text-muted capitalize">{ws.role}</span>
                      </button>
                    ))}
                  </div>
                  {isSuperAdmin && (
                    <div className="border-t border-border p-2">
                      <button
                        onClick={() => {
                          setWorkspaceSwitcherOpen(false);
                          navigate('/admin');
                        }}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted hover:bg-border/30 hover:text-foreground transition-colors"
                      >
                        <AdminIcon />
                        Admin Dashboard
                      </button>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Mode icons */}
          <div className="flex flex-1 flex-col items-center gap-1">
            <RailIcon
              icon={<DocsIcon />}
              label="Docs"
              active={activeMode === 'docs'}
              onClick={() => handleModeClick('docs')}
            />
            <RailIcon
              icon={<IssuesIcon />}
              label="Issues"
              active={activeMode === 'issues'}
              onClick={() => handleModeClick('issues')}
            />
            <RailIcon
              icon={<ProgramsIcon />}
              label="Programs"
              active={activeMode === 'programs'}
              onClick={() => handleModeClick('programs')}
            />
            <RailIcon
              icon={<TeamIcon />}
              label="Teams"
              active={activeMode === 'team'}
              onClick={() => handleModeClick('team')}
            />
          </div>

          {/* Expand sidebar button (shows when collapsed) */}
          {leftSidebarCollapsed && (
            <button
              onClick={() => setLeftSidebarCollapsed(false)}
              className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-border/50 hover:text-foreground transition-colors"
              aria-label="Expand sidebar"
            >
              <ExpandRightIcon />
            </button>
          )}

          {/* User avatar & settings at bottom */}
          <div className="flex flex-col items-center gap-2">
            <RailIcon
              icon={<SettingsIcon />}
              label="Settings"
              active={activeMode === 'settings'}
              onClick={() => handleModeClick('settings')}
            />
            <button
              onClick={logout}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-accent/80 text-xs font-medium text-white hover:bg-accent transition-colors"
              title={`${user?.name} - Click to logout`}
            >
              {user?.name?.charAt(0).toUpperCase() || 'U'}
            </button>
          </div>
        </nav>

        {/* Contextual Sidebar - Complementary landmark */}
        <aside
          className={cn(
            'flex flex-col border-r border-border transition-all duration-200 overflow-hidden select-none',
            leftSidebarCollapsed ? 'w-0 border-r-0' : 'w-56'
          )}
          aria-label="Document list"
        >
          <div className="flex w-56 flex-col h-full">
            {/* Sidebar header */}
            <div className="flex h-10 items-center justify-between border-b border-border px-3">
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-medium text-foreground m-0">
                  {activeMode === 'docs' && 'Docs'}
                  {activeMode === 'issues' && 'Issues'}
                  {activeMode === 'programs' && 'Programs'}
                  {activeMode === 'team' && 'Teams'}
                  {activeMode === 'settings' && 'Settings'}
                </h2>
                <PendingSyncCount />
              </div>
              <div className="flex items-center gap-1">
                {activeMode === 'docs' && (
                  <button
                    onClick={handleCreateDocument}
                    className="flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-border hover:text-foreground transition-colors"
                    aria-label="New document"
                  >
                    <PlusIcon />
                  </button>
                )}
                {activeMode === 'issues' && (
                  <button
                    onClick={handleCreateIssue}
                    className="flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-border hover:text-foreground transition-colors"
                    aria-label="New issue"
                  >
                    <PlusIcon />
                  </button>
                )}
                <button
                  onClick={() => setLeftSidebarCollapsed(true)}
                  className="flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-border hover:text-foreground transition-colors"
                  aria-label="Collapse sidebar"
                >
                  <CollapseLeftIcon />
                </button>
              </div>
            </div>

            {/* Sidebar content */}
            <div className="flex-1 overflow-auto py-2">
              {activeMode === 'docs' && (
                <DocumentsTree
                  documents={documents}
                  activeId={location.pathname.split('/docs/')[1]}
                  onSelect={(id) => navigate(`/docs/${id}`)}
                />
              )}
              {activeMode === 'issues' && (
                <IssuesList
                  issues={issues}
                  activeId={location.pathname.split('/issues/')[1]}
                />
              )}
              {activeMode === 'programs' && (
                <ProgramsList
                  programs={programs}
                  activeId={location.pathname.split('/programs/')[1]}
                  onSelect={(id) => navigate(`/programs/${id}`)}
                />
              )}
              {activeMode === 'team' && (
                <TeamSidebar />
              )}
              {activeMode === 'settings' && (
                <div className="px-3 py-2 text-sm text-muted">Settings</div>
              )}
            </div>
          </div>
        </aside>

        {/* Main content */}
        <main id="main-content" className="flex flex-1 flex-col overflow-hidden" role="main" tabIndex={-1}>
          <Outlet />
        </main>
      </div>

      {/* Command Palette (Cmd+K) */}
      <CommandPalette open={commandPaletteOpen} onOpenChange={setCommandPaletteOpen} />

      {/* Session Timeout Warning Modal */}
      <SessionTimeoutModal
        open={showTimeoutWarning}
        timeRemaining={timeRemaining}
        warningType={warningType}
        onStayLoggedIn={resetSessionTimer}
      />
    </div>
  );
}

function RailIcon({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex h-9 w-9 items-center justify-center rounded-lg transition-colors',
        active ? 'bg-border text-foreground' : 'text-muted hover:bg-border/50 hover:text-foreground'
      )}
      aria-label={label}
    >
      {icon}
    </button>
  );
}

const SIDEBAR_ITEM_LIMIT = 10;

function DocumentsTree({ documents, activeId, onSelect }: { documents: WikiDocument[]; activeId?: string; onSelect: (id: string) => void }) {
  // Split documents by visibility and build separate trees
  const { privateTree, workspaceTree } = useMemo(() => {
    // Group documents by visibility (root documents determine the section)
    const privateDocs = documents.filter(d => d.visibility === 'private');
    const workspaceDocs = documents.filter(d => d.visibility !== 'private');
    return {
      privateTree: buildDocumentTree(privateDocs),
      workspaceTree: buildDocumentTree(workspaceDocs),
    };
  }, [documents]);

  if (documents.length === 0) {
    return <div className="px-3 py-2 text-sm text-muted">No documents yet</div>;
  }

  // Limit items shown
  const workspaceToShow = workspaceTree.slice(0, SIDEBAR_ITEM_LIMIT);
  const workspaceHiddenCount = workspaceTree.length - SIDEBAR_ITEM_LIMIT;

  const privateToShow = privateTree.slice(0, SIDEBAR_ITEM_LIMIT);
  const privateHiddenCount = privateTree.length - SIDEBAR_ITEM_LIMIT;

  return (
    <div className="space-y-2" data-testid="document-list">
      {/* Workspace section */}
      <div>
        <div className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-muted uppercase tracking-wider">
          <GlobeIcon className="h-3 w-3" />
          Workspace
        </div>
        <ul role="tree" aria-label="Workspace documents" aria-live="polite" className="space-y-0.5 px-2">
          {workspaceToShow.length > 0 ? (
            workspaceToShow.map((doc) => (
              <DocumentTreeItem
                key={doc.id}
                document={doc}
                activeId={activeId}
                onSelect={onSelect}
                depth={0}
              />
            ))
          ) : (
            <li className="px-2 py-1 text-sm text-muted">No workspace documents</li>
          )}
          {workspaceHiddenCount > 0 && (
            <li>
              <Link
                to="/docs?filter=workspace"
                className="block px-2 py-1.5 text-sm text-muted hover:text-foreground hover:bg-border/30 rounded-md transition-colors"
              >
                {workspaceHiddenCount} more...
              </Link>
            </li>
          )}
        </ul>
      </div>
      {/* Private section - only show if user has private docs */}
      {privateTree.length > 0 && (
        <div>
          <div className="flex items-center gap-1.5 px-3 py-1 text-xs font-medium text-muted uppercase tracking-wider">
            <LockIcon className="h-3 w-3" />
            Private
          </div>
          <ul role="tree" aria-label="Private documents" aria-live="polite" className="space-y-0.5 px-2">
            {privateToShow.map((doc) => (
              <DocumentTreeItem
                key={doc.id}
                document={doc}
                activeId={activeId}
                onSelect={onSelect}
                depth={0}
              />
            ))}
            {privateHiddenCount > 0 && (
              <li>
                <Link
                  to="/docs?filter=private"
                  className="block px-2 py-1.5 text-sm text-muted hover:text-foreground hover:bg-border/30 rounded-md transition-colors"
                >
                  {privateHiddenCount} more...
                </Link>
              </li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

// Check if any descendant node matches the activeId
function hasActiveDescendant(node: DocumentTreeNode, activeId?: string): boolean {
  if (!activeId) return false;
  for (const child of node.children) {
    if (child.id === activeId || hasActiveDescendant(child, activeId)) {
      return true;
    }
  }
  return false;
}

function DocumentTreeItem({
  document,
  activeId,
  onSelect,
  depth
}: {
  document: DocumentTreeNode;
  activeId?: string;
  onSelect: (id: string) => void;
  depth: number;
}) {
  // Auto-expand if this node or any descendant is active
  const shouldAutoExpand = hasActiveDescendant(document, activeId);
  const [isOpen, setIsOpen] = useState(shouldAutoExpand);

  // Update isOpen when activeId changes (for navigation)
  useEffect(() => {
    if (shouldAutoExpand && !isOpen) {
      setIsOpen(true);
    }
  }, [shouldAutoExpand, isOpen]);

  const isActive = activeId === document.id;
  const hasChildren = document.children.length > 0;

  return (
    <li
      role="treeitem"
      aria-expanded={hasChildren ? isOpen : undefined}
      aria-selected={isActive}
      data-tree-item
      data-testid="doc-item"
    >
      <div
        className={cn(
          'flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors group',
          isActive
            ? 'bg-border/50 text-foreground'
            : 'text-muted hover:bg-border/30 hover:text-foreground',
          'focus-within:bg-border/30 focus-within:text-foreground'
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
      >
        {/* Expand/collapse button - always visible for accessibility */}
        {hasChildren ? (
          <button
            type="button"
            className="w-4 h-4 flex-shrink-0 flex items-center justify-center p-0 rounded hover:bg-border/50"
            onClick={() => setIsOpen(!isOpen)}
            aria-label={isOpen ? 'Collapse' : 'Expand'}
          >
            <ChevronIcon isOpen={isOpen} />
          </button>
        ) : (
          <div className="w-4 h-4 flex-shrink-0 flex items-center justify-center">
            <DocIcon />
          </div>
        )}
        {/* Main navigation link */}
        <Link
          to={`/docs/${document.id}`}
          className="flex-1 truncate text-left cursor-pointer flex items-center gap-1"
        >
          <span className="truncate">{document.title || 'Untitled'}</span>
          {document.visibility === 'private' && (
            <LockIcon className="h-3 w-3 flex-shrink-0 text-muted" />
          )}
        </Link>
        {/* Pending sync indicator */}
        {'_pending' in document && document._pending && (
          <PendingSyncIcon isPending={true} />
        )}
      </div>

      {/* Children (collapsible) */}
      {hasChildren && isOpen && (
        <ul role="group" className="space-y-0.5">
          {document.children.map((child) => (
            <DocumentTreeItem
              key={child.id}
              document={child}
              activeId={activeId}
              onSelect={onSelect}
              depth={depth + 1}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

function ChevronIcon({ isOpen }: { isOpen: boolean }) {
  return (
    <svg
      className={cn(
        'h-4 w-4 text-muted transition-transform',
        isOpen && 'rotate-90'
      )}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 5l7 7-7 7"
      />
    </svg>
  );
}

function IssuesList({ issues, activeId }: { issues: Issue[]; activeId?: string }) {
  if (issues.length === 0) {
    return <div className="px-3 py-2 text-sm text-muted">No issues yet</div>;
  }

  const stateColors: Record<string, string> = {
    backlog: 'bg-gray-500',
    todo: 'bg-blue-500',
    in_progress: 'bg-yellow-500',
    done: 'bg-green-500',
    cancelled: 'bg-red-500',
  };

  return (
    <ul className="space-y-0.5 px-2" data-testid="issues-list">
      {issues.map((issue) => (
        <li key={issue.id} data-testid="issue-item">
          <Link
            to={`/issues/${issue.id}`}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
              activeId === issue.id
                ? 'bg-border/50 text-foreground'
                : 'text-muted hover:bg-border/30 hover:text-foreground'
            )}
          >
            <span className={cn('h-2 w-2 rounded-full flex-shrink-0', stateColors[issue.state] || stateColors.backlog)} />
            <span className="flex-1 truncate">{issue.title || 'Untitled'}</span>
            {'_pending' in issue && issue._pending && (
              <PendingSyncIcon isPending={true} />
            )}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function ProgramsList({ programs, activeId, onSelect }: { programs: Program[]; activeId?: string; onSelect: (id: string) => void }) {
  if (programs.length === 0) {
    return <div className="px-3 py-2 text-sm text-muted">No programs yet</div>;
  }

  return (
    <ul className="space-y-0.5 px-2" data-testid="programs-list">
      {programs.map((program) => (
        <li key={program.id} data-testid="program-item">
          <button
            onClick={() => onSelect(program.id)}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
              activeId === program.id
                ? 'bg-border/50 text-foreground'
                : 'text-muted hover:bg-border/30 hover:text-foreground'
            )}
          >
            <span
              className="h-4 w-4 rounded flex-shrink-0 flex items-center justify-center text-[10px] font-bold"
              style={{ backgroundColor: program.color, color: getContrastTextColor(program.color) }}
            >
              {program.prefix.slice(0, 2)}
            </span>
            <span className="flex-1 truncate">{program.name}</span>
            {'_pending' in program && program._pending && (
              <PendingSyncIcon isPending={true} />
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

function TeamSidebar() {
  const location = useLocation();
  const navigate = useNavigate();

  const isAllocation = location.pathname === '/team/allocation' || location.pathname === '/team';
  const isDirectory = location.pathname === '/team/directory';

  return (
    <ul className="space-y-0.5 px-2">
      <li>
        <button
          onClick={() => navigate('/team/allocation')}
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
            isAllocation
              ? 'bg-border/50 text-foreground'
              : 'text-muted hover:bg-border/30 hover:text-foreground'
          )}
        >
          <GridIcon />
          <span>Allocation</span>
        </button>
      </li>
      <li>
        <button
          onClick={() => navigate('/team/directory')}
          className={cn(
            'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
            isDirectory
              ? 'bg-border/50 text-foreground'
              : 'text-muted hover:bg-border/30 hover:text-foreground'
          )}
        >
          <PeopleIcon />
          <span>Directory</span>
        </button>
      </li>
    </ul>
  );
}

function GridIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M4 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1V5zM14 5a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1V5zM4 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1H5a1 1 0 01-1-1v-4zM14 15a1 1 0 011-1h4a1 1 0 011 1v4a1 1 0 01-1 1h-4a1 1 0 01-1-1v-4z" />
    </svg>
  );
}

function PeopleIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
    </svg>
  );
}

// Icons
function DocsIcon() {
  return (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

function IssuesIcon() {
  return (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
    </svg>
  );
}

function ProgramsIcon() {
  return (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
    </svg>
  );
}

function TeamIcon() {
  return (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
    </svg>
  );
}

function SettingsIcon() {
  return (
    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
    </svg>
  );
}

function DocIcon() {
  return (
    <svg className="h-4 w-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
    </svg>
  );
}

function CollapseLeftIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 19l-7-7 7-7m8 14V5" />
    </svg>
  );
}

function ExpandRightIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 5l7 7-7 7M4 5v14" />
    </svg>
  );
}

function AdminIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
    </svg>
  );
}

function LockIcon({ className }: { className?: string }) {
  return (
    <svg className={className || "h-4 w-4"} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
    </svg>
  );
}

function GlobeIcon({ className }: { className?: string }) {
  return (
    <svg className={className || "h-4 w-4"} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M21 12a9 9 0 01-9 9m9-9a9 9 0 00-9-9m9 9H3m9 9a9 9 0 01-9-9m9 9c1.657 0 3-4.03 3-9s-1.343-9-3-9m0 18c-1.657 0-3-4.03-3-9s1.343-9 3-9m-9 9a9 9 0 019-9" />
    </svg>
  );
}
