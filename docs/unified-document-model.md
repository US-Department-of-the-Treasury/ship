# Unified Document Model

This document describes the unified document architecture where all content types are stored as documents with different properties.

> **Related**: See [Document Model Conventions](./document-model-conventions.md) for architectural decisions, terminology, and guiding principles.

## Core Concept

Following Notion's paradigm: **everything is a document with properties**. The difference between a "wiki page" and an "issue" is not the underlying data structure—it's the properties and workflows associated with it.

## Architecture Overview

### Tech Stack

| Layer         | Technology                      | Rationale                                           |
| ------------- | ------------------------------- | --------------------------------------------------- |
| **Server DB** | PostgreSQL (direct SQL, no ORM) | Simplicity, full control, no abstraction overhead   |
| **Client DB** | IndexedDB                       | Offline-tolerant storage, fast reads                |
| **Rich Text** | TipTap + Yjs                    | Collaborative editing with CRDT conflict resolution |
| **Sync**      | Hybrid (see below)              | Properties full-sync, content CRDT-sync             |
| **API**       | REST endpoints                  | Well-understood, good tooling                       |
| **Real-time** | WebSocket + Yjs Awareness       | Presence, cursors, live updates                     |

### Permissions Model

**Workspace-level only** - simplest model:

- You're in the workspace or you're not
- All workspace members see all documents
- No per-program or per-document access controls
- Roles (admin, member) are workspace-scoped

### Authorization vs Content Separation

**Critical architecture principle:** Authorization and content are separate layers.

| Layer | Table | Purpose |
|-------|-------|---------|
| Authorization | `workspace_memberships` | Who can access what workspace, with what role |
| Content | `documents (type='person')` | User profile, editable content |

**How they connect:**
- Person documents have `properties.user_id` linking to `users.id`
- Membership table has NO reference to person documents
- Auth checks query `workspace_memberships`
- Display (Directory, Allocation) queries `documents WHERE document_type = 'person'`

**Why separate:**
- Security: Authorization changes are auditable, separate from content edits
- Independence: Creating membership doesn't require creating person doc atomically
- Clarity: No "repair logic" to keep layers in sync

### Caching Strategy

The application uses stale-while-revalidate caching for performance:

- **Query cache**: TanStack Query with IndexedDB persistence for fast startup
- **Rich text content**: Yjs CRDT documents with y-indexeddb for editor state persistence
- **Read from cache**: Stale data shown immediately, fresh data fetched in background
- **Write requires network**: Mutations use optimistic updates with rollback on error

## Document Types

The `document_type` field describes **what kind** of document it is:

| Type           | Description                | Key Properties                                   |
| -------------- | -------------------------- | ------------------------------------------------ |
| `wiki`         | Documentation content      | Prose content, no workflow state                 |
| `issue`        | Work item (tracked task)   | State, assignees, priority, ticket number, dates |
| `program`      | Product/Initiative         | Long-lived container, has members, ticket prefix |
| `project`      | Time-bounded deliverable   | Groups issues, has dates, belongs to program     |
| `sprint`       | Program's sprint container | Sprint number, program_id, contains sprint work  |
| `sprint_plan`  | Sprint planning doc        | Child of sprint, required before sprint starts   |
| `sprint_retro` | Sprint retrospective       | Child of sprint, required after sprint ends      |
| `person`       | User profile page          | `properties.user_id` links to auth user, capacity, skills |
| `view`         | Saved filter/query         | Query, filters, display options (future)         |

## Document Location

The `program_id` field describes **where** the document lives:

| Value          | Location        | Example                                         |
| -------------- | --------------- | ----------------------------------------------- |
| `null`         | Workspace-level | Org documentation like "Engineering Onboarding" |
| `<program_id>` | Program-level   | Program specs, program issues                   |

## Sprint Model

### Sprint Windows (Implicit)

Sprints are **implicit 2-week time windows**, not stored entities:

- Workspace has `sprint_start_date` setting
- Sprint 1 = days 1-14 from start date
- Sprint 2 = days 15-28
- Sprint N = computed from date

**No Sprint table exists.** The sprint window is calculated.

### Sprint Documents (Explicit)

What IS stored is the **Sprint document** - one per program per sprint window:

