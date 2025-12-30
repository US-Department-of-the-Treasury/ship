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

### Offline-Tolerant Design

The application must work offline (planes, subways, spotty connections) and sync when reconnected:

- **Properties/metadata**: Full sync to IndexedDB, simple merge strategies
- **Rich text content**: Yjs CRDT documents, partial sync, conflict-free merging
- **Read offline**: Always available from local cache
- **Write offline**: Changes queued, synced on reconnect

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
| `person`       | User profile page          | Links to auth user, capacity, skills             |
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
- `sprint_number`: which 2-week window
- Children: sprint plan, sprint retro, assigned issues

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

### Document Schema (Conceptual)

```typescript
interface Document {
  // Identity
  id: string; // UUID
  workspace_id: string;
  document_type: DocumentType;

  // Location/associations
  program_id: string | null; // null = workspace-level
  project_id: string | null; // for issues
  sprint_id: string | null; // when assigned to sprint
  parent_id: string | null; // document tree nesting

  // Content
  name: string;
  content: YjsDoc; // CRDT for rich text (TipTap)

  // Properties (schema-less, type-enforced)
  properties: Record<string, any>;

  // Denormalized snapshots (for offline display)
  _snapshot: {
    assignee?: { id: string; name: string; avatar_url: string };
    state?: { id: string; name: string; color: string };
    program?: { id: string; name: string; prefix: string };
    parent?: { id: string; name: string };
  };

  // Issue-specific (in properties, but commonly accessed)
  ticket_number?: number; // Program-scoped: AUTH-42
  state_id?: string;
  assignee_ids?: string[];

  // Timestamps
  created_at: string;
  updated_at: string;
}
```

### Relationship Strategy

**Hybrid approach** for offline performance:

1. **Denormalized snapshots** (`_snapshot`): Embed display data for offline rendering
2. **Canonical IDs** (`*_id` fields): Keep relationship IDs for navigation and sync
3. **Sync reconciliation**: Server rebuilds snapshots, client uses them for display

### Properties System

Properties are **schema-less JSON**, enforced via TypeScript:

```typescript
// Required properties by document type (enforced in code)
const REQUIRED_PROPERTIES = {
  issue: ["state_id"], // Issues must have state
  sprint: ["sprint_number"], // Sprints must have number
  sprint_plan: ["owner_id"], // Plans must have owner
  sprint_retro: ["owner_id"], // Retros must have owner
};

// Custom properties stored in properties blob
document.properties = {
  state_id: "state_123",
  priority: "high",
  estimate_hours: 4,
  custom_field: "any value",
};
```

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

## Configuration Entities

States, Labels, and IssueTypes are **not documents** - they're lightweight config:

| Entity        | Purpose              | Example Values                   |
| ------------- | -------------------- | -------------------------------- |
| **State**     | Workflow status      | "Backlog", "In Progress", "Done" |
| **Label**     | Categorization tags  | "bug", "feature", "urgent"       |
| **IssueType** | Issue classification | "Bug", "Story", "Task"           |

**Why not documents:**

- Small (typically <50 per type per workspace)
- Rarely change (monthly at most)
- Don't need versioning, comments, or rich content
- Appear in dropdowns, not navigated to

**Sync:** Fully synced on initial load and cached. Tiny payload.

**Usage:** Referenced by ID in document properties, included in `_snapshot` for offline display.

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

## References

- [Document Model Conventions](./document-model-conventions.md) - Architectural decisions and terminology
- [Sprint Documentation Philosophy](./sprint-documentation-philosophy.md) - Sprint workflow and documentation requirements
