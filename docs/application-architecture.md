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
| **Query Builder**  | Kysely                   | Type-safe SQL without ORM magic           |
| **Client Storage** | IndexedDB                | Offline cache, write queue                |
| **Real-time**      | WebSocket (ws)           | Same process as API, simple               |
| **Rich Text**      | TipTap + Yjs             | Collaborative editing (online only)       |
| **State Mgmt**     | TanStack Query + Zustand | Server state + minimal UI state           |
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
│   │   ├── services/       # Business logic
│   │   ├── db/             # Kysely queries
│   │   ├── ws/             # WebSocket handlers
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

### Database Access (Kysely)

Type-safe SQL without ORM abstraction:

```typescript
// api/src/db/documents.ts
import { db } from "./connection";

export async function getDocument(id: string) {
  return db.selectFrom("documents").where("id", "=", id).selectAll().executeTakeFirst();
}

export async function createDocument(doc: NewDocument) {
  return db.insertInto("documents").values(doc).returningAll().executeTakeFirst();
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
| GET    | `/api/sync/changes`  | Get changes since timestamp   |
| POST   | `/api/sync/push`     | Push offline changes          |

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

**TanStack Query** for server/cached data:

```typescript
// Queries read from IndexedDB (cached data)
const { data: documents } = useQuery({
  queryKey: ["documents", { programId }],
  queryFn: () => localDb.documents.where({ programId }).toArray(),
});

// Mutations write to IndexedDB + queue for sync
const mutation = useMutation({
  mutationFn: async (doc) => {
    await localDb.documents.put(doc);
    await syncQueue.add({ type: "update", doc });
  },
  onSuccess: () => queryClient.invalidateQueries(["documents"]),
});
```

**Zustand** for UI-only state:

```typescript
// Minimal UI state
const useUIStore = create<UIState>((set) => ({
  sidebarOpen: true,
  currentMode: "programs",
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
}));
```

### IndexedDB Schema

```typescript
// web/src/db/schema.ts
interface ShipDB {
  documents: Document;
  programs: Program;
  config: ConfigEntity; // States, Labels, IssueTypes
  syncQueue: QueuedChange;
  syncMeta: { key: string; value: any };
}
```

### Offline Strategy

**Model**: Offline-tolerant (server is source of truth)

```
┌─────────────────────────────────────────────────────────────┐
│                        Online                                │
│  ┌──────────┐    fetch     ┌──────────┐    query   ┌─────┐  │
│  │  Server  │ ──────────>  │ IndexedDB │ ────────> │ UI  │  │
│  └──────────┘              └──────────┘            └─────┘  │
│       ▲                          │                    │      │
│       │         sync queue       │       mutation     │      │
│       └──────────────────────────┴────────────────────┘      │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│                        Offline                               │
│                                                              │
│  ┌──────────┐   (queued)   ┌──────────┐    query   ┌─────┐  │
│  │  Server  │ <─ ─ ─ ─ ─   │ IndexedDB │ ────────> │ UI  │  │
│  └──────────┘              └──────────┘            └─────┘  │
│       ▲                          │                    │      │
│       │         sync queue       │       mutation     │      │
│       └──────────────────────────┴────────────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

**Reads**: Served from IndexedDB cache
**Writes**: Saved to IndexedDB + added to sync queue
**Reconnect**: Flush sync queue to server
**Conflicts**: Last-write-wins (timestamp-based)

### Sync Flow

```typescript
// web/src/sync/syncManager.ts
class SyncManager {
  async initialize() {
    // Load cached data from IndexedDB
    await this.loadFromCache();

    // Start sync if online
    if (navigator.onLine) {
      await this.pullChanges();
      await this.flushQueue();
    }

    // Listen for online/offline
    window.addEventListener("online", () => this.onOnline());
  }

  async onOnline() {
    await this.flushQueue(); // Push pending changes
    await this.pullChanges(); // Get server updates
  }

  async pullChanges() {
    const lastSync = await localDb.syncMeta.get("lastSync");
    const changes = await api.get(`/sync/changes?since=${lastSync}`);
    await this.applyChanges(changes);
  }

  async flushQueue() {
    const pending = await localDb.syncQueue.toArray();
    if (pending.length > 0) {
      await api.post("/sync/push", { changes: pending });
      await localDb.syncQueue.clear();
    }
  }
}
```

## Real-Time Collaboration

**Online only** - collaborative editing requires connection.

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

- Document opens in single-user mode
- No presence indicators
- Edits queue locally
- On reconnect: changes sync, presence restored

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

Primary testing strategy:

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

**Manual + reviewed** - safe for government deployments.

### Migration Workflow

```bash
# 1. Generate migration
pnpm db:generate migration_name

# 2. Review generated SQL
cat api/src/db/migrations/YYYYMMDD_migration_name.ts

# 3. Test locally
pnpm db:migrate

# 4. PR review includes migration review

# 5. Run in production (manually or via deploy script)
```

### Kysely Migrations

```typescript
// api/src/db/migrations/20241230_add_sprint_number.ts
import { Kysely } from "kysely";

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable("documents").addColumn("sprint_number", "integer").execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.alterTable("documents").dropColumn("sprint_number").execute();
}
```

### Safety Rules

- Always write `down` migrations
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
3. **Database access**: Kysely (type-safe SQL, not ORM)
4. **Repo structure**: Single repo, separate builds (web/, api/, shared/)
5. **Deployment**: Single container (EB or ECS) + S3/CloudFront
6. **Real-time**: WebSocket on same Express process
7. **Auth**: PIV + password fallback
8. **State management**: TanStack Query + light Zustand
9. **Offline model**: Offline-tolerant (queue writes, last-write-wins)
10. **Collab editing**: Real-time only (requires connection)

**Rationale for Key Choices:**

- **Express over Fastify**: More ubiquitous, "boring technology"
- **Kysely over raw pg**: Type safety without ORM complexity
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

## References

- [Unified Document Model](./unified-document-model.md) - Data model
- [Document Model Conventions](./document-model-conventions.md) - Terminology
- [Sprint Documentation Philosophy](./sprint-documentation-philosophy.md) - Sprint workflow
