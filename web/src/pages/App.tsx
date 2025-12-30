import { useState, useEffect } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/cn';

type Mode = 'docs' | 'issues' | 'team' | 'settings';

interface Document {
  id: string;
  title: string;
  document_type: string;
  created_at: string;
  updated_at: string;
}

interface Issue {
  id: string;
  title: string;
  state: string;
  ticket_number: number;
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export function AppLayout() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [documents, setDocuments] = useState<Document[]>([]);
  const [issues, setIssues] = useState<Issue[]>([]);

  // Determine active mode from path
  const getActiveMode = (): Mode => {
    if (location.pathname.startsWith('/docs')) return 'docs';
    if (location.pathname.startsWith('/issues')) return 'issues';
    if (location.pathname.startsWith('/team')) return 'team';
    if (location.pathname.startsWith('/settings')) return 'settings';
    return 'docs';
  };

  const activeMode = getActiveMode();
  const isInEditor = /^\/docs\/[^/]+$/.test(location.pathname) || /^\/issues\/[^/]+$/.test(location.pathname);

  // Fetch documents for sidebar
  useEffect(() => {
    if (activeMode === 'docs') {
      fetch(`${API_URL}/api/documents?type=wiki`, { credentials: 'include' })
        .then(res => res.ok ? res.json() : [])
        .then(setDocuments)
        .catch(() => setDocuments([]));
    }
    if (activeMode === 'issues') {
      fetch(`${API_URL}/api/issues`, { credentials: 'include' })
        .then(res => res.ok ? res.json() : [])
        .then(setIssues)
        .catch(() => setIssues([]));
    }
  }, [activeMode]);

  const handleModeClick = (mode: Mode) => {
    switch (mode) {
      case 'docs': navigate('/docs'); break;
      case 'issues': navigate('/issues'); break;
      case 'team': navigate('/team'); break;
      case 'settings': navigate('/settings'); break;
    }
  };

  const createIssue = async () => {
    try {
      const res = await fetch(`${API_URL}/api/issues`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ title: 'Untitled Issue' }),
      });
      if (res.ok) {
        const issue = await res.json();
        setIssues(prev => [issue, ...prev]);
        navigate(`/issues/${issue.id}`);
      }
    } catch (err) {
      console.error('Failed to create issue:', err);
    }
  };

  const createDocument = async () => {
    try {
      const res = await fetch(`${API_URL}/api/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ title: 'Untitled', document_type: 'wiki' }),
      });
      if (res.ok) {
        const doc = await res.json();
        setDocuments(prev => [doc, ...prev]);
        navigate(`/docs/${doc.id}`);
      }
    } catch (err) {
      console.error('Failed to create document:', err);
    }
  };

  return (
    <div className="flex h-screen bg-background">
      {/* Icon Rail */}
      <div className="flex w-12 flex-col items-center border-r border-border bg-background py-3">
        {/* Workspace icon */}
        <div className="mb-4 flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-sm font-bold text-white">
          S
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
            icon={<TeamIcon />}
            label="Team"
            active={activeMode === 'team'}
            onClick={() => handleModeClick('team')}
          />
        </nav>

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

      {/* Contextual Sidebar - hidden when in editor */}
      {!isInEditor && (
        <aside className="flex w-56 flex-col border-r border-border">
          {/* Sidebar header */}
          <div className="flex h-10 items-center justify-between border-b border-border px-3">
            <span className="text-sm font-medium text-foreground">
              {activeMode === 'docs' && 'Documents'}
              {activeMode === 'issues' && 'Issues'}
              {activeMode === 'team' && 'Team'}
              {activeMode === 'settings' && 'Settings'}
            </span>
            {activeMode === 'docs' && (
              <button
                onClick={createDocument}
                className="flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-border hover:text-foreground transition-colors"
                title="New document"
              >
                <PlusIcon />
              </button>
            )}
            {activeMode === 'issues' && (
              <button
                onClick={createIssue}
                className="flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-border hover:text-foreground transition-colors"
                title="New issue"
              >
                <PlusIcon />
              </button>
            )}
          </div>

          {/* Sidebar content */}
          <div className="flex-1 overflow-auto py-2">
            {activeMode === 'docs' && (
              <DocumentsList
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
            {activeMode === 'team' && (
              <div className="px-3 py-2 text-sm text-muted">Coming soon</div>
            )}
            {activeMode === 'settings' && (
              <div className="px-3 py-2 text-sm text-muted">Settings</div>
            )}
          </div>
        </aside>
      )}

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

function DocumentsList({ documents, activeId, onSelect }: { documents: Document[]; activeId?: string; onSelect: (id: string) => void }) {
  if (documents.length === 0) {
    return <div className="px-3 py-2 text-sm text-muted">No documents yet</div>;
  }

  return (
    <ul className="space-y-0.5 px-2">
      {documents.map((doc) => (
        <li key={doc.id}>
          <button
            onClick={() => onSelect(doc.id)}
            className={cn(
              'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
              activeId === doc.id
                ? 'bg-border/50 text-foreground'
                : 'text-muted hover:bg-border/30 hover:text-foreground'
            )}
          >
            <DocIcon />
            <span className="truncate">{doc.title || 'Untitled'}</span>
          </button>
        </li>
      ))}
    </ul>
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
