# Sprint Documentation Philosophy

This document explains the philosophy behind Sprint documentation requirements in Ship.

> **Related**: See [Unified Document Model](./unified-document-model.md) for data model details and [Document Model Conventions](./document-model-conventions.md) for terminology.

## The Scientific Method for Sprints

Sprints in Ship follow the scientific method:

1. **Hypothesis (Sprint Plan)**: Before the sprint, document what you plan to do and what you expect to happen
2. **Experiment (The Sprint)**: Execute the work
3. **Conclusion (Sprint Retro)**: After the sprint, document what actually happened and what you learned

This isn't just process for process's sake. It's how teams learn and improve.

## Sprint Architecture

### Sprint Windows (Implicit)

Sprints are **computed 2-week time windows**, not stored entities:

- Workspace has a `sprint_start_date` setting
- Sprint 1 = days 1-14 from start date
- Sprint 2 = days 15-28
- All programs share the same sprint cadence

**Why workspace-wide cadence:**

1. **Shared rhythm**: Everyone is on the same schedule. Sprint 5 means the same dates for everyone.
2. **Cross-program visibility**: Easy to see what's happening across programs
3. **Simpler mental model**: No "which program's sprint are we talking about?"
4. **Resource allocation**: People work on multiple programs - one sprint timeline makes planning possible

**Why fixed 14-day duration:**

1. **Predictability**: Teams can plan around a consistent rhythm
2. **Comparability**: Sprint 5 velocity can be compared to Sprint 4 velocity
3. **Simplicity**: No debates about "should this sprint be shorter?"

If 14 days doesn't work for your team, the answer isn't variable sprint lengths - it's changing what you commit to within those 14 days.

### Sprint Documents (Explicit)

What IS stored is the **Sprint document** - one per program per sprint window:

```
Program (AUTH)
└── Sprint (AUTH's Sprint 5)       ← document_type: 'sprint'
    ├── Sprint Plan                ← document_type: 'sprint_plan'
    ├── Sprint Retro               ← document_type: 'sprint_retro'
    └── Issues (active work)
```

**Why per-program sprint documents:**

- Sprint Plans are specific to what a program is doing
- Sprint Retros capture program-specific learnings
- Different programs can have different focuses within the same sprint window

## Why Required Documentation

### The Problem with Optional Documentation

When documentation is optional, it doesn't get done. Teams that skip retrospectives:

- Repeat the same mistakes
- Don't capture institutional knowledge
- Can't demonstrate what they've accomplished
- Have no basis for improving estimates

### Accountability Model

**Only people can be held accountable, not projects.** Every Sprint Plan and Sprint Retro document has an owner - the person who created it. This enables:

- Clear responsibility for documentation completion
- Performance review integration (who consistently delivers? who doesn't?)
- Knowledge of who to ask about a particular sprint's decisions

### The Two Required Documents

#### Sprint Plan (Hypothesis)

A document with `document_type: 'sprint_plan'`, child of the Sprint document.

Written before or at the start of the sprint. Answers:

- What are we planning to do?
- What do we think will happen?
- What assumptions are we making?
- What are the risks?

The act of writing this down forces teams to think through their commitments rather than just pulling work into a sprint.

**Required properties:**

- `owner_id`: Who wrote this and is accountable for it

#### Sprint Retro (Conclusion)

A document with `document_type: 'sprint_retro'`, child of the Sprint document.

Written after the sprint ends. Answers:

- What did we actually do?
- How did reality compare to our hypothesis?
- What worked well?
- What should we change?

This closes the learning loop. Without it, you have activity but not improvement.

**Required properties:**

- `owner_id`: Who wrote this and is accountable for it

## Non-Blocking, But Visible

Documentation is required but not blocking. You can start the next sprint without completing the previous retro. However:

- **Visual indicators** make missing documentation obvious
- **Escalating urgency** (yellow → red) creates social pressure
- **Compliance reports** enable management visibility

This design respects that sometimes things get busy, while ensuring documentation doesn't silently fall through the cracks.

## Status Indicator Philosophy

### Why Escalating Colors?

The yellow → red progression gives teams grace while maintaining accountability:

**Sprint Plan:**

- Yellow (sprint not started): "You should do this soon"
- Red (sprint started): "You're already executing without a plan - this is a problem"

**Sprint Retro:**

- Gray (sprint active): "Not due yet - focus on the work"
- Gray (sprint just ended): "Due soon - start thinking about it"
- Yellow (1-13 days after): "You need to write this while it's fresh"
- Red (14+ days after): "This is now overdue - things are spiraling"

The 14-day threshold for retros (one full sprint) is deliberate. If you haven't written your retro by the time the next sprint ends, you're now two sprints behind and institutional knowledge is being lost.

### Why Not Block?

Blocking would be counterproductive:

- Sometimes there are genuine emergencies
- Blocking breeds workarounds and resentment
- The goal is learning, not compliance theater

Instead, we make non-compliance visible and let management handle it through normal performance channels.

## Issue Lifecycle During Sprints

Issues flow through the sprint like a conveyor belt:

```
Backlog (in Project)
    ↓ assigned to sprint
Active Sprint Work (sprint_id set)
    ↓ work completed
Done (completed_at set)
```

- Issues keep their `project_id` (which project they belong to)
- Issues gain a `sprint_id` when pulled into active work
- The Sprint document serves as a container for that sprint's work

## Future Considerations

### Performance Review Integration

The compliance data (who completed docs, who didn't) can feed into performance reviews. This isn't punitive - it's objective evidence of who follows through on commitments.

### Templates

Both Sprint Plan and Sprint Retro have templates. This isn't to constrain thinking - it's to reduce friction. The template prompts ensure people at least consider the important questions.

## Key Principle

**The goal is learning, not compliance.** Every design decision should be evaluated against: "Does this help teams learn and improve, or is it just bureaucracy?"

## References

- [Unified Document Model](./unified-document-model.md) - Data model details
- [Document Model Conventions](./document-model-conventions.md) - Architectural decisions and terminology