```
Program (AUTH)
├── Project (Login Revamp)
│   └── Issues (backlog)
└── Sprint (AUTH's Sprint 5)       ← document_type: 'sprint'
    ├── Sprint Plan                ← document_type: 'sprint_plan'
    ├── Sprint Retro               ← document_type: 'sprint_retro'
    └── Issues (active work)       ← assigned to this sprint
```

Sprint documents have:

- `program_id`: which program
- `properties.sprint_number`: which 2-week window (REQUIRED)
- `properties.owner_id`: person accountable for this sprint (REQUIRED)
- Document body: sprint goals, context, description (everything is a document)
- Children: sprint plan, sprint retro, assigned issues

**Creating a sprint is intentional.** It means "we commit to doing work on this program during this 2-week window." Programs may skip sprint windows if no work is planned.

### Sprint Dates (Computed)

Sprint dates are **computed from sprint_number + workspace start date**, not stored:

```typescript
function computeSprintDates(sprintNumber: number, workspaceStartDate: Date) {
  const start = addDays(workspaceStartDate, (sprintNumber - 1) * 7);
  const end = addDays(start, 6); // 7 days total
  return { start, end };
}
```

### Sprint Status (Computed)

Sprint status is **computed from the computed dates**, not stored:

| Condition | Status |
|-----------|--------|
| `today < start` | `upcoming` |
| `start <= today <= end` | `active` |
| `today > end` | `completed` |

This eliminates the need for manual "Start Sprint" / "Complete Sprint" workflows and avoids storing redundant data.

### Sprint Owner Constraint

Each sprint requires exactly **one owner** (`owner_id`). A person can only own one sprint per sprint window across all programs. This ensures:
- Clear accountability
- Resource visibility
- No overallocation

### Sprint Iterations (Claude Code Integration)

The `sprint_iterations` table tracks story completion attempts during Claude Code `/work` sessions:

```
sprint_iterations
├── id: UUID
├── sprint_id: UUID (FK → documents)
├── workspace_id: UUID
├── story_id: VARCHAR(200) - PRD story ID
├── story_title: VARCHAR(500)
├── status: ENUM('pass', 'fail', 'in_progress')
├── what_attempted: TEXT - Description of work done
├── blockers_encountered: TEXT - What failed/blocked
├── author_id: UUID (FK → users)
└── created_at, updated_at
```

**Use cases:**
- Real-time progress visibility during `/work` execution
- Sprint velocity analysis (iterations per story)
- Learning extraction from failed attempts
- Historical record for retrospectives

**API endpoints:**
- `POST /api/sprints/:id/iterations` - Log an iteration
- `GET /api/sprints/:id/iterations` - List iterations (filterable by status, story_id)

## Issue Lifecycle

Issues flow from backlog to sprint (the "conveyor belt"):

```
Backlog (in Project)  →  Assigned to Sprint  →  Done
     ↓                         ↓
  project_id: "proj_1"    sprint_id: "sprint_5"
  sprint_id: null         project_id: "proj_1" (kept)
```

Issues maintain **multiple associations**:

- `program_id` - always set (required)
- `project_id` - set when belongs to a project
- `sprint_id` - set when assigned to active sprint work

## Data Model

### Document Schema

```typescript
interface Document {
  // Identity
  id: string; // UUID
  workspace_id: string;
  document_type: DocumentType;

  // Location/associations (columns, not in properties)
  program_id: string | null; // null = workspace-level
  project_id: string | null; // for issues
  sprint_id: string | null; // when assigned to sprint
  parent_id: string | null; // document tree nesting

  // Content
  title: string; // Always "Untitled" for new docs
  content: TipTapJSON; // Rich text content
  yjs_state: Uint8Array; // CRDT state for collaboration

  // Properties (schema-less JSONB, type-enforced in code)
  properties: Record<string, any>;

  // Timestamps
  created_at: string;
  updated_at: string;
  created_by: string;
}
```

### Relationship Strategy

Association fields (`program_id`, `project_id`, `sprint_id`, `parent_id`) are **columns** for efficient querying. Everything else type-specific goes in `properties` JSONB.

### Properties System

Properties are stored in a **schema-less JSONB column**, with structure enforced via TypeScript:

