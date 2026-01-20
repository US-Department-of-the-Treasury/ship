import { Router, Request, Response } from 'express';
import { pool } from '../db/client.js';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';
import { handleVisibilityChange, handleDocumentConversion, invalidateDocumentCache } from '../collaboration/index.js';
import { extractHypothesisFromContent, extractSuccessCriteriaFromContent, extractVisionFromContent, extractGoalsFromContent, checkDocumentCompleteness } from '../utils/extractHypothesis.js';
import { loadContentFromYjsState } from '../utils/yjsConverter.js';

type RouterType = ReturnType<typeof Router>;
const router: RouterType = Router();

// Check if user is workspace admin
async function isWorkspaceAdmin(userId: string, workspaceId: string): Promise<boolean> {
  const result = await pool.query(
    'SELECT role FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
    [workspaceId, userId]
  );
  return result.rows[0]?.role === 'admin';
}

// Check if user can access a document (visibility check)
async function canAccessDocument(
  docId: string,
  userId: string,
  workspaceId: string
): Promise<{ canAccess: boolean; doc: any | null }> {
  const result = await pool.query(
    `SELECT d.*,
            (d.visibility = 'workspace' OR d.created_by = $2 OR
             (SELECT role FROM workspace_memberships WHERE workspace_id = $3 AND user_id = $2) = 'admin') as can_access
     FROM documents d
     WHERE d.id = $1 AND d.workspace_id = $3`,
    [docId, userId, workspaceId]
  );

  if (result.rows.length === 0) {
    return { canAccess: false, doc: null };
  }

  return { canAccess: result.rows[0].can_access, doc: result.rows[0] };
}

// Validation schemas
const createDocumentSchema = z.object({
  title: z.string().min(1).max(255).optional().default('Untitled'),
  document_type: z.enum(['wiki', 'issue', 'program', 'project', 'sprint', 'person', 'sprint_plan', 'sprint_retro']).optional().default('wiki'),
  parent_id: z.string().uuid().optional().nullable(),
  program_id: z.string().uuid().optional().nullable(),
  sprint_id: z.string().uuid().optional().nullable(),
  properties: z.record(z.unknown()).optional(),
  visibility: z.enum(['private', 'workspace']).optional(),
  content: z.any().optional(),
});

const updateDocumentSchema = z.object({
  title: z.string().min(1).max(255).optional(),
  content: z.any().optional(),
  parent_id: z.string().uuid().optional().nullable(),
  position: z.number().int().min(0).optional(),
  properties: z.record(z.unknown()).optional(),
  visibility: z.enum(['private', 'workspace']).optional(),
  document_type: z.enum(['wiki', 'issue', 'program', 'project', 'sprint', 'person']).optional(),
  // Issue-specific fields (stored in properties but accepted at top level for convenience)
  state: z.string().optional(),
  priority: z.string().optional(),
  estimate: z.number().nullable().optional(),
  assignee_id: z.string().uuid().nullable().optional(),
  source: z.enum(['internal', 'external']).optional(),
  rejection_reason: z.string().nullable().optional(),
  belongs_to: z.array(z.object({
    id: z.string().uuid(),
    type: z.enum(['program', 'project', 'sprint', 'parent']),
  })).optional(),
  confirm_orphan_children: z.boolean().optional(),
  // Project-specific fields (stored in properties but accepted at top level)
  impact: z.number().min(1).max(10).nullable().optional(),
  confidence: z.number().min(1).max(10).nullable().optional(),
  ease: z.number().min(1).max(10).nullable().optional(),
  color: z.string().optional(),
  owner_id: z.string().uuid().nullable().optional(),
  // Sprint-specific fields (stored in properties but accepted at top level)
  start_date: z.string().optional(),
  end_date: z.string().optional(),
  sprint_status: z.enum(['planning', 'active', 'completed']).optional(),
  goal: z.string().optional(),
});

