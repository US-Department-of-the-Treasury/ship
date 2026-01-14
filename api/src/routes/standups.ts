import { Router, Request, Response } from 'express';
import { pool } from '../db/client.js';
import { z } from 'zod';
import { getVisibilityContext, VISIBILITY_FILTER_SQL } from '../middleware/visibility.js';
import { authMiddleware } from '../middleware/auth.js';

type RouterType = ReturnType<typeof Router>;
const router: RouterType = Router();

// Schema for updating a standup
const updateStandupSchema = z.object({
  content: z.record(z.unknown()).optional(),
  title: z.string().max(200).optional(),
});

/**
 * @swagger
 * /standups/{id}:
 *   patch:
 *     summary: Update a standup entry
 *     tags: [Standups]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               content:
 *                 type: object
 *               title:
 *                 type: string
 *     responses:
 *       200:
 *         description: Standup updated successfully
 *       404:
 *         description: Standup not found
 *       403:
 *         description: Forbidden - only author or admin can update
 */
router.patch('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    const parsed = updateStandupSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.errors });
      return;
    }

    const { content, title } = parsed.data;

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Verify standup exists and user can access it
    // Only the author or an admin can update a standup
    const existing = await pool.query(
      `SELECT id, properties->>'author_id' as author_id FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'standup'
         AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Standup not found' });
      return;
    }

    // Check if user is author or admin
    const authorId = existing.rows[0].author_id;
    if (authorId !== userId && !isAdmin) {
      res.status(403).json({ error: 'Only the author or admin can update this standup' });
      return;
    }

    // Build update query
    const updates: string[] = [];
    const values: any[] = [];
    let paramIndex = 1;

    if (content !== undefined) {
      updates.push(`content = $${paramIndex++}`);
      values.push(JSON.stringify(content));
    }

    if (title !== undefined) {
      updates.push(`title = $${paramIndex++}`);
      values.push(title);
    }

    if (updates.length === 0) {
      res.status(400).json({ error: 'No fields to update' });
      return;
    }

    updates.push(`updated_at = now()`);

    await pool.query(
      `UPDATE documents SET ${updates.join(', ')}
       WHERE id = $${paramIndex} AND workspace_id = $${paramIndex + 1} AND document_type = 'standup'`,
      [...values, id, workspaceId]
    );

    // Re-query to get full standup with author info
    const result = await pool.query(
      `SELECT d.id, d.parent_id, d.title, d.content, d.created_at, d.updated_at,
              d.properties->>'author_id' as author_id,
              u.name as author_name, u.email as author_email
       FROM documents d
       LEFT JOIN users u ON (d.properties->>'author_id')::uuid = u.id
       WHERE d.id = $1 AND d.document_type = 'standup'`,
      [id]
    );

    const standup = result.rows[0];
    res.json({
      id: standup.id,
      sprint_id: standup.parent_id,
      title: standup.title,
      content: standup.content,
      author_id: standup.author_id,
      author_name: standup.author_name,
      author_email: standup.author_email,
      created_at: standup.created_at,
      updated_at: standup.updated_at,
    });
  } catch (err) {
    console.error('Update standup error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /standups/{id}:
 *   delete:
 *     summary: Delete a standup entry
 *     tags: [Standups]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Standup deleted successfully
 *       404:
 *         description: Standup not found
 *       403:
 *         description: Forbidden - only author or admin can delete
 */
router.delete('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.userId!;
    const workspaceId = req.workspaceId!;

    // Get visibility context for filtering
    const { isAdmin } = await getVisibilityContext(userId, workspaceId);

    // Verify standup exists and user can access it
    const existing = await pool.query(
      `SELECT id, properties->>'author_id' as author_id FROM documents
       WHERE id = $1 AND workspace_id = $2 AND document_type = 'standup'
         AND ${VISIBILITY_FILTER_SQL('documents', '$3', '$4')}`,
      [id, workspaceId, userId, isAdmin]
    );

    if (existing.rows.length === 0) {
      res.status(404).json({ error: 'Standup not found' });
      return;
    }

    // Check if user is author or admin
    const authorId = existing.rows[0].author_id;
    if (authorId !== userId && !isAdmin) {
      res.status(403).json({ error: 'Only the author or admin can delete this standup' });
      return;
    }

    await pool.query(
      `DELETE FROM documents WHERE id = $1 AND document_type = 'standup'`,
      [id]
    );

    res.status(204).send();
  } catch (err) {
    console.error('Delete standup error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
