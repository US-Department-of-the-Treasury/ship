---
name: plan_review
description: Have multiple specialized agents review a plan in parallel (Ship-extended)
argument-hint: "[plan file path or plan content]"
---

# Ship Plan Review

This project extends the standard `/workflows:plan_review` with Ship-specific philosophy review.

## Instructions

1. **Run the standard plan review** from `~/.claude/commands/workflows/plan_review.md` with the provided arguments

2. **Additionally**, run in parallel with the other reviewers:
   - Task ship-philosophy-reviewer: Review the plan against Ship's core philosophy (unified document model, single Editor component, 4-panel layout, YAGNI)

3. **In the synthesis**, add a "Ship Philosophy" section that includes findings from the ship-philosophy-reviewer, checking for:
   - Violations of "everything is a document" principle
   - Unnecessary type-specific components
   - Deviations from the 4-panel layout
   - Over-engineering or YAGNI violations

## Plan to Review

<plan_content> $ARGUMENTS </plan_content>
