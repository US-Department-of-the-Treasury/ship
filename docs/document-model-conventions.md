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

- Workspace settings (stored in workspace JSONB)
- User identity/auth (separate `users` table)
- Available custom states per workspace (in workspace settings)
- Available labels per workspace (in workspace settings)

**Key insight:** States and labels are **values in properties**, not separate tables. The list of *available* states/labels is workspace configuration, but the actual state of an issue is just a string in its properties.

**Rule of thumb:** If it appears in a dropdown/picker, it's probably configuration. If it opens a full page, it's probably a document.

## Properties System

### Property Categories

| Category               | Description                | Examples                                             |
| ---------------------- | -------------------------- | ---------------------------------------------------- |
| **Core fields**        | Columns on every document  | `id`, `title`, `workspace_id`, `document_type`       |
| **Hierarchy field**    | Parent-child containment   | `parent_id` (only column for relationships)          |
| **Association table**  | Junction table for org relationships | `document_associations` (program, project, sprint) |
| **Type-specific**      | In properties JSONB        | `state` (issues), `sprint_number` (sprints)          |
| **Custom**             | User-defined in properties | "Department", "Risk Level"                           |

### Schema-less with Type Enforcement

Properties are stored in a **JSONB column**, with structure enforced in TypeScript:

```typescript
// Type-specific property interfaces (enforced in code)
interface IssueProperties {
  state: 'backlog' | 'todo' | 'in_progress' | 'done' | string;
  priority?: 'low' | 'medium' | 'high';
  assignee_id?: string;
  ticket_number?: number;
  claude_metadata?: ClaudeMetadata; // Claude Code integration tracking
  [key: string]: any; // allows custom properties
}

// Example usage
document.properties = {
  state: "in_progress",
  priority: "high",
  assignee_id: "user_123",
  department: "Engineering", // custom property
};
```

**Why JSONB over columns:**
- Custom properties without schema migrations
- Simpler schema (fewer nullable columns)
- Query performance is fine with aggressive client-side caching
- TypeScript provides compile-time safety anyway

## Association Pattern

Ship uses two distinct patterns for document relationships. Understanding when to use each is critical to avoid bugs.

### parent_id vs document_associations

| Pattern | Column/Table | Relationship | Use Case |
|---------|--------------|--------------|----------|
| **parent_id** | `parent_id` column | 1:1 containment | Wiki children, sprint_plan → sprint |
| **document_associations** | Junction table | Many-to-many organizational | program, project, sprint memberships |

**parent_id (Hierarchy):** Used when a document is *contained within* another document. The child cannot exist without the parent. Examples:
- Wiki page nested under another wiki page
- Sprint plan belonging to a sprint document
- Sprint retro belonging to a sprint document

**document_associations (Organizational):** Used when a document *belongs to* another document for organizational purposes, but could theoretically belong to multiple or move between them. Examples:
- Issue belongs to a program (organizational grouping)
- Issue belongs to a project (work stream)
- Issue assigned to a sprint (time window)

### Junction Table Schema

```sql
CREATE TABLE document_associations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  related_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
  relationship_type TEXT NOT NULL,  -- 'program' | 'project' | 'sprint'
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE (document_id, related_id, relationship_type)
);
```

### Using document-crud.ts Utilities

**Always use the utility functions** in `api/src/utils/document-crud.ts` for association operations. Never write raw SQL for associations in route files.

#### Reading Associations

```typescript
import {
  getBelongsToAssociations,
  getBelongsToAssociationsBatch,
  getProgramAssociation,
  getProjectAssociation,
  getSprintAssociation,
} from '../utils/document-crud.js';

// Get all associations for a document
const associations = await getBelongsToAssociations(documentId);
// Returns: [{ id, type, title, color }, ...]

// Get specific association type
const program = await getProgramAssociation(documentId);
const project = await getProjectAssociation(documentId);
const sprint = await getSprintAssociation(documentId);
// Returns: { id, type, title, color } or null

// Batch fetch to avoid N+1 (for lists)
const associationsMap = await getBelongsToAssociationsBatch(documentIds);
for (const doc of documents) {
  doc.belongs_to = associationsMap.get(doc.id) || [];
}
```

