import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';
import bcrypt from 'bcryptjs';
import { pool } from '../db/client.js';
import { ERROR_CODES, HTTP_STATUS } from '@ship/shared';

const router: RouterType = Router();

// GET /api/setup/status - Check if setup is needed
router.get('/status', async (_req: Request, res: Response): Promise<void> => {
  try {
    const result = await pool.query('SELECT COUNT(*) as count FROM users');
    const userCount = parseInt(result.rows[0].count);

    res.json({
      success: true,
      data: {
        needsSetup: userCount === 0,
      },
    });
  } catch (error) {
    console.error('Setup status error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to check setup status',
      },
    });
  }
});

// POST /api/setup/initialize - Create first super admin (only works when no users exist)
router.post('/initialize', async (req: Request, res: Response): Promise<void> => {
  const { email, password, name } = req.body;

  // Validate input
  if (!email || !password || !name) {
    res.status(HTTP_STATUS.BAD_REQUEST).json({
      success: false,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Email, password, and name are required',
      },
    });
    return;
  }

  if (password.length < 8) {
    res.status(HTTP_STATUS.BAD_REQUEST).json({
      success: false,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Password must be at least 8 characters',
      },
    });
    return;
  }

  try {
    // Check if any users exist - this is the critical security check
    const countResult = await pool.query('SELECT COUNT(*) as count FROM users');
    const userCount = parseInt(countResult.rows[0].count);

    if (userCount > 0) {
      res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        error: {
          code: ERROR_CODES.FORBIDDEN,
          message: 'Setup has already been completed',
        },
      });
      return;
    }

    // Hash password
    const passwordHash = await bcrypt.hash(password, 12);

    // Create workspace first
    const workspaceResult = await pool.query(
      `INSERT INTO workspaces (name)
       VALUES ($1)
       RETURNING id`,
      [`${name}'s Workspace`]
    );
    const workspaceId = workspaceResult.rows[0].id;

    // Create super admin user
    const userResult = await pool.query(
      `INSERT INTO users (email, password_hash, name, is_super_admin, last_workspace_id)
       VALUES ($1, $2, $3, true, $4)
       RETURNING id, email, name, is_super_admin`,
      [email.toLowerCase(), passwordHash, name, workspaceId]
    );
    const user = userResult.rows[0];

    // Create person document for this user
    const personDocResult = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, created_by)
       VALUES ($1, 'person', $2, $3)
       RETURNING id`,
      [workspaceId, name, user.id]
    );

    // Add user to workspace as admin
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, person_document_id, role)
       VALUES ($1, $2, $3, 'admin')`,
      [workspaceId, user.id, personDocResult.rows[0].id]
    );

    // Create welcome document
    const welcomeContent = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 1 },
          content: [{ type: 'text', text: 'Welcome to Ship' }],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Ship is your workspace for managing projects, sprints, and issues. Here are some things you can do:' },
          ],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Create wiki pages to document your team\'s knowledge' }] }],
            },
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Create projects to organize your work' }] }],
            },
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Create issues and assign them to sprints' }] }],
            },
            {
              type: 'listItem',
              content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Collaborate in real-time with your team' }] }],
            },
          ],
        },
        {
          type: 'paragraph',
          content: [{ type: 'text', text: 'Feel free to edit or delete this page. Happy shipping!' }],
        },
      ],
    };

    await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, content, created_by)
       VALUES ($1, 'wiki', 'Welcome to Ship', $2, $3)`,
      [workspaceId, JSON.stringify(welcomeContent), user.id]
    );

    console.log(`Initial setup complete: ${email} is now super admin`);

    res.status(HTTP_STATUS.CREATED).json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          isSuperAdmin: user.is_super_admin,
        },
        message: 'Setup complete! You can now log in.',
      },
    });
  } catch (error) {
    console.error('Setup initialization error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to complete setup',
      },
    });
  }
});

export default router;
