# Document Model Conventions

This document captures architectural decisions and conventions for Ship's unified document model. These conventions guide implementation and ensure consistency across the codebase.

> **Related**: See [Unified Document Model](./unified-document-model.md) for data model details and [Sprint Documentation Philosophy](./sprint-documentation-philosophy.md) for sprint workflow.

## Core Philosophy

**Everything is a document with properties.** Following Notion's paradigm, the difference between a "wiki page" and an "issue" is not the underlying data structure—it's the properties and workflows associated with it.

## Terminology

Consistent terminology prevents confusion across UI, API, and documentation.

| Term                | Description                                                    |
| ------------------- | -------------------------------------------------------------- |
| **Program**         | Long-lived product, initiative, or feature area                |
| **Project**         | Time-bounded deliverable spanning multiple sprints             |
| **Sprint**          | Fixed 2-week iteration (implicit time window, workspace-wide)  |
| **Sprint Document** | A program's container for a specific sprint (explicit, stored) |
| **Issue**           | Individual work item (task/story/bug)                          |

### Hierarchy

```
Workspace
└── Program (Product/Initiative)
    ├── Project (Time-bounded deliverable)
    │   └── Issues (backlog)
    └── Sprint Document (Program's Sprint N)
        ├── Sprint Plan
        ├── Sprint Retro
        └── Issues (active work)
```

## Modes = Use Cases (Same Data, Different Lens)

Ship offers multiple "modes" to view the same document graph. Modes serve different personas with different mental models:

| Mode         | Use Case       | Mental Model                                    |
| ------------ | -------------- | ----------------------------------------------- |
| **Programs** | Engineering/PM | "What are we building? How's it going?"         |
| **Sprint**   | Daily standup  | "What's happening this sprint? What's blocked?" |
| **Resource** | Manager/Lead   | "Who's doing what? Who's overloaded?"           |
| **Docs**     | Anyone         | "Where's that document?"                        |

**Key principle:** All modes query the same document graph. Mode changes grouping, filtering, and layout—not the underlying data.

## What Becomes a Document vs. Stays Configuration

### Should Be Documents

Entities with these characteristics become documents:

- Has `name` and content (content-like)
- Users navigate to it (has its own page/detail view)
- Benefits from comments, linking, versioning
- Could have child documents

**Document types:** `wiki`, `issue`, `program`, `project`, `sprint`, `sprint_plan`, `sprint_retro`, `person`

### Should Stay as Configuration

Entities that are "configuration" rather than "content":

- State (workflow states)
- Label (categorization tags)
- IssueType (bug, feature, etc.)
- Estimate points scale
- Workspace settings
- User identity/auth

**Rule of thumb:** If it appears in a dropdown/picker, it's probably configuration. If it opens a full page, it's probably a document.

## Properties System

### Property Categories

| Category               | Description                | Examples                                             |
| ---------------------- | -------------------------- | ---------------------------------------------------- |
| **Core fields**        | On every document          | `id`, `name`, `workspace_id`, `document_type`        |
| **Association fields** | Relationships              | `program_id`, `project_id`, `sprint_id`, `parent_id` |
| **Type-specific**      | Required by document type  | `state_id` (issues), `sprint_number` (sprints)       |
| **Custom**             | User-defined per workspace | "Department", "Risk Level"                           |

### Schema-less with Type Enforcement

Properties are stored as **JSON blobs**, with required properties enforced in TypeScript:

```typescript
// Required properties by document type
const REQUIRED_PROPERTIES = {
  issue: ["state_id"],
  sprint: ["sprint_number"],
  sprint_plan: ["owner_id"],
  sprint_retro: ["owner_id"],
};

// All properties in one blob
document.properties = {
  state_id: "state_123",
  priority: "high",
  estimate_hours: 4,
  department: "Engineering", // custom
};
```

**Rationale:** Start simple, add validation/schema later if patterns emerge. YAGNI.

## Sprint Model

### Sprint Windows (Implicit)

Sprints are **computed time windows**, not stored entities:

- Workspace has `sprint_start_date` setting
- All sprints are exactly 14 days
- Sprint N = calculated from workspace start date