// List documents
router.get('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { type, parent_id } = req.query;
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    // Check if user is admin (admins can see all documents)
    const isAdmin = await isWorkspaceAdmin(userId, workspaceId);

    let query = `
      SELECT id, workspace_id, document_type, title, parent_id, position,
             program_id, project_id, sprint_id, ticket_number, properties,
             created_at, updated_at, created_by, visibility
      FROM documents
      WHERE workspace_id = $1
        AND archived_at IS NULL
        AND (visibility = 'workspace' OR created_by = $2 OR $3 = TRUE)
    `;
    const params: (string | boolean | null)[] = [workspaceId, userId, isAdmin];

    if (type) {
      query += ` AND document_type = $${params.length + 1}`;
      params.push(type as string);
    }

    if (parent_id !== undefined) {
      if (parent_id === 'null' || parent_id === '') {
        query += ` AND parent_id IS NULL`;
      } else {
        query += ` AND parent_id = $${params.length + 1}`;
        params.push(parent_id as string);
      }
    }

    query += ` ORDER BY position ASC, created_at DESC`;

    const result = await pool.query(query, params);

    // Extract properties into flat fields for backwards compatibility
    const documents = result.rows.map(row => {
      const props = row.properties || {};
      return {
        ...row,
        // Flatten common properties for backwards compatibility
        state: props.state,
        priority: props.priority,
        estimate: props.estimate,
        assignee_id: props.assignee_id,
        source: props.source,
        prefix: props.prefix,
        color: props.color,
      };
    });

    res.json(documents);
  } catch (err) {
    console.error('List documents error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// List converted documents (archived originals that were converted to another type)
router.get('/converted/list', authMiddleware, async (req: Request, res: Response) => {
  try {
    const userId = String(req.userId);
    const workspaceId = String(req.workspaceId);
    const { original_type, converted_type } = req.query;

    // Only show documents the user can access (workspace-visible or owned by user)
    let query = `
      SELECT d.id, d.title, d.document_type as original_type, d.ticket_number,
             d.converted_to_id, d.converted_at, d.converted_by,
             d.created_at, d.updated_at,
             converted_doc.document_type as converted_type,
             converted_doc.title as converted_title,
             converted_doc.ticket_number as converted_ticket_number,
             converter.name as converted_by_name
      FROM documents d
      INNER JOIN documents converted_doc ON d.converted_to_id = converted_doc.id
      LEFT JOIN users converter ON d.converted_by = converter.id
      WHERE d.workspace_id = $1
        AND d.converted_to_id IS NOT NULL
        AND d.archived_at IS NOT NULL
        AND (d.visibility = 'workspace' OR d.created_by = $2)
        AND (converted_doc.visibility = 'workspace' OR converted_doc.created_by = $2)
    `;
    const params: (string | null)[] = [workspaceId, userId];

    // Filter by original document type
    if (original_type && typeof original_type === 'string') {
      params.push(original_type);
      query += ` AND d.document_type = $${params.length}`;
    }

    // Filter by converted document type
    if (converted_type && typeof converted_type === 'string') {
      params.push(converted_type);
      query += ` AND converted_doc.document_type = $${params.length}`;
    }

    query += ` ORDER BY d.converted_at DESC NULLS LAST, d.updated_at DESC`;

    const result = await pool.query(query, params);

    const conversions = result.rows.map(row => ({
      original_id: row.id,
      original_title: row.title,
      original_type: row.original_type,
      original_ticket_number: row.ticket_number,
      converted_id: row.converted_to_id,
      converted_title: row.converted_title,
      converted_type: row.converted_type,
      converted_ticket_number: row.converted_ticket_number,
      converted_at: row.converted_at,
      converted_by: row.converted_by,
      converted_by_name: row.converted_by_name,
    }));

    res.json(conversions);
  } catch (err) {
    console.error('List converted documents error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get single document
router.get('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const userId = String(req.userId);
    const workspaceId = String(req.workspaceId);

    const { canAccess, doc } = await canAccessDocument(id, userId, workspaceId);

    if (!doc) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    if (!canAccess) {
      // Return 404 for private docs user can't access (to not reveal existence)
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    // Check if document was converted - redirect to new document
    if (doc.converted_to_id) {
      // Fetch the new document to determine its type for proper routing
      const newDocResult = await pool.query(
        'SELECT id, document_type FROM documents WHERE id = $1 AND workspace_id = $2',
        [doc.converted_to_id, workspaceId]
      );

      if (newDocResult.rows.length > 0) {
        const newDoc = newDocResult.rows[0];
        // Return 301 with Location header to the new document's API endpoint
        // Include X-Converted-Type header so frontend knows the target type for routing
        res.set('X-Converted-Type', newDoc.document_type);
        res.set('X-Converted-To', newDoc.id);
        res.redirect(301, `/api/documents/${newDoc.id}`);
        return;
      }
    }

    const props = doc.properties || {};

    // Get belongs_to associations from junction table (for issues and other document types)
    let belongs_to: Array<{ id: string; type: string; title?: string; color?: string }> = [];
    if (doc.document_type === 'issue' || doc.document_type === 'wiki') {
      const assocResult = await pool.query(
        `SELECT da.related_id as id, da.relationship_type as type,
                d.title, (d.properties->>'color') as color
         FROM document_associations da
         LEFT JOIN documents d ON d.id = da.related_id
         WHERE da.document_id = $1`,
        [id]
      );
      belongs_to = assocResult.rows.map(row => ({
        id: row.id,
        type: row.type,
        title: row.title || undefined,
        color: row.color || undefined,
      }));
    }

    // Return with flattened properties for backwards compatibility
    res.json({
      ...doc,
      state: props.state,
      priority: props.priority,
      estimate: props.estimate,
      assignee_id: props.assignee_id,
      source: props.source,
      prefix: props.prefix,
      color: props.color,
      start_date: props.start_date,
      end_date: props.end_date,
      sprint_status: props.sprint_status,
      goal: props.goal,
      // Include belongs_to for issue documents
      ...(doc.document_type === 'issue' && { belongs_to }),
    });
  } catch (err) {
    console.error('Get document error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Get document content as TipTap JSON
// This endpoint converts Yjs state to TipTap JSON if content is null
// Useful for API-based document editing without using the collaborative editor
router.get('/:id/content', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const userId = String(req.userId);
    const workspaceId = String(req.workspaceId);

    // Verify document exists and user can access it
    const result = await pool.query(
      `SELECT d.id, d.content, d.yjs_state, d.title,
              (d.visibility = 'workspace' OR d.created_by = $2 OR
               (SELECT role FROM workspace_memberships WHERE workspace_id = $3 AND user_id = $2) = 'admin') as can_access
       FROM documents d
       WHERE d.id = $1 AND d.workspace_id = $3 AND d.archived_at IS NULL`,
      [id, userId, workspaceId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    const doc = result.rows[0];

    if (!doc.can_access) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    let content = doc.content;

    // If content is null but yjs_state exists, convert Yjs to TipTap JSON
    if (!content && doc.yjs_state) {
      content = loadContentFromYjsState(doc.yjs_state);

      if (!content) {
        res.status(500).json({ error: 'Failed to convert document content' });
        return;
      }
    }

    // Return content with document metadata
    res.json({
      id: doc.id,
      title: doc.title,
      content: content || { type: 'doc', content: [] },
    });
  } catch (err) {
    console.error('Get document content error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update document content with TipTap JSON
// This endpoint updates content and clears yjs_state (forcing regeneration)
// Useful for API-based document editing without using the collaborative editor
router.patch('/:id/content', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const userId = String(req.userId);
    const workspaceId = String(req.workspaceId);

    // Validate content
    const { content } = req.body;
    if (!content || typeof content !== 'object') {
      res.status(400).json({ error: 'Content is required and must be a valid TipTap JSON object' });
      return;
    }

    // Verify document exists and user can access it
    const { canAccess, doc: existing } = await canAccessDocument(id, userId, workspaceId);

    if (!existing) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    if (!canAccess) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    // Extract hypothesis, success criteria, vision, and goals from content
    const extractedHypothesis = extractHypothesisFromContent(content);
    const extractedCriteria = extractSuccessCriteriaFromContent(content);
    const extractedVision = extractVisionFromContent(content);
    const extractedGoals = extractGoalsFromContent(content);

    // Merge with existing properties (extracted values always win)
    const currentProps = existing.properties || {};
    const newProps = {
      ...currentProps,
      hypothesis: extractedHypothesis,
      success_criteria: extractedCriteria,
      vision: extractedVision,
      goals: extractedGoals,
    };

    // Update content and clear yjs_state (forces regeneration on next collaboration session)
    const result = await pool.query(
      `UPDATE documents
       SET content = $1, yjs_state = NULL, properties = $2, updated_at = now()
       WHERE id = $3 AND workspace_id = $4
       RETURNING id, title, content`,
      [JSON.stringify(content), JSON.stringify(newProps), id, workspaceId]
    );

    // Invalidate collaboration cache so connected clients get fresh content
    invalidateDocumentCache(id);

    res.json({
      id: result.rows[0].id,
      title: result.rows[0].title,
      content: result.rows[0].content,
    });
  } catch (err) {
    console.error('Update document content error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create document
router.post('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const parsed = createDocumentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.errors });
      return;
    }

    const { title, document_type, parent_id, program_id, sprint_id, properties, content } = parsed.data;
    let { visibility } = parsed.data;

    // If parent_id is provided and visibility is not specified, inherit from parent
    if (parent_id && !visibility) {
      const parentResult = await pool.query(
        'SELECT visibility FROM documents WHERE id = $1 AND workspace_id = $2',
        [parent_id, req.workspaceId]
      );
      if (parentResult.rows[0]) {
        visibility = parentResult.rows[0].visibility;
      }
    }

    // Default to 'workspace' visibility if not specified
    visibility = visibility || 'workspace';

    const result = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, parent_id, program_id, sprint_id, properties, created_by, visibility, content)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [req.workspaceId, document_type, title, parent_id || null, program_id || null, sprint_id || null, JSON.stringify(properties || {}), req.userId, visibility, content ? JSON.stringify(content) : null]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Create document error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Update document
router.patch('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const userId = String(req.userId);
    const workspaceId = String(req.workspaceId);

    const parsed = updateDocumentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.errors });
      return;
    }

    // Verify document exists and user can access it
    const { canAccess, doc: existing } = await canAccessDocument(id, userId, workspaceId);

    if (!existing) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    if (!canAccess) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    const data = parsed.data;

    // Check permission for visibility changes
    if (data.visibility !== undefined && data.visibility !== existing.visibility) {
      const isCreator = existing.created_by === userId;
      const isAdmin = await isWorkspaceAdmin(userId, workspaceId);

      if (!isCreator && !isAdmin) {
        res.status(403).json({ error: 'Only the creator or admin can change document visibility' });
        return;
      }
    }

    // Handle moving private doc to workspace parent (changes visibility to workspace)
    if (data.parent_id !== undefined && data.parent_id !== null && data.visibility === undefined) {
      const parentResult = await pool.query(
        'SELECT visibility FROM documents WHERE id = $1 AND workspace_id = $2',
        [data.parent_id, workspaceId]
      );
      if (parentResult.rows[0]?.visibility === 'workspace' && existing.visibility === 'private') {
        // Moving private doc under workspace parent makes it workspace-visible
        data.visibility = 'workspace';
      }
    }

    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    // Track extracted values from content (content is source of truth)
    let extractedHypothesis: string | null = null;
    let extractedCriteria: string | null = null;
    let extractedVision: string | null = null;
    let extractedGoals: string | null = null;
    let contentUpdated = false;

    if (data.title !== undefined) {
      updates.push(`title = $${paramIndex++}`);
      values.push(data.title);
    }
    if (data.content !== undefined) {
      updates.push(`content = $${paramIndex++}`);
      values.push(JSON.stringify(data.content));
      // Clear yjs_state when content is updated via API
      // This forces the collaboration server to regenerate Yjs state from new content
      updates.push(`yjs_state = NULL`);

      // Extract hypothesis, success criteria, vision, and goals from content (content is source of truth)
      extractedHypothesis = extractHypothesisFromContent(data.content);
      extractedCriteria = extractSuccessCriteriaFromContent(data.content);
      extractedVision = extractVisionFromContent(data.content);
      extractedGoals = extractGoalsFromContent(data.content);
      contentUpdated = true;
    }
    if (data.parent_id !== undefined) {
      updates.push(`parent_id = $${paramIndex++}`);
      values.push(data.parent_id);
    }
    if (data.position !== undefined) {
      updates.push(`position = $${paramIndex++}`);
      values.push(data.position);
    }

    // Extract top-level issue/project/sprint fields that should be stored in properties
    const topLevelProps: Record<string, unknown> = {};
    if (data.state !== undefined) topLevelProps.state = data.state;
    if (data.priority !== undefined) topLevelProps.priority = data.priority;
    if (data.estimate !== undefined) topLevelProps.estimate = data.estimate;
    if (data.assignee_id !== undefined) topLevelProps.assignee_id = data.assignee_id;
    if (data.source !== undefined) topLevelProps.source = data.source;
    if (data.rejection_reason !== undefined) topLevelProps.rejection_reason = data.rejection_reason;
    if (data.impact !== undefined) topLevelProps.impact = data.impact;
    if (data.confidence !== undefined) topLevelProps.confidence = data.confidence;
    if (data.ease !== undefined) topLevelProps.ease = data.ease;
    if (data.color !== undefined) topLevelProps.color = data.color;
    if (data.owner_id !== undefined) topLevelProps.owner_id = data.owner_id;
    if (data.start_date !== undefined) topLevelProps.start_date = data.start_date;
    if (data.end_date !== undefined) topLevelProps.end_date = data.end_date;
    if (data.sprint_status !== undefined) topLevelProps.sprint_status = data.sprint_status;
    if (data.goal !== undefined) topLevelProps.goal = data.goal;

    const hasTopLevelProps = Object.keys(topLevelProps).length > 0;

    // Handle properties update - merge existing, data.properties, top-level fields, and extracted values
    // Content is source of truth: extracted values override any manually set hypothesis/success_criteria/vision/goals
    if (data.properties !== undefined || contentUpdated || hasTopLevelProps) {
      const currentProps = existing.properties || {};
      const dataProps = data.properties || {};
      let newProps = {
        ...currentProps,
        ...dataProps,
        ...topLevelProps,
        // Extracted values always win (content is source of truth)
        ...(contentUpdated ? {
          hypothesis: extractedHypothesis,
          success_criteria: extractedCriteria,
          vision: extractedVision,
          goals: extractedGoals,
        } : {}),
      };

      // Compute document completeness for projects and sprints
      if (existing.document_type === 'project' || existing.document_type === 'sprint') {
        let linkedIssuesCount = 0;

        // For sprints, count linked issues
        if (existing.document_type === 'sprint') {
          const issueCountResult = await pool.query(
            'SELECT COUNT(*) as count FROM documents WHERE sprint_id = $1 AND document_type = $2',
            [id, 'issue']
          );
          linkedIssuesCount = parseInt(issueCountResult.rows[0]?.count || '0', 10);
        }

        const completeness = checkDocumentCompleteness(
          existing.document_type,
          newProps,
          linkedIssuesCount
        );

        newProps = {
          ...newProps,
          is_complete: completeness.isComplete,
          missing_fields: completeness.missingFields,
        };
      }

      updates.push(`properties = $${paramIndex++}`);
      values.push(JSON.stringify(newProps));
    }
    if (data.visibility !== undefined) {
      updates.push(`visibility = $${paramIndex++}`);
      values.push(data.visibility);
    }

    // Handle document_type change
    if (data.document_type !== undefined && data.document_type !== existing.document_type) {
      // Only the document creator can change its type
      if (existing.created_by !== userId) {
        res.status(403).json({ error: 'Only the document creator can change its type' });
        return;
      }

      // Restrict certain type changes (can't change to/from program or person)
      const restrictedTypes = ['program', 'person'];
      if (restrictedTypes.includes(existing.document_type) || restrictedTypes.includes(data.document_type)) {
        res.status(400).json({ error: 'Cannot change to or from program or person document types' });
        return;
      }

      updates.push(`document_type = $${paramIndex++}`);
      values.push(data.document_type);

      // When changing to 'issue', assign a ticket number if not already present
      if (data.document_type === 'issue' && !existing.ticket_number) {
        // Get next ticket number for this workspace
        const ticketResult = await pool.query(
          `SELECT COALESCE(MAX(ticket_number), 0) + 1 as next_number
           FROM documents
           WHERE workspace_id = $1 AND document_type = 'issue'`,
          [workspaceId]
        );
        const ticketNumber = ticketResult.rows[0].next_number;
        updates.push(`ticket_number = $${paramIndex++}`);
        values.push(ticketNumber);
      }

      // When changing from 'issue' to another type, preserve ticket_number for reference
      // (don't clear it - it serves as a historical reference)
    }

    // Track if we have association updates (belongs_to)
    const hasBelongsToUpdate = data.belongs_to !== undefined;

    if (updates.length === 0 && !hasBelongsToUpdate) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    // Handle belongs_to association updates
    if (hasBelongsToUpdate) {
      const newBelongsTo = data.belongs_to || [];

      // Get current associations
      const currentAssocs = await pool.query(
        'SELECT related_id, relationship_type FROM document_associations WHERE document_id = $1',
        [id]
      );
      const currentSet = new Set(currentAssocs.rows.map(r => `${r.relationship_type}:${r.related_id}`));
      const newSet = new Set(newBelongsTo.map(bt => `${bt.type}:${bt.id}`));

      // Remove associations that are no longer present
      for (const row of currentAssocs.rows) {
        const key = `${row.relationship_type}:${row.related_id}`;
        if (!newSet.has(key)) {
          await pool.query(
            'DELETE FROM document_associations WHERE document_id = $1 AND related_id = $2 AND relationship_type = $3',
            [id, row.related_id, row.relationship_type]
          );
        }
      }

      // Add new associations
      for (const bt of newBelongsTo) {
        const key = `${bt.type}:${bt.id}`;
        if (!currentSet.has(key)) {
          await pool.query(
            'INSERT INTO document_associations (document_id, related_id, relationship_type) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING',
            [id, bt.id, bt.type]
          );
        }
      }
    }

    // If we only had belongs_to updates, still update the timestamp
    if (updates.length === 0) {
      updates.push(`updated_at = now()`);
    } else {
      updates.push(`updated_at = now()`);
    }

    const result = await pool.query(
      `UPDATE documents SET ${updates.join(', ')} WHERE id = $${paramIndex} AND workspace_id = $${paramIndex + 1} RETURNING *`,
      [...values, id, workspaceId]
    );

    // Invalidate collaboration cache when content is updated via API
    if (contentUpdated) {
      invalidateDocumentCache(id);
    }

    // Cascade visibility changes to child documents
    if (data.visibility !== undefined && data.visibility !== existing.visibility) {
      await pool.query(
        `WITH RECURSIVE descendants AS (
          SELECT id FROM documents WHERE parent_id = $1
          UNION ALL
          SELECT d.id FROM documents d
          INNER JOIN descendants descendant ON d.parent_id = descendant.id
        )
        UPDATE documents SET visibility = $2, updated_at = now()
        WHERE id IN (SELECT id FROM descendants)`,
        [id, data.visibility]
      );

      // Notify WebSocket collaboration server to disconnect users who lost access
      handleVisibilityChange(id, data.visibility, existing.created_by).catch((err) => {
        console.error('Failed to handle visibility change for collaboration:', err);
      });
    }

    // Flatten properties for backwards compatibility (match GET endpoint format)
    const updatedDoc = result.rows[0];
    const props = updatedDoc.properties || {};
    res.json({
      ...updatedDoc,
      state: props.state,
      priority: props.priority,
      estimate: props.estimate,
      assignee_id: props.assignee_id,
      source: props.source,
      prefix: props.prefix,
      color: props.color,
      start_date: props.start_date,
      end_date: props.end_date,
      sprint_status: props.sprint_status,
      goal: props.goal,
    });
  } catch (err) {
    console.error('Update document error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Delete document
router.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const id = String(req.params.id);
    const userId = String(req.userId);
    const workspaceId = String(req.workspaceId);

    // Check if user can access the document
    const { canAccess, doc } = await canAccessDocument(id, userId, workspaceId);

    if (!doc) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    if (!canAccess) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    const result = await pool.query(
      'DELETE FROM documents WHERE id = $1 AND workspace_id = $2 RETURNING id',
      [id, workspaceId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    res.status(204).send();
  } catch (err) {
    console.error('Delete document error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Convert document type (issue <-> project)
// Uses create-and-reference pattern: creates new doc, archives original with pointer
const convertDocumentSchema = z.object({
  target_type: z.enum(['issue', 'project']),
});

router.post('/:id/convert', authMiddleware, async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const id = String(req.params.id);
    const userId = String(req.userId);
    const workspaceId = String(req.workspaceId);

    const parsed = convertDocumentSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.errors });
      return;
    }

    const { target_type } = parsed.data;

    // Check if user can access the document
    const { canAccess, doc } = await canAccessDocument(id, userId, workspaceId);

    if (!doc) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    if (!canAccess) {
      res.status(404).json({ error: 'Document not found' });
      return;
    }

    // Only the document creator can convert it (significant structural change)
    if (doc.created_by !== userId) {
      res.status(403).json({ error: 'Only the document creator can convert it' });
      return;
    }

    // Validate conversion is between issue and project only
    if (doc.document_type !== 'issue' && doc.document_type !== 'project') {
      res.status(400).json({ error: 'Only issues and projects can be converted' });
      return;
    }

    // Validate not converting to same type
    if (doc.document_type === target_type) {
      res.status(400).json({ error: `Document is already a ${target_type}` });
      return;
    }

    // Check if document is already archived/converted
    if (doc.archived_at || doc.converted_to_id) {
      res.status(400).json({ error: 'Document has already been archived or converted' });
      return;
    }

    await client.query('BEGIN');

    let newDocId: string;
    let newDoc: any;

    if (target_type === 'project') {
      // Issue -> Project conversion
      // Preserve title and content, set default project properties
      const projectProperties = {
        impact: 3,
        confidence: 3,
        ease: 3,
        color: '#6366f1',
        owner_id: userId,
        // Track original ticket number for reference
        promoted_from_ticket: doc.ticket_number,
      };

      const result = await client.query(
        `INSERT INTO documents (
          workspace_id, document_type, title, content, yjs_state, properties,
          created_by, visibility, converted_from_id
        )
        VALUES ($1, 'project', $2, $3, $4, $5, $6, $7, $8)
        RETURNING *`,
        [
          workspaceId,
          doc.title,
          JSON.stringify(doc.content || {}),
          doc.yjs_state, // Copy collaborative content
          JSON.stringify(projectProperties),
          userId,
          doc.visibility,
          id, // converted_from_id points to original
        ]
      );
      newDoc = result.rows[0];
      newDocId = newDoc.id;

    } else {
      // Project -> Issue conversion
      // Needs fresh ticket number with advisory lock

      // Use advisory lock to serialize ticket number generation per workspace
      const workspaceIdHex = workspaceId.replace(/-/g, '').substring(0, 15);
      const lockKey = parseInt(workspaceIdHex, 16);
      await client.query('SELECT pg_advisory_xact_lock($1)', [lockKey]);

      // Get next ticket number
      const ticketResult = await client.query(
        `SELECT COALESCE(MAX(ticket_number), 0) + 1 as next_number
         FROM documents
         WHERE workspace_id = $1 AND document_type = 'issue'`,
        [workspaceId]
      );
      const ticketNumber = ticketResult.rows[0].next_number;

      const issueProperties = {
        state: 'backlog',
        priority: 'medium',
        source: 'internal',
        assignee_id: null,
        rejection_reason: null,
      };

      const result = await client.query(
        `INSERT INTO documents (
          workspace_id, document_type, title, content, yjs_state, properties,
          ticket_number, created_by, visibility, converted_from_id
        )
        VALUES ($1, 'issue', $2, $3, $4, $5, $6, $7, $8, $9)
        RETURNING *`,
        [
          workspaceId,
          doc.title,
          JSON.stringify(doc.content || {}),
          doc.yjs_state, // Copy collaborative content
          JSON.stringify(issueProperties),
          ticketNumber,
          userId,
          doc.visibility,
          id, // converted_from_id points to original
        ]
      );
      newDoc = result.rows[0];
      newDocId = newDoc.id;

      // Remove 'project' associations from child issues pointing to this project
      // (They become orphaned - their parent project is being converted to an issue)
      await client.query(
        `DELETE FROM document_associations
         WHERE related_id = $1 AND relationship_type = 'project'`,
        [id]
      );
    }

    // Copy associations from original to new document (filtered by target type validity)
    // According to the association validity matrix:
    // - issue: ["parent", "project", "sprint", "program"]
    // - project: ["program"]
    // When converting issue->project, only 'program' associations are valid for projects
    // When converting project->issue, only 'program' associations are carried over
    const validTypesForTarget = target_type === 'project' ? ['program'] : ['program'];

    await client.query(
      `INSERT INTO document_associations (document_id, related_id, relationship_type, metadata, created_at)
       SELECT $1, related_id, relationship_type, metadata, NOW()
       FROM document_associations
       WHERE document_id = $2 AND relationship_type = ANY($3)`,
      [newDocId, id, validTypesForTarget]
    );

    // Archive original document with converted_to_id pointer
    await client.query(
      `UPDATE documents
       SET archived_at = NOW(),
           converted_to_id = $1,
           converted_at = NOW(),
           converted_by = $2,
           updated_at = NOW()
       WHERE id = $3 AND workspace_id = $4`,
      [newDocId, userId, id, workspaceId]
    );

    await client.query('COMMIT');

    // Notify collaborators about the conversion
    handleDocumentConversion(
      id,
      newDocId,
      doc.document_type as 'issue' | 'project',
      target_type
    );

    // Return the new document with conversion metadata
    res.status(201).json({
      ...newDoc,
      converted_from: {
        id: id,
        document_type: doc.document_type,
        ticket_number: doc.ticket_number,
      },
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Convert document error:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

// POST /documents/:id/undo-conversion - Undo a document conversion
router.post('/:id/undo-conversion', authMiddleware, async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const userId = String(req.userId);
  const workspaceId = String(req.workspaceId);

  // First check access using canAccessDocument (outside transaction for read)
  const { canAccess, doc: currentDoc } = await canAccessDocument(id, userId, workspaceId);

  if (!currentDoc) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }

  if (!canAccess) {
    res.status(404).json({ error: 'Document not found' });
    return;
  }

  // Only the creator, the person who converted it, or workspace admin can undo
  const isCreator = currentDoc.created_by === userId;
  const isConverter = currentDoc.converted_by === userId;
  // For simplicity, we allow creator or converter (admin check would require additional query)
  if (!isCreator && !isConverter) {
    res.status(403).json({ error: 'Only the document creator or converter can undo conversion' });
    return;
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // Check if this document was converted from another (already checked above but need in transaction)
    if (!currentDoc.converted_from_id) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'This document was not converted from another document' });
      return;
    }

    // Get the original document
    const originalResult = await client.query(
      `SELECT * FROM documents WHERE id = $1 AND workspace_id = $2`,
      [currentDoc.converted_from_id, workspaceId]
    );

    if (originalResult.rows.length === 0) {
      await client.query('ROLLBACK');
      res.status(404).json({ error: 'Original document not found' });
      return;
    }

    const originalDoc = originalResult.rows[0];

    // Verify the original document points to this one
    if (originalDoc.converted_to_id !== id) {
      await client.query('ROLLBACK');
      res.status(400).json({ error: 'Document conversion chain is inconsistent' });
      return;
    }

    // Restore the original document:
    // - Clear converted_to_id so it's no longer archived
    // - Clear archived_at so it appears in lists again
    // - Set converted_from_id to point to the current doc (for history)
    await client.query(
      `UPDATE documents
       SET converted_to_id = NULL,
           converted_from_id = $1,
           archived_at = NULL,
           updated_at = NOW()
       WHERE id = $2`,
      [id, originalDoc.id]
    );

    // Archive the current document:
    // - Set converted_to_id to point back to original (making it the archived one now)
    // - Set archived_at since this is now the archived conversion
    // - Clear converted_from_id
    await client.query(
      `UPDATE documents
       SET converted_to_id = $1,
           converted_from_id = NULL,
           archived_at = NOW(),
           updated_at = NOW()
       WHERE id = $2`,
      [originalDoc.id, id]
    );

    // Copy associations from current document back to original document
    // (restoring the associations as they were before conversion)
    // First, clear any existing associations on the original (shouldn't be many since it was archived)
    await client.query(
      `DELETE FROM document_associations WHERE document_id = $1`,
      [originalDoc.id]
    );

    // Copy all associations from the current (being archived) document to the restored original
    await client.query(
      `INSERT INTO document_associations (document_id, related_id, relationship_type, metadata, created_at)
       SELECT $1, related_id, relationship_type, metadata, NOW()
       FROM document_associations
       WHERE document_id = $2`,
      [originalDoc.id, id]
    );

    await client.query('COMMIT');

    // Get the restored original document for response
    const restoredResult = await client.query(
      `SELECT * FROM documents WHERE id = $1`,
      [originalDoc.id]
    );

    const restoredDoc = restoredResult.rows[0];

    res.status(200).json({
      restored_document: restoredDoc,
      archived_document_id: id,
      message: `Conversion undone. Original ${originalDoc.document_type} has been restored.`,
    });

  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Undo conversion error:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

export default router;

// Type augmentation for Express Request
declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
        email: string;
        name: string;
        workspaceId: string;
      };
    }
  }
}
