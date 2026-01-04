# Application Architecture

This document describes the application architecture for the Ship greenfield rebuild.

> **Related**: See [Unified Document Model](./unified-document-model.md) for data model and [Document Model Conventions](./document-model-conventions.md) for terminology.

## Design Principles

1. **Maximally simple** - Avoid complexity until proven necessary
2. **Boring technology** - Use well-understood tools over cutting-edge
3. **Single codebase** - One repo, shared types, unified tooling
4. **Server is source of truth** - Offline-tolerant, not offline-first

## Tech Stack

| Layer              | Technology               | Rationale                                 |
| ------------------ | ------------------------ | ----------------------------------------- |
| **Runtime**        | Node.js                  | JavaScript everywhere, large ecosystem    |
| **API Framework**  | Express                  | Battle-tested, simple, ubiquitous         |
| **Frontend**       | React + Vite             | Fast dev experience, TipTap/Yjs ecosystem |
| **Database**       | PostgreSQL               | Reliable, feature-rich, direct SQL        |
| **DB Client**      | pg (raw SQL)             | Maximum simplicity, no abstraction        |
| **Client Storage** | IndexedDB (y-indexeddb)  | Editor content cache (implemented)        |
| **Real-time**      | WebSocket (y-websocket)  | Yjs sync for collaborative editing        |
| **Rich Text**      | TipTap + Yjs             | Offline-tolerant via IndexedDB cache      |
| **State Mgmt**     | React Context (current)  | TanStack Query migration planned          |
| **UI Components**  | shadcn/ui                | Tailwind + Radix, copy-paste ownership    |
| **Router**         | React Router v6          | Boring, ubiquitous, works with Vite       |
| **Forms**          | React Hook Form          | Performant, good validation               |
| **Dates**          | date-fns                 | Modular, tree-shakeable, immutable        |
| **i18n**           | react-i18next            | Structured for future translations        |
| **Secrets**        | SSM Parameter Store      | AWS-native, gov-compliant                 |

## Repository Structure

Single repo with separate builds:

```
ship/
├── api/                    # Express backend
│   ├── src/
│   │   ├── routes/         # REST endpoints
│   │   ├── db/             # Database client + schema
│   │   ├── collaboration/  # WebSocket + Yjs handlers
│   │   ├── middleware/     # Auth, etc.
│   │   └── index.ts        # Entry point
│   ├── package.json
│   └── tsconfig.json
│
├── web/                    # React frontend
│   ├── src/
│   │   ├── components/     # UI components
│   │   ├── pages/          # Route pages
│   │   ├── hooks/          # Custom hooks
│   │   ├── stores/         # Zustand stores
│   │   ├── db/             # IndexedDB access
│   │   └── main.tsx        # Entry point
│   ├── package.json
│   └── vite.config.ts
│
├── shared/                 # Shared code
│   ├── types/              # TypeScript types
│   └── constants/          # Shared constants
│
├── package.json            # Workspace root
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

## API Architecture

### Express Server

Single Express process handles both REST and WebSocket:

```typescript
// api/src/index.ts
import express from "express";
import { createServer } from "http";
import { WebSocketServer } from "ws";

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// REST routes
app.use("/api/documents", documentsRouter);
app.use("/api/programs", programsRouter);
app.use("/api/auth", authRouter);

// WebSocket for real-time
wss.on("connection", handleConnection);

server.listen(3000);
```

### Database Access (pg)

Direct SQL queries for maximum simplicity:

```typescript
// api/src/db/pool.ts
import { Pool } from "pg";

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// api/src/db/documents.ts
import { pool } from "./pool";

export async function getDocument(id: string) {
  const result = await pool.query(
    "SELECT * FROM documents WHERE id = $1",
    [id]
  );
  return result.rows[0];
}

