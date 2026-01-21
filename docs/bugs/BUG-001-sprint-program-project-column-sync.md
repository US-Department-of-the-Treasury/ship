# BUG-001: sprint_id/program_id/project_id Columns Not Syncing with belongs_to

**Status:** Open
**Severity:** High
**Reported:** 2026-01-20
**Affects:** Sprint issue counts, filtering, issue assignment

## Summary

Issues created via the `/prd` skill or API have their relationships stored in a `belongs_to` array in the `properties` JSONB column, but the actual `sprint_id`, `program_id`, and `project_id` database columns remain NULL. This causes sprint `issue_count` to always show 0 despite issues being linked via `belongs_to`.

## Impact

1. **Sprint Dashboard**: Sprint 4 shows `issue_count: 0` despite 37 issues being linked
2. **Filtering**: The `?sprint_id=X` filter somehow works (production code reads from `belongs_to`), but it's inconsistent
3. **Data Integrity**: Dual storage of relationships (`belongs_to` array vs columns) without sync
4. **PATCH Operations**: Cannot update `sprint_id`/`program_id` via PATCH - returns "No fields to update" because production code compares against `belongs_to` values

## Technical Details

### Database Schema

The `documents` table has three relationship columns:

```sql
program_id UUID REFERENCES documents(id) ON DELETE SET NULL,
project_id UUID REFERENCES documents(id) ON DELETE SET NULL,
sprint_id UUID REFERENCES documents(id) ON DELETE SET NULL,
```

### issue_count Computation

Sprint `issue_count` is computed using a subquery that reads from the column:

```sql
(SELECT COUNT(*) FROM documents i WHERE i.sprint_id = d.id AND i.document_type = 'issue') as issue_count
```

Since `sprint_id` column is NULL for all Sprint 4 issues, this returns 0.

### belongs_to Array

Production API returns issues with a `belongs_to` array:

```json
{
  "id": "6c1d17fe-9d68-473f-b00b-a777f694fa8a",
  "title": "SignalR disconnect shows retry button and feedback",
  "sprint_id": null,
  "program_id": null,
  "belongs_to": [
    {
      "id": "b9a144d0-cdcb-495a-a1b1-63a29a4b62ee",
      "type": "sprint",
      "title": "Book Builder Bugs & Enhancements"
    },
    {
      "id": "ece76b1c-f736-45d8-be22-8f88da51cf14",
      "type": "program",
      "title": "Book Builder",
      "color": "#eab308"
    }
  ]
}
```

### Code Discrepancy

The local codebase does NOT contain any reference to `belongs_to`:
- `grep -r "belongs_to" /Users/sanghaa/projects/ship` returns no results
- The deployed production code has this feature but local code doesn't

This suggests the deployed code was modified or is from a different source.

### PATCH Behavior

When attempting to PATCH an issue with `sprint_id`:

```bash
curl -X PATCH "$SHIP_URL/api/issues/$ISSUE_ID" \
  -H "Authorization: Bearer $SHIP_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"sprint_id": "b9a144d0-cdcb-495a-a1b1-63a29a4b62ee"}'
```

Returns: `{"error":"No fields to update"}`

The PATCH handler compares `data.sprint_id !== existingIssue.sprint_id`, but `existingIssue` appears to be reading from `belongs_to` in production, so it thinks the value is already set.

## Affected Issues

Sprint 4 (Book Builder):
- Sprint ID: `b9a144d0-cdcb-495a-a1b1-63a29a4b62ee`
- Program ID: `ece76b1c-f736-45d8-be22-8f88da51cf14`
- 37 issues (#354-#390) have:
  - `sprint_id` column = NULL
  - `program_id` column = NULL
  - `belongs_to` array correctly references sprint and program

## Root Cause Hypothesis

1. Production code was modified to use `belongs_to` array for relationship storage
2. The sync from `belongs_to` to actual columns was not implemented
3. Or: Production code reads `belongs_to` for display/filter but writes to columns, and something broke the write path

## Proposed Fix

### Option 1: Migration to Sync Existing Data

Created migration `018_sync_belongs_to_columns.sql`:

```sql
UPDATE documents d
SET sprint_id = (
  SELECT (elem->>'id')::uuid
  FROM jsonb_array_elements(d.properties->'belongs_to') elem
  WHERE elem->>'type' = 'sprint'
  LIMIT 1
)
WHERE d.document_type = 'issue'
  AND d.sprint_id IS NULL
  AND EXISTS (SELECT 1 FROM jsonb_array_elements(d.properties->'belongs_to') elem WHERE elem->>'type' = 'sprint');
```

### Option 2: Identify and Fix Production Code

1. Find the deployed code that manages `belongs_to`
2. Ensure it also writes to the columns
3. Or change `issue_count` to read from `belongs_to`

### Option 3: Direct Database Update

Run SQL directly against production database:

```sql
UPDATE documents
SET
  sprint_id = 'b9a144d0-cdcb-495a-a1b1-63a29a4b62ee',
  program_id = 'ece76b1c-f736-45d8-be22-8f88da51cf14'
WHERE document_type = 'issue'
  AND sprint_id IS NULL
  AND properties->'belongs_to' @> '[{"id": "b9a144d0-cdcb-495a-a1b1-63a29a4b62ee"}]';
```

## Verification Steps

After fix, verify:

1. Sprint 4 `issue_count` shows 37 (not 0)
2. Issues return both `sprint_id` field AND `belongs_to` array
3. PATCH endpoint can update `sprint_id` when value differs

## Related Files

- `/Users/sanghaa/projects/ship/api/src/routes/issues.ts` - Issues PATCH handler
- `/Users/sanghaa/projects/ship/api/src/routes/sprints.ts` - Sprint issue_count query
- `/Users/sanghaa/projects/ship/api/src/db/schema.sql` - Column definitions
- `/Users/sanghaa/projects/ship/scripts/fix-sprint-4-issues.sh` - API-based fix script (doesn't work due to PATCH issue)
- `/Users/sanghaa/projects/ship/scripts/fix-sprint-4-issues.sql` - Direct SQL fix

## Key IDs for Sprint 4 Fix

```
SPRINT_ID=b9a144d0-cdcb-495a-a1b1-63a29a4b62ee
PROGRAM_ID=ece76b1c-f736-45d8-be22-8f88da51cf14
PROJECT_ID=c51a9e11-115a-49d3-a469-13f4e16b041f
USER_ID=8b0e1b10-4df3-4e13-82ec-d14e51566213
```
