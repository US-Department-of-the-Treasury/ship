import { useState, useEffect, useMemo } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useDocuments, WikiDocument } from '@/contexts/DocumentsContext';
import { useProjects, Project } from '@/contexts/ProjectsContext';
import { useIssues, Issue } from '@/contexts/IssuesContext';
import { cn } from '@/lib/cn';
import { buildDocumentTree, DocumentTreeNode } from '@/lib/documentTree';

type Mode = 'docs' | 'issues' | 'projects' | 'team' | 'settings';

export function AppLayout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const { documents, createDocument } = useDocuments();
  const { projects } = useProjects();
  const { issues, createIssue } = useIssues();
  const [leftSidebarCollapsed, setLeftSidebarCollapsed] = useState(() => {
    return localStorage.getItem('ship:leftSidebarCollapsed') === 'true';
  });

  // Persist sidebar state
  useEffect(() => {
    localStorage.setItem('ship:leftSidebarCollapsed', String(leftSidebarCollapsed));
  }, [leftSidebarCollapsed]);

  // Determine active mode from path
  const getActiveMode = (): Mode => {
    if (location.pathname.startsWith('/docs')) return 'docs';
    if (location.pathname.startsWith('/issues')) return 'issues';
    if (location.pathname.startsWith('/projects') || location.pathname.startsWith('/sprints')) return 'projects';
    if (location.pathname.startsWith('/team')) return 'team';
    if (location.pathname.startsWith('/settings')) return 'settings';
    return 'docs';
  };

  const activeMode = getActiveMode();

  const handleModeClick = (mode: Mode) => {
    switch (mode) {
      case 'docs': navigate('/docs'); break;
      case 'issues': navigate('/issues'); break;
      case 'projects': navigate('/projects'); break;
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

  return (
    <div className="flex h-screen bg-background">
      {/* Icon Rail */}
      <div className="flex w-12 flex-col items-center border-r border-border bg-background py-3">
        {/* Workspace icon */}
        <div className="mb-4 flex h-8 w-8 items-center justify-center">
          <img src="/icons/white/logo-64.png" alt="Ship" className="h-8 w-8" />
        </div>

        {/* Mode icons */}
        <nav className="flex flex-1 flex-col items-center gap-1">
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
            icon={<ProjectsIcon />}
            label="Projects"
            active={activeMode === 'projects'}
            onClick={() => handleModeClick('projects')}
          />
          <RailIcon
            icon={<TeamIcon />}
            label="Teams"
            active={activeMode === 'team'}
            onClick={() => handleModeClick('team')}
          />
        </nav>

        {/* Expand sidebar button (shows when collapsed) */}
        {leftSidebarCollapsed && (
          <button
            onClick={() => setLeftSidebarCollapsed(false)}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-muted hover:bg-border/50 hover:text-foreground transition-colors"
            title="Expand sidebar"
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
      </div>

      {/* Contextual Sidebar */}
      <aside
        className={cn(
          'flex flex-col border-r border-border transition-all duration-200 overflow-hidden',
          leftSidebarCollapsed ? 'w-0 border-r-0' : 'w-56'
        )}
      >
        <div className="flex w-56 flex-col h-full">
          {/* Sidebar header */}
          <div className="flex h-10 items-center justify-between border-b border-border px-3">
            <span className="text-sm font-medium text-foreground">
              {activeMode === 'docs' && 'Documents'}
              {activeMode === 'issues' && 'Issues'}
              {activeMode === 'projects' && 'Projects'}
              {activeMode === 'team' && 'Teams'}
              {activeMode === 'settings' && 'Settings'}
            </span>
            <div className="flex items-center gap-1">
              {activeMode === 'docs' && (
                <button
                  onClick={handleCreateDocument}
                  className="flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-border hover:text-foreground transition-colors"
                  title="New document"
                >
                  <PlusIcon />
                </button>
              )}
              {activeMode === 'issues' && (
                <button
                  onClick={handleCreateIssue}
                  className="flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-border hover:text-foreground transition-colors"
                  title="New issue"
                >
                  <PlusIcon />
                </button>
              )}
              <button
                onClick={() => setLeftSidebarCollapsed(true)}
                className="flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-border hover:text-foreground transition-colors"
                title="Collapse sidebar"
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
                onSelect={(id) => navigate(`/issues/${id}`)}
              />
            )}
            {activeMode === 'projects' && (
              <ProjectsList
                projects={projects}
                activeId={location.pathname.split('/projects/')[1]}
                onSelect={(id) => navigate(`/projects/${id}`)}
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
      <main className="flex flex-1 flex-col overflow-hidden">
        <Outlet />
      </main>
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
      title={label}
    >
      {icon}
    </button>
  );
}

function DocumentsTree({ documents, activeId, onSelect }: { documents: WikiDocument[]; activeId?: string; onSelect: (id: string) => void }) {
  // Build tree structure - only roots at top level
  const tree = useMemo(() => buildDocumentTree(documents), [documents]);

  if (documents.length === 0) {
    return <div className="px-3 py-2 text-sm text-muted">No documents yet</div>;
  }

  return (
    <ul className="space-y-0.5 px-2">
      {tree.map((doc) => (
        <DocumentTreeItem
          key={doc.id}
          document={doc}
          activeId={activeId}
          onSelect={onSelect}
          depth={0}
        />
      ))}
    </ul>
  );
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
  const [isOpen, setIsOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const isActive = activeId === document.id;
  const hasChildren = document.children.length > 0;
  const showCaret = hasChildren && isHovered;

  return (
    <li>
      <div
        className={cn(
          'flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
          isActive
            ? 'bg-border/50 text-foreground'
            : 'text-muted hover:bg-border/30 hover:text-foreground'
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Expand/collapse button - only shown if has children and hovered */}
        {showCaret ? (
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
        {/* Main navigation button */}
        <button
          type="button"
          className="flex-1 truncate text-left cursor-pointer bg-transparent border-none p-0"
          onClick={() => onSelect(document.id)}
        >
          {document.title || 'Untitled'}
        </button>
      </div>

      {/* Children (collapsible) */}
      {hasChildren && isOpen && (
        <ul className="space-y-0.5">
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

function IssuesList({ issues, activeId, onSelect }: { issues: Issue[]; activeId?: string; onSelect: (id: string) => void }) {
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
    <ul className="space-y-0.5 px-2">
      {issues.map((issue) => (
        <li key={issue.id}>
          <button
            onClick={() => onSelect(issue.id)}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
              activeId === issue.id
                ? 'bg-border/50 text-foreground'
                : 'text-muted hover:bg-border/30 hover:text-foreground'
            )}
          >
            <span className={cn('h-2 w-2 rounded-full flex-shrink-0', stateColors[issue.state] || stateColors.backlog)} />
            <span className="truncate">{issue.title || 'Untitled'}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function ProjectsList({ projects, activeId, onSelect }: { projects: Project[]; activeId?: string; onSelect: (id: string) => void }) {
  if (projects.length === 0) {
    return <div className="px-3 py-2 text-sm text-muted">No projects yet</div>;
  }

  return (
    <ul className="space-y-0.5 px-2">
      {projects.map((project) => (
        <li key={project.id}>
          <button
            onClick={() => onSelect(project.id)}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
              activeId === project.id
                ? 'bg-border/50 text-foreground'
                : 'text-muted hover:bg-border/30 hover:text-foreground'
            )}
          >
            <span
              className="h-4 w-4 rounded flex-shrink-0 flex items-center justify-center text-[10px] font-bold text-white"
              style={{ backgroundColor: project.color }}
            >
              {project.prefix.slice(0, 2)}
            </span>
            <span className="truncate">{project.name}</span>
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

function ProjectsIcon() {
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
