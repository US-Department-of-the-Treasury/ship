import { useEffect, useState, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import Placeholder from '@tiptap/extension-placeholder';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { cn } from '@/lib/cn';

interface EditorProps {
  documentId: string;
  userName: string;
  userColor?: string;
  onTitleChange?: (title: string) => void;
  initialTitle?: string;
  onBack?: () => void;
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

export function Editor({ documentId, userName, userColor, onTitleChange, initialTitle = 'Untitled', onBack }: EditorProps) {
  const [title, setTitle] = useState(initialTitle);
  const [ydoc] = useState(() => new Y.Doc());
  const [provider, setProvider] = useState<WebsocketProvider | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('connecting');
  const [connectedUsers, setConnectedUsers] = useState<{ name: string; color: string }[]>([]);

  const color = userColor || stringToColor(userName);

  // Setup WebSocket provider
  useEffect(() => {
    // WebsocketProvider appends roomName to URL, so just provide base path
    const wsUrl = 'ws://localhost:3000/collaboration';
    const wsProvider = new WebsocketProvider(wsUrl, `doc:${documentId}`, ydoc, {
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
  }, [documentId, userName, color, ydoc]);

  // Build extensions - only include CollaborationCursor when provider is ready
  const extensions = provider
    ? [
        StarterKit.configure({ history: false }),
        Placeholder.configure({ placeholder: 'Start writing...' }),
        Collaboration.configure({ document: ydoc }),
        CollaborationCursor.configure({
          provider: provider,
          user: { name: userName, color: color },
        }),
      ]
    : [
        StarterKit.configure({ history: false }),
        Placeholder.configure({ placeholder: 'Start writing...' }),
        Collaboration.configure({ document: ydoc }),
      ];

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
        {/* Back button */}
        {onBack && (
          <button
            onClick={onBack}
            className="text-muted hover:text-foreground transition-colors"
            aria-label="Back to documents"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
        )}

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

      {/* Editor area - full height */}
      <div className="flex-1 overflow-auto p-8">
        <div className="mx-auto max-w-3xl">
          {/* Large document title */}
          <input
            type="text"
            value={title}
            onChange={handleTitleChange}
            placeholder="Untitled"
            className="mb-6 w-full bg-transparent text-3xl font-bold text-foreground placeholder:text-muted/30 focus:outline-none"
          />
          <EditorContent editor={editor} />
        </div>
      </div>
    </div>
  );
}
