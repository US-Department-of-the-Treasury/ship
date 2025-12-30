import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import Placeholder from '@tiptap/extension-placeholder';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/cn';

interface Issue {
  id: string;
  title: string;
  state: string;
  priority: string;
  ticket_number: number;
  assignee_id: string | null;
  assignee_name: string | null;
}

interface TeamMember {
  id: string;
  name: string;
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

const STATES = [
  { value: 'backlog', label: 'Backlog' },
  { value: 'todo', label: 'Todo' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'done', label: 'Done' },
  { value: 'cancelled', label: 'Cancelled' },
];

const PRIORITIES = [
  { value: 'urgent', label: 'Urgent' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
  { value: 'none', label: 'No Priority' },
];

function stringToColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = hash % 360;
  return `hsl(${hue}, 70%, 60%)`;
}

type SyncStatus = 'connecting' | 'synced' | 'disconnected';

export function IssueEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [issue, setIssue] = useState<Issue | null>(null);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState('');

  // Collaboration state
  const [ydoc] = useState(() => new Y.Doc());
  const [provider, setProvider] = useState<WebsocketProvider | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('connecting');
  const [connectedUsers, setConnectedUsers] = useState<{ name: string; color: string }[]>([]);

  const userName = user?.name || 'Anonymous';
  const userColor = stringToColor(userName);

  // Fetch issue
  useEffect(() => {
    if (id) {
      fetchIssue();
      fetchTeamMembers();
    }
  }, [id]);