#### Writing Associations

```typescript
import {
  addBelongsToAssociation,
  removeBelongsToAssociation,
  removeAssociationsByType,
  syncBelongsToAssociations,
  updateProgramAssociation,
  updateProjectAssociation,
  updateSprintAssociation,
} from '../utils/document-crud.js';

// Add a single association (idempotent - uses ON CONFLICT DO NOTHING)
await addBelongsToAssociation(issueId, sprintId, 'sprint');

// Remove a single association
await removeBelongsToAssociation(issueId, sprintId, 'sprint');

// Remove all associations of a type
await removeAssociationsByType(issueId, 'program');

// Replace association (remove old, add new - handles null)
await updateProgramAssociation(documentId, newProgramId);
await updateProjectAssociation(documentId, newProjectId);
await updateSprintAssociation(documentId, newSprintId);

// Full sync (replace all associations)
await syncBelongsToAssociations(issueId, [
  { id: programId, type: 'program' },
  { id: projectId, type: 'project' },
  { id: sprintId, type: 'sprint' },
]);
```

### Why This Pattern Exists

The document_associations pattern was adopted after discovering write-read mismatch bugs with direct columns:

1. **Old pattern (buggy):** `program_id` column on documents table
   - CREATE wrote to the column
   - GET read from junction table via JOIN
   - Result: orphaned entities, data inconsistency

2. **New pattern (consistent):** All reads and writes go through `document_associations`
   - Single source of truth
   - Utility functions ensure consistent usage
   - No more orphaned entities

### Migration History

| Column | Status | Migration |
|--------|--------|-----------|
| `project_id` | DROPPED | 027_drop_legacy_association_columns.sql |
| `sprint_id` | DROPPED | 027_drop_legacy_association_columns.sql |
| `program_id` | DROPPED | 029_drop_program_id_column.sql |

All three organizational relationship columns have been removed. Only `parent_id` remains for hierarchy.

### Adding New Association Types

If you need to add a new association type (e.g., 'team', 'milestone'):

1. Add the type to `BelongsToEntry` in `document-crud.ts`
2. Create type-specific helpers (e.g., `getTeamAssociation`, `updateTeamAssociation`)
3. Update documentation
4. No schema changes needed - junction table handles any relationship_type string

## Sprint Model

### Sprint Windows (Implicit)

Sprints are **computed time windows**, not stored entities:

- Workspace has `sprint_start_date` setting
- All sprints are exactly 7 days
- Sprint N = calculated from workspace start date

```typescript
function getSprintNumber(date: Date, workspaceStartDate: Date): number {
  const daysSinceStart = differenceInDays(date, workspaceStartDate);
  return Math.floor(daysSinceStart / 7) + 1;
}
```

### Sprint Documents (Explicit)

What IS stored is the **Sprint document** - one per program per sprint window:

- `document_type: 'sprint'`
- `program_id`: which program
- `properties.sprint_number`: which 2-week window (REQUIRED)
- `properties.owner_id`: **REQUIRED** - person accountable for this sprint
- Document body: sprint goals, context, description (everything is a document)
- Children: sprint plan, sprint retro, assigned issues

**Creating a sprint is an intentional commitment.** By creating a sprint document, you're saying "we intend to do work on this program during this 2-week window." Programs may skip sprint windows if no work is planned.

**Why this pattern:**

- Sprint Plan and Sprint Retro are per-program (not workspace-wide)
- Each program has its own sprint container
- Clean parent-child relationship for navigation
- Can query "all sprint docs for Sprint 5" or "all sprints for AUTH program"

### Sprint Dates (Computed, Not Stored)

**Sprint dates are computed from sprint_number + workspace start date.**

```typescript
export function computeSprintDates(sprintNumber: number, workspaceStartDate: Date) {
  const start = addDays(workspaceStartDate, (sprintNumber - 1) * 7);
  const end = addDays(start, 6); // 7 days total (0-6)
  return { start, end };
}
```

**Why computed:**
- YAGNI: Don't store what you can compute
- Single source of truth: workspace `sprint_start_date` determines all sprint dates
- No inconsistency: impossible for dates to disagree with sprint_number

### Sprint Status (Computed, Not Stored)

