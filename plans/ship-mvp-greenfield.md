# Ship MVP - Greenfield Build Plan

**Created:** 2025-12-30
**Status:** Ready for Implementation
**Type:** Greenfield Build (No Data Migration)

---

## Executive Summary

Build Ship - a government-hardened project management platform with collaborative document editing. This is a true greenfield build following the unified document model ("everything is a document with properties").

### MVP Features
1. **Authentication**: Email/password login + dev seed credentials
2. **Program Mode**: View programs, projects, sprints, issues with sidebar tree navigation
3. **Docs Mode**: View and edit workspace-level wikis with collaborative editing
4. **Team Mode**: Spreadsheet view showing who's working on what per sprint period

### Key Constraints
- Section 508 compliance (WCAG 2.1 AA)
- 15-minute inactivity session timeout
- Zero external telemetry
- Worktree isolation for concurrent development
- Government deployment patterns (AWS, SSM Parameter Store)

---

## Architecture Decisions

### Tech Stack (from docs/application-architecture.md)
| Layer | Technology | Rationale |
|-------|------------|-----------|
| Backend | Node.js + Express | Single process for REST + WebSocket |
| Database | PostgreSQL + Kysely | Type-safe SQL, no ORM overhead |
| Collaboration | TipTap + Yjs | CRDT-based conflict-free editing |
| Frontend | React + Vite | Fast builds, modern tooling |
| UI Components | shadcn/ui + Tailwind | Accessible, customizable |
| Client Storage | IndexedDB (Dexie) | Offline-tolerant persistence |
| Data Fetching | TanStack Query | Optimistic updates, caching |

### Monorepo Structure
```
ship/
├── api/         # Express backend + WebSocket
├── web/         # React + Vite frontend
├── shared/      # @ship/shared TypeScript types
├── scripts/     # Worktree isolation scripts
└── plans/       # This file
```

### Design Philosophy
- **Linear-style minimal aesthetic** with high information density
- **Everything is a document** - issues, wikis, programs all share the same editor
- **Modes are lenses** on the same data, not separate features

---

## Interview Decisions Log

### Session: 2025-12-30

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Bootstrap | Seed script | Creates workspace + admin (dev@ship.local/password) |
| DB Isolation | Database per worktree | ship_main, ship_feature_x for concurrent dev |
| Team Mode | Spreadsheet view | Rows=people, Columns=sprint periods |
| Sprint Association | Sprint Plan owner + issue assignees | Hybrid approach |
| Program Navigation | Sidebar tree | Click program → tabbed detail (Projects, Sprints, Issues) |
| Docs Hierarchy | Parent-child documents | Notion-style nesting |
| Issue Workflow | Free movement | Any state → any state |
| Issue Creation | Full page editor | "Everything is a document" UX |
| Sprint Selection | Sprint number picker | Sprint 6, Sprint 7... |
| Backlog | Single per program | One backlog view per program |
| Design Style | Linear-style minimal | Information density focus |
| Sprint Docs | Sprint container only | No Plan/Retro in MVP |
| Dark Mode | Light only for MVP | Simplicity |
| Custom Properties | Not in MVP | Defer complexity |
| Dev Database | Docker Compose | PostgreSQL container |

---

## Ralph Loop Exit Criteria (Phases 0-1)

**Completion Promise:** `AUTH_MILESTONE_COMPLETE`

**Exit Conditions (ALL must be true):**
- [ ] `pnpm install` succeeds without errors
- [ ] `pnpm run build` succeeds for all packages
- [ ] `docker compose up -d` starts PostgreSQL
- [ ] `pnpm run db:seed` creates workspace and dev user
- [ ] Visit http://localhost:5173 - see Linear-style minimal login form
- [ ] Enter dev@ship.local / password - redirects to app shell
- [ ] App shell has sidebar on left, header with user email
- [ ] Click logout - returns to login page
- [ ] Design feels Linear-style minimal with good information density

---

## Implementation Phases

### Phase 0: Project Bootstrap (Foundation)
**Goal:** Running monorepo with all tooling configured

#### Tasks
- [ ] Initialize pnpm workspace with api/web/shared packages
- [ ] Configure TypeScript with project references
- [ ] Set up Docker Compose for PostgreSQL
- [ ] Create worktree-init.sh for port/database isolation
- [ ] Configure ESLint, Prettier
- [ ] Set up shadcn/ui in web package
- [ ] Create base Express server with health endpoint
- [ ] Create base Vite app with React Router

