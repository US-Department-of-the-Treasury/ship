# TipTap Extensions Research

**Date:** 2025-12-31
**Purpose:** Comprehensive research on TipTap editor extensions and best practices for implementing rich document features in Ship.
**Current Version:** Ship uses TipTap ^2.10.4 (with Link at ^2.27.1)
**Latest TipTap Version:** 3.14.0 (as of research)

## Table of Contents

1. [Core Extensions (StarterKit)](#1-core-extensions-starterkit)
2. [Mention Extensions](#2-mention-extensions)
3. [Link Extensions](#3-link-extensions)
4. [Media Extensions](#4-media-extensions)
5. [Collaboration Extensions](#5-collaboration-extensions)
6. [Slash Commands](#6-slash-commands)
7. [Yjs Integration](#7-yjs-integration)
8. [Best Practices & Gotchas](#8-best-practices--gotchas)

---

## 1. Core Extensions (StarterKit)

### What is StarterKit?

**Package:** `@tiptap/starter-kit`
**Current Ship Version:** ^2.10.4

StarterKit is a convenience bundle that includes the most common extensions. It's the quickest way to get started with TipTap.

### What's Included in StarterKit

The StarterKit bundle includes these extensions:

#### Nodes (Block-level)
- **Document** - The root node that contains all other content
- **Paragraph** - Basic paragraph block
- **Heading** - Headings (h1-h6)
- **Blockquote** - Quote blocks
- **BulletList** - Unordered lists
- **OrderedList** - Numbered lists
- **ListItem** - List item nodes
- **CodeBlock** - Code blocks with syntax highlighting support
- **HardBreak** - Line breaks (Shift+Enter)
- **HorizontalRule** - Horizontal dividers

#### Marks (Inline formatting)
- **Bold** - Bold text
- **Italic** - Italic text
- **Strike** - Strikethrough text
- **Code** - Inline code
- **Link** - Hyperlinks (basic version, not the advanced one)

#### Functionality Extensions
- **History** - Undo/redo functionality
- **Dropcursor** - Visual indicator when dragging content
- **Gapcursor** - Navigate to otherwise inaccessible places

### Configuration in Ship

```typescript
// Current implementation in Editor.tsx
StarterKit.configure({ history: false })
```

**Why `history: false`?** The Collaboration extension provides its own history tracking through Yjs, so StarterKit's history must be disabled to avoid conflicts.

### What's NOT Included

Extensions you need to add separately:
- **Link (Advanced)** - `@tiptap/extension-link` (Ship already uses this)
- **Placeholder** - `@tiptap/extension-placeholder` (Ship already uses this)
- **Image** - `@tiptap/extension-image`
- **Mention** - `@tiptap/extension-mention`
- **Table** - `@tiptap/extension-table`
- **TaskList** - `@tiptap/extension-task-list`
- **Collaboration** - `@tiptap/extension-collaboration` (Ship already uses this)
- **CollaborationCursor** - `@tiptap/extension-collaboration-cursor` (Ship already uses this)

### Customizing StarterKit

You can disable specific bundled extensions:

```typescript
StarterKit.configure({
  history: false,  // Already done in Ship
  heading: {
    levels: [1, 2, 3],  // Only allow h1-h3
  },
  codeBlock: false,  // Disable code blocks
})
```

---

## 2. Mention Extensions

### Package Information

**Package:** `@tiptap/extension-mention`
**Latest Version:** 3.14.0
**Depends On:** `@tiptap/suggestion` (for autocomplete functionality)

### Purpose

Implement @mentions for referencing people, documents, issues, or any other entities within your content.

### Key Configuration Options

```typescript
import Mention from '@tiptap/extension-mention';
import { ReactRenderer } from '@tiptap/react';
import tippy from 'tippy.js';

Mention.configure({
  HTMLAttributes: {
    class: 'mention',
  },
  // Suggestion plugin configuration
  suggestion: {
    // Character that triggers the mention (default: '@')
    char: '@',

    // Items function - returns filtered list based on query
    items: async ({ query }) => {
      // Fetch and filter items
      return await fetchMentionables(query);
    },

    // Render function - handles UI
    render: () => {
      let component;
      let popup;

      return {
        onStart: (props) => {
          component = new ReactRenderer(MentionList, {
            props,
            editor: props.editor,
          });

          popup = tippy('body', {
            getReferenceClientRect: props.clientRect,
            appendTo: () => document.body,
            content: component.element,
            showOnCreate: true,
            interactive: true,
            trigger: 'manual',
            placement: 'bottom-start',
          });
        },

        onUpdate(props) {
          component.updateProps(props);
          popup[0].setProps({
            getReferenceClientRect: props.clientRect,
          });
        },

        onKeyDown(props) {
          if (props.event.key === 'Escape') {
            popup[0].hide();
            return true;
          }
          return component.ref?.onKeyDown(props);
        },

        onExit() {
          popup[0].destroy();
          component.destroy();
        },
      };
    },
  },
})
```

### Backend Integration Patterns

#### API Endpoint for Mention Autocomplete

```typescript
// api/src/routes/mentions.ts
router.get('/api/mentions', async (req, res) => {
  const { query, type } = req.query;

  // Type can be: 'person', 'document', 'issue', etc.
  let results = [];

  if (type === 'person') {
    results = await db.query(
      'SELECT id, name, email FROM users WHERE name ILIKE $1 LIMIT 10',
      [`%${query}%`]
    );
  } else if (type === 'document') {
    results = await db.query(
      'SELECT id, title FROM documents WHERE title ILIKE $1 LIMIT 10',
      [`%${query}%`]
    );
  }

  res.json(results);
});
```

#### Storing Mentions

Mentions are stored as nodes in the TipTap JSON structure:

```json
{
  "type": "mention",
  "attrs": {
    "id": "user-123",
    "label": "Jane Doe"
  }
}
```

When persisted to the database, they're part of the `content` column JSON.

#### Rendering Mentions

```typescript
// React component for mention list
const MentionList = forwardRef(({ items, command }, ref) => {
  const [selectedIndex, setSelectedIndex] = useState(0);

  const selectItem = (index) => {
    const item = items[index];
    if (item) {
      command({ id: item.id, label: item.name });
    }
  };

  useImperativeHandle(ref, () => ({
    onKeyDown: ({ event }) => {
      if (event.key === 'ArrowUp') {
        setSelectedIndex((prev) => (prev + items.length - 1) % items.length);
        return true;
      }
      if (event.key === 'ArrowDown') {
        setSelectedIndex((prev) => (prev + 1) % items.length);
        return true;
      }
      if (event.key === 'Enter') {
        selectItem(selectedIndex);
        return true;
      }
      return false;
    },
  }));

  return (
    &lt;div className="mention-list"&gt;
      {items.map((item, index) => (
        &lt;button
          key={item.id}
          onClick={() => selectItem(index)}
          className={index === selectedIndex ? 'selected' : ''}
        &gt;
          {item.name}
        &lt;/button&gt;
      ))}
    &lt;/div&gt;
  );
});
```

### Multiple Mention Types

You can have different mention types with different trigger characters:

```typescript
// @mentions for people
Mention.configure({
  HTMLAttributes: { class: 'mention-person' },
  suggestion: {
    char: '@',
    items: ({ query }) => fetchPeople(query),
  },
});

// #mentions for issues
Mention.extend({ name: 'issueMention' }).configure({
  HTMLAttributes: { class: 'mention-issue' },
  suggestion: {
    char: '#',
    items: ({ query }) => fetchIssues(query),
  },
});
```

### Gotchas

1. **Debouncing:** Always debounce the `items` function to avoid excessive API calls
2. **Loading States:** The suggestion plugin doesn't have built-in loading states - handle this in your component
3. **Keyboard Navigation:** Must implement keyboard navigation in your render component
4. **Positioning:** Tippy.js handles positioning, but you need to ensure the reference rect is correct

---

## 3. Link Extensions

### Package Information

**Package:** `@tiptap/extension-link`
**Ship Current Version:** ^2.27.1 (newer than other TipTap packages)
**Already Installed:** ✅ Yes

### Current Ship Implementation

```typescript
Link.configure({
  openOnClick: true,
  HTMLAttributes: {
    class: 'text-accent hover:underline cursor-pointer',
  },
})
```

### Advanced Configuration Options

```typescript
Link.configure({
  // Open links on click (default: true)
  openOnClick: true,

  // Open in new tab
  HTMLAttributes: {
    target: '_blank',
    rel: 'noopener noreferrer nofollow',
    class: 'text-accent hover:underline cursor-pointer',
  },

  // Link validation
  validate: href => /^https?:\/\//.test(href),

  // Protocols to allow
  protocols: ['http', 'https', 'mailto', 'tel'],

  // Auto-link typed URLs
  autolink: true,

  // Link on paste
  linkOnPaste: true,
})
```

### Internal Document Linking

For Ship's internal document linking (linking between documents), you can create a custom extension:

```typescript
import Link from '@tiptap/extension-link';

export const DocumentLink = Link.extend({
  name: 'documentLink',

  addAttributes() {
    return {
      ...this.parent?.(),
      documentId: {
        default: null,
      },
      href: {
        default: null,
      },
    };
  },

  addCommands() {
    return {
      ...this.parent?.(),
      setDocumentLink: (attributes) => ({ chain }) => {
        return chain()
          .setMark(this.name, {
            documentId: attributes.documentId,
            href: `/docs/${attributes.documentId}`,
          })
          .run();
      },
    };
  },

  // Intercept clicks to handle internal navigation
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleClick(view, pos, event) {
            const attrs = view.state.doc.resolve(pos).marks().find(
              mark => mark.type.name === 'documentLink'
            )?.attrs;

            if (attrs?.documentId) {
              event.preventDefault();
              // Use React Router for navigation
              navigate(`/docs/${attrs.documentId}`);
              return true;
            }
            return false;
          },
        },
      }),
    ];
  },
});
```

### Link Preview

For link previews (showing metadata when hovering over links), you can use:

```typescript
import { Plugin } from '@tiptap/pm/state';
import tippy from 'tippy.js';

const LinkPreviewExtension = Extension.create({
  name: 'linkPreview',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        view: () => ({
          update: (view) => {
            const { state } = view;
            const { selection } = state;
            const { $from } = selection;

            // Check if cursor is on a link
            const marks = $from.marks();
            const linkMark = marks.find(mark => mark.type.name === 'link');

            if (linkMark) {
              // Fetch and show preview
              fetchLinkPreview(linkMark.attrs.href).then(preview => {
                tippy(view.dom, {
                  content: renderPreview(preview),
                  // ... tippy config
                });
              });
            }
          },
        }),
      }),
    ];
  },
});
```

### Link Commands

```typescript
// Set a link
editor.chain().focus().setLink({ href: 'https://example.com' }).run();

// Update existing link
editor.chain().focus().extendMarkRange('link').setLink({ href: 'https://new-url.com' }).run();

// Remove link
editor.chain().focus().unsetLink().run();

// Toggle link (set if not present, remove if present)
editor.chain().focus().toggleLink({ href: 'https://example.com' }).run();
```

### UI Pattern: Link Bubble Menu

```typescript
const LinkBubbleMenu = ({ editor }) => {
  const [url, setUrl] = useState('');

  useEffect(() => {
    const { href } = editor.getAttributes('link');
    setUrl(href || '');
  }, [editor]);

  return (
    &lt;BubbleMenu editor={editor} shouldShow={({ editor }) => editor.isActive('link')}&gt;
      &lt;input
        type="url"
        value={url}
        onChange={(e) => setUrl(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            editor.chain().focus().setLink({ href: url }).run();
          }
        }}
      /&gt;
      &lt;button onClick={() => editor.chain().focus().unsetLink().run()}&gt;
        Remove
      &lt;/button&gt;
    &lt;/BubbleMenu&gt;
  );
};
```

---

## 4. Media Extensions

### Image Extension

**Package:** `@tiptap/extension-image`
**Latest Version:** 3.14.0
**Currently Installed in Ship:** ❌ No

#### Basic Configuration

```typescript
import Image from '@tiptap/extension-image';

Image.configure({
  inline: false,  // Block-level images
  allowBase64: false,  // Don't allow data URLs (better for performance)
  HTMLAttributes: {
    class: 'rounded-lg max-w-full',
  },
})
```

#### Image Upload Pattern

**Frontend:**

```typescript
const handleImageUpload = async (file: File) => {
  const formData = new FormData();
  formData.append('image', file);

  const response = await fetch('/api/upload/image', {
    method: 'POST',
    body: formData,
  });

  const { url } = await response.json();

  // Insert image into editor
  editor.chain().focus().setImage({ src: url }).run();
};

// Drag and drop handler
const ImageUploadExtension = Extension.create({
  name: 'imageUpload',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          handleDrop(view, event, slice, moved) {
            if (moved) return false;

            const files = Array.from(event.dataTransfer?.files || []);
            const imageFiles = files.filter(file => file.type.startsWith('image/'));

            if (imageFiles.length > 0) {
              event.preventDefault();

              imageFiles.forEach(async (file) => {
                const url = await uploadImage(file);
                const { schema } = view.state;
                const node = schema.nodes.image.create({ src: url });
                const transaction = view.state.tr.insert(view.state.selection.from, node);
                view.dispatch(transaction);
              });

              return true;
            }

            return false;
          },

          handlePaste(view, event) {
            const items = Array.from(event.clipboardData?.items || []);
            const imageItems = items.filter(item => item.type.startsWith('image/'));

            if (imageItems.length > 0) {
              event.preventDefault();

              imageItems.forEach(item => {
                const file = item.getAsFile();
                if (file) {
                  handleImageUpload(file);
                }
              });

              return true;
            }

            return false;
          },
        },
      }),
    ];
  },
});
```

**Backend (Express):**

```typescript
// api/src/routes/upload.ts
import multer from 'multer';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import sharp from 'sharp';  // Image optimization

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },  // 10MB limit
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only images allowed'));
    }
  },
});

router.post('/api/upload/image', upload.single('image'), async (req, res) => {
  if (!req.file) {
    return res.status(400).json({ error: 'No file uploaded' });
  }

  // Optimize image
  const optimized = await sharp(req.file.buffer)
    .resize(2000, 2000, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 80 })
    .toBuffer();

  // Upload to S3 (or local storage for development)
  const filename = `${Date.now()}-${req.file.originalname}`;
  const s3 = new S3Client({ region: process.env.AWS_REGION });

  await s3.send(new PutObjectCommand({
    Bucket: process.env.S3_BUCKET,
    Key: `images/${filename}`,
    Body: optimized,
    ContentType: 'image/jpeg',
    ACL: 'public-read',
  }));

  const url = `https://${process.env.S3_BUCKET}.s3.amazonaws.com/images/${filename}`;

  res.json({ url });
});
```

#### Advanced Image Features

**Resizable Images:**

```typescript
import { NodeViewWrapper, NodeViewProps } from '@tiptap/react';
import { ResizableBox } from 'react-resizable';

const ResizableImageComponent = ({ node, updateAttributes }: NodeViewProps) => {
  return (
    &lt;NodeViewWrapper&gt;
      &lt;ResizableBox
        width={node.attrs.width || 300}
        height={node.attrs.height || 200}
        onResizeStop={(e, data) => {
          updateAttributes({ width: data.size.width, height: data.size.height });
        }}
      &gt;
        &lt;img src={node.attrs.src} alt={node.attrs.alt} /&gt;
      &lt;/ResizableBox&gt;
    &lt;/NodeViewWrapper&gt;
  );
};

const ResizableImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      width: { default: null },
      height: { default: null },
    };
  },

  addNodeView() {
    return ReactNodeViewRenderer(ResizableImageComponent);
  },
});
```

### File Attachments

**Package:** `@tiptap/extension-file-handler`
**Latest Version:** 3.14.0

```typescript
import FileHandler from '@tiptap/extension-file-handler';

FileHandler.configure({
  allowedMimeTypes: ['image/*', 'application/pdf', 'text/*'],
  onDrop: (editor, files, pos) => {
    files.forEach(async (file) => {
      const url = await uploadFile(file);

      if (file.type.startsWith('image/')) {
        editor.chain().focus().setImage({ src: url }).run();
      } else {
        // Insert as a link or custom file node
        editor.chain().focus().insertContent({
          type: 'fileAttachment',
          attrs: { url, name: file.name, size: file.size },
        }).run();
      }
    });
  },
  onPaste: (editor, files) => {
    // Similar to onDrop
  },
})
```

### Video Embeds

For embedded videos (YouTube, Vimeo, etc.), create a custom node:

```typescript
import { Node } from '@tiptap/core';
import { ReactNodeViewRenderer } from '@tiptap/react';

const VideoEmbed = Node.create({
  name: 'videoEmbed',
  group: 'block',
  atom: true,

  addAttributes() {
    return {
      src: { default: null },
      provider: { default: 'youtube' },  // youtube, vimeo, etc.
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-video-embed]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', { 'data-video-embed': '', ...HTMLAttributes }];
  },

  addNodeView() {
    return ReactNodeViewRenderer(({ node }) => (
      &lt;div className="video-embed"&gt;
        &lt;iframe
          src={node.attrs.src}
          frameBorder="0"
          allowFullScreen
          className="w-full aspect-video"
        /&gt;
      &lt;/div&gt;
    ));
  },
});
```

---

## 5. Collaboration Extensions

**Ship Already Implements:** ✅ Yes

### Current Ship Implementation

```typescript
// From Editor.tsx
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

// Create Yjs document
const ydoc = new Y.Doc();

// Setup WebSocket provider
const wsProvider = new WebsocketProvider(
  wsUrl,
  `${roomPrefix}:${documentId}`,
  ydoc
);

// Configure extensions
const extensions = [
  Collaboration.configure({ document: ydoc }),
  CollaborationCursor.configure({
    provider: wsProvider,
    user: { name: userName, color: color },
  }),
];
```

### How It Works

1. **Yjs Document:** Shared data structure that holds the editor state
2. **WebSocket Provider:** Syncs changes between clients
3. **Collaboration Extension:** Binds TipTap editor to Yjs document
4. **CollaborationCursor:** Shows other users' cursors in real-time

### Backend WebSocket Server

Ship's collaboration server at `/Users/corcoss/code/ship/.worktrees/docs-mode/api/src/collaboration/index.ts` handles:
- WebSocket connections
- Yjs state synchronization
- Persistence to PostgreSQL

### Best Practices for Collaboration

1. **Disable History:** StarterKit's history conflicts with Yjs (Ship already does this)
2. **Awareness:** Use awareness for presence features (cursors, online status)
3. **Persistence:** Periodically save Yjs state to database (Ship does this)
4. **Conflict Resolution:** Yjs handles this automatically through CRDTs

### Advanced Collaboration Features

#### Comments/Annotations

```typescript
import { Mark } from '@tiptap/core';

const Comment = Mark.create({
  name: 'comment',

  addAttributes() {
    return {
      commentId: { default: null },
      resolved: { default: false },
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-comment]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', { 'data-comment': '', ...HTMLAttributes }, 0];
  },
});

// Add comment command
editor.chain().focus().setMark('comment', { commentId: 'comment-123' }).run();
```

#### Track Changes/Suggestions

**Package:** `@tiptap/extension-collaboration-history` (if available)

Or implement custom:

```typescript
const TrackChanges = Extension.create({
  name: 'trackChanges',

  addStorage() {
    return {
      changes: [],
    };
  },

  addProseMirrorPlugins() {
    return [
      new Plugin({
        appendTransaction(transactions, oldState, newState) {
          if (transactions.some(tr => tr.docChanged)) {
            // Track the change
            this.storage.changes.push({
              user: currentUser,
              timestamp: Date.now(),
              from: transactions[0].mapping.map(oldState.selection.from),
              to: transactions[0].mapping.map(oldState.selection.to),
            });
          }
        },
      }),
    ];
  },
});
```

---

## 6. Slash Commands

**Ship Implementation:** ✅ Already implemented in `/Users/corcoss/code/ship/.worktrees/docs-mode/web/src/components/editor/SlashCommands.tsx`

### Current Ship Implementation

Ship uses the `@tiptap/suggestion` package to implement Notion-style slash commands.

#### Architecture

1. **Extension Creation:** Custom extension using `Extension.create()`
2. **Suggestion Plugin:** Triggers on `/` character
3. **React Renderer:** Renders command menu with keyboard navigation
4. **Tippy.js:** Positions the menu popup
5. **Command Items:** Array of commands with titles, descriptions, icons, and actions

#### Command Structure

```typescript
interface SlashCommandItem {
  title: string;
  description: string;
  aliases: string[];  // For fuzzy search
  icon: React.ReactNode;
  command: (props: { editor: any; range: any }) => void;
}
```

### Extending Slash Commands in Ship

To add new commands to Ship's existing slash menu:

```typescript
// In SlashCommands.tsx, add to the slashCommands array:

const slashCommands: SlashCommandItem[] = [
  // ... existing commands

  // Add image upload command
  {
    title: 'Image',
    description: 'Upload an image',
    aliases: ['img', 'photo', 'picture'],
    icon: icons.image,
    command: async ({ editor, range }) => {
      editor.chain().focus().deleteRange(range).run();
      // Trigger file picker
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.onchange = async (e) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (file) {
          const url = await uploadImage(file);
          editor.chain().focus().setImage({ src: url }).run();
        }
      };
      input.click();
    },
  },

  // Add table command
  {
    title: 'Table',
    description: 'Insert a table',
    aliases: ['grid', 'spreadsheet'],
    icon: icons.table,
    command: ({ editor, range }) => {
      editor.chain().focus().deleteRange(range)
        .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
        .run();
    },
  },
];
```

### Advanced Slash Command Patterns

#### Grouped Commands

```typescript
const commandGroups = [
  {
    name: 'Basic blocks',
    commands: [
      { title: 'Text', ... },
      { title: 'Heading 1', ... },
    ],
  },
  {
    name: 'Media',
    commands: [
      { title: 'Image', ... },
      { title: 'Video', ... },
    ],
  },
];

// Render with separators
{commandGroups.map(group => (
  &lt;div key={group.name}&gt;
    &lt;div className="group-label"&gt;{group.name}&lt;/div&gt;
    {group.commands.map(cmd => ...)}
  &lt;/div&gt;
))}
```

#### Async Commands with Loading States

```typescript
{
  title: 'Generate with AI',
  description: 'Use AI to generate content',
  aliases: ['ai', 'generate', 'write'],
  icon: icons.ai,
  command: async ({ editor, range }) => {
    editor.chain().focus().deleteRange(range).run();

    // Show loading indicator
    editor.chain().focus().insertContent('Generating...').run();

    try {
      const content = await generateWithAI(editor.getText());

      // Replace loading text with generated content
      editor.chain().focus()
        .deleteRange({ from: range.from, to: editor.state.doc.content.size })
        .insertContent(content)
        .run();
    } catch (error) {
      editor.chain().focus().insertContent('Failed to generate content').run();
    }
  },
},
```

---

## 7. Yjs Integration

**Ship Implementation:** ✅ Already implemented

### How Yjs Works with TipTap

Yjs is a CRDT (Conflict-free Replicated Data Type) implementation that enables real-time collaboration.

#### Key Concepts

1. **Y.Doc:** The shared document that holds all collaborative data
2. **Y.XmlFragment:** Stores the ProseMirror document structure
3. **Awareness:** Tracks user presence (cursors, selections)
4. **Provider:** Handles synchronization (WebSocket, WebRTC, etc.)

### Ship's Current Architecture

```typescript
// 1. Create Yjs document
const ydoc = new Y.Doc();

// 2. Connect to WebSocket server
const wsProvider = new WebsocketProvider(wsUrl, roomName, ydoc);

// 3. Bind TipTap to Yjs
Collaboration.configure({ document: ydoc })

// 4. Show cursors
CollaborationCursor.configure({
  provider: wsProvider,
  user: { name: 'User', color: '#ff0000' },
})

// 5. Track awareness
wsProvider.awareness.setLocalStateField('user', {
  name: userName,
  color: color,
});

// 6. Listen for changes
wsProvider.awareness.on('change', () => {
  const users = Array.from(wsProvider.awareness.getStates().values());
  setConnectedUsers(users);
});
```

### Persistence Strategy

Ship persists Yjs state to PostgreSQL:

```typescript
// Backend: api/src/collaboration/index.ts
import * as Y from 'yjs';

// Load from database
const yjsState = await db.query(
  'SELECT yjs_state FROM documents WHERE id = $1',
  [documentId]
);

if (yjsState) {
  const state = new Uint8Array(yjsState.yjs_state);
  Y.applyUpdate(ydoc, state);
}

// Save to database (periodically or on disconnect)
const update = Y.encodeStateAsUpdate(ydoc);
await db.query(
  'UPDATE documents SET yjs_state = $1 WHERE id = $2',
  [Buffer.from(update), documentId]
);
```

### Advanced Yjs Features

#### Offline Support

```typescript
// IndexedDB provider for offline persistence
import { IndexeddbPersistence } from 'y-indexeddb';

const indexeddbProvider = new IndexeddbPersistence(roomName, ydoc);

// Sync will happen automatically when back online
```

#### Version History

```typescript
// Save snapshots
const snapshot = Y.snapshot(ydoc);
await saveSnapshot(documentId, Y.encodeSnapshot(snapshot));

// Restore from snapshot
const snapshotData = await loadSnapshot(documentId, timestamp);
const snapshot = Y.decodeSnapshot(snapshotData);
const restoredDoc = Y.createDocFromSnapshot(ydoc, snapshot);
```

#### Custom Shared Types

```typescript
// Add custom shared data beyond editor content
const ymap = ydoc.getMap('metadata');
ymap.set('lastModified', Date.now());
ymap.set('author', userId);

// Listen for changes
ymap.observe(event => {
  console.log('Metadata changed:', event.keys);
});
```

---

## 8. Best Practices & Gotchas

### Performance Best Practices

1. **Lazy Load Extensions:** Only load extensions you need

```typescript
const extensions = [
  StarterKit,
  ...(needsCollaboration ? [Collaboration, CollaborationCursor] : []),
  ...(needsMentions ? [Mention] : []),
];
```

2. **Debounce API Calls:** For mentions, search, etc.

```typescript
import { debounce } from 'lodash';

const debouncedFetch = debounce(async (query) => {
  const results = await fetchMentions(query);
  setItems(results);
}, 300);
```

3. **Optimize Images:** Always resize/compress before upload (use sharp on backend)

4. **Limit Document Size:** Very large documents can slow down the editor
   - Consider pagination for long documents
   - Use virtual scrolling for large lists

5. **Memoize Extension Configurations:** Prevent unnecessary re-renders

```typescript
// Ship already does this
const slashCommandsExtension = useMemo(() => {
  if (!onCreateSubDocument) return null;
  return createSlashCommands({ onCreateSubDocument, onNavigateToDocument });
}, [onCreateSubDocument, onNavigateToDocument]);
```

### Common Gotchas

#### 1. History Conflicts with Collaboration

**Problem:** Both StarterKit and Collaboration provide history
**Solution:** Disable StarterKit's history

```typescript
StarterKit.configure({ history: false })
```

#### 2. Extension Order Matters

**Problem:** Some extensions depend on others being loaded first
**Solution:** Load dependencies first

```typescript
// Wrong
[Collaboration, StarterKit]

// Right
[StarterKit, Collaboration]
```

#### 3. React Strict Mode Doubles Initialization

**Problem:** TipTap editors created twice in development
**Solution:** Use refs to track initialization

```typescript
const editorInitialized = useRef(false);

useEffect(() => {
  if (editorInitialized.current) return;
  editorInitialized.current = true;
  // Initialize editor
}, []);
```

#### 4. Suggestions Menu Positioning

**Problem:** Menu appears off-screen or in wrong position
**Solution:** Use Tippy.js's `flip` and `preventOverflow` modifiers

```typescript
tippy('body', {
  // ...
  popperOptions: {
    modifiers: [
      {
        name: 'flip',
        options: { fallbackPlacements: ['top', 'bottom'] },
      },
      {
        name: 'preventOverflow',
        options: { boundary: 'viewport' },
      },
    ],
  },
});
```

#### 5. Node Views and React Components

**Problem:** React components not re-rendering when attributes change
**Solution:** Use `updateAttributes` callback properly

```typescript
const Component = ({ node, updateAttributes }: NodeViewProps) => {
  // This will re-render when attrs change
  const { width } = node.attrs;

  return (
    &lt;div style={{ width }}&gt;
      &lt;button onClick={() => updateAttributes({ width: width + 10 })}&gt;
        Resize
      &lt;/button&gt;
    &lt;/div&gt;
  );
};
```

#### 6. Collaboration Connection Issues

**Problem:** Users not seeing each other's changes
**Common Causes:**
- WebSocket URL is incorrect
- CORS issues
- Server not forwarding updates properly

**Debug:**

```typescript
wsProvider.on('status', ({ status }) => {
  console.log('WebSocket status:', status);
});

wsProvider.on('sync', (isSynced) => {
  console.log('Synced:', isSynced);
});

wsProvider.on('connection-error', (error) => {
  console.error('Connection error:', error);
});
```

#### 7. Mention Autocomplete Not Working

**Problem:** Mention menu doesn't appear
**Checklist:**
- ✅ Is `@tiptap/suggestion` installed?
- ✅ Is the `items` function returning data?
- ✅ Is the render function returning an element?
- ✅ Is Tippy.js CSS loaded? (`import 'tippy.js/dist/tippy.css'`)

**Debug:**

```typescript
suggestion: {
  char: '@',
  items: ({ query }) => {
    console.log('Query:', query);
    const results = fetchItems(query);
    console.log('Results:', results);
    return results;
  },
  render: () => {
    console.log('Render called');
    return {
      onStart: (props) => console.log('Menu started', props),
      // ...
    };
  },
}
```

### Security Best Practices

1. **Sanitize HTML:** Always sanitize pasted HTML content

```typescript
import DOMPurify from 'isomorphic-dompurify';

const CleanPaste = Extension.create({
  addProseMirrorPlugins() {
    return [
      new Plugin({
        props: {
          transformPastedHTML(html) {
            return DOMPurify.sanitize(html);
          },
        },
      }),
    ];
  },
});
```

2. **Validate File Uploads:** Check file types and sizes on both client and server

```typescript
// Client
const allowedTypes = ['image/jpeg', 'image/png', 'image/gif'];
if (!allowedTypes.includes(file.type)) {
  throw new Error('Invalid file type');
}
if (file.size > 10 * 1024 * 1024) {  // 10MB
  throw new Error('File too large');
}

// Server (Express)
const upload = multer({
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!allowedTypes.includes(file.mimetype)) {
      cb(new Error('Invalid file type'));
    } else {
      cb(null, true);
    }
  },
});
```

3. **Rate Limit API Endpoints:** Especially for uploads and mentions

```typescript
import rateLimit from 'express-rate-limit';

const uploadLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,  // 15 minutes
  max: 100,  // 100 requests per window
});

router.post('/api/upload/image', uploadLimiter, upload.single('image'), ...);
```

4. **Authenticate WebSocket Connections:** Validate user identity

```typescript
// Backend
wsServer.on('connection', (ws, req) => {
  const token = req.url.split('token=')[1];
  const user = validateToken(token);

  if (!user) {
    ws.close(4001, 'Unauthorized');
    return;
  }

  // Continue with connection...
});
```

### Accessibility Best Practices

1. **Keyboard Navigation:** Ensure all features work with keyboard

```typescript
// Ship's SlashCommands already implements this
useImperativeHandle(ref, () => ({
  onKeyDown: ({ event }: { event: KeyboardEvent }) => {
    if (event.key === 'ArrowUp') { /* navigate up */ }
    if (event.key === 'ArrowDown') { /* navigate down */ }
    if (event.key === 'Enter') { /* select */ }
    if (event.key === 'Escape') { /* close */ }
    return true;
  },
}));
```

2. **ARIA Labels:** Add proper labels to interactive elements

```typescript
&lt;button
  onClick={handleClick}
  aria-label="Bold text"
  aria-pressed={editor.isActive('bold')}
&gt;
  &lt;BoldIcon /&gt;