**Sprint status is computed from the computed dates.**

```typescript
export type SprintStatus = 'active' | 'upcoming' | 'completed';

export function computeSprintStatus(sprintNumber: number, workspaceStartDate: Date): SprintStatus {
  const { start, end } = computeSprintDates(sprintNumber, workspaceStartDate);
  const today = startOfDay(new Date());

  if (today < start) return 'upcoming';
  if (today > end) return 'completed';
  return 'active';
}
```

**Why computed:**
- Eliminates manual "Start Sprint" / "Complete Sprint" workflow
- Status is always accurate based on real dates
- No state to get out of sync
- Minimal properties: only store `sprint_number` and `owner_id`

### Sprint Goal (Document Body, Not Property)

**Sprint goals and context go in the document body, not a property.**

This aligns with Ship's "everything is a document" philosophy. The sprint document IS the place to describe what the sprint is about. Using the TipTap editor body for goals/context means:
- Rich text formatting available
- Consistent with how all other documents work
- No artificial distinction between "the goal property" and "the document content"

### Sprint Owner Constraint

Each sprint has exactly **one owner** who is accountable for that sprint's success.

**Constraint:** A person can only own ONE sprint per sprint window across all programs.

This ensures:
- Clear accountability (no ambiguity about who owns what)
- Resource allocation visibility (person is committed to one program per window)
- Prevents overallocation (can't be sprint owner for 3 programs simultaneously)

When creating a sprint, the UI must show owner availability and prevent selecting someone already assigned to another program's sprint in that window.

### Team Allocation View

The Team Allocation view (Team → Allocation tab) shows **explicit sprint ownership**, NOT inferred assignments from issues:

| What it shows | What it does NOT show |
|---------------|----------------------|
| Sprint `owner_id` - who is explicitly assigned as sprint owner | Issue `assignee_id` - who has work assigned |

**Key distinction:** A person might have issues assigned to them in a sprint, but that doesn't make them the sprint owner. Sprint ownership is an explicit, accountable assignment stored in `properties.owner_id` on the sprint document.

The `/api/team/assignments` endpoint queries sprint documents by `owner_id`, not issues by `assignee_id`.

### Sprint UI in Program Mode

Program mode displays sprints in **three sections**:

```
● ACTIVE (expanded by default)
  - Shows progress bar, days remaining, owner, issue breakdown
  - Only one sprint can be active at a time

○ UPCOMING (collapsed)
  - Future sprints sorted by start date
  - Shows owner and issue count

✓ COMPLETED (collapsed)
  - Past sprints sorted reverse chronologically
  - Shows owner and completion stats
```

**Empty state:** When no sprint is active (gap between windows), show "No active sprint - Next sprint starts [date]"

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

## Offline-Tolerant Conventions

### Current Approach

The app is **offline-tolerant** (server is source of truth), not offline-first:
- Documents cached in IndexedDB for fast reads
- Writes go to server immediately when online
- Offline writes queued, synced on reconnect
- Last-write-wins conflict resolution

### IndexedDB Indexing

Create indexes for common query patterns:

```typescript
// Essential indexes
{ keyPath: "id" }                              // Primary key
{ keyPath: "workspace_id" }                    // All docs in workspace
{ keyPath: ["workspace_id", "document_type"] } // Docs by type
{ keyPath: ["program_id", "document_type"] }   // Docs in program
{ keyPath: ["sprint_id"] }                     // Docs in sprint
{ keyPath: "updated_at" }                      // Sync ordering
```

### Roadmap: Denormalized Snapshots

Future optimization for offline display - embed related data directly:

```typescript
document._snapshot = {
  assignee: { id: "user_1", name: "Jane", avatar_url: "..." },
  program: { id: "prog_1", name: "Auth Service", prefix: "AUTH" },
};
```

Not yet implemented. Currently we join data client-side from cached documents.

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

## Canonical UI Patterns

Ship has exactly **4 canonical patterns** for displaying collections of items. When building UI that shows a list of things, you must use one of these patterns—do not create new ones or duplicate existing implementations.

### The 4 Patterns

| Pattern | Component | Purpose | Key Features |
|---------|-----------|---------|--------------|
| **SelectableList** | `<SelectableList>` | Tables/lists with selection | Hover checkboxes, multi-select, keyboard nav, context menu, bulk actions |
| **Tree** | `<DocumentTreeItem>` | Hierarchical data | Expand/collapse, indentation, parent-child relationships |
| **Kanban** | `<KanbanBoard>` | Status-based columns | Drag-and-drop between columns, cards grouped by state |
| **CardGrid** | `<CardGrid>` | Navigable card collections | Responsive grid, click-to-navigate, visual cards |

### Decision Tree: Which Pattern?

```
Is the data hierarchical (parent-child)?
  └─ Yes → Tree
  └─ No → Is this a status-based workflow?
            └─ Yes → Kanban
            └─ No → Do users need to select/act on multiple items?
                      └─ Yes → SelectableList
                      └─ No → CardGrid
```

### Pattern Details

#### SelectableList
Use for tabular data where users need to select items and perform bulk actions.

**Features:**
- Checkboxes appear on row hover, stay visible when selected
- Shift+Click for range selection
- Ctrl/Cmd+Click for toggle selection
- Arrow keys for navigation, Shift+Arrow to extend selection
- Right-click context menu for bulk actions
- Space to toggle selection on focused row

**When to use:** Issues list, any list with bulk operations

#### Tree
Use for hierarchical data with parent-child relationships.

**Features:**
- Expand/collapse with chevron
- Visual indentation shows hierarchy
- Click to navigate to item

**When to use:** Documents (nested pages), any hierarchical structure

#### Kanban
Use for workflow visualization where items move through states.

**Features:**
- Columns represent states/categories
- Drag-and-drop between columns
- Cards show item summary

**When to use:** Issue status workflow, any state machine visualization

#### CardGrid
Use for browsable collections where users navigate to items.

**Features:**
- Responsive grid (fewer columns on mobile)
- Visual cards with key information
- Click to navigate

**When to use:** Programs list, team directory, any visual collection

### Why This Matters

**User expectation:** When UI looks similar, users expect it to behave similarly. If the Issues page has hover checkboxes, users expect the Program→Issues tab to work the same way.

**Maintenance:** One well-tested component is better than multiple similar implementations with subtle differences.

**Philosophy alignment:** This follows Ship's principle of consistency over specialization.

## Standard Document List View

When using SelectableList for document collections (Issues, Programs, Documents), follow this standardized pattern to ensure consistency across all list views.

### Required Components and Hooks

| Component/Hook | Purpose | File |
|----------------|---------|------|
| `useColumnVisibility` | Manages column visibility state with localStorage persistence | `web/src/hooks/useColumnVisibility.ts` |
| `useListFilters` | Manages sort options and view mode (list/kanban/tree) | `web/src/hooks/useListFilters.ts` |
| `DocumentListToolbar` | Reusable toolbar with sort dropdown, view toggle, column picker | `web/src/components/DocumentListToolbar.tsx` |
| `SelectableList` | Table component with selection, keyboard nav, context menu | `web/src/components/SelectableList.tsx` |

### Standard Features

Every document list view should include:

1. **Sort dropdown** - Configurable sort options (Updated, Created, Title, etc.)
2. **Column picker** - Toggle column visibility, persisted to localStorage
3. **Multi-select** - Checkboxes on hover, Shift+Click range selection
4. **Bulk actions** - Action bar appears when items selected (Archive, Delete, etc.)
5. **Context menu** - Right-click for same actions as bulk action bar
6. **Keyboard navigation** - Arrow keys, Space to select, Escape to clear

### Implementation Pattern

```typescript
// 1. Define columns with ColumnDefinition type
const ALL_COLUMNS: ColumnDefinition[] = [
  { key: 'title', label: 'Title', hideable: false },  // Required column
  { key: 'status', label: 'Status', hideable: true },
  { key: 'updated', label: 'Updated', hideable: true },
];

// 2. Define sort options
const SORT_OPTIONS = [
  { value: 'updated', label: 'Updated' },
  { value: 'created', label: 'Created' },
  { value: 'title', label: 'Title' },
];

// 3. Use shared hooks
const { sortBy, setSortBy, viewMode, setViewMode } = useListFilters({
  sortOptions: SORT_OPTIONS,
  defaultSort: 'updated',
});

const { visibleColumns, columns, hiddenCount, toggleColumn } = useColumnVisibility({
  columns: ALL_COLUMNS,
  storageKey: 'my-list-column-visibility',
});

// 4. Render toolbar and list
<DocumentListToolbar
  sortOptions={SORT_OPTIONS}
  sortBy={sortBy}
  onSortChange={setSortBy}
  viewModes={['list', 'kanban']}
  viewMode={viewMode}
  onViewModeChange={setViewMode}
  allColumns={ALL_COLUMNS}
  visibleColumns={visibleColumns}
  onToggleColumn={toggleColumn}
  hiddenCount={hiddenCount}
/>

<SelectableList
  items={sortedItems}
  columns={columns}
  renderRow={(item) => <MyRowContent item={item} columns={columns} />}
  selectable={true}
  onSelectionChange={setSelectedIds}
  onContextMenu={handleContextMenu}
/>
```

### When to Use List View

| Document Type | Primary View | Secondary View | Notes |
|---------------|--------------|----------------|-------|
| **Issues** | List | Kanban | List for bulk operations, Kanban for workflow |
| **Programs** | List | - | Replaced CardGrid with List for bulk actions |
| **Documents** | Tree | List | Tree for hierarchy, List for flat view with bulk actions |

**Decision criteria:**
- Use **List** when users need to select/filter/sort/bulk-operate on items
- Use **Tree** when hierarchy is the primary organizational principle
- Use **Kanban** when status workflow visualization is the primary use case
- Avoid **CardGrid** for document collections (prefer List with bulk actions)

### Column Visibility Storage

Column visibility is stored in localStorage with the pattern `{storageKey}`:

```typescript
// Stored as JSON array of hidden column keys
localStorage.setItem('issues-column-visibility', '["assignee", "priority"]');
```

Each list view should use a unique `storageKey` to prevent conflicts.

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

## Icon Tooltip Convention

**Every icon-only interactive element must have both an `aria-label` AND a `Tooltip` wrapper.**

### Why Both?

| Attribute | Purpose | Audience |
|-----------|---------|----------|
| `aria-label` | Screen reader accessibility (WCAG) | Users with visual impairments |
| `Tooltip` | Visual hover hint | Sighted users who don't recognize the icon |

`aria-label` alone is not sufficient—sighted users can't see it. `Tooltip` alone is not sufficient—screen readers can't announce it.

### Pattern

```tsx
import { Tooltip } from '@/components/ui/Tooltip';

// Icon-only button: MUST have both aria-label AND Tooltip
<Tooltip content="Delete document">
  <button
    aria-label="Delete document"
    onClick={handleDelete}
  >
    <TrashIcon />
  </button>
</Tooltip>

// Button with visible text: aria-label optional, Tooltip NOT needed
<button onClick={handleDelete}>
  <TrashIcon />
  Delete
</button>
```

### When to Use Tooltips

| Element | Needs Tooltip? |
|---------|----------------|
| Icon-only button | Yes |
| Icon with visible text label | No |
| Icon used purely decoratively | No (but should have `aria-hidden="true"`) |

### Tooltip Component

The `Tooltip` component wraps any trigger element and displays on hover/focus:

```tsx
<Tooltip
  content="Label text"    // Required: tooltip text
  side="top"              // Optional: top, right, bottom, left (default: top)
  delayDuration={300}     // Optional: hover delay in ms (default: 300)
>
  <button>...</button>
</Tooltip>
```

Use `side="right"` for icons in the left rail, `side="bottom"` for icons in headers.

## Decision Log

### 2025-01-03: Team Allocation View Bug Fix

**Attendees:** User + Claude

**Context:** Team Allocation view showed empty grid despite sprints having `owner_id` set in seed data. Investigation revealed the API was querying issues by `assignee_id` instead of sprints by `owner_id`.

**Root Cause:** The `/api/team/assignments` endpoint was incorrectly treating "allocation" as inferred from issue assignees rather than explicit sprint ownership. This contradicted the documented model where `owner_id` on sprints is the explicit accountability assignment.

**Fix Applied:**
- `GET /api/team/assignments` - Now queries sprint documents by `owner_id` (was querying issues by `assignee_id`)
- `POST /api/team/assign` - Sets `owner_id` on sprint document (was creating placeholder issues)
- `DELETE /api/team/assign` - Clears `owner_id` from sprint (was removing placeholder issues)

**Key Clarification Added:**
- Added "Team Allocation View" section to document the distinction between:
  - Sprint ownership (`owner_id`) - explicit accountability
  - Issue assignment (`assignee_id`) - who has work assigned
- These are different concepts; allocation grid shows ownership, not inferred assignments

**Lesson Learned:** When implementing features involving sprints, always check the documented sprint model. Sprint `owner_id` is the authoritative source for "who owns this sprint."

### 2025-01-01: Program Mode Sprint UX Interview

**Attendees:** User + Claude

**Context:** Sprint tab in Program mode was confusing - all sprints showed "Upcoming" due to seed data bug, no clear current sprint, flat list without grouping.

**Key Decisions:**

1. **Minimal sprint properties**: Only `sprint_number` and `owner_id`. Nothing else stored.

2. **Dates computed from sprint_number**: Use `computeSprintDates(sprint_number, workspace.sprint_start_date)`. Don't store redundant `start_date`/`end_date`.

3. **Status computed from computed dates**: Use `computeSprintStatus()`. No `sprint_status` property.

4. **Goal = document body**: Sprint goals/context go in the TipTap document body, not a separate `goal` property. Aligns with "everything is a document" philosophy.

5. **Sprint owner is REQUIRED**: Every sprint must have an `owner_id` when created. Clear accountability.

6. **One owner per window constraint**: A person can only own one sprint per sprint window across all programs. Prevents overallocation.

7. **Three-section UI grouping**: Active (expanded) → Upcoming (collapsed) → Completed (collapsed). Active sprint shows progress bar, days remaining, owner.

8. **Sprint creation is intentional**: Creating a sprint document = committing to work on that program during that window. Programs can skip windows.

9. **Sprint overlap prevented**: Cannot create two sprints for same program with same sprint_number.

10. **Issues tab filtering**: Add sprint filter to help answer "which issues aren't assigned to a sprint?"

11. **Cross-program separation**: Program mode is program-scoped. Team mode handles cross-program sprint views.

**Ship Philosophy Alignment:**
- YAGNI: Don't store what you can compute (dates, status)
- Everything is a document: Sprint goal = document body, not a property
- Boring technology: Simple derived values, not duplicated state
- Minimal properties: Only store `sprint_number` and `owner_id`

**Rationale for Owner Constraint:**
- Accountability requires clarity (one person owns it)
- Resource visibility (see who's committed where)
- Prevents the "everyone and no one is responsible" anti-pattern

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
2. **States/Labels**: Values in properties JSONB, not separate tables
3. **Initial sync**: Recent + accessed documents (last 30 days + previously touched)
4. **Search**: Server search with offline fallback to local IndexedDB
5. **File attachments**: References only, files stored in S3/blob storage
6. **Real-time**: Full collaboration (presence, cursors, live updates via WebSocket + Yjs)
7. **Offboarding**: Wipe IndexedDB immediately when user removed
8. **Mobile**: Web-only for now, revisit later
9. **API**: REST endpoints

**Rationale for States as Values (not tables):**

- Simpler schema (no foreign keys, no joins)
- Custom states just add to workspace settings
- Query by state uses JSONB operators (performant with GIN index if needed)
- 4 required states enforced in code, custom states allowed

### 2024-12-31: Properties Architecture Clarification

**Attendees:** User + Claude

**Key Decisions:**

1. **Pure JSONB properties**: All type-specific data in `properties` JSONB column
2. **States as values**: `state: "in_progress"` not `state_id: "uuid"`
3. **4 required states**: backlog, todo, in_progress, done (enforced in code)
4. **Custom states allowed**: Workspaces can add more states beyond the 4
5. **Migration planned**: Current explicit columns will migrate to JSONB

## References

- [Unified Document Model](./unified-document-model.md) - Data model details
- [Sprint Documentation Philosophy](./sprint-documentation-philosophy.md) - Sprint workflow
