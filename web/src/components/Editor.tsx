import { useEffect, useState, useCallback, useRef, useMemo, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useEditor, EditorContent, JSONContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import { ResizableImage } from './editor/ResizableImage';
import Dropcursor from '@tiptap/extension-dropcursor';
import CodeBlockLowlight from '@tiptap/extension-code-block-lowlight';
import { common, createLowlight } from 'lowlight';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableCell from '@tiptap/extension-table-cell';
import TableHeader from '@tiptap/extension-table-header';
import TaskList from '@tiptap/extension-task-list';
import TaskItem from '@tiptap/extension-task-item';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { IndexeddbPersistence } from 'y-indexeddb';
import { cn } from '@/lib/cn';
import { Tooltip } from '@/components/ui/Tooltip';
import { apiPost } from '@/lib/api';
import { createSlashCommands } from './editor/SlashCommands';
import { DocumentEmbed } from './editor/DocumentEmbed';
import { DragHandleExtension } from './editor/DragHandle';
import { createMentionExtension } from './editor/MentionExtension';
import { ImageUploadExtension } from './editor/ImageUpload';
import { FileAttachmentExtension } from './editor/FileAttachment';
import { DetailsExtension, DetailsSummary, DetailsContent } from './editor/DetailsExtension';
import { EmojiExtension } from './editor/EmojiExtension';
import { TableOfContentsExtension } from './editor/TableOfContents';
import 'tippy.js/dist/tippy.css';

// Create lowlight instance with common languages
const lowlight = createLowlight(common);

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
  /** Breadcrumbs to show above the title */
  breadcrumbs?: React.ReactNode;
  /** Sidebar content (e.g., issue properties) */
  sidebar?: React.ReactNode;
  /** Callback to create a sub-document (for slash commands) */
  onCreateSubDocument?: () => Promise<{ id: string; title: string } | null>;
  /** Callback to navigate to a document (for slash commands) */
  onNavigateToDocument?: (id: string) => void;
  /** Callback to delete the document */
  onDelete?: () => void;
  /** Secondary header content (e.g., action buttons) - displayed below breadcrumb header */
  secondaryHeader?: React.ReactNode;
  /** Document type for filtering document-specific slash commands (e.g., 'program', 'project') */
  documentType?: string;
  /** Callback when the document is converted to a different type by another user */
  onDocumentConverted?: (newDocId: string, newDocType: 'issue' | 'project') => void;
}

type SyncStatus = 'connecting' | 'cached' | 'synced' | 'disconnected';

// Generate a consistent color from a string
function stringToColor(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = hash % 360;
  return `hsl(${hue}, 70%, 60%)`;
}