```typescript
function getSprintNumber(date: Date, workspaceStartDate: Date): number {
  const daysSinceStart = differenceInDays(date, workspaceStartDate);
  return Math.floor(daysSinceStart / 14) + 1;
}
```

### Sprint Documents (Explicit)

What IS stored is the **Sprint document** - one per program per sprint window:

- `document_type: 'sprint'`
- `program_id`: which program
- `sprint_number`: which 2-week window
- Children: sprint plan, sprint retro, assigned issues

**Why this pattern:**

- Sprint Plan and Sprint Retro are per-program (not workspace-wide)
- Each program has its own sprint container
- Clean parent-child relationship for navigation
- Can query "all sprint docs for Sprint 5" or "all sprints for AUTH program"

## Issue Lifecycle (Conveyor Belt)

Issues flow from backlog to active sprint work:

```
Backlog (project_id set, sprint_id null)
    ↓
Assigned to Sprint (sprint_id set, project_id kept)
    ↓
Done (completed_at set)
```

Issues maintain **both** project and sprint associations:

- `project_id` - which project this issue belongs to (persistent)
- `sprint_id` - which sprint this issue is being worked in (changes)

## Ticket Numbers

Issues get **program-prefixed sequential numbers**:

- Format: `{PREFIX}-{NUMBER}` (e.g., AUTH-42, PAY-15)
- Counter is per-program
- Program has a `prefix` property (e.g., "AUTH")
- Numbers are for human reference, UUIDs are canonical IDs

**Why prefixes:** "Can you look at AUTH-42?" is more meaningful than "#42" when you have multiple programs.

## Estimation Philosophy

**Use hours, not story points.**

Story points often map 1:1 to hours anyway. All estimate properties use hours:

| Property         | Unit         | Example  |
| ---------------- | ------------ | -------- |
| `estimate_hours` | hours        | 4 hours  |
| `capacity_hours` | hours/sprint | 80 hours |

## Computed Properties (Roll-ups)

Properties that calculate from children are **computed on-demand**:

| Computation        | Description        | Example                  |
| ------------------ | ------------------ | ------------------------ |
| `count`            | Count children     | Project: "12 issues"     |
| `sum`              | Sum child property | Sprint: "40 hours total" |
| `percent_complete` | % with status=done | Project: "70% complete"  |

**Rationale:** Compute when rendering. No precomputation or caching to start. Optimize later if needed.

## Offline-First Conventions

### Denormalized Snapshots

For offline display, documents include snapshots of related data:

```typescript
document._snapshot = {
  assignee: { id: "user_1", name: "Jane", avatar_url: "..." },
  state: { id: "state_2", name: "In Progress", color: "#..." },
  program: { id: "prog_1", name: "Auth Service", prefix: "AUTH" },
};
```

- Snapshots are for **display only**
- Canonical IDs (`assignee_ids`, `state_id`) are source of truth
- Server rebuilds snapshots on sync

### IndexedDB Indexing

Create indexes for common query patterns:

```typescript
// Essential indexes
{
  keyPath: "id";
} // Primary key
{
  keyPath: "workspace_id";
} // All docs in workspace
{
  keyPath: ["workspace_id", "document_type"];
} // Docs by type
{
  keyPath: ["program_id", "document_type"];
} // Docs in program
{
  keyPath: ["sprint_id"];
} // Docs in sprint
{
  keyPath: "updated_at";
} // Sync ordering
```

## Editor Layout (4-Panel Structure)

Every document editor view follows the same 4-panel layout. This is the canonical UI structure for Ship.

```
┌──────┬────────────────┬─────────────────────────────────┬────────────────┐
│      │                │ Header: ← Badge Title    Saved ●│                │
│ Icon │   Contextual   ├─────────────────────────────────┤   Properties   │
│ Rail │    Sidebar     │                                 │    Sidebar     │
│      │                │   Large Title                   │                │
│ 48px │    224px       │   Body content...               │     256px      │
│      │  (mode list)   │                                 │  (doc props)   │
│      │                │         (flex-1)                │                │
└──────┴────────────────┴─────────────────────────────────┴────────────────┘
```