#### Validation
```bash
# All commands must succeed
pnpm install
pnpm run build
./scripts/worktree-init.sh
docker compose up -d
pnpm run dev
# Visit http://localhost:5173 - see empty app shell
# Visit http://localhost:3000/health - see JSON response
```

---

### Phase 1: Authentication
**Goal:** Users can log in and see authenticated app shell

#### Tasks
- [ ] Create users table with email/password (bcrypt hashed)
- [ ] Create sessions table with 15-minute inactivity timeout
- [ ] Implement /api/auth/login endpoint
- [ ] Implement /api/auth/logout endpoint
- [ ] Implement /api/auth/me endpoint (session check)
- [ ] Create seed script: workspace + dev@ship.local user
- [ ] Build login page with email/password form
- [ ] Build authenticated app shell (sidebar + header)
- [ ] Add session timeout check on frontend
- [ ] Implement protected route wrapper

#### Validation
```bash
# Seed the database
pnpm run db:seed

# Test login flow
# 1. Visit http://localhost:5173/login
# 2. Enter dev@ship.local / password
# 3. Should redirect to app shell
# 4. Should see user info in header
# 5. Logout should return to login page
```

**Ralph Loop Exit Criteria:**
```
I visit the login page and see a Linear-style minimal login form.
I enter dev@ship.local and password.
I am redirected to the main app with a sidebar on the left.
The header shows my email.
I click logout and return to the login page.
```

---

### Phase 2: Document Model Foundation
**Goal:** Core document CRUD with collaborative editing working