```typescript
// Type-specific properties (enforced in code, not database)
interface IssueProperties {
  state: 'backlog' | 'todo' | 'in_progress' | 'done' | string; // 4 required + custom
  priority?: 'low' | 'medium' | 'high';
  assignee_id?: string;
  ticket_number?: number;
  estimate_hours?: number;
  claude_metadata?: ClaudeMetadata; // Claude Code integration
}

// Claude Code workflow tracking (see application-architecture.md)
interface ClaudeMetadata {
  updated_by: 'claude';           // Attribution flag
  story_id?: string;              // PRD story ID
  prd_name?: string;              // Source PRD
  confidence?: number;            // 0-100 completion confidence
  telemetry?: {                   // Completion metrics
    iterations: number;
    feedback_loops: { type_check: number; test: number; build: number };
    time_elapsed_seconds: number;
    files_changed: string[];
  };
}

interface SprintProperties {
  sprint_number: number;  // References implicit 2-week window - REQUIRED
  owner_id: string;       // Person who owns this sprint - REQUIRED
  // That's it. Dates computed from sprint_number + workspace start date.
  // Goal/description goes in document body (everything is a document).
  // Status computed from dates. See document-model-conventions.md.
}

interface ProgramProperties {
  prefix: string; // e.g., "AUTH" for ticket numbers
  color?: string;
}

interface PersonProperties {
  user_id: string; // Links to users.id (required)
  email?: string; // Denormalized for display
  capacity_hours?: number;
  skills?: string[];
}

// Example issue properties
document.properties = {
  state: "in_progress",
  priority: "high",
  assignee_id: "user_123",
  ticket_number: 42,
  estimate_hours: 4,
  custom_field: "any value", // user-defined
};
```

**Key principle:** The database stores raw JSONB. TypeScript interfaces enforce structure at the application layer. This allows custom properties without schema migrations.

### Workflow States

Issues have a `state` property with **4 required states** that every workspace has:

| State | Description |
|-------|-------------|
| `backlog` | Not yet planned |
| `todo` | Planned for current sprint |
| `in_progress` | Actively being worked |
| `done` | Completed |

Workspaces can add **custom states** beyond these 4 (stored in workspace settings). States are string values in properties, not foreign keys to a separate table.

### Computed Properties (Roll-ups)

Roll-ups are **computed on-demand client-side**:

| Computation        | Description        | Example                  |
| ------------------ | ------------------ | ------------------------ |
| `count`            | Count children     | Project: "12 issues"     |
| `sum`              | Sum child property | Sprint: "40 hours total" |
| `percent_complete` | % with status=done | Project: "70% complete"  |

No precomputation or caching - compute when rendering. Optimize later if needed.

## Ticket Numbers

Issues get **program-prefixed sequential numbers**:

- Format: `{PROGRAM_PREFIX}-{NUMBER}` (e.g., AUTH-42, PAYMENTS-15)
- Counter is per-program
- Program has a `prefix` property (e.g., "AUTH", "PAY")
- Meaningful for communication: "Can you look at AUTH-42?"

## Sync Architecture

### Hybrid Sync Model

| Data Type         | Sync Strategy               | Conflict Resolution       |
| ----------------- | --------------------------- | ------------------------- |
| Properties        | Full sync to IndexedDB      | Last-write-wins or merge  |
| Rich text content | Yjs CRDT partial sync       | Automatic CRDT merge      |
| Relationships     | Full sync (IDs + snapshots) | Server is source of truth |

### Sync Flow

```
Client (IndexedDB)          Server (PostgreSQL)
      │                            │
      │  ──── push changes ────>   │
      │                            │
      │  <─── pull updates ─────   │
      │       (properties)         │
      │                            │
      │  <═══ Yjs sync ═══════>    │
      │       (rich text)          │
```

### Initial Sync Strategy

**Recent + accessed documents** - balance of coverage and speed:

- Sync last 30 days of documents
- Sync any document user has previously accessed
- Config entities (states, labels) sync fully (small payload)
- Rich text content fetched on-demand, cached locally

### Search

**Server search with offline fallback**:

- Primary: Full-text search on PostgreSQL server
- Offline: Search locally synced documents in IndexedDB
- UI indicates when showing "offline results only"

## Configuration

### Workflow States

States are **string values** stored directly in document properties, not foreign keys to a separate table:

```typescript
// States are just strings in the properties JSONB
document.properties.state = "in_progress";
```

**4 built-in states:** `backlog`, `todo`, `in_progress`, `done`