export async function createDocument(doc: NewDocument) {
  const result = await pool.query(
    `INSERT INTO documents (workspace_id, document_type, title, content, properties)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING *`,
    [doc.workspace_id, doc.document_type, doc.title, doc.content, doc.properties]
  );
  return result.rows[0];
}
```

### REST API Design

Simple RESTful endpoints:

| Method | Endpoint             | Description                   |
| ------ | -------------------- | ----------------------------- |
| GET    | `/api/documents`     | List documents (with filters) |
| GET    | `/api/documents/:id` | Get single document           |
| POST   | `/api/documents`     | Create document               |
| PATCH  | `/api/documents/:id` | Update document               |
| DELETE | `/api/documents/:id` | Delete document               |
| GET    | `/api/programs`      | List programs                 |

### WebSocket Protocol

For real-time collaboration (TipTap/Yjs) and presence:

```typescript
// Message types
type WSMessage =
  | { type: "yjs-sync"; docId: string; update: Uint8Array }
  | { type: "presence-join"; docId: string; user: User }
  | { type: "presence-leave"; docId: string; userId: string }
  | { type: "doc-update"; docId: string; changes: Change[] };
```

## Frontend Architecture

### State Management

#### Current Implementation (React Context)

Lists and metadata currently use React Context + useState with direct API calls:

```typescript
// web/src/contexts/DocumentsContext.tsx (current)
const [documents, setDocuments] = useState<Document[]>([]);

const refreshDocuments = useCallback(async () => {
  const res = await apiGet('/api/documents?type=wiki');
  if (res.ok) setDocuments(await res.json());
}, []);
```

**Limitations of current approach:**
- No caching across page navigations
- No automatic cache invalidation
- No offline support for lists
- Full re-renders on context updates

#### Target Architecture (TanStack Query + IndexedDB)

Migration to TanStack Query with IndexedDB persistence is planned:

```typescript
// Target: TanStack Query with IndexedDB persist
const { data: documents } = useQuery({
  queryKey: ["documents", { programId }],
  queryFn: () => fetchDocuments(programId),
  staleTime: 1000 * 60, // 1 minute
});

// Mutations with optimistic updates
const mutation = useMutation({
  mutationFn: createDocument,
  onMutate: async (newDoc) => {
    // Optimistic update - show immediately
    await queryClient.cancelQueries(['documents']);
    const previous = queryClient.getQueryData(['documents']);
    queryClient.setQueryData(['documents'], (old) => [...old, newDoc]);
    return { previous };
  },
  onError: (err, newDoc, context) => {
    // Rollback on error
    queryClient.setQueryData(['documents'], context.previous);
  },
  onSettled: () => queryClient.invalidateQueries(['documents']),
});
```

**Zustand** for UI-only state (unchanged):

```typescript
// Minimal UI state - does not need offline persistence
const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  currentMode: "programs",
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
}));
```

### Offline Strategy

**Design Philosophy**: Email-client UX - app feels native, works on flaky wifi, syncs when online.

**Model**: Offline-tolerant (server is source of truth, last-write-wins for conflicts)

#### Two-Layer Sync Architecture

Ship uses two different sync mechanisms optimized for their data types:

| Layer | Data Type | Sync Technology | Offline Behavior |
|-------|-----------|-----------------|------------------|
| **Editor Content** | Yjs documents | y-websocket + y-indexeddb | ✅ **Implemented** - edits queue locally, auto-merge on reconnect |
| **Lists/Metadata** | Documents, issues, programs | TanStack Query + IndexedDB persist | 🔲 **Planned** - currently requires connection |

#### Layer 1: Editor Content (Implemented)

Collaborative document editing uses Yjs CRDTs with dual persistence:

```typescript
// web/src/components/Editor.tsx (current implementation)
import { IndexeddbPersistence } from 'y-indexeddb';
import { WebsocketProvider } from 'y-websocket';

// IndexedDB caches content locally - loads instantly
const indexeddbProvider = new IndexeddbPersistence(`ship-${roomPrefix}-${documentId}`, ydoc);

