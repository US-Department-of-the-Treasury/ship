# Developer Workflow Guide

This guide documents the end-to-end developer workflow in Ship, from receiving an issue to sprint completion. It serves as both documentation of the current state and a training tutorial.

> **Last Updated:** 2025-12-30
> **Current UX Rating:** 2.5/10 (see [Baseline Evaluation](#baseline-evaluation))

---

## Overview

Ship follows a document-first approach where everything (issues, sprints, programs, wikis) is a document. The developer workflow centers around:

1. **Programs** - Collections of issues and sprints (like "Ship Core", "API Platform")
2. **Issues** - Work items with state, priority, and assignee
3. **Sprints** - Time-boxed iterations with goals and backlog planning
4. **Documents** - Wiki pages, sprint plans, and retrospectives

---

## Workflow 1: Issue Triage & Assignment

### Goal
See incoming issues across programs and assign them to a sprint in <3 clicks.

### Current Path

1. **Navigate to Issues**
   - Click "Issues" in the left icon rail
   - Or press `Cmd+K` and type "issues" *(not yet implemented)*

2. **View Backlog**
   - Issues page shows all issues filtered by state
   - Default view shows all states

3. **Assign to Sprint**
   - Click an issue to open the issue editor
   - In the Properties sidebar (right side), find "Sprint" dropdown
   - Select a sprint from the dropdown
   - Issue is now assigned to that sprint

### Known Issues
- [ ] **BUG**: Sprint assignment dropdown may not work (API field mismatch)
- [ ] No bulk assignment capability yet
- [ ] No drag-and-drop from issues list to sprint

---

## Workflow 2: Sprint Planning

### Goal
Create a sprint with clear goals and plan which issues to include.

### Current Path

1. **Navigate to a Program**
   - Click "Programs" in the left icon rail
   - Click a program name in the sidebar (e.g., "Ship Core")

2. **View Program's Sprints**
   - In Program view, click "Sprints" tab *(currently broken)*
   - **Workaround**: Navigate directly to `/programs/{id}/view` and use Sprints tab

3. **Create New Sprint**
   - Click "New Sprint" button
   - Fill in: Name, Start Date, End Date, Goal
   - Click "Create Sprint"

4. **Sprint Planning View**
   - Navigate to `/sprints/{id}/view` to see the planning board
   - **Left column**: Backlog (program issues not in any sprint)
   - **Right column**: Sprint (issues assigned to this sprint)

5. **Add Issues to Sprint**
   - Click the green "+" button on any backlog issue
   - Issue moves from Backlog to Sprint column
   - *(Currently broken - see bugs)*

6. **Set Sprint Goal**
   - Click "Click to add a sprint goal..." text
   - Type your goal (hypothesis for the sprint)
   - Click "Save"
   - *(Currently broken - API doesn't accept goal field)*

### Known Issues
- [ ] **BUG**: Tab switching doesn't work in Program view
- [ ] **BUG**: "+" button returns 400 error (wrong field name)
- [ ] **BUG**: Sprint goal save returns 400 error (field not in schema)
- [ ] No drag-and-drop for planning

---

## Workflow 3: Sprint Execution

### Goal
Track issues through states with visual clarity and see progress at a glance.

### Current Path

1. **Start the Sprint**
   - From sprint view (`/sprints/{id}/view`)
   - Click "Start Sprint" button (changes status from Planned to Active)
   - Sprint is now active

2. **Work on Issues**
   - Click an issue in the Sprint column to open it
   - Update state via the Properties sidebar: backlog → todo → in_progress → done
   - Add notes, comments, or updates in the document area

3. **Track Progress**
   - Sprint view shows progress bar: "X% complete (Y/Z)"
   - Progress updates automatically as issues move to "done" state

4. **Complete Sprint**
   - When work is done, click "Complete Sprint" button
   - Sprint status changes to Completed

### Issue States

| State | Meaning | Visual |
|-------|---------|--------|
| backlog | Not yet planned | Gray dot |
| todo | Planned but not started | Blue dot |
| in_progress | Currently being worked on | Yellow dot |
| done | Completed | Green dot |
| cancelled | Won't do | Red dot |

### Known Issues
- [ ] Issues can't be moved to sprint (API bug)
- [ ] No keyboard shortcuts for state changes
- [ ] No board view (only list view exists)

---

## Workflow 4: Sprint Retrospective

### Goal
Write a retro document capturing learnings after sprint ends.

### Current Path

**NOT YET IMPLEMENTED**

The intended workflow:
1. After completing a sprint, click "Write Retrospective"
2. Create a document linked to the sprint with type `sprint_retro`
3. Template includes: What went well, What didn't, Action items
4. Retro is discoverable from the sprint view

### Known Issues
- [ ] **MISSING**: `sprint_retro` document type doesn't exist
- [ ] **MISSING**: No UI to create retro from sprint
- [ ] **MISSING**: No template for retrospective format

---

## Workflow 5: Sprint Plan Document

### Goal
Write a sprint plan document capturing goals and hypothesis.

### Current Path

**NOT YET IMPLEMENTED**

The intended workflow:
1. When creating a sprint, click "Write Sprint Plan"
2. Create a document linked to the sprint with type `sprint_plan`
3. Document captures: Goals, hypothesis, key deliverables, risks
4. Plan is visible from sprint view header

### Known Issues
- [ ] **MISSING**: `sprint_plan` document type doesn't exist
- [ ] **MISSING**: No UI to create plan from sprint
- [ ] Sprint has `goal` field but it's just a text field, not a full document

---

## Quick Reference

### Navigation

| Action | Current Path | Ideal (Future) |
|--------|-------------|----------------|
| View all issues | Click Issues icon | `Cmd+K` → "issues" |
| View all programs | Click Programs icon | `Cmd+K` → "programs" |
| Open specific program | Sidebar → Program name | `Cmd+K` → program name |
| View sprint | URL: `/sprints/{id}/view` | Click sprint card |
| Create issue | Issues page → New Issue | `Cmd+K` → "new issue" |
| Create sprint | Program → Sprints → New | `Cmd+K` → "new sprint" |

### Keyboard Shortcuts (Planned)

| Shortcut | Action |
|----------|--------|
| `Cmd+K` | Open command palette |
| `C` | Create new (context-dependent) |
| `E` | Edit current item |
| `1-4` | Set issue state (todo/in_progress/done/cancelled) |
| `P` | Set priority |
| `A` | Assign to user |
| `S` | Assign to sprint |

---

## Baseline Evaluation

**Date:** 2025-12-30
**Rating:** 2.5/10

| Area | Score | Notes |
|------|-------|-------|
| Issue Triage | 0.5/2 | UI exists but API broken |
| Sprint Goals | 0.5/2 | Can edit but can't save |
| Sprint Execution | 1.0/2 | Display works, interaction broken |
| Sprint Retro | 0.0/2 | Feature doesn't exist |
| Overall Polish | 0.5/2 | Visual good, full of bugs |

### Bugs Blocking Basic Workflow

1. **Tab switching** - Can't switch between Issues/Sprints tabs in Program view
2. **Issue-to-sprint** - "+" button fails with 400 error
3. **Sprint goal save** - Save button fails with 400 error
4. **Missing features** - No sprint_plan or sprint_retro document types

---

## Future Improvements

Once bugs are fixed, the following improvements are planned:

1. **Cmd+K Command Palette** - Quick access to any action
2. **Drag-and-Drop Planning** - Move issues between backlog/sprint by dragging
3. **Sprint Documentation** - Full documents for plans and retros
4. **Keyboard-First UX** - All actions available via keyboard
5. **Auto-Archive** - Move incomplete issues to backlog when sprint ends
6. **Board View** - Kanban-style view for sprint execution

---

## Appendix: URL Structure

| URL Pattern | View |
|-------------|------|
| `/programs` | Programs list |
| `/programs/{id}` | Program editor |
| `/programs/{id}/view` | Program view (tabs: Issues, Sprints, Settings) |
| `/sprints/{id}` | Sprint editor (document) |
| `/sprints/{id}/view` | Sprint planning view (backlog/sprint columns) |
| `/issues` | Issues list |
| `/issues/{id}` | Issue editor |
| `/docs` | Wiki documents list |
| `/docs/{id}` | Document editor |