&lt;/button&gt;
```

3. **Focus Management:** Ensure editor maintains focus correctly

```typescript
editor.chain().focus().run();  // Always chain .focus() before commands
```

---

## Recommendations for Ship

Based on this research and Ship's current implementation:

### Immediate Additions (High Value, Low Complexity)

1. **Mention Extension** (`@tiptap/extension-mention`)
   - Ship already has user/document data
   - Pattern similar to existing slash commands
   - Enables @mentions for people and #mentions for issues/documents

2. **Image Extension** (`@tiptap/extension-image`)
   - Essential for rich document features
   - Backend upload endpoint needed (can use local storage initially)
   - Use Ship's existing file structure pattern

3. **Task List Extension** (`@tiptap/extension-task-list`)
   - Checkbox lists for issues and project planning
   - Minimal setup required
   - Integrates well with Ship's project management focus

### Medium Priority (Add When Needed)

4. **Table Extension** (`@tiptap/extension-table`)
   - Useful for structured data in documents
   - More complex UI (row/col controls)
   - Consider when users request it

5. **Code Block with Syntax Highlighting** (`@tiptap/extension-code-block-lowlight`)
   - Better than basic code blocks
   - Technical teams will appreciate it
   - Requires loading highlight.js languages

### Future Enhancements

6. **Comments/Annotations** (Custom extension)
   - Build on top of collaboration
   - Threaded discussions on specific content
   - Requires additional UI for comment threads

7. **Track Changes** (Custom extension)
   - Useful for formal document review
   - Complex implementation
   - Consider third-party solutions first

### What NOT to Add

- **WYSIWYG Table Editing:** Too complex, use existing table extension
- **Custom Fonts:** Adds complexity, stick to system fonts
- **Inline Drawings:** Use image uploads instead
- **Math Equations:** Only if specifically needed (use `@tiptap/extension-mathematics`)

---

## Version Upgrade Considerations

Ship currently uses TipTap 2.10.4, but the latest is 3.14.0.

### Breaking Changes in TipTap 3.x

1. **Package Structure:** More granular packages
2. **TypeScript:** Stricter types
3. **Node Views:** API changes in React renderer
4. **Commands:** Chainable commands syntax improvements

### Upgrade Recommendation

**Wait until Ship's MVP is stable.** TipTap 2.x is stable and well-supported. Upgrade to 3.x when:
- You need specific 3.x features
- You're doing a major refactor
- 2.x stops receiving security updates

### If Upgrading

1. Test collaboration thoroughly (biggest risk area)
2. Review custom extensions (DocumentEmbed, DragHandle, SlashCommands)
3. Update TypeScript types
4. Test all slash commands
5. Verify Yjs integration still works

---

## Additional Resources

- **TipTap Docs:** https://tiptap.dev/docs/editor/introduction
- **TipTap GitHub:** https://github.com/ueberdosis/tiptap
- **Yjs Docs:** https://docs.yjs.dev/
- **ProseMirror Guide:** https://prosemirror.net/docs/guide/
- **Ship's Current Implementation:**
  - `/Users/corcoss/code/ship/.worktrees/docs-mode/web/src/components/Editor.tsx`
  - `/Users/corcoss/code/ship/.worktrees/docs-mode/web/src/components/editor/SlashCommands.tsx`
  - `/Users/corcoss/code/ship/.worktrees/docs-mode/web/src/components/editor/DocumentEmbed.tsx`
  - `/Users/corcoss/code/ship/.worktrees/docs-mode/api/src/collaboration/index.ts`

---

**End of Research Document**
