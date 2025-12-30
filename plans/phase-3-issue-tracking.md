# Phase 3: Issue Tracking

## Goal
Build a Linear-style issue tracking system with collaborative editing, status workflows, and kanban board visualization.

## Constraints
- Reuse existing Yjs collaboration infrastructure for issue descriptions
- Keep UI consistent with existing Linear-dark theme
- Issues belong to the workspace (single-tenant for now)
- Status workflow: backlog → todo → in_progress → done → cancelled

## Acceptance Criteria
- [ ] Can create, view, edit, and delete issues
- [ ] Issue descriptions support real-time collaborative editing
- [ ] Issues display in a sortable/filterable list view
- [ ] Kanban board view with drag-and-drop between columns
- [ ] Status, priority, and assignee can be changed
- [ ] "Issues" mode in icon rail shows issue list in sidebar
- [ ] Keyboard shortcut "c" creates new issue from anywhere

## Implementation Steps

### Step 1: Database Schema
Create issues table with migration:
```sql
CREATE TABLE issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  title VARCHAR(500) NOT NULL,
  description_yjs BYTEA,
  status VARCHAR(50) NOT NULL DEFAULT 'backlog',
  priority VARCHAR(20) NOT NULL DEFAULT 'medium',
  assignee_id UUID REFERENCES users(id),
  created_by UUID NOT NULL REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT valid_status CHECK (status IN ('backlog', 'todo', 'in_progress', 'done', 'cancelled')),
  CONSTRAINT valid_priority CHECK (priority IN ('urgent', 'high', 'medium', 'low', 'none'))
);
CREATE INDEX idx_issues_workspace ON issues(workspace_id);
CREATE INDEX idx_issues_status ON issues(status);
CREATE INDEX idx_issues_assignee ON issues(assignee_id);
```

### Step 2: API Endpoints
Create `/api/issues` routes:
- GET /api/issues - list issues (with filters: status, priority, assignee)
- POST /api/issues - create issue
- GET /api/issues/:id - get single issue
- PATCH /api/issues/:id - update issue (title, status, priority, assignee)
- DELETE /api/issues/:id - delete issue

### Step 3: Issue List Component
Build `IssuesList.tsx`:
- Table/list view with columns: ID, Title, Status, Priority, Assignee, Updated
- Sortable columns
- Filter chips for status
- Click row to open issue detail

### Step 4: Issue Detail/Editor Page
Build `IssueEditor.tsx`:
- Header with back button, issue ID badge, title input
- Status dropdown, Priority dropdown, Assignee dropdown
- Collaborative description editor (reuse TipTap + Yjs setup)
- Sidebar hidden when editing (like document editor)

### Step 5: Update Navigation
- Rename "Programs" to "Issues" in icon rail
- Update icon to ticket/issue icon
- Sidebar shows issue list when in Issues mode
- Quick filter tabs: All, Active (todo + in_progress), Backlog, Done

### Step 6: Kanban Board View
Build `KanbanBoard.tsx`:
- Columns for each status: Backlog, Todo, In Progress, Done
- Drag-and-drop cards between columns (use @dnd-kit/core)
- Toggle between list and kanban view
- Cards show: title, priority badge, assignee avatar

### Step 7: Keyboard Shortcuts
- "c" - create new issue (global)
- "1-4" - set status when issue focused
- "Escape" - close issue detail

## Ralph Loop Exit Criteria

**Completion Promise:** `ISSUE_TRACKING_COMPLETE`

**Exit Conditions (ALL must be true):**
- [ ] Issues table exists in database with correct schema
- [ ] API endpoints work: GET/POST/PATCH/DELETE /api/issues
- [ ] Issues list view displays with status filters
- [ ] Issue detail page with collaborative description editor works
- [ ] Kanban board with drag-and-drop status changes works
- [ ] "Issues" mode appears in icon rail with issue list in sidebar
- [ ] Keyboard shortcut "c" creates new issue
- [ ] All TypeScript compiles without errors
- [ ] App runs without console errors

## Technical Notes
- Reuse collaboration WebSocket server - add issue: prefix for issue descriptions
- Issue IDs displayed as short codes (first 8 chars of UUID or sequential number)
- Consider adding issue number sequence per workspace later
## Session State (Auto-updated: 2025-12-30T18:43:07Z)

**Branch:** `master`
**Project:** `/Users/corcoss/code/ship`

### Recent Commits
```
ed17b87 Initial commit: Ship MVP with document and issue tracking
```

### Uncommitted Changes
```
 M web/src/components/Editor.tsx
 M web/src/pages/IssueEditor.tsx
?? docs/solutions/
```

### Modified Files
web/src/components/Editor.tsx
web/src/pages/IssueEditor.tsx

