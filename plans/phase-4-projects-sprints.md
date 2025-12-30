# Phase 4: Projects & Sprints

## Goal
Add project organization and sprint planning to group issues into logical containers with time-boxed iterations.

## Constraints
- Projects belong to workspaces (single-tenant)
- Issues can belong to one project (or none)
- Sprints belong to projects and have start/end dates
- Keep UI consistent with Linear-dark theme
- Reuse existing patterns from issues implementation

## Acceptance Criteria
- [ ] Can create, view, edit, and archive projects
- [ ] Issues can be assigned to projects
- [ ] Can create sprints within projects with date ranges
- [ ] Issues can be assigned to sprints
- [ ] Project view shows all issues in that project
- [ ] Sprint view shows issues in current sprint with progress
- [ ] Sidebar shows project hierarchy: Project → Sprints → Issues

## Implementation Steps

### Step 1: Database Schema
Create projects and sprints tables:
```sql
CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  name VARCHAR(200) NOT NULL,
  description TEXT,
  prefix VARCHAR(10) NOT NULL,  -- e.g., "SHIP" for SHIP-123
  color VARCHAR(7),             -- hex color for UI
  archived_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(workspace_id, prefix)
);

CREATE TABLE sprints (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name VARCHAR(200) NOT NULL,
  goal TEXT,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'planned',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT valid_sprint_status CHECK (status IN ('planned', 'active', 'completed'))
);

-- Add ticket_number sequence per project
ALTER TABLE documents ADD COLUMN IF NOT EXISTS ticket_number INTEGER;
CREATE SEQUENCE IF NOT EXISTS ticket_seq;
```

### Step 2: API Endpoints
Create `/api/projects` and `/api/sprints` routes:
- GET/POST /api/projects - list/create projects
- GET/PATCH/DELETE /api/projects/:id - single project operations
- GET/POST /api/projects/:id/sprints - list/create sprints
- PATCH /api/sprints/:id - update sprint (dates, status)
- PATCH /api/issues/:id - add project_id, sprint_id assignment

### Step 3: Project List & Creation
Build `ProjectsList.tsx`:
- Grid of project cards with name, prefix, issue count
- Color-coded project badges
- "New Project" button with name, prefix, color picker
- Click card to open project view

### Step 4: Project Detail View
Build `ProjectView.tsx`:
- Header with project name, prefix badge, description
- Tabs: Issues | Sprints | Settings
- Issues tab shows filtered issue list/kanban for this project
- Settings tab for name, description, prefix, archive

### Step 5: Sprint Planning
Build `SprintView.tsx`:
- Sprint header with name, dates, progress bar
- Backlog column (unassigned to sprint)
- Sprint column (assigned issues)
- Drag issues between backlog and sprint
- Sprint goal text field

### Step 6: Update Issue Assignment
Modify `IssueEditor.tsx`:
- Add Project dropdown in sidebar
- Add Sprint dropdown (filtered by selected project)
- Issue ID shows as PROJECT-123 format when in project

### Step 7: Navigation Updates
- Add "Projects" mode to icon rail
- Sidebar shows project list with nested sprints
- Quick switch between projects

## Ralph Loop Exit Criteria

**Completion Promise:** `PROJECTS_SPRINTS_COMPLETE`

**Exit Conditions (ALL must be true):**
- [ ] Projects table exists with prefix uniqueness
- [ ] Sprints table exists with project relationship
- [ ] API endpoints work: projects CRUD, sprints CRUD
- [ ] Project list view displays with cards
- [ ] Project detail view shows filtered issues
- [ ] Sprint planning view with backlog/sprint columns
- [ ] Issues can be assigned to projects and sprints
- [ ] Issue IDs display as PROJECT-123 when in project
- [ ] "Projects" mode in navigation works
- [ ] All TypeScript compiles without errors
- [ ] App runs without console errors

## Technical Notes
- Ticket numbers are per-project sequences (SHIP-1, SHIP-2, etc.)
- Sprints automatically transition to 'completed' when end_date passes
- Consider adding sprint burndown chart in future phase
- Archived projects hide from default list but remain accessible
