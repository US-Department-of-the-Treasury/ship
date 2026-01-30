import { Router, Request, Response } from 'express';
import { pool } from '../db/client.js';
import { z } from 'zod';
import { authMiddleware } from '../middleware/auth.js';
import { v4 as uuidv4 } from 'uuid';

type RouterType = ReturnType<typeof Router>;
const router: RouterType = Router();

// Schema for creating/getting a weekly plan
const weeklyPlanSchema = z.object({
  person_id: z.string().uuid(),
  project_id: z.string().uuid(),
  week_number: z.number().int().min(1),
});

/**
 * @swagger
 * /weekly-plans:
 *   post:
 *     summary: Create or get existing weekly plan document (idempotent)
 *     tags: [Weekly Plans]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - person_id
 *               - project_id
 *               - week_number
 *             properties:
 *               person_id:
 *                 type: string
 *                 format: uuid
 *               project_id:
 *                 type: string
 *                 format: uuid
 *               week_number:
 *                 type: integer
 *                 minimum: 1
 *     responses:
 *       200:
 *         description: Existing weekly plan document returned
 *       201:
 *         description: New weekly plan document created
 *       400:
 *         description: Invalid input
 *       404:
 *         description: Person or project not found
 */
router.post('/', authMiddleware, async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const parsed = weeklyPlanSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.errors });
      return;
    }

    const { person_id, project_id, week_number } = parsed.data;
    const workspaceId = req.workspaceId!;
    const userId = req.userId!;

    // Verify person exists in this workspace
    const personResult = await client.query(
      `SELECT id, title FROM documents WHERE id = $1 AND workspace_id = $2 AND document_type = 'person'`,
      [person_id, workspaceId]
    );
    if (personResult.rows.length === 0) {
      res.status(404).json({ error: 'Person not found' });
      return;
    }
    const personName = personResult.rows[0].title;

    // Verify project exists in this workspace
    const projectResult = await client.query(
      `SELECT id, title FROM documents WHERE id = $1 AND workspace_id = $2 AND document_type = 'project'`,
      [project_id, workspaceId]
    );
    if (projectResult.rows.length === 0) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    // Check if weekly plan already exists for this person+project+week
    const existingResult = await client.query(
      `SELECT id, title, content, properties, created_at, updated_at
       FROM documents
       WHERE workspace_id = $1
         AND document_type = 'weekly_plan'
         AND (properties->>'person_id') = $2
         AND (properties->>'project_id') = $3
         AND (properties->>'week_number')::int = $4`,
      [workspaceId, person_id, project_id, week_number]
    );

    if (existingResult.rows.length > 0) {
      // Return existing document with 200
      const doc = existingResult.rows[0];
      res.status(200).json({
        id: doc.id,
        title: doc.title,
        document_type: 'weekly_plan',
        content: doc.content,
        properties: doc.properties,
        created_at: doc.created_at,
        updated_at: doc.updated_at,
      });
      return;
    }

    // Create new weekly plan document
    await client.query('BEGIN');

    const docId = uuidv4();
    const title = 'Untitled'; // Per Ship convention, all new docs are "Untitled"
    const properties = {
      person_id,
      project_id,
      week_number,
      submitted_at: null,
    };

    // Insert the document
    const insertResult = await client.query(
      `INSERT INTO documents (id, workspace_id, document_type, title, content, properties, visibility, created_by, position)
       VALUES ($1, $2, 'weekly_plan', $3, $4, $5, 'workspace', $6, 0)
       RETURNING id, title, content, properties, created_at, updated_at`,
      [docId, workspaceId, title, JSON.stringify({ type: 'doc', content: [] }), JSON.stringify(properties), userId]
    );

    // Create association with project
    await client.query(
      `INSERT INTO document_associations (id, document_id, related_id, relationship_type)
       VALUES ($1, $2, $3, 'project')`,
      [uuidv4(), docId, project_id]
    );

    await client.query('COMMIT');

    const doc = insertResult.rows[0];
    res.status(201).json({
      id: doc.id,
      title: doc.title,
      document_type: 'weekly_plan',
      content: doc.content,
      properties: doc.properties,
      created_at: doc.created_at,
      updated_at: doc.updated_at,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Create weekly plan error:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

/**
 * @swagger
 * /weekly-plans:
 *   get:
 *     summary: Query weekly plan documents
 *     tags: [Weekly Plans]
 *     parameters:
 *       - in: query
 *         name: person_id
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: project_id
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: week_number
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of weekly plans matching query
 */
router.get('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const workspaceId = req.workspaceId!;
    const { person_id, project_id, week_number } = req.query;

    let query = `
      SELECT d.id, d.title, d.content, d.properties, d.created_at, d.updated_at,
             p.title as person_name, pr.title as project_name
      FROM documents d
      LEFT JOIN documents p ON (d.properties->>'person_id')::uuid = p.id
      LEFT JOIN documents pr ON (d.properties->>'project_id')::uuid = pr.id
      WHERE d.workspace_id = $1
        AND d.document_type = 'weekly_plan'
        AND d.archived_at IS NULL
    `;
    const params: (string | number)[] = [workspaceId];
    let paramIndex = 2;

    if (person_id) {
      query += ` AND (d.properties->>'person_id') = $${paramIndex++}`;
      params.push(person_id as string);
    }

    if (project_id) {
      query += ` AND (d.properties->>'project_id') = $${paramIndex++}`;
      params.push(project_id as string);
    }

    if (week_number) {
      query += ` AND (d.properties->>'week_number')::int = $${paramIndex++}`;
      params.push(parseInt(week_number as string, 10));
    }

    query += ` ORDER BY (d.properties->>'week_number')::int DESC, d.created_at DESC`;

    const result = await pool.query(query, params);

    const plans = result.rows.map(row => ({
      id: row.id,
      title: row.title,
      document_type: 'weekly_plan' as const,
      content: row.content,
      properties: row.properties,
      person_name: row.person_name,
      project_name: row.project_name,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));

    res.json(plans);
  } catch (err) {
    console.error('Get weekly plans error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /weekly-plans/{id}:
 *   get:
 *     summary: Get a specific weekly plan by ID
 *     tags: [Weekly Plans]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Weekly plan document
 *       404:
 *         description: Weekly plan not found
 */
router.get('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const workspaceId = req.workspaceId!;

    const result = await pool.query(
      `SELECT d.id, d.title, d.content, d.properties, d.created_at, d.updated_at,
              p.title as person_name, pr.title as project_name
       FROM documents d
       LEFT JOIN documents p ON (d.properties->>'person_id')::uuid = p.id
       LEFT JOIN documents pr ON (d.properties->>'project_id')::uuid = pr.id
       WHERE d.id = $1
         AND d.workspace_id = $2
         AND d.document_type = 'weekly_plan'`,
      [id, workspaceId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Weekly plan not found' });
      return;
    }

    const row = result.rows[0];
    res.json({
      id: row.id,
      title: row.title,
      document_type: 'weekly_plan' as const,
      content: row.content,
      properties: row.properties,
      person_name: row.person_name,
      project_name: row.project_name,
      created_at: row.created_at,
      updated_at: row.updated_at,
    });
  } catch (err) {
    console.error('Get weekly plan error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ============================================
// WEEKLY RETROS ROUTES
// ============================================

// Schema for creating/getting a weekly retro
const weeklyRetroSchema = z.object({
  person_id: z.string().uuid(),
  project_id: z.string().uuid(),
  week_number: z.number().int().min(1),
});

/**
 * @swagger
 * /weekly-retros:
 *   post:
 *     summary: Create or get existing weekly retro document (idempotent)
 *     tags: [Weekly Retros]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - person_id
 *               - project_id
 *               - week_number
 *             properties:
 *               person_id:
 *                 type: string
 *                 format: uuid
 *               project_id:
 *                 type: string
 *                 format: uuid
 *               week_number:
 *                 type: integer
 *                 minimum: 1
 *     responses:
 *       200:
 *         description: Existing weekly retro document returned
 *       201:
 *         description: New weekly retro document created
 */
export const weeklyRetrosRouter: RouterType = Router();

weeklyRetrosRouter.post('/', authMiddleware, async (req: Request, res: Response) => {
  const client = await pool.connect();
  try {
    const parsed = weeklyRetroSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid input', details: parsed.error.errors });
      return;
    }

    const { person_id, project_id, week_number } = parsed.data;
    const workspaceId = req.workspaceId!;
    const userId = req.userId!;

    // Verify person exists in this workspace
    const personResult = await client.query(
      `SELECT id, title FROM documents WHERE id = $1 AND workspace_id = $2 AND document_type = 'person'`,
      [person_id, workspaceId]
    );
    if (personResult.rows.length === 0) {
      res.status(404).json({ error: 'Person not found' });
      return;
    }

    // Verify project exists in this workspace
    const projectResult = await client.query(
      `SELECT id, title FROM documents WHERE id = $1 AND workspace_id = $2 AND document_type = 'project'`,
      [project_id, workspaceId]
    );
    if (projectResult.rows.length === 0) {
      res.status(404).json({ error: 'Project not found' });
      return;
    }

    // Check if weekly retro already exists for this person+project+week
    const existingResult = await client.query(
      `SELECT id, title, content, properties, created_at, updated_at
       FROM documents
       WHERE workspace_id = $1
         AND document_type = 'weekly_retro'
         AND (properties->>'person_id') = $2
         AND (properties->>'project_id') = $3
         AND (properties->>'week_number')::int = $4`,
      [workspaceId, person_id, project_id, week_number]
    );

    if (existingResult.rows.length > 0) {
      // Return existing document with 200
      const doc = existingResult.rows[0];
      res.status(200).json({
        id: doc.id,
        title: doc.title,
        document_type: 'weekly_retro',
        content: doc.content,
        properties: doc.properties,
        created_at: doc.created_at,
        updated_at: doc.updated_at,
      });
      return;
    }

    // Create new weekly retro document
    await client.query('BEGIN');

    const docId = uuidv4();
    const title = 'Untitled'; // Per Ship convention
    const properties = {
      person_id,
      project_id,
      week_number,
      submitted_at: null,
    };

    // Insert the document
    const insertResult = await client.query(
      `INSERT INTO documents (id, workspace_id, document_type, title, content, properties, visibility, created_by, position)
       VALUES ($1, $2, 'weekly_retro', $3, $4, $5, 'workspace', $6, 0)
       RETURNING id, title, content, properties, created_at, updated_at`,
      [docId, workspaceId, title, JSON.stringify({ type: 'doc', content: [] }), JSON.stringify(properties), userId]
    );

    // Create association with project
    await client.query(
      `INSERT INTO document_associations (id, document_id, related_id, relationship_type)
       VALUES ($1, $2, $3, 'project')`,
      [uuidv4(), docId, project_id]
    );

    await client.query('COMMIT');

    const doc = insertResult.rows[0];
    res.status(201).json({
      id: doc.id,
      title: doc.title,
      document_type: 'weekly_retro',
      content: doc.content,
      properties: doc.properties,
      created_at: doc.created_at,
      updated_at: doc.updated_at,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Create weekly retro error:', err);
    res.status(500).json({ error: 'Internal server error' });
  } finally {
    client.release();
  }
});

/**
 * @swagger
 * /weekly-retros:
 *   get:
 *     summary: Query weekly retro documents
 *     tags: [Weekly Retros]
 *     parameters:
 *       - in: query
 *         name: person_id
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: project_id
 *         schema:
 *           type: string
 *           format: uuid
 *       - in: query
 *         name: week_number
 *         schema:
 *           type: integer
 *     responses:
 *       200:
 *         description: List of weekly retros matching query
 */
weeklyRetrosRouter.get('/', authMiddleware, async (req: Request, res: Response) => {
  try {
    const workspaceId = req.workspaceId!;
    const { person_id, project_id, week_number } = req.query;

    let query = `
      SELECT d.id, d.title, d.content, d.properties, d.created_at, d.updated_at,
             p.title as person_name, pr.title as project_name
      FROM documents d
      LEFT JOIN documents p ON (d.properties->>'person_id')::uuid = p.id
      LEFT JOIN documents pr ON (d.properties->>'project_id')::uuid = pr.id
      WHERE d.workspace_id = $1
        AND d.document_type = 'weekly_retro'
        AND d.archived_at IS NULL
    `;
    const params: (string | number)[] = [workspaceId];
    let paramIndex = 2;

    if (person_id) {
      query += ` AND (d.properties->>'person_id') = $${paramIndex++}`;
      params.push(person_id as string);
    }

    if (project_id) {
      query += ` AND (d.properties->>'project_id') = $${paramIndex++}`;
      params.push(project_id as string);
    }

    if (week_number) {
      query += ` AND (d.properties->>'week_number')::int = $${paramIndex++}`;
      params.push(parseInt(week_number as string, 10));
    }

    query += ` ORDER BY (d.properties->>'week_number')::int DESC, d.created_at DESC`;

    const result = await pool.query(query, params);

    const retros = result.rows.map(row => ({
      id: row.id,
      title: row.title,
      document_type: 'weekly_retro' as const,
      content: row.content,
      properties: row.properties,
      person_name: row.person_name,
      project_name: row.project_name,
      created_at: row.created_at,
      updated_at: row.updated_at,
    }));

    res.json(retros);
  } catch (err) {
    console.error('Get weekly retros error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

/**
 * @swagger
 * /weekly-retros/{id}:
 *   get:
 *     summary: Get a specific weekly retro by ID
 *     tags: [Weekly Retros]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Weekly retro document
 *       404:
 *         description: Weekly retro not found
 */
weeklyRetrosRouter.get('/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const workspaceId = req.workspaceId!;

    const result = await pool.query(
      `SELECT d.id, d.title, d.content, d.properties, d.created_at, d.updated_at,
              p.title as person_name, pr.title as project_name
       FROM documents d
       LEFT JOIN documents p ON (d.properties->>'person_id')::uuid = p.id
       LEFT JOIN documents pr ON (d.properties->>'project_id')::uuid = pr.id
       WHERE d.id = $1
         AND d.workspace_id = $2
         AND d.document_type = 'weekly_retro'`,
      [id, workspaceId]
    );

    if (result.rows.length === 0) {
      res.status(404).json({ error: 'Weekly retro not found' });
      return;
    }

    const row = result.rows[0];
    res.json({
      id: row.id,
      title: row.title,
      document_type: 'weekly_retro' as const,
      content: row.content,
      properties: row.properties,
      person_name: row.person_name,
      project_name: row.project_name,
      created_at: row.created_at,
      updated_at: row.updated_at,
    });
  } catch (err) {
    console.error('Get weekly retro error:', err);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
