-- Fix Sprint 4 Issues - Set sprint_id on issues that belong to Sprint 4
--
-- Context: Issues were created with sprint_id=null due to a bug in the /prd skill
-- that didn't properly persist variables between bash blocks.
--
-- Sprint 4 ID: b9a144d0-cdcb-495a-a1b1-63a29a4b62ee
-- Program ID: ece76b1c-f736-45d8-be22-8f88da51cf14
--
-- Usage: Run against Ship database (ship_dev or production)

-- First, show current state
SELECT
    id,
    title,
    sprint_id,
    program_id,
    ticket_number
FROM documents
WHERE document_type = 'issue'
  AND sprint_id IS NULL
ORDER BY ticket_number;

-- Count issues to fix
SELECT COUNT(*) as issues_to_fix
FROM documents
WHERE document_type = 'issue'
  AND sprint_id IS NULL;

-- Update issues to set sprint_id and program_id
-- Uncomment the UPDATE statement below after verifying the SELECT results
/*
UPDATE documents
SET
    sprint_id = 'b9a144d0-cdcb-495a-a1b1-63a29a4b62ee',
    program_id = 'ece76b1c-f736-45d8-be22-8f88da51cf14',
    updated_at = NOW()
WHERE document_type = 'issue'
  AND sprint_id IS NULL;
*/

-- Verify the fix
SELECT
    d.id as sprint_id,
    d.title as sprint_name,
    (SELECT COUNT(*) FROM documents i WHERE i.sprint_id = d.id AND i.document_type = 'issue') as issue_count
FROM documents d
WHERE d.document_type = 'sprint'
  AND d.id = 'b9a144d0-cdcb-495a-a1b1-63a29a4b62ee';
