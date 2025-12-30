import { useEffect, useState, useCallback, useRef, useMemo } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { cn } from '@/lib/cn';
import { createSlashCommands } from './editor/SlashCommands';
import 'tippy.js/dist/tippy.css';

interface EditorProps {
  documentId: string;
  userName: string;
  userColor?: string;
  onTitleChange?: (title: string) => void;
  initialTitle?: string;
  onBack?: () => void;
  /** Label for back button (e.g., parent document title) */
  backLabel?: string;
  /** Room prefix for collaboration (e.g., 'doc' or 'issue') */
  roomPrefix?: string;
  /** Placeholder text for the editor */
  placeholder?: string;
  /** Badge to show in header (e.g., issue number) */
  headerBadge?: React.ReactNode;
  /** Sidebar content (e.g., issue properties) */
  sidebar?: React.ReactNode;
  /** Callback to create a sub-document (for slash commands) */
  onCreateSubDocument?: () => Promise<{ id: string; title: string } | null>;
}

type SyncStatus = 'connecting' | 'synced' | 'disconnected';

// Generate a consistent color from a string
function stringToColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = hash % 360;
  return `hsl(${hue}, 70%, 60%)`;
}

export function Editor({
  documentId,
  userName,
  userColor,
  onTitleChange,
  initialTitle = 'Untitled',
  onBack,
  backLabel,
  roomPrefix = 'doc',
  placeholder = 'Start writing...',
  headerBadge,
  sidebar,
  onCreateSubDocument,
}: EditorProps) {
  const [title, setTitle] = useState(initialTitle === 'Untitled' ? '' : initialTitle);
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Create a new Y.Doc for each documentId - must recreate when doc changes
  const [ydoc, setYdoc] = useState(() => new Y.Doc());
  const prevDocIdRef = useRef(documentId);

  // Recreate ydoc when documentId changes
  useEffect(() => {
    if (prevDocIdRef.current !== documentId) {
      prevDocIdRef.current = documentId;
      setYdoc(new Y.Doc());
    }
  }, [documentId]);

  // Sync title when initialTitle prop changes (e.g., from context update)
  useEffect(() => {
    const newTitle = initialTitle === 'Untitled' ? '' : initialTitle;
    setTitle(newTitle);
  }, [initialTitle]);
  const [provider, setProvider] = useState<WebsocketProvider | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('connecting');
  const [connectedUsers, setConnectedUsers] = useState<{ name: string; color: string }[]>([]);
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(() => {
    return localStorage.getItem('ship:rightSidebarCollapsed') === 'true';
  });

  // Persist right sidebar state
  useEffect(() => {
    localStorage.setItem('ship:rightSidebarCollapsed', String(rightSidebarCollapsed));
  }, [rightSidebarCollapsed]);

  const color = userColor || stringToColor(userName);

  // Auto-focus title if empty (new document)
  useEffect(() => {
    if (!title && titleInputRef.current) {
      titleInputRef.current.focus();
    }
  }, []);

  // Setup WebSocket provider
  useEffect(() => {
    // WebsocketProvider appends roomName to URL, so just provide base path
    const wsUrl = 'ws://localhost:3000/collaboration';
    const wsProvider = new WebsocketProvider(wsUrl, `${roomPrefix}:${documentId}`, ydoc, {
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

    // Set awareness info
    wsProvider.awareness.setLocalStateField('user', {
      name: userName,
      color: color,
    });

    // Track connected users
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
  }, [documentId, userName, color, ydoc, roomPrefix]);

  // Create slash commands extension (memoized to avoid recreation)
  const slashCommandsExtension = useMemo(() => {
    if (!onCreateSubDocument) return null;
    return createSlashCommands({ onCreateSubDocument });
  }, [onCreateSubDocument]);

  // Build extensions - only include CollaborationCursor when provider is ready
  const baseExtensions = [
    StarterKit.configure({ history: false }),
    Placeholder.configure({ placeholder }),
    Collaboration.configure({ document: ydoc }),
    Link.configure({
      openOnClick: true,
      HTMLAttributes: {
        class: 'text-accent hover:underline cursor-pointer',
      },
    }),
    ...(slashCommandsExtension ? [slashCommandsExtension] : []),
  ];

  const extensions = provider
    ? [
        ...baseExtensions,
        CollaborationCursor.configure({
          provider: provider,
          user: { name: userName, color: color },
        }),
      ]
    : baseExtensions;

  const editor = useEditor({
    extensions,
    editorProps: {
      attributes: {
        class: 'prose prose-invert prose-sm max-w-none focus:outline-none min-h-[300px]',
      },
    },
  }, [provider]);

  // Handle title changes
  const handleTitleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newTitle = e.target.value;
    setTitle(newTitle);
    onTitleChange?.(newTitle);
  }, [onTitleChange]);

  return (
    <div className="flex h-full flex-col">
      {/* Compact header - breadcrumb, title, status, presence all in one row */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-2">
        {/* Back button with optional parent label */}
        {onBack && (
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-muted hover:text-foreground transition-colors"
            aria-label={backLabel ? `Back to ${backLabel}` : 'Back to documents'}
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            {backLabel && (
              <span className="text-xs truncate max-w-[120px]">{backLabel}</span>
            )}
          </button>
        )}

        {/* Optional header badge (e.g., issue number) */}
        {headerBadge}

        {/* Title (display only - edit via large title below) */}
        <span className="flex-1 truncate text-sm font-medium text-foreground">
          {title || 'Untitled'}
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
          {connectedUsers.map((user, index) => (
            <div
              key={index}
              className="flex h-6 w-6 items-center justify-center rounded-full text-xs font-medium text-white"
              style={{ backgroundColor: user.color }}
              title={user.name}
            >
              {user.name.charAt(0).toUpperCase()}
            </div>
          ))}
        </div>
      </div>

      {/* Content area with optional sidebar */}
      <div className="flex flex-1 overflow-hidden">
        {/* Editor area */}
        <div className="flex-1 overflow-auto p-8">
          <div className="mx-auto max-w-3xl">
            {/* Large document title */}
            <input
              ref={titleInputRef}
              type="text"
              value={title}
              onChange={handleTitleChange}
              placeholder="Untitled"
              className="mb-6 w-full bg-transparent text-3xl font-bold text-foreground placeholder:text-muted/30 focus:outline-none"
            />
            <EditorContent editor={editor} />
          </div>
        </div>

        {/* Optional sidebar (e.g., issue properties) */}
        {sidebar && (
          <aside
            className={cn(
              'flex flex-col border-l border-border transition-all duration-200 overflow-hidden',
              rightSidebarCollapsed ? 'w-0 border-l-0' : 'w-64'
            )}
          >
            <div className="flex w-64 flex-col h-full">
              {/* Sidebar header with collapse button */}
              <div className="flex h-10 items-center justify-between border-b border-border px-3">
                <span className="text-sm font-medium text-foreground">Properties</span>
                <button
                  onClick={() => setRightSidebarCollapsed(true)}
                  className="flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-border hover:text-foreground transition-colors"
                  title="Collapse sidebar"
                >
                  <CollapseRightIcon />
                </button>
              </div>
              {/* Sidebar content */}
              <div className="flex-1 overflow-auto">
                {sidebar}
              </div>
            </div>
          </aside>
        )}

        {/* Expand button when right sidebar is collapsed */}
        {sidebar && rightSidebarCollapsed && (
          <button
            onClick={() => setRightSidebarCollapsed(false)}
            className="flex h-10 w-10 items-center justify-center border-l border-border text-muted hover:bg-border/50 hover:text-foreground transition-colors"
            title="Expand properties sidebar"
          >
            <ExpandLeftIcon />
          </button>
        )}
      </div>
    </div>
  );
}

function CollapseRightIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13 5l7 7-7 7m-8-14v14" />
    </svg>
  );
}

function ExpandLeftIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 19l-7-7 7-7m8 14V5" />
    </svg>
  );
}