// WebSocket syncs with server - handles real-time collaboration
const wsProvider = new WebsocketProvider(wsUrl, `${roomPrefix}:${documentId}`, ydoc);
```

**How it works:**
1. **Open document**: IndexedDB loads cached content instantly (no spinner)
2. **WebSocket connects**: Merges any server changes via CRDT (conflict-free)
3. **Edit offline**: Changes saved to IndexedDB, queued for sync
4. **Reconnect**: Yjs automatically merges local + server changes

**Status indicators:**
- `Saved` (green) - synced with server
- `Cached` (blue) - loaded from local cache, not yet synced
- `Saving` (yellow) - connecting to server
- `Offline` (red) - disconnected, edits cached locally

#### Layer 2: Lists/Metadata (Planned)

Document lists, properties, and metadata will use TanStack Query with IndexedDB persistence:

```
┌─────────────────────────────────────────────────────────────┐
│                        Architecture                          │
├─────────────────────────────────────────────────────────────┤
│  UI Layer (React Components)                                │
├─────────────────────────────────────────────────────────────┤
│  TanStack Query                     │  Yjs (Editor)         │
│  - Query cache (in-memory)          │  - Y.Doc (in-memory)  │
│  - Mutations with optimistic UI     │  - CRDT operations    │
│  ↕                                  │  ↕                    │
│  IndexedDB Persister                │  y-indexeddb          │
│  (query cache survives reload)      │  (doc survives reload)│
│  ↕                                  │  ↕                    │
│  REST API (/api/*)                  │  WebSocket (/collab)  │
├─────────────────────────────────────────────────────────────┤
│                    PostgreSQL (source of truth)              │
└─────────────────────────────────────────────────────────────┘
```

**Target implementation (planned):**

```typescript
// Target: TanStack Query with IndexedDB persistence
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import { persistQueryClient } from '@tanstack/react-query-persist-client';

const persister = createSyncStoragePersister({
  storage: window.localStorage, // or IndexedDB adapter
});

persistQueryClient({
  queryClient,
  persister,
  maxAge: 1000 * 60 * 60 * 24, // 24 hours
});
```

**Offline mutation queue (planned):**

```typescript
// Target: Queued mutations for offline writes
const mutation = useMutation({
  mutationFn: createDocument,
  onMutate: async (newDoc) => {
    // Show optimistically
    queryClient.setQueryData(['documents'], (old) => [...old, { ...newDoc, _pending: true }]);
  },
  retry: true, // Retry when back online
  networkMode: 'offlineFirst',
});
```

#### Conflict Resolution

| Data Type | Strategy | Rationale |
|-----------|----------|-----------|
| Editor content | CRDT auto-merge | Yjs handles this - no conflicts possible |
| Structured data | Last-write-wins | Simple, predictable, server timestamp decides |

**Last-write-wins behavior:**
- Each mutation includes client timestamp
- Server compares with current `updated_at`
- Most recent timestamp wins
- User's offline edit may be overwritten if server has newer data
- No conflict UI needed - keep it simple

## Real-Time Collaboration

**Offline-tolerant** - editing works offline, collaboration resumes on reconnect.

### TipTap + Yjs Integration

```typescript
// web/src/components/Editor.tsx
const editor = useEditor({
  extensions: [
    StarterKit,
    Collaboration.configure({
      document: ydoc,
    }),
    CollaborationCursor.configure({
      provider: wsProvider,
    }),
  ],
});
```

### Presence

Show who's viewing/editing:

```typescript
// Presence state via Yjs Awareness
awareness.setLocalState({
  user: { id: currentUser.id, name: currentUser.name },
  cursor: null,
});
```

**Offline behavior**:

- Document opens with cached content (IndexedDB)
- No presence indicators when offline
- Edits saved locally, queued for sync
- On reconnect: Yjs CRDT auto-merges changes, presence restored
- No data loss - offline edits always preserved

## Authentication

**PIV/CAC primary, password fallback**:

```
┌─────────────────────────────────────────────────────────────┐
│                    Authentication Flow                       │
│                                                              │
│  ┌─────────┐         ┌─────────────┐         ┌───────────┐  │
│  │ Browser │ ──────> │ CloudFront  │ ──────> │ ALB (mTLS)│  │
│  │ (PIV)   │  HTTPS  │             │         │           │  │
│  └─────────┘         └─────────────┘         └─────┬─────┘  │
│                                                    │         │
│                                              PIV cert        │
│                                              extracted       │
│                                                    │         │
│                                                    ▼         │
│                                              ┌───────────┐   │
│                                              │  Express  │   │
│                                              │  (auth)   │   │
│                                              └───────────┘   │
└─────────────────────────────────────────────────────────────┘
```

For non-PIV users (testing, external):

- Username/password authentication
- Session stored in secure cookie
- Configurable per environment

## Deployment

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Internet                              │
└────────────────────────────┬────────────────────────────────┘
                             │
                             ▼
              ┌──────────────────────────────┐
              │     CloudFront Distribution   │
              │                              │
              │  /            → S3 (React)   │
              │  /api/*       → ALB          │
              │  /ws/*        → ALB          │
              └──────────────┬───────────────┘
                             │
              ┌──────────────┴───────────────┐
              │                              │
              ▼                              ▼
     ┌─────────────────┐           ┌─────────────────┐
     │   S3 Bucket     │           │      ALB        │
     │   (React app)   │           │   (mTLS opt)    │
     └─────────────────┘           └────────┬────────┘
                                            │
                                            ▼
                              ┌──────────────────────────┐
                              │  Elastic Beanstalk       │
                              │  (Docker / Node.js)      │
                              │                          │
                              │  ┌────────────────────┐  │
                              │  │  Express + WS      │  │
                              │  │  (single process)  │  │
                              │  └────────────────────┘  │
                              └────────────┬─────────────┘
                                           │
                              ┌────────────┴─────────────┐
                              │                          │
                              ▼                          ▼
                    ┌─────────────────┐       ┌─────────────────┐
                    │   PostgreSQL    │       │   S3 (files)    │
                    │   (Aurora)      │       │                 │
                    └─────────────────┘       └─────────────────┘
```

### Container

Single Docker container:

```dockerfile
# Dockerfile
FROM node:20-slim

WORKDIR /app
COPY api/dist ./dist
COPY api/package.json ./

RUN npm ci --production

EXPOSE 3000
CMD ["node", "dist/index.js"]
```

### Infrastructure

- **Frontend**: S3 + CloudFront (static files)
- **API**: Elastic Beanstalk (Docker) or ECS Fargate
- **Database**: Aurora Serverless v2 (PostgreSQL)
- **Files**: S3 (attachments)

## Testing Strategy

**E2E-heavy approach** - test real user flows, not implementation details.

### Playwright E2E Tests

Primary testing strategy. **Chromium only** - Firefox/Safari add maintenance burden without meaningful coverage benefit for our use case.

```typescript
// e2e/documents.spec.ts
test("create and edit document", async ({ page }) => {
  await page.goto("/programs/auth");
  await page.click('[data-testid="new-document"]');
  await page.fill('[data-testid="document-title"]', "Test Doc");
  await page.click('[data-testid="save"]');
  await expect(page.locator(".document-title")).toHaveText("Test Doc");
});
```

```bash
# Run tests (Chromium only)
pnpm test:e2e

# Run specific test file
pnpm test:e2e e2e/sprints.spec.ts
```

### Test Categories

| Category  | Scope                       | When to Run  |
| --------- | --------------------------- | ------------ |
| **Smoke** | Critical paths only         | Every commit |
| **E2E**   | All user flows              | PR merge     |
| **Unit**  | Complex business logic only | As needed    |

### Test Data

- Seed scripts for consistent test state
- Clean database before each E2E run
- No shared state between tests

## UI Components

**shadcn/ui** - Tailwind-based components with copy-paste ownership.

### Why shadcn/ui

- Copy components into codebase (not npm dependency)
- Full control over styling and behavior
- Radix primitives for accessibility
- Tailwind for consistent styling

### Component Structure

```
web/src/components/
├── ui/                    # shadcn/ui components (copied)
│   ├── button.tsx
│   ├── dialog.tsx
│   ├── dropdown-menu.tsx
│   └── ...
├── documents/             # Feature components
│   ├── DocumentList.tsx
│   ├── DocumentEditor.tsx
│   └── ...
└── layout/                # Layout components
    ├── Sidebar.tsx
    └── Header.tsx
```

### Styling

```typescript
// Tailwind + cn() utility for conditional classes
import { cn } from "@/lib/utils";

<Button className={cn("w-full", isLoading && "opacity-50")} />;
```

## Accessibility

**Section 508 strict compliance** required for government deployment.

### Requirements

- WCAG 2.1 AA minimum
- Keyboard navigation for all interactions
- Screen reader support (NVDA, JAWS, VoiceOver)
- Focus management for modals/dialogs
- Color contrast ratios (4.5:1 text, 3:1 UI)

### Implementation

shadcn/ui (Radix primitives) provides:

- Proper ARIA attributes
- Focus trapping in modals
- Keyboard shortcuts
- Screen reader announcements

### Testing

- axe-core automated checks in E2E tests
- Manual screen reader testing before release
- Keyboard-only navigation testing

## Observability

**CloudWatch only** - AWS-native, government-compliant.

### Logging

```typescript
// Structured JSON logs
const logger = {
  info: (message: string, context?: object) =>
    console.log(JSON.stringify({ level: "info", message, ...context, timestamp: new Date().toISOString() })),
  error: (message: string, error?: Error, context?: object) =>
    console.error(
      JSON.stringify({
        level: "error",
        message,
        error: error?.message,
        stack: error?.stack,
        ...context,
        timestamp: new Date().toISOString(),
      })
    ),
};
```

### Metrics

- CloudWatch Container Insights for EB
- Custom metrics via AWS SDK when needed
- No external APM tools (gov restriction)

### Alerting

- CloudWatch Alarms for error rates
- SNS notifications to on-call
- No PagerDuty/OpsGenie (use email/SMS)

## Database Migrations

**Manual SQL + reviewed** - safe for government deployments.

### Migration Workflow

```bash
# 1. Create migration file
touch api/src/db/migrations/YYYYMMDD_migration_name.sql

# 2. Write SQL migration
cat api/src/db/migrations/20241230_add_sprint_number.sql

# 3. Test locally
psql $DATABASE_URL -f api/src/db/migrations/20241230_add_sprint_number.sql

# 4. PR review includes migration review

# 5. Run in production (manually or via deploy script)
```

### SQL Migration Example

```sql
-- api/src/db/migrations/20241230_add_sprint_number.sql

-- UP
ALTER TABLE documents ADD COLUMN sprint_number INTEGER;

-- DOWN (in separate rollback file or commented)
-- ALTER TABLE documents DROP COLUMN sprint_number;
```

For complex migrations, use a simple runner:

```typescript
// api/src/db/migrate.ts
import { pool } from "./pool";
import fs from "fs";
import path from "path";

async function migrate() {
  const migrationsDir = path.join(__dirname, "migrations");
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith(".sql")).sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), "utf-8");
    await pool.query(sql);
    console.log(`Applied: ${file}`);
  }
}
```

### Safety Rules

- Write rollback SQL for every migration
- Test rollback locally before deploy
- No destructive changes without data backup
- Large data migrations run separately from schema changes

## Development

### Local Setup

```bash
# Install dependencies
pnpm install

# Start database
docker compose up -d postgres

# Run migrations
pnpm db:migrate

# Start dev servers (parallel)
pnpm dev
```

### Dev Server Ports

| Service         | Port |
| --------------- | ---- |
| Vite (frontend) | 5173 |
| Express (API)   | 3000 |
| PostgreSQL      | 5432 |

### Scripts

```json
{
  "dev": "concurrently \"pnpm --filter api dev\" \"pnpm --filter web dev\"",
  "build": "pnpm --filter api build && pnpm --filter web build",
  "test": "pnpm --filter api test && pnpm --filter web test",
  "db:migrate": "pnpm --filter api db:migrate",
  "db:generate": "pnpm --filter api db:generate"
}
```

## Decision Log

### 2024-12-30: Application Architecture Interview

**Attendees:** User + Claude

**Key Decisions:**

1. **Backend**: Node.js + Express (simple, ubiquitous)
2. **Frontend**: React + Vite (ecosystem support for TipTap/Yjs)
3. **Database access**: pg (raw SQL, not ORM)
4. **Repo structure**: Single repo, separate builds (web/, api/, shared/)
5. **Deployment**: Single container (EB or ECS) + S3/CloudFront
6. **Real-time**: WebSocket on same Express process
7. **Auth**: PIV + password fallback
8. **State management**: TanStack Query + light Zustand
9. **Offline model**: Offline-tolerant (queue writes, last-write-wins)
10. **Collab editing**: Real-time only (requires connection)

**Rationale for Key Choices:**

- **Express over Fastify**: More ubiquitous, "boring technology"
- **pg over Kysely/ORM**: Maximum simplicity, full SQL control, no abstraction overhead
- **Offline-tolerant over offline-first**: Much simpler, meets "works on plane" requirement
- **Single container**: Simplest deployment, no microservices
- **WebSocket same process**: Avoids separate service, sticky sessions if scaling

### 2024-12-30: Implementation Decisions Interview

**Attendees:** User + Claude

**Key Decisions:**

1. **Migration strategy**: Clean break (no data migration from old system)
2. **Testing approach**: E2E-heavy (Playwright focus, minimal unit tests)
3. **Error tracking**: CloudWatch only (AWS-native, gov-compliant)
4. **UI components**: shadcn/ui (Tailwind + Radix primitives)
5. **Database migrations**: Manual + reviewed (safe, auditable)
6. **Expected scale**: Department-level (20-200 users)
7. **Bulk operations**: One-at-a-time REST (simple, client batches)
8. **WebSocket recovery**: Simple reconnect + refetch from REST
9. **Accessibility**: Section 508 strict compliance

**Rationale:**

- **Clean break over migration**: Greenfield rebuild, don't carry technical debt
- **E2E-heavy**: Tests real user flows, shadcn/ui components don't need unit tests
- **CloudWatch only**: Gov-compliant, no external services (Sentry blocked)
- **shadcn/ui**: Copy-paste ownership, Radix accessibility, Tailwind consistency
- **Manual migrations**: Government deployments favor safety over convenience

### 2024-12-30: Library & Tooling Decisions

**Attendees:** User + Claude

**Key Decisions:**

1. **Secrets management**: SSM Parameter Store (AWS-native, gov-compliant)
2. **CI/CD**: Manual deploys initially (scripts, not pipeline)
3. **Router**: React Router v6 (boring technology, ubiquitous)
4. **i18n**: react-i18next (structure for future, English only initially)
5. **Forms**: React Hook Form (performant, good validation)
6. **Document export**: Not initially (browser print if needed)
7. **API errors**: Simple JSON `{ error: string, code?: string }`
8. **Feature flags**: None (ship to everyone, simplest)
9. **Date library**: date-fns (modular, tree-shakeable)

**Rationale:**

- **SSM over Secrets Manager**: Simpler, cheaper, sufficient for most secrets
- **Manual deploys**: Start simple, add CI/CD when it becomes painful
- **React Router over TanStack Router**: "Boring technology" - everyone knows it
- **i18n structure early**: Easier than retrofitting, low overhead with react-i18next
- **No feature flags**: YAGNI - add when needed, don't over-engineer

### 2024-12-30: UX & Infrastructure Decisions

**Attendees:** User + Claude

**Key Decisions:**

1. **File uploads**: Direct to S3 via presigned URLs
2. **Notifications**: In-app toasts only (no inbox, no email)
3. **Dark mode**: Yes, user toggle (not system preference)
4. **URL structure**: Resource-based (`/programs/:id`, `/documents/:id`)
5. **Pagination**: Cursor-based (handles real-time better)
6. **Keyboard shortcuts**: Comprehensive (CMD+K palette, vim-like nav)

**Rationale:**

- **Direct S3 uploads**: Better for large files, offloads API server
- **In-app toasts only**: Simplest notification pattern, add inbox later if needed
- **User toggle dark mode**: Users expect theme control, shadcn/ui makes it easy
- **Resource-based URLs**: Clean, bookmarkable, RESTful
- **Cursor pagination**: Robust with real-time updates and offline sync
- **Comprehensive shortcuts**: Power user focus - productivity apps need this

### 2024-12-30: Security & Compliance Decisions

**Attendees:** User + Claude

**Key Decisions:**

1. **Audit logging**: Yes, basic (log CRUD operations to DB)
2. **Session timeout**: 15 minutes strict (government standard)

**Implementation Notes:**

- **Audit log schema**: `audit_logs(id, user_id, action, resource_type, resource_id, changes_json, ip, timestamp)`
- **Session timeout**: Cookie expiry + server-side session validation
- **Idle timeout**: Warn at 14 min, auto-logout at 15 min
- **Re-auth for sensitive actions**: Consider requiring fresh auth for destructive operations

### 2026-01-03: Offline Architecture Clarification

**Attendees:** User + Claude

**Context:** Architecture review revealed docs described TanStack Query + IndexedDB but implementation used React Context. Clarified intended architecture through interview.

**Key Decisions:**

1. **Two-layer sync architecture**: Editor content (Yjs) and lists/metadata (TanStack Query) use different strategies
2. **Editor offline**: Already implemented via y-indexeddb - works fully offline
3. **Lists offline (planned)**: TanStack Query + IndexedDB persistence + mutation queue
4. **Conflict resolution**: Last-write-wins for structured data (simple, no UI needed)
5. **Design philosophy**: "Email client UX" - works on flaky wifi, syncs when online
6. **Scope**: Full offline for everything (no exceptions that add complexity)

**Implementation Phases:**

| Phase | Scope | Status |
|-------|-------|--------|
| Editor content | Yjs + y-indexeddb + y-websocket | ✅ Implemented |
| TanStack Query migration | Replace Context + useState | 🔲 Planned |
| IndexedDB persistence | Persist query cache | 🔲 Planned |
| Offline mutation queue | Queue writes, sync on reconnect | 🔲 Planned |

**Rationale:**

- **Two-layer approach**: Editor benefits from CRDT (conflict-free), lists can use simpler last-write-wins
- **Full offline**: Exceptions add their own complexity; simpler to make everything work offline
- **Last-write-wins**: Avoids conflict UI complexity; users understand "most recent change wins"

---

## Roadmap

Features planned but not yet implemented:

### TanStack Query Migration (High Priority)

Replace React Context with TanStack Query for server state:

| Current | Target |
|---------|--------|
| `DocumentsContext` + useState | `useDocuments()` hook with TanStack Query |
| `IssuesContext` + useState | `useIssues()` hook with TanStack Query |
| `ProgramsContext` + useState | `usePrograms()` hook with TanStack Query |
| `WorkspaceContext` + useState | `useWorkspace()` hook with TanStack Query |

**Why:** Enables caching, optimistic updates, and offline persistence. Current Context pattern causes full re-renders and no caching.

### Offline Mutation Queue

Queued writes for true offline support:

```typescript
// TanStack Query mutation with offline support
const mutation = useMutation({
  mutationFn: createDocument,
  networkMode: 'offlineFirst',
  retry: true,
});
```

**Why:** Enables creating/editing documents while offline. Changes sync automatically on reconnect.

### Type-Safe Query Builder

Consider adding Kysely or similar for complex queries:

```typescript
// Future: Type-safe queries for complex operations
const results = await db
  .selectFrom("documents")
  .where("document_type", "=", "issue")
  .where("properties", "@>", '{"state": "in_progress"}')
  .selectAll()
  .execute();
```

**Why:** Raw SQL is sufficient for simple CRUD. Type-safe builder may help with complex filtering/reporting queries.

---

## E2E Offline Test Infrastructure Requirements

The e2e/offline-*.spec.ts test suite is comprehensive TDD coverage for offline functionality. Tests are organized into what currently passes vs. what needs infrastructure.

### Currently Passing (14 tests)

**offline-03-editor-content.spec.ts** - Editor content offline persistence via Yjs + y-indexeddb:
- Document content loads from IndexedDB when offline
- Offline edits persist across page reloads
- Offline edits sync when reconnected
- Multiple documents can be edited offline

**Why these pass:** Layer 1 (Editor Content) is fully implemented with y-indexeddb.

### Skipped Tests (138 tests) - Infrastructure Needed

Tests in these categories are skipped because they require Layer 2 infrastructure that is not yet implemented:

#### 1. TanStack Query + IndexedDB Persistence

**Required for:** Lists caching, metadata persistence, offline page loads

```typescript
// Target implementation
import { persistQueryClient } from '@tanstack/react-query-persist-client';
import { createIDBPersister } from './idb-persister';

const persister = createIDBPersister();
persistQueryClient({ queryClient, persister });
```

**Test files needing this:**
- offline-01-list-cache.spec.ts (list caching)
- offline-09-cold-start.spec.ts (cold start from cache)
- offline-10-search-filter.spec.ts (cached search/filter)
- offline-22-background-tab.spec.ts (refetchOnWindowFocus)
- offline-26-schema-migration.spec.ts (cache version migration)
- offline-32-ui-state.spec.ts (state preservation)
- offline-33-version-mismatch.spec.ts (API version handling)

#### 2. Offline Mutation Queue

**Required for:** Creating/editing while offline, auto-sync on reconnect

```typescript
// Target implementation
const mutation = useMutation({
  mutationFn: createDocument,
  networkMode: 'offlineFirst',
  onMutate: async (newDoc) => {
    // Optimistic update - show with pending indicator
    queryClient.setQueryData(['documents'], (old) =>
      [...old, { ...newDoc, _pending: true }]
    );
  },
  retry: true,
});
```

**Test files needing this:**
- offline-02-mutations.spec.ts (CRUD operations offline)
- offline-04-queue-management.spec.ts (queue ordering, persistence)
- offline-05-error-handling.spec.ts (retry logic, error recovery)
- offline-07-session-handling.spec.ts (session expiry during offline)
- offline-12-extended-periods.spec.ts (long offline periods)
- offline-14-server-validation.spec.ts (validation error handling)
- offline-15-chained-operations.spec.ts (operation collapsing)
- offline-16-optimistic-rollback.spec.ts (rollback on error)
- offline-18-browser-close.spec.ts (persistence across sessions)
- offline-19-*.spec.ts (assignees, programs, projects, sprints)
- offline-20-reference-integrity.spec.ts (dangling references)
- offline-23-ticket-collision.spec.ts (concurrent issue creation)
- offline-24-rapid-mutations.spec.ts (debouncing/deduplication)
- offline-28-flaky-network.spec.ts (timeout/retry handling)
- offline-30-permission-changes.spec.ts (auth error handling)
- offline-31-large-content.spec.ts (large document sync)

#### 3. Offline UI Components

**Required for:** User feedback during offline/sync states

| Component | data-testid | Purpose |
|-----------|-------------|---------|
| Offline indicator | `offline-indicator` | Shows "You're offline" banner |
| Connection status | `connection-status` | Shows server vs network issues |
| Pending sync count | `pending-sync-count` | Shows "3 changes pending" |
| Pending sync icon | `pending-sync-icon` | Per-item pending indicator |
| Document list | `document-list` | Main document list container |

**Test files needing these:**
- offline-06-ui-indicators.spec.ts (all indicators)
- offline-08-websocket.spec.ts (collab status)
- offline-11-multi-tab.spec.ts (cross-tab sync)
- offline-13-storage-limits.spec.ts (quota warnings)
- offline-17-user-controls.spec.ts (manual sync controls)
- offline-21-server-unreachable.spec.ts (server vs offline distinction)
- offline-27-accessibility.spec.ts (ARIA for offline states)

### Implementation Priority

Based on test coverage and user impact:

| Priority | Component | Impact | Complexity |
|----------|-----------|--------|------------|
| 1 | TanStack Query migration | Lists cache, no loading on navigate | Medium |
| 2 | IndexedDB persistence | Offline page loads work | Low |
| 3 | Offline mutation queue | Create/edit offline | High |
| 4 | Offline UI components | User feedback | Low |

### Running Offline Tests

```bash
# Run all offline tests (shows pass/skip counts)
npx playwright test e2e/offline-*.spec.ts --reporter=line

# Run only passing tests (editor content)
npx playwright test e2e/offline-03-editor-content.spec.ts

# Expected current output:
# 138 skipped
# 14 passed
```

As each infrastructure component is implemented, remove `.skip` from the corresponding test files to enable the TDD tests.

---

## References

- [Unified Document Model](./unified-document-model.md) - Data model
- [Document Model Conventions](./document-model-conventions.md) - Terminology
- [Sprint Documentation Philosophy](./sprint-documentation-philosophy.md) - Sprint workflow
