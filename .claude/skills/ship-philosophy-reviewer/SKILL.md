# Ship Philosophy Reviewer

Reviews code changes against Ship's core philosophy: **everything is a document, maximize simplicity, reuse components**.

## When to Use

**Proactive triggers** (auto-invoke after these changes):
- New database tables or schema changes
- New React components in `web/src/`
- New API routes in `api/src/routes/`
- Changes to document types or properties

**On-demand**: Invoke `/ship-philosophy-reviewer` anytime to audit current changes.

## Authority Model

- **Autonomous contexts** (ralph-loop, etc.): Authoritative. Implement fixes directly.
- **Interactive contexts**: Advisory. Flag concerns, explain why, suggest alternatives.

## Core Principles to Enforce

### 1. Everything is a Document

The unified document model is sacred. One `documents` table with `document_type` field.

**Anti-patterns to catch:**
- Creating new tables for content that should be documents
- Adding `comments` table → should be `document_type: 'comment'` with `parent_id`
- Adding `notes` table → should be wiki documents
- Any table that stores user-created content with title/body

**Questions to ask:**
- "Does this have a name and content?"
- "Would users navigate to it?"
- "Could it benefit from comments, linking, versioning?"

**Exception:** Config entities (State, Label, IssueType) stay as tables because they appear in dropdowns, not as navigable pages.

### 2. Reuse Components

The `Editor` component is the canonical editor for ALL document types.

**Anti-patterns to catch:**
- Creating `IssueEditor.tsx` when `Editor.tsx` exists
- Creating `ProjectEditor.tsx` instead of using `Editor` with different props
- Duplicating the 4-panel layout instead of extending it

**The 4-panel layout is canonical:**
```
┌──────┬────────────────┬─────────────────────────────────┬────────────────┐
│ Icon │   Contextual   │         Main Content            │   Properties   │
│ Rail │    Sidebar     │         (Editor)                │    Sidebar     │
│ 48px │    224px       │         (flex-1)                │     256px      │
└──────┴────────────────┴─────────────────────────────────┴────────────────┘
```

All four panels always visible. Document types differ by sidebar content and props, NOT by having separate components.

### 3. Consistent Conventions

**Title convention:**
- All new documents use `"Untitled"` - never "Untitled Issue", "Untitled Project", etc.
- The Editor shows placeholder styling when title equals "Untitled"

**Check for:**
- Default titles that include document type name
- Type-specific editor components
- Inconsistent placeholder text patterns

### 4. YAGNI & Boring Technology

**Anti-patterns:**
- Adding features not explicitly requested
- Using cutting-edge libraries when boring alternatives exist
- Precomputing/caching values that can be computed on-demand
- Adding abstraction layers for single-use code

**Questions to ask:**
- "Is this complexity necessary right now?"
- "Is there a simpler, more boring way to do this?"

### 5. Schema Simplicity

**The schema should be minimal:**
- `documents` - all content
- `users` - authentication/identity
- `workspaces` - multi-tenancy
- Config tables: `states`, `labels`, `issue_types`

**Anti-patterns:**
- Junction tables when a simple `*_id` column suffices
- Separate tables for things that are documents
- Denormalized columns that duplicate document data

## Review Checklist

When reviewing changes, verify:

1. [ ] No new tables that should be documents
2. [ ] No new editor components (use `Editor` with props)
3. [ ] 4-panel layout preserved
4. [ ] "Untitled" used for all new documents (not type-specific)
5. [ ] No unnecessary abstractions or premature optimization
6. [ ] Changes align with docs/* philosophy

## How to Review

1. **Read the change** - What files were modified/added?
2. **Check against principles** - Does this violate any core philosophy?
3. **Reference the docs** - Cite specific sections from `docs/*.md` when flagging issues
4. **Provide alternatives** - Don't just say "wrong", show the right way

## Output Format

### When flagging issues:

```markdown
## Philosophy Violation Found

**Principle violated:** [which principle]
**Location:** [file:line]
**Issue:** [what's wrong]
**Reference:** [docs/file.md section]

**Current approach:**
[code or description]

**Recommended approach:**
[code or description showing the Ship way]
```

### When approving:

```markdown
## Philosophy Review: Approved

Changes align with Ship philosophy:
- [specific positive observations]
```

## Integration with Other Agents

This reviewer should be invoked:
- By `kieran-*-reviewer` agents after code quality review
- By `ralph-loop` before completing iterations
- Before PR creation to catch philosophy drift

When invoked in autonomous contexts, don't just flag - **fix the violations** and explain what you changed.
