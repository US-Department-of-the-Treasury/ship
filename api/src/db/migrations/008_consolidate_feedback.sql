-- Consolidate feedback into issues
-- 1. Rename source='feedback' to source='external'
-- 2. Migrate feedback_status to state
-- 3. Clean up feedback_status property

-- Step 1: Update source from 'feedback' to 'external'
UPDATE documents
SET properties = jsonb_set(properties, '{source}', '"external"')
WHERE document_type = 'issue'
  AND properties->>'source' = 'feedback';

-- Step 2: Migrate feedback_status='draft' to state='triage'
-- Drafts are external submissions that haven't been triaged yet
UPDATE documents
SET properties = jsonb_set(properties, '{state}', '"triage"')
WHERE document_type = 'issue'
  AND properties->>'feedback_status' = 'draft';

-- Step 3: Migrate feedback_status='submitted' to state='triage'
UPDATE documents
SET properties = jsonb_set(properties, '{state}', '"triage"')
WHERE document_type = 'issue'
  AND properties->>'feedback_status' = 'submitted';

-- Step 4: Migrate feedback with rejection_reason to state='cancelled'
UPDATE documents
SET properties = jsonb_set(properties, '{state}', '"cancelled"')
WHERE document_type = 'issue'
  AND properties->>'source' = 'external'
  AND properties->>'feedback_status' IS NULL
  AND properties->>'rejection_reason' IS NOT NULL;

-- Step 5: Ensure remaining external feedback (accepted) is in backlog
UPDATE documents
SET properties = jsonb_set(properties, '{state}', '"backlog"')
WHERE document_type = 'issue'
  AND properties->>'source' = 'external'
  AND properties->>'feedback_status' IS NULL
  AND properties->>'rejection_reason' IS NULL
  AND properties->>'state' NOT IN ('backlog', 'todo', 'in_progress', 'in_review', 'done', 'cancelled', 'triage');

-- Step 6: Remove feedback_status property from all issues
UPDATE documents
SET properties = properties - 'feedback_status'
WHERE document_type = 'issue'
  AND properties ? 'feedback_status';