  async function fetchIssue() {
    try {
      const res = await fetch(`${API_URL}/api/issues/${id}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setIssue(data);
        setTitle(data.title);
      } else if (res.status === 404) {
        navigate('/issues');
      }
    } catch (err) {
      console.error('Failed to fetch issue:', err);
    } finally {
      setLoading(false);
    }
  }

  async function fetchTeamMembers() {
    try {
      const res = await fetch(`${API_URL}/api/auth/me`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        // For now, just use the current user as team member
        setTeamMembers([{ id: data.id, name: data.name }]);
      }
    } catch (err) {
      console.error('Failed to fetch team:', err);
    }
  }

  // Setup WebSocket provider for collaboration
  useEffect(() => {
    if (!id) return;

    const wsUrl = 'ws://localhost:3000/collaboration';
    const wsProvider = new WebsocketProvider(wsUrl, `issue:${id}`, ydoc, {
      connect: true,
    });

    wsProvider.on('status', (event: { status: string }) => {
      if (event.status === 'connected') {
        setSyncStatus('synced');
      } else if (event.status === 'disconnected') {
        setSyncStatus('disconnected');
      }
    });

    wsProvider.on('sync', (isSynced: boolean) => {
      if (isSynced) {
        setSyncStatus('synced');
      }
    });

    wsProvider.awareness.setLocalStateField('user', {
      name: userName,
      color: userColor,
    });

    const updateUsers = () => {
      const users: { name: string; color: string }[] = [];
      wsProvider.awareness.getStates().forEach((state) => {
        if (state.user) {
          users.push(state.user);
        }
      });
      setConnectedUsers(users);
    };

    wsProvider.awareness.on('change', updateUsers);
    updateUsers();

    setProvider(wsProvider);

    return () => {
      wsProvider.awareness.off('change', updateUsers);
      wsProvider.destroy();
    };
  }, [id, userName, userColor, ydoc]);

  // Build editor extensions
  const extensions = provider
    ? [
        StarterKit.configure({ history: false }),
        Placeholder.configure({ placeholder: 'Add a description...' }),
        Collaboration.configure({ document: ydoc }),
        CollaborationCursor.configure({
          provider: provider,
          user: { name: userName, color: userColor },
        }),
      ]
    : [
        StarterKit.configure({ history: false }),
        Placeholder.configure({ placeholder: 'Add a description...' }),
        Collaboration.configure({ document: ydoc }),
      ];

  const editor = useEditor({
    extensions,
    editorProps: {
      attributes: {
        class: 'prose prose-invert prose-sm max-w-none focus:outline-none min-h-[200px]',
      },
    },
  }, [provider]);

  // Update handlers
  const updateIssue = useCallback(async (updates: Partial<Issue>) => {
    if (!id) return;
    try {
      const res = await fetch(`${API_URL}/api/issues/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(updates),
      });
      if (res.ok) {
        const data = await res.json();
        setIssue(data);
      }
    } catch (err) {
      console.error('Failed to update issue:', err);
    }
  }, [id]);

  const [titleTimeout, setTitleTimeout] = useState<ReturnType<typeof setTimeout> | null>(null);
  const handleTitleChange = useCallback((newTitle: string) => {
    setTitle(newTitle);
    if (titleTimeout) clearTimeout(titleTimeout);
    setTitleTimeout(setTimeout(() => updateIssue({ title: newTitle }), 500));
  }, [updateIssue, titleTimeout]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted">Loading...</div>
      </div>
    );
  }

  if (!issue || !user) {
    return null;
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-2">
        <button
          onClick={() => navigate('/issues')}
          className="text-muted hover:text-foreground transition-colors"
          aria-label="Back to issues"
        >
          <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>

        <span className="rounded bg-border px-2 py-0.5 text-xs font-medium text-muted">
          #{issue.ticket_number}
        </span>

        {/* Title (display only - edit via large title below) */}
        <span className="flex-1 truncate text-sm font-medium text-foreground">
          {title || 'Untitled Issue'}
        </span>

        {/* Sync status */}
        <div className="flex items-center gap-1.5">
          <div
            className={cn(
              'h-2 w-2 rounded-full',
              syncStatus === 'synced' && 'bg-green-500',
              syncStatus === 'connecting' && 'bg-yellow-500 animate-pulse',
              syncStatus === 'disconnected' && 'bg-red-500'
            )}
          />
          <span className="text-xs text-muted">
            {syncStatus === 'synced' && 'Saved'}
            {syncStatus === 'connecting' && 'Syncing...'}
            {syncStatus === 'disconnected' && 'Offline'}
          </span>
        </div>

        {/* Connected users */}
        <div className="flex items-center gap-1">
          {connectedUsers.map((u, index) => (
            <div
              key={index}
              className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium text-white"
              style={{ backgroundColor: u.color }}
              title={u.name}
            >
              {u.name.charAt(0).toUpperCase()}
            </div>
          ))}
        </div>
      </div>

      {/* Content area */}
      <div className="flex flex-1 overflow-hidden">
        {/* Main content */}
        <div className="flex-1 overflow-auto p-6">
          <div className="mx-auto max-w-3xl">
            {/* Large issue title */}
            <input
              type="text"
              value={title}
              onChange={(e) => handleTitleChange(e.target.value)}
              placeholder="Issue title"
              className="mb-6 w-full bg-transparent text-3xl font-bold text-foreground placeholder:text-muted/30 focus:outline-none"
            />
            <EditorContent editor={editor} />
          </div>
        </div>

        {/* Properties sidebar */}
        <aside className="w-64 border-l border-border p-4">
          <div className="space-y-4">
            <PropertyRow label="Status">
              <select
                value={issue.state}
                onChange={(e) => updateIssue({ state: e.target.value })}
                className="w-full rounded bg-border px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
              >
                {STATES.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </PropertyRow>

            <PropertyRow label="Priority">
              <select
                value={issue.priority}
                onChange={(e) => updateIssue({ priority: e.target.value })}
                className="w-full rounded bg-border px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
              >
                {PRIORITIES.map((p) => (
                  <option key={p.value} value={p.value}>
                    {p.label}
                  </option>
                ))}
              </select>
            </PropertyRow>

            <PropertyRow label="Assignee">
              <select
                value={issue.assignee_id || ''}
                onChange={(e) => updateIssue({ assignee_id: e.target.value || null })}
                className="w-full rounded bg-border px-2 py-1 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-accent"
              >
                <option value="">Unassigned</option>
                {teamMembers.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.name}
                  </option>
                ))}
              </select>
            </PropertyRow>
          </div>
        </aside>
      </div>
    </div>
  );
}

function PropertyRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted">{label}</label>
      {children}
    </div>
  );
}