// Extract document mention IDs from TipTap JSON content
function extractDocumentMentionIds(content: JSONContent): string[] {
  const mentionIds: string[] = [];

  function traverse(node: JSONContent) {
    if (node.type === 'mention' && node.attrs?.mentionType === 'document' && node.attrs?.id) {
      mentionIds.push(node.attrs.id);
    }
    if (node.content) {
      for (const child of node.content) {
        traverse(child);
      }
    }
  }

  traverse(content);
  return [...new Set(mentionIds)]; // Deduplicate
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
  breadcrumbs,
  sidebar,
  onCreateSubDocument,
  onNavigateToDocument,
  onDelete,
  secondaryHeader,
  documentType,
  onDocumentConverted,
}: EditorProps) {
  const [title, setTitle] = useState(initialTitle === 'Untitled' ? '' : initialTitle);
  const titleInputRef = useRef<HTMLInputElement>(null);

  // Track if user has made local changes (to prevent stale server responses from overwriting)
  const hasLocalChangesRef = useRef(false);
  const lastSyncedTitleRef = useRef(initialTitle);

  // CRITICAL: Create a new Y.Doc for each documentId using useMemo
  // This ensures the Y.Doc is atomically recreated when documentId changes,
  // preventing race conditions where the WebSocket provider might use a stale Y.Doc
  // that contains content from a different document (cross-document contamination bug)
  const ydoc = useMemo(() => new Y.Doc(), [documentId]);

  // Sync title when initialTitle prop changes (e.g., from context update)
  // Only update if user hasn't made local changes (prevents stale responses from overwriting)
  useEffect(() => {
    const newTitle = initialTitle === 'Untitled' ? '' : initialTitle;
    // Only update if this is a genuinely new value from server
    // AND user hasn't made local changes since
    if (!hasLocalChangesRef.current && initialTitle !== lastSyncedTitleRef.current) {
      setTitle(newTitle);
      lastSyncedTitleRef.current = initialTitle;
    }
  }, [initialTitle]);

  // Reset local changes flag after save completes (parent will update initialTitle)
  useEffect(() => {
    if (initialTitle === title || (initialTitle === 'Untitled' && title === '')) {
      hasLocalChangesRef.current = false;
      lastSyncedTitleRef.current = initialTitle;
    }
  }, [initialTitle, title]);
  const [provider, setProvider] = useState<WebsocketProvider | null>(null);
  const [syncStatus, setSyncStatus] = useState<SyncStatus>('connecting');
  const [isBrowserOnline, setIsBrowserOnline] = useState(navigator.onLine);
  const [connectedUsers, setConnectedUsers] = useState<{ name: string; color: string }[]>([]);
  const [rightSidebarCollapsed, setRightSidebarCollapsed] = useState(() => {
    return localStorage.getItem('ship:rightSidebarCollapsed') === 'true';
  });
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);

  // Find portal target for properties sidebar (for proper landmark order)
  useLayoutEffect(() => {
    const target = document.getElementById('properties-portal');
    setPortalTarget(target);
  }, []);

  // Persist right sidebar state
  useEffect(() => {
    localStorage.setItem('ship:rightSidebarCollapsed', String(rightSidebarCollapsed));
  }, [rightSidebarCollapsed]);

  // Track browser online status for sync indicator using native browser events
  useEffect(() => {
    const handleOnline = () => setIsBrowserOnline(true);
    const handleOffline = () => setIsBrowserOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const color = userColor || stringToColor(userName);

  // Auto-focus and select title if "Untitled" (new document)
  useEffect(() => {
    if (titleInputRef.current && (!title || title === 'Untitled')) {
      titleInputRef.current.focus();
      titleInputRef.current.select();
    }
  }, []);

  // Setup IndexedDB persistence and WebSocket provider
  useEffect(() => {
    let wsProvider: WebsocketProvider | null = null;
    let hasCachedContent = false;
    let cancelled = false;

    // Create IndexedDB persistence for content caching
    // This loads cached content BEFORE WebSocket connects for instant navigation
    const indexeddbProvider = new IndexeddbPersistence(`ship-${roomPrefix}-${documentId}`, ydoc);

    // Wait for IndexedDB to load cached content (with timeout)
    // This ensures cached content shows instantly before WebSocket syncs
    const waitForCache = new Promise<void>((resolve) => {
      // Resolve immediately if already synced
      if (indexeddbProvider.synced) {
        hasCachedContent = true;
        setSyncStatus('cached');
        resolve();
        return;
      }

      // Wait for sync event
      const onSynced = () => {
        hasCachedContent = true;
        setSyncStatus((prev) => prev === 'connecting' ? 'cached' : prev);
        console.log(`[Editor] IndexedDB synced for ${roomPrefix}:${documentId}`);
        resolve();
      };
      indexeddbProvider.on('synced', onSynced);

      // Timeout after 300ms - don't block forever if no cache exists
      setTimeout(() => {
        indexeddbProvider.off('synced', onSynced);
        resolve();
      }, 300);
    });

    // Connect WebSocket AFTER cache loads (or timeout)
    waitForCache.then(() => {
      if (cancelled) return;

      // In production, use current host with wss:// (through CloudFront)
      // In development, Vite proxy handles /collaboration WebSocket (see vite.config.ts)
      const apiUrl = import.meta.env.VITE_API_URL ?? '';
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = apiUrl
        ? apiUrl.replace(/^http/, 'ws') + '/collaboration'
        : `${wsProtocol}//${window.location.host}/collaboration`;
      wsProvider = new WebsocketProvider(wsUrl, `${roomPrefix}:${documentId}`, ydoc, {
        connect: true,
      });

      wsProvider.on('status', (event: { status: string }) => {
        console.log(`[Editor] WebSocket status: ${event.status} for ${roomPrefix}:${documentId}`);
        if (event.status === 'connected') {
          setSyncStatus('synced');
        } else if (event.status === 'disconnected') {
          // If we have cached content, show 'cached' instead of 'disconnected'
          setSyncStatus(hasCachedContent ? 'cached' : 'disconnected');
        }
      });

      // Handle WebSocket close events to detect access revoked or document converted
      wsProvider.on('connection-close', (event: CloseEvent | null) => {
        if (event?.code === 4403) {
          console.log(`[Editor] Access revoked for document ${documentId}`);
          // Disable auto-reconnect since access was revoked
          wsProvider!.shouldConnect = false;
          // Show user-friendly message
          alert('Access to this document has been revoked. The document is now private.');
          // Navigate back if possible
          onBack?.();
        } else if (event?.code === 4100) {
          console.log(`[Editor] Document ${documentId} was converted`);
          // Disable auto-reconnect since document was converted
          wsProvider!.shouldConnect = false;
          // Parse conversion info from close reason
          try {
            const conversionInfo = JSON.parse(event.reason || '{}');
            if (conversionInfo.newDocId && conversionInfo.newDocType && onDocumentConverted) {
              onDocumentConverted(conversionInfo.newDocId, conversionInfo.newDocType);
            } else {
              // Fallback if callback not provided or info missing
              alert('This document was converted. Please refresh to view the new document.');
              onBack?.();
            }
          } catch {
            console.error('[Editor] Failed to parse conversion info:', event.reason);
            alert('This document was converted. Please refresh to view the new document.');
            onBack?.();
          }
        }
      });

      wsProvider.on('sync', (isSynced: boolean) => {
        console.log(`[Editor] WebSocket sync: ${isSynced} for ${roomPrefix}:${documentId}`);
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
        wsProvider!.awareness.getStates().forEach((state) => {
          if (state.user) {
            users.push(state.user);
          }
        });
        setConnectedUsers(users);
      };

      wsProvider.awareness.on('change', updateUsers);
      updateUsers();

      setProvider(wsProvider);
    });

    return () => {
      cancelled = true;
      if (wsProvider) {
        wsProvider.awareness.off('change', () => {});
        wsProvider.destroy();
      }
      indexeddbProvider.destroy();
    };
  }, [documentId, userName, color, ydoc, roomPrefix, onBack, onDocumentConverted]);

  // Create slash commands extension (memoized to avoid recreation)
  const slashCommandsExtension = useMemo(() => {
    if (!onCreateSubDocument) return null;
    return createSlashCommands({ onCreateSubDocument, onNavigateToDocument, documentType });
  }, [onCreateSubDocument, onNavigateToDocument, documentType]);

  // Create mention extension (memoized to avoid recreation)
  const mentionExtension = useMemo(() => {
    return createMentionExtension({
      onNavigate: (type, id) => {
        // Navigate to the mentioned entity
        if (type === 'person') {
          onNavigateToDocument?.(`/people/${id}`);
        } else {
          onNavigateToDocument?.(id);
        }
      },
    });
  }, [onNavigateToDocument]);

  // Build extensions - only include CollaborationCursor when provider is ready
  const baseExtensions = [
    StarterKit.configure({
      history: false,
      dropcursor: false,
      codeBlock: false, // Disable default code block to use CodeBlockLowlight
    }),
    CodeBlockLowlight.configure({
      lowlight,
      HTMLAttributes: {
        class: 'code-block-lowlight',
      },
    }),
    Placeholder.configure({ placeholder }),
    Collaboration.configure({ document: ydoc }),
    Link.configure({
      openOnClick: true,
      HTMLAttributes: {
        class: 'text-accent hover:underline cursor-pointer',
      },
    }),
    ResizableImage,
    Dropcursor.configure({
      color: '#3b82f6',
      width: 2,
    }),
    Table.configure({
      resizable: true,
      HTMLAttributes: {
        class: 'tiptap-table',
      },
    }),
    TableRow,
    TableCell,
    TableHeader,
    TaskList.configure({
      HTMLAttributes: {
        class: 'task-list',
      },
    }),
    TaskItem.configure({
      nested: true,
      HTMLAttributes: {
        class: 'task-item',
      },
    }),
    ImageUploadExtension.configure({
      onUploadStart: (file) => console.log('Upload started:', file.name),
      onUploadComplete: (url) => console.log('Upload complete:', url),
      onUploadError: (error) => console.error('Upload error:', error),
    }),
    FileAttachmentExtension,
    DocumentEmbed,
    DragHandleExtension,
    DetailsExtension,
    DetailsSummary,
    DetailsContent,
    mentionExtension,
    EmojiExtension,
    TableOfContentsExtension,
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
  }, [provider, documentType]);

  // Sync document links when editor content changes (for backlinks feature)
  const lastSyncedLinksRef = useRef<string>('');
  useEffect(() => {
    if (!editor) return;

    const syncLinks = () => {
      const json = editor.getJSON();
      const targetIds = extractDocumentMentionIds(json);
      const targetIdsKey = targetIds.sort().join(',');

      // Only sync if links have changed
      if (targetIdsKey === lastSyncedLinksRef.current) {
        return;
      }
      lastSyncedLinksRef.current = targetIdsKey;

      // POST to update links (uses target_ids for API compatibility)
      // Use apiPost to handle CSRF token automatically
      apiPost(`/api/documents/${documentId}/links`, { target_ids: targetIds })
        .catch(err => {
          console.error('[LinkSync] POST error:', err);
        });
    };

    // Debounce during editing
    let debounceTimer: ReturnType<typeof setTimeout>;
    const debouncedSync = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(syncLinks, 500);
    };

    editor.on('update', debouncedSync);
    // Sync on initial load
    syncLinks();

    return () => {
      clearTimeout(debounceTimer);
      editor.off('update', debouncedSync);
      // Flush any pending sync - but this won't complete if navigating away
      syncLinks();
    };
  }, [editor, documentId]);

  // Handle title changes
  const handleTitleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newTitle = e.target.value;
    hasLocalChangesRef.current = true; // Mark as having local changes to prevent stale overwrites
    setTitle(newTitle);
    onTitleChange?.(newTitle);
  }, [onTitleChange]);

  return (
    <div className="flex h-full flex-col">
      {/* Compact header - breadcrumb, title, status, presence all in one row */}
      <div className="flex items-center gap-3 border-b border-border px-4 py-2">
          {/* Back button with optional parent label */}
          {onBack && (
            <Tooltip content={backLabel ? `Back to ${backLabel}` : 'Back to documents'}>
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
            </Tooltip>
          )}

          {/* Optional header badge (e.g., issue number) */}
          {headerBadge}

          {/* Title (display only - edit via large title below) - h1 for accessibility */}
          {/* WCAG 1.4.12: min-w-[3rem] prevents collapse, overflow-visible shows text */}
          <h1 className="flex-1 min-w-[3rem] overflow-visible text-sm font-medium text-foreground m-0">
            {title || 'Untitled'}
          </h1>

          {/* Sync status - WCAG 4.1.3 aria-live for status messages */}
          {/* Show 'Offline' when browser is offline, regardless of WebSocket state */}
          {(() => {
            const effectiveStatus = !isBrowserOnline ? 'disconnected' : syncStatus;
            return (
              <div
                role="status"
                aria-live="polite"
                aria-atomic="true"
                className="flex items-center gap-1.5"
                data-testid="sync-status"
              >
                <div
                  className={cn(
                    'h-2 w-2 rounded-full',
                    effectiveStatus === 'synced' && 'bg-green-500',
                    effectiveStatus === 'cached' && 'bg-blue-500',
                    effectiveStatus === 'connecting' && 'bg-yellow-500 animate-pulse',
                    effectiveStatus === 'disconnected' && 'bg-red-500'
                  )}
                  aria-hidden="true"
                />
                <span className="text-xs text-muted">
                  {effectiveStatus === 'synced' && 'Saved'}
                  {effectiveStatus === 'cached' && 'Cached'}
                  {effectiveStatus === 'connecting' && 'Saving'}
                  {effectiveStatus === 'disconnected' && 'Offline'}
                </span>
              </div>
            );
          })()}

          {/* Delete button */}
          {onDelete && (
            <Tooltip content="Delete document">
              <button
                onClick={onDelete}
                className="flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-red-500/10 hover:text-red-500 transition-colors"
                aria-label="Delete document"
              >
                <TrashIcon />
              </button>
            </Tooltip>
          )}

        {/* Connected users */}
        <div className="flex items-center gap-1" data-testid="collab-status">
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

      {/* Secondary header for actions (e.g., Submit, Accept, Reject buttons) */}
      {secondaryHeader && (
        <div className="flex items-center justify-center border-b border-border px-4 py-2">
          {secondaryHeader}
        </div>
      )}

      {/* Content area with optional sidebar */}
      <div className="flex flex-1 overflow-hidden">
        {/* Editor area - clickable to focus at end */}
        <div className="flex flex-1 flex-col overflow-auto cursor-text">
          <div className="mx-auto max-w-3xl w-full py-8 pr-8 pl-12">
            {/* Breadcrumbs above title */}
            {breadcrumbs && (
              <div className="mb-2 pl-8">
                {breadcrumbs}
              </div>
            )}
            {/* Large document title */}
            <input
              ref={titleInputRef}
              type="text"
              value={title}
              onChange={handleTitleChange}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  editor?.commands.focus('start');
                }
              }}
              placeholder="Untitled"
              className="mb-6 w-full bg-transparent text-3xl font-bold text-foreground placeholder:text-muted/30 focus:outline-none pl-8"
            />
            <div className="tiptap-wrapper" data-testid="tiptap-editor">
              <EditorContent editor={editor} />
            </div>
          </div>
          {/* Spacer to fill remaining height - clickable to focus editor at end */}
          <div
            className="flex-1 min-h-[200px]"
            onClick={() => {
              if (!editor) return;
              // Focus editor at the end
              const lastNode = editor.state.doc.lastChild;
              const isLastNodeEmpty = lastNode?.type.name === 'paragraph' && lastNode.content.size === 0;

              if (isLastNodeEmpty) {
                // Focus the existing empty paragraph at the end
                editor.chain().focus('end').run();
              } else {
                // Insert a new empty paragraph at the end of the document and focus it
                const endPos = editor.state.doc.content.size;
                editor.chain()
                  .insertContentAt(endPos, { type: 'paragraph' })
                  .focus('end')
                  .run();
              }
            }}
          />
        </div>

      </div>

      {/* Properties sidebar content - rendered via portal into the aside landmark in App.tsx */}
      {sidebar && portalTarget && createPortal(
        <div
          className={cn(
            'flex flex-col border-l border-border transition-all duration-200 overflow-hidden h-full',
            rightSidebarCollapsed ? 'w-0 border-l-0' : 'w-64'
          )}
        >
          <div className="flex w-64 flex-col h-full">
            {/* Sidebar header with collapse button */}
            <div className="flex h-10 items-center justify-between border-b border-border px-3">
              <span className="text-sm font-medium text-foreground">Properties</span>
              <Tooltip content="Collapse sidebar">
                <button
                  onClick={() => setRightSidebarCollapsed(true)}
                  className="flex h-6 w-6 items-center justify-center rounded text-muted hover:bg-border hover:text-foreground transition-colors"
                  aria-label="Collapse sidebar"
                >
                  <CollapseRightIcon />
                </button>
              </Tooltip>
            </div>
            {/* Sidebar content */}
            <div className="flex-1 overflow-auto">
              {sidebar}
            </div>
          </div>

          {/* Expand button when right sidebar is collapsed */}
          {rightSidebarCollapsed && (
            <Tooltip content="Expand properties" side="left">
              <button
                onClick={() => setRightSidebarCollapsed(false)}
                className="absolute right-0 top-0 flex h-10 w-10 items-center justify-center border-l border-border text-muted hover:bg-border/50 hover:text-foreground transition-colors"
                aria-label="Expand properties sidebar"
              >
                <ExpandLeftIcon />
              </button>
            </Tooltip>
          )}
        </div>,
        portalTarget
      )}
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

function TrashIcon() {
  return (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
    </svg>
  );
}