Workspaces can define **additional custom states** (stored in workspace settings JSONB). This keeps the data model simple while allowing customization.

### Labels (Future)

Labels will be stored as string arrays in properties:

```typescript
document.properties.labels = ["bug", "urgent", "frontend"];
```

Available labels per workspace stored in workspace settings. No separate labels table needed.

## File Attachments

**References only, files in S3/blob storage**:

- Documents store file references (URL, filename, size, mime type)
- Actual files stored in S3 or compatible blob storage
- Files not synced to IndexedDB (too large)
- Offline: Show placeholder, fetch when online

```typescript
interface FileAttachment {
  id: string;
  filename: string;
  url: string; // S3 presigned URL or CDN URL
  size_bytes: number;
  mime_type: string;
  uploaded_by: string;
  uploaded_at: string;
}
```

## Real-Time Collaboration

**Full collaboration experience** (like Notion):

| Feature              | Technology                | Scope                                 |
| -------------------- | ------------------------- | ------------------------------------- |
| **Document editing** | Yjs CRDT                  | Conflict-free collaborative editing   |
| **Presence**         | Yjs Awareness + WebSocket | Who's viewing a document              |
| **Cursors**          | Yjs Awareness             | See others' cursor positions in docs  |
| **Live updates**     | WebSocket                 | Real-time list updates, new documents |

**Offline behavior:**

- Edits queued locally, merged on reconnect via CRDT
- Presence/cursors only work when online
- List updates apply on reconnect

## User Offboarding

When a user is removed from a workspace:

- **IndexedDB wiped immediately** for that workspace
- Server rejects further sync attempts
- In-flight changes are lost (security over data preservation)

## Mobile Strategy

**Web-only for now**:

- Responsive web design
- No native iOS/Android apps initially
- PWA possible future enhancement
- Revisit mobile apps based on user demand

## UI Filtering Rules

### Documents View (Workspace Level)

Shows workspace-level documents (`program_id = null`):

- Org-level wikis like "Engineering Onboarding"
- Cross-program documentation

### Program View

Shows documents where `program_id = <current_program>`:

- Program documentation (wikis)
- Projects and their issues
- Sprint documents and their contents

### Sprint View

Shows current sprint across programs:

- Filter by computed sprint window (current date)
- Group by program or assignee
- Show sprint docs, plans, retros, issues

### Resource View

Shows people and their work:

- Person documents
- Issues grouped by assignee
- Capacity and workload

## Modes (Use Cases)

Modes are **different lenses on the same data** for different personas:

| Mode         | Use Case       | Mental Model                                    |
| ------------ | -------------- | ----------------------------------------------- |
| **Programs** | Engineering/PM | "What are we building? How's it going?"         |
| **Sprint**   | Daily standup  | "What's happening this sprint? What's blocked?" |
| **Resource** | Manager/Lead   | "Who's doing what? Who's overloaded?"           |
| **Docs**     | Anyone         | "Where's that document?"                        |

**Key principle:** All modes query the same document graph. Mode changes grouping/filtering/layout—not the underlying data.

## Current Reality vs Target Architecture

> **Migration Pending:** The current database schema uses explicit columns (`state`, `priority`, `assignee_id`, etc.) instead of a `properties` JSONB column. This works but requires schema migrations for new property types. The target architecture described in this doc (pure JSONB properties) enables custom properties without migrations. Migration is planned.

| Aspect | Current Implementation | Target (This Doc) |
|--------|----------------------|-------------------|
| Properties | Explicit columns | JSONB column |
| States | TEXT column | String in properties |
| Custom props | Not supported | Any key in properties |

---

## Roadmap

Features planned but not yet implemented:

### Denormalized Snapshots

`_snapshot` field on documents for offline display without joins:

```typescript
document._snapshot = {
  assignee: { id: "user_1", name: "Jane", avatar_url: "..." },
  program: { id: "prog_1", name: "Auth Service", prefix: "AUTH" },
};
```

### View Documents

Saved filters/queries as `document_type: 'view'`:
- Store query parameters, filters, display options
- Share views across team
- Not yet in schema enum

---

## References

- [Document Model Conventions](./document-model-conventions.md) - Architectural decisions and terminology
- [Sprint Documentation Philosophy](./sprint-documentation-philosophy.md) - Sprint workflow and documentation requirements