| Panel | Width | Contents | Always Visible |
|-------|-------|----------|----------------|
| **Icon Rail** | 48px | Mode icons (Docs, Issues, Projects, Team), Settings, User avatar | Yes |
| **Contextual Sidebar** | 224px | List of items for active mode (documents, issues, projects) with + button | Yes |
| **Main Content** | flex-1 | Header (back, badge, title, sync status, presence) + Editor (title input + TipTap body) | Yes |
| **Properties Sidebar** | 256px | Type-specific properties (status, assignee, color, etc.) | Yes |

**Key rules:**
- All four panels are **always visible** when viewing/editing a document
- Contextual sidebar shows items from the **current mode** (not the document type being edited)
- Properties sidebar content varies by document type (via `sidebar` prop on Editor)
- Header shows sync status and connected users for real-time collaboration

## Editor Conventions

All document types share a single `Editor` component. This ensures consistent UX across docs, issues, projects, and sprints.

### New Document Titles

**All new documents use `"Untitled"` as the default title.** No type-specific variations.

| ❌ Wrong | ✅ Correct |
|----------|-----------|
| `"Untitled Issue"` | `"Untitled"` |
| `"Untitled Project"` | `"Untitled"` |
| `"Untitled Sprint"` | `"Untitled"` |
| `"New Document"` | `"Untitled"` |

**Why:** The Editor component converts `"Untitled"` to an empty input with placeholder text. Type-specific titles break this logic and create inconsistent UX.

### Placeholder Text

Each document type can customize the body placeholder via the `placeholder` prop:

| Type | Placeholder |
|------|-------------|
| Document | `"Start writing..."` |
| Issue | `"Add a description..."` |
| Project | `"Describe this project..."` |

### Document Type Differentiation

Document types differ by:
- **Sidebar content** (issue has status/priority, project has color picker)
- **Header badge** (issue shows ticket number, project shows prefix)
- **Placeholder text** (as above)
- **Room prefix** for collaboration (`doc:`, `issue:`, `project:`)

They do NOT differ by title handling. Keep it simple.

## Decision Log

### 2024-12-30: Greenfield Architecture Interview

**Attendees:** User + Claude

**Key Decisions:**

1. **Offline-tolerant**: Must work on planes/subways, sync when reconnected
2. **Tech stack**: PostgreSQL (direct SQL, no ORM), IndexedDB client-side
3. **Sync model**: Hybrid - properties full sync, rich text via Yjs CRDT
4. **Sprint windows implicit**: Computed from workspace start date, not stored
5. **Sprint documents explicit**: One per program per sprint window
6. **Properties schema-less**: JSON blob, TypeScript enforcement
7. **Roll-ups on-demand**: Compute client-side when rendering
8. **Ticket numbers**: Program-prefixed (AUTH-42), counter per program
9. **Modes as use cases**: Different personas, same underlying data
10. **Denormalized snapshots**: For offline display performance

**Superseded Decisions:**

- ~~Sprint_Program junction document~~ → Simplified to just `sprint` document type
- ~~Django ORM~~ → Direct SQL for simplicity
- ~~Precomputed roll-ups~~ → Compute on-demand

### 2024-12-30: Greenfield Architecture Interview (Part 2)

**Attendees:** User + Claude

**Key Decisions:**

1. **Permissions**: Workspace-level only (you're in or you're out)
2. **Config entities**: Keep as lightweight tables, not documents (States, Labels, IssueTypes)
3. **Initial sync**: Recent + accessed documents (last 30 days + previously touched)
4. **Search**: Server search with offline fallback to local IndexedDB
5. **File attachments**: References only, files stored in S3/blob storage
6. **Real-time**: Full collaboration (presence, cursors, live updates via WebSocket + Yjs)
7. **Offboarding**: Wipe IndexedDB immediately when user removed
8. **Mobile**: Web-only for now, revisit later
9. **API**: REST endpoints

**Rationale for Config as Tables:**

Config entities (State, Label, IssueType) differ from documents:

- Small cardinality (<50 per type)
- Rarely change
- Don't need versioning/comments
- Appear in dropdowns, not navigated to

## References

- [Unified Document Model](./unified-document-model.md) - Data model details
- [Sprint Documentation Philosophy](./sprint-documentation-philosophy.md) - Sprint workflow
