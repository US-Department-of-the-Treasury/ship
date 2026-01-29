# Developer Workflow Guide

This guide documents the end-to-end developer workflow in Ship, from receiving an issue to week completion. It serves as both documentation of the current state and a training tutorial.

> **Last Updated:** 2025-12-30
> **Current UX Rating:** 2.5/10 (see [Baseline Evaluation](#baseline-evaluation))

---

## Overview

Ship follows a document-first approach where everything (issues, weeks, programs, wikis) is a document. The developer workflow centers around:

1. **Programs** - Collections of issues and weeks (like "Ship Core", "API Platform")
2. **Issues** - Work items with state, priority, and assignee
3. **Weeks** - Time-boxed iterations with goals and backlog planning
4. **Documents** - Wiki pages, weekly plans, and retrospectives

---

## Workflow 1: Issue Triage & Assignment

### Goal
See incoming issues across programs and assign them to a week in <3 clicks.

### Current Path

1. **Navigate to Issues**
   - Click "Issues" in the left icon rail
   - Or press `Cmd+K` and type "issues" *(not yet implemented)*

2. **View Backlog**
   - Issues page shows all issues filtered by state
   - Default view shows all states

3. **Assign to Week**
   - Click an issue to open the issue editor
   - In the Properties sidebar (right side), find "Week" dropdown
   - Select a week from the dropdown
   - Issue is now assigned to that week

### Known Issues
- [ ] **BUG**: Week assignment dropdown may not work (API field mismatch)
- [ ] No bulk assignment capability yet
- [ ] No drag-and-drop from issues list to week

---

## Workflow 2: Week Planning

### Goal
Create a week with clear goals and plan which issues to include.

### Current Path

1. **Navigate to a Program**
   - Click "Programs" in the left icon rail
   - Click a program name in the sidebar (e.g., "Ship Core")

2. **View Program's Weeks**
   - In Program view, click "Weeks" tab *(currently broken)*
   - **Workaround**: Navigate directly to `/programs/{id}/view` and use Weeks tab

3. **Create New Week**
   - Click "New Week" button
   - Fill in: Name, Start Date, End Date, Goal
   - Click "Create Week"

4. **Week Planning View**
   - Navigate to `/weeks/{id}/view` to see the planning board
   - **Left column**: Backlog (program issues not in any week)
   - **Right column**: Week (issues assigned to this week)

5. **Add Issues to Week**
   - Click the green "+" button on any backlog issue
   - Issue moves from Backlog to Week column
   - *(Currently broken - see bugs)*

6. **Set Week Goal**
   - Click "Click to add a week goal..." text
   - Type your goal (hypothesis for the week)
   - Click "Save"
   - *(Currently broken - API doesn't accept goal field)*

### Known Issues
- [ ] **BUG**: Tab switching doesn't work in Program view
- [ ] **BUG**: "+" button returns 400 error (wrong field name)
- [ ] **BUG**: Week goal save returns 400 error (field not in schema)
- [ ] No drag-and-drop for planning

---

## Workflow 3: Week Execution

### Goal
Track issues through states with visual clarity and see progress at a glance.

### Current Path

1. **Start the Week**
   - From week view (`/weeks/{id}/view`)
   - Click "Start Week" button (changes status from Planned to Active)
   - Week is now active

2. **Work on Issues**
   - Click an issue in the Week column to open it
   - Update state via the Properties sidebar: backlog → todo → in_progress → done
   - Add notes, comments, or updates in the document area

3. **Track Progress**
   - Week view shows progress bar: "X% complete (Y/Z)"
   - Progress updates automatically as issues move to "done" state

4. **Complete Week**
   - When work is done, click "Complete Week" button
   - Week status changes to Completed

### Issue States

| State | Meaning | Visual |
|-------|---------|--------|
| backlog | Not yet planned | Gray dot |
| todo | Planned but not started | Blue dot |
| in_progress | Currently being worked on | Yellow dot |
| done | Completed | Green dot |
| cancelled | Won't do | Red dot |

### Known Issues
- [ ] Issues can't be moved to week (API bug)
- [ ] No keyboard shortcuts for state changes
- [ ] No board view (only list view exists)

---

## Workflow 4: Weekly Retrospective

### Goal
Write a retro document capturing learnings after week ends.

### Current Path

**NOT YET IMPLEMENTED**

The intended workflow:
1. After completing a week, click "Write Retrospective"
2. Create a document linked to the week with type `weekly_retro`
3. Template includes: What went well, What didn't, Action items
4. Retro is discoverable from the week view

### Known Issues
- [ ] **MISSING**: `weekly_retro` document type doesn't exist
- [ ] **MISSING**: No UI to create retro from week
- [ ] **MISSING**: No template for retrospective format

---

## Workflow 5: Weekly Plan Document

### Goal
Write a weekly plan document capturing goals and hypothesis.

### Current Path

**NOT YET IMPLEMENTED**

The intended workflow:
1. When creating a week, click "Write Weekly Plan"
2. Create a document linked to the week with type `weekly_plan`
3. Document captures: Goals, hypothesis, key deliverables, risks
4. Plan is visible from week view header

### Known Issues
- [ ] **MISSING**: `weekly_plan` document type doesn't exist
- [ ] **MISSING**: No UI to create plan from week
- [ ] Week has `goal` field but it's just a text field, not a full document

---

## Quick Reference

### Navigation

| Action | Current Path | Ideal (Future) |
|--------|-------------|----------------|
| View all issues | Click Issues icon | `Cmd+K` → "issues" |
| View all programs | Click Programs icon | `Cmd+K` → "programs" |
| Open specific program | Sidebar → Program name | `Cmd+K` → program name |
| View week | URL: `/weeks/{id}/view` | Click week card |
| Create issue | Issues page → New Issue | `Cmd+K` → "new issue" |
| Create week | Program → Weeks → New | `Cmd+K` → "new week" |

### Keyboard Shortcuts (Planned)

| Shortcut | Action |
|----------|--------|
| `Cmd+K` | Open command palette |
| `C` | Create new (context-dependent) |
| `E` | Edit current item |
| `1-4` | Set issue state (todo/in_progress/done/cancelled) |
| `P` | Set priority |
| `A` | Assign to user |
| `S` | Assign to week |

---

## Baseline Evaluation

**Date:** 2025-12-30
**Rating:** 2.5/10

| Area | Score | Notes |
|------|-------|-------|
| Issue Triage | 0.5/2 | UI exists but API broken |
| Week Goals | 0.5/2 | Can edit but can't save |
| Week Execution | 1.0/2 | Display works, interaction broken |
| Weekly Retro | 0.0/2 | Feature doesn't exist |
| Overall Polish | 0.5/2 | Visual good, full of bugs |

### Bugs Blocking Basic Workflow

1. **Tab switching** - Can't switch between Issues/Weeks tabs in Program view
2. **Issue-to-week** - "+" button fails with 400 error
3. **Week goal save** - Save button fails with 400 error
4. **Missing features** - No weekly_plan or weekly_retro document types

---

## Workflow 6: Claude Code Integration

### Goal
Use AI-assisted development workflows with real-time Ship visibility.

### Overview

Ship integrates with Claude Code CLI for automated week planning and execution. See [Ship + Claude CLI Integration Guide](./ship-claude-cli-integration.md) for complete documentation.

### Key Commands

| Command | Description | Ship Integration |
|---------|-------------|------------------|
| `/prd` | Generate PRD with user stories | Creates week + issues in Ship |
| `/work` | Execute PRD stories | Updates issue states in real-time |
| `/standup` | Daily progress summary | Pulls data from Ship |
| `/document` | Capture learnings | Creates wiki docs in Ship |

### Setup

1. Generate API token in **Workspace Settings → API Tokens**
2. Configure `~/.claude/.env`:
   ```bash
   SHIP_API_TOKEN=ship_<your_token>
   SHIP_API_URL=https://your-ship-instance.example.com/api
   ```
3. Run `/prd` to create a linked week

### Observable Outcomes

While `/work` runs:
- Issue states transition: `todo` → `in_progress` → `done`
- Week progress percentage updates live
- Iteration attempts logged to week history
- Verification failures recorded with context

---

## Future Improvements

Once bugs are fixed, the following improvements are planned:

1. **Cmd+K Command Palette** - Quick access to any action
2. **Drag-and-Drop Planning** - Move issues between backlog/week by dragging
3. **Week Documentation** - Full documents for plans and retros
4. **Keyboard-First UX** - All actions available via keyboard
5. **Auto-Archive** - Move incomplete issues to backlog when week ends
6. **Board View** - Kanban-style view for week execution

---

## Appendix: URL Structure

| URL Pattern | View |
|-------------|------|
| `/programs` | Programs list |
| `/programs/{id}` | Program editor |
| `/programs/{id}/view` | Program view (tabs: Issues, Weeks, Settings) |
| `/weeks/{id}` | Week editor (document) |
| `/weeks/{id}/view` | Week planning view (backlog/week columns) |
| `/issues` | Issues list |
| `/issues/{id}` | Issue editor |
| `/docs` | Wiki documents list |
| `/docs/{id}` | Document editor |