#### Tasks
- [ ] Create documents table (unified schema from docs/)
- [ ] Create document_type enum (wiki, issue, program, project, sprint, person)
- [ ] Implement Yjs WebSocket server (collaboration path)
- [ ] Create TipTap editor component with Collaboration extension
- [ ] Implement /api/documents CRUD endpoints
- [ ] Create document list component
- [ ] Create document detail/editor component
- [ ] Implement real-time sync indicator ("Saving...", "Saved")
- [ ] Add presence indicators (who's viewing)

#### Validation
```bash
# Open two browser windows to same document
# Type in one - should appear in other immediately
# Presence indicator shows both users
# Close one - presence updates
```

**Ralph Loop Exit Criteria:**
```
I create a new document.
The editor opens full-page with a clean TipTap interface.
I type some text and see "Saving..." then "Saved".
In a second browser tab, I open the same document.
I see the same content.
I type in the second tab and see it appear in the first.
I see presence indicators showing both sessions.
```

---

### Phase 3: Docs Mode
**Goal:** Workspace-level wiki viewing and editing

#### Tasks
- [ ] Create Docs mode route (/docs)
- [ ] Build document tree component (parent-child navigation)
- [ ] Implement drag-drop reordering
- [ ] Add "New Page" button that creates wiki document
- [ ] Build document sidebar with tree navigation
- [ ] Implement breadcrumb navigation
- [ ] Style editor for wiki content (prose styling)

#### Validation
```bash
# Navigate to /docs
# Create new page
# Create child page under it
# Navigate tree structure
# Edit content collaboratively
```

**Ralph Loop Exit Criteria:**
```
I click "Docs" in the main nav.
I see a document tree on the left, empty content on the right.
I click "New Page" and a new wiki document is created.
I type a title and some content.
I click "New Page" again and create a child page.
The tree shows parent-child relationship.
I can click to navigate between pages.
The content area shows the selected document in the editor.
```

---

### Phase 4: Programs & Projects Setup
**Goal:** Program/Project hierarchy with basic CRUD

#### Tasks
- [ ] Create programs table (extends documents with prefix, etc.)
- [ ] Create projects table (extends documents with dates, etc.)
- [ ] Build Program mode route (/programs)
- [ ] Build program list view
- [ ] Build program creation flow
- [ ] Build program detail page with tabs (Projects, Sprints, Issues)
- [ ] Build project list within program
- [ ] Build project creation flow
- [ ] Generate ticket numbers (AUTH-1, AUTH-2, etc.)

#### Validation
```bash
# Create program "Authentication" with prefix "AUTH"
# Create project "Login Revamp" under AUTH
# See AUTH program in sidebar
# Click to see tabbed interface
```

**Ralph Loop Exit Criteria:**
```
I click "Programs" in the main nav.
I see a sidebar tree of programs (empty initially).
I click "New Program" and create "Authentication" with prefix "AUTH".
The sidebar updates to show AUTH.
I click AUTH and see a tabbed interface.
I click the Projects tab.
I click "New Project" and create "Login Revamp".
The project appears in the list with a start/end date.
```

---

### Phase 5: Issues
**Goal:** Full issue lifecycle within programs

#### Tasks
- [ ] Create issues table (extends documents with state, assignee, etc.)
- [ ] Create states table (Backlog, Todo, In Progress, Done)
- [ ] Build issue creation flow (full page editor)
- [ ] Build issue list view with state columns
- [ ] Build issue detail page
- [ ] Implement state transitions (drag or click)
- [ ] Show ticket numbers (AUTH-1)
- [ ] Implement assignee selection
- [ ] Build backlog view (all issues without sprint)

#### Validation
```bash
# Navigate to AUTH program → Issues tab
# Create new issue "Implement OAuth"
# Issue appears as AUTH-1
# Change state to "In Progress"
# Assign to dev@ship.local
```

**Ralph Loop Exit Criteria:**
```
I navigate to AUTH program and click Issues tab.
I click "New Issue".
A full-page editor opens (like creating a wiki page).
I enter title "Implement OAuth" and description.
I see it saved as AUTH-1.
I return to the issue list.
AUTH-1 appears in the Backlog column.
I drag it to "In Progress".
The state updates and the issue moves.
I click the issue and see the full document editor.
```

---

### Phase 6: Sprints
**Goal:** Sprint containers and issue assignment

#### Tasks
- [ ] Implement sprint number calculation from workspace start date
- [ ] Create sprint documents (per program per sprint window)
- [ ] Build Sprint tab in program view
- [ ] Show current sprint, past sprints, future sprints
- [ ] Build sprint detail view (issues assigned to sprint)
- [ ] Implement issue → sprint assignment
- [ ] Build sprint picker component

#### Validation
```bash
# Navigate to AUTH → Sprints tab
# See Sprint 1 (current)
# Assign AUTH-1 to Sprint 1
# See issue in sprint view
```

**Ralph Loop Exit Criteria:**
```
I navigate to AUTH program and click Sprints tab.
I see a list of sprints (Sprint 1 current, Sprint 2 planned).
I click Sprint 1.
I see issues assigned to this sprint (empty initially).
I go to Issues tab and click AUTH-1.
I use the sprint picker to assign it to Sprint 1.
I return to Sprints → Sprint 1.
AUTH-1 now appears in the sprint.
```

---

### Phase 7: Team Mode
**Goal:** Spreadsheet view of who's working on what

#### Tasks
- [ ] Create person documents (linked to auth users)
- [ ] Build Team mode route (/team)
- [ ] Build spreadsheet grid component
- [ ] Rows = people (person documents)
- [ ] Columns = sprint periods (3 months back, 3 months forward)
- [ ] Cells = programs/projects the person is working on
- [ ] Calculate association from: Sprint Plan owner_id + issue assignees
- [ ] Implement column navigation (scroll through sprints)

#### Validation
```bash
# Navigate to /team
# See spreadsheet with dev@ship.local as a row
# Sprint 1 cell shows AUTH (assigned issue)
# Scroll to see other sprint columns
```

**Ralph Loop Exit Criteria:**
```
I click "Team" in the main nav.
I see a spreadsheet with people as rows.
The columns are sprint periods (Sprint 1, Sprint 2, etc.).
I see dev@ship.local in a row.
The Sprint 1 cell shows "AUTH" because AUTH-1 is assigned to me.
I scroll left/right to see past/future sprints.
The current sprint column is highlighted.
I click a cell and see a tooltip with the specific issues.
```

---

### Phase 8: Polish & Accessibility
**Goal:** Production-ready UX meeting government standards

#### Tasks
- [ ] Audit and fix Section 508 compliance (axe-core)
- [ ] Add keyboard navigation throughout
- [ ] Implement focus management in modals/dialogs
- [ ] Add ARIA labels and landmarks
- [ ] Test with screen reader (VoiceOver)
- [ ] Add loading states (skeletons)
- [ ] Add error states (toast notifications)
- [ ] Add empty states (helpful prompts)
- [ ] Optimize for information density
- [ ] Final design polish pass

#### Validation
```bash
# Run axe-core accessibility audit
# Navigate entire app via keyboard only
# Test critical flows with VoiceOver
# Verify WCAG 2.1 AA compliance
```

**Ralph Loop Exit Criteria:**
```
I run the accessibility audit and see zero critical violations.
I can navigate from login to creating an issue using only keyboard.
Tab order is logical and focus is always visible.
Error messages are announced to screen readers.
Loading states show skeletons, not blank screens.
The UI feels dense with information but not cluttered.
```

---

## Ralph Loop Validation Protocol

### Test Execution Pattern
For each phase's exit criteria:

1. Start fresh (clear database, seed fresh)
2. Execute criteria as written
3. Take screenshots at each step
4. If ANY step fails: fix and restart validation
5. All steps must pass in sequence

### Playwright MCP Integration
Each exit criteria should be verifiable via Playwright:

```javascript
// Example: Phase 1 validation
test('authentication flow', async ({ page }) => {
  await page.goto('/login');
  await expect(page.locator('form')).toBeVisible();
  await page.fill('[name="email"]', 'dev@ship.local');
  await page.fill('[name="password"]', 'password');
  await page.click('button[type="submit"]');
  await expect(page).toHaveURL('/');
  await expect(page.locator('header')).toContainText('dev@ship.local');
});
```

### Visual Verification
After each phase:
1. Screenshot main views
2. Compare to Linear for design quality
3. Rate information density (target: high)
4. Rate visual clarity (target: clean, minimal)

---

## Database Schema (Core Tables)

```sql
-- Core document table (unified model)
CREATE TABLE documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  document_type TEXT NOT NULL,
  name TEXT NOT NULL,
  content JSONB,          -- TipTap JSON for rich text
  properties JSONB DEFAULT '{}',

  -- Associations
  program_id UUID REFERENCES documents(id),
  project_id UUID REFERENCES documents(id),
  sprint_id UUID REFERENCES documents(id),
  parent_id UUID REFERENCES documents(id),

  -- Issue-specific
  ticket_number INTEGER,
  state_id UUID REFERENCES states(id),

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  created_by UUID REFERENCES users(id)
);

-- Users and auth
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  expires_at TIMESTAMPTZ NOT NULL,
  last_activity TIMESTAMPTZ DEFAULT now()
);

-- Config entities (not documents)
CREATE TABLE states (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id),
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  position INTEGER NOT NULL
);

-- Workspaces
CREATE TABLE workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  sprint_start_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

---

## Worktree Isolation

### Setup Script (scripts/worktree-init.sh)
```bash
#!/bin/bash
# Generate unique config per worktree
HASH=$(echo -n "$(pwd)" | md5sum | cut -c1-4)
PORT_OFFSET=$((0x$HASH % 1000))

API_PORT=$((3000 + PORT_OFFSET))
WEB_PORT=$((5173 + PORT_OFFSET))
DB_NAME="ship_$(git branch --show-current | tr -cd '[:alnum:]_')"

# Generate .env.local files
cat > api/.env.local << EOF
PORT=$API_PORT
DATABASE_URL=postgresql://localhost:5432/$DB_NAME
CORS_ORIGIN=http://localhost:$WEB_PORT
EOF

cat > web/.env.local << EOF
VITE_API_URL=http://localhost:$API_PORT
VITE_PORT=$WEB_PORT
EOF
```

### Usage
```bash
# Create worktree
git worktree add ../ship-feature-x -b feature-x
cd ../ship-feature-x

# Initialize (auto-generates unique ports/database)
./scripts/worktree-init.sh
pnpm install
pnpm run dev
```

---

## Success Metrics

### Phase Completion
Each phase is complete when:
1. All tasks checked off
2. Ralph Loop exit criteria pass
3. Visual verification scores acceptable
4. No accessibility violations

### MVP Complete When
- [ ] All 8 phases pass validation
- [ ] E2E test suite passes (Playwright)
- [ ] Accessibility audit passes (axe-core)
- [ ] Design review rates 8+/10
- [ ] Can demo full workflow: Login → Create Program → Create Issue → Assign to Sprint → View in Team Mode

---

## Files Referenced

- `docs/application-architecture.md` - Tech stack decisions
- `docs/unified-document-model.md` - Document model specification
- `docs/document-model-conventions.md` - Terminology and conventions
- `docs/sprint-documentation-philosophy.md` - Sprint workflow
- `research/configs/` - Ready-to-use monorepo configuration files

---

## Session State (Auto-updated: 2025-12-30T18:17:38Z)

**Branch:** `unknown`
**Project:** `/Users/corcoss/code/ship`

### Recent Commits
```

```

### Uncommitted Changes
```

```

### Modified Files


