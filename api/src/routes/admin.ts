import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';
import { pool } from '../db/client.js';
import { authMiddleware, superAdminMiddleware } from '../middleware/auth.js';
import { ERROR_CODES, HTTP_STATUS } from '@ship/shared';
import { logAuditEvent } from '../services/audit.js';

const router: RouterType = Router();

// All admin routes require super-admin
router.use(authMiddleware, superAdminMiddleware);

// GET /api/admin/workspaces - List all workspaces (including archived)
router.get('/workspaces', async (req: Request, res: Response): Promise<void> => {
  const { includeArchived } = req.query;

  try {
    let query = `SELECT w.id, w.name, w.sprint_start_date, w.archived_at, w.created_at, w.updated_at,
                        (SELECT COUNT(*) FROM workspace_memberships wm WHERE wm.workspace_id = w.id) as member_count
                 FROM workspaces w`;

    if (includeArchived !== 'true') {
      query += ' WHERE w.archived_at IS NULL';
    }

    query += ' ORDER BY w.name';

    const result = await pool.query(query);

    const workspaces = result.rows.map(row => ({
      id: row.id,
      name: row.name,
      sprintStartDate: row.sprint_start_date,
      archivedAt: row.archived_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      memberCount: parseInt(row.member_count),
    }));

    res.json({
      success: true,
      data: { workspaces },
    });
  } catch (error) {
    console.error('Admin list workspaces error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to list workspaces',
      },
    });
  }
});

// POST /api/admin/workspaces - Create workspace
router.post('/workspaces', async (req: Request, res: Response): Promise<void> => {
  const { name } = req.body;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    res.status(HTTP_STATUS.BAD_REQUEST).json({
      success: false,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Workspace name is required',
      },
    });
    return;
  }

  try {
    const result = await pool.query(
      `INSERT INTO workspaces (name)
       VALUES ($1)
       RETURNING id, name, sprint_start_date, archived_at, created_at, updated_at`,
      [name.trim()]
    );

    const workspace = result.rows[0];

    await logAuditEvent({
      workspaceId: workspace.id,
      actorUserId: req.userId!,
      action: 'workspace.create',
      resourceType: 'workspace',
      resourceId: workspace.id,
      details: { name },
      req,
    });

    res.status(HTTP_STATUS.CREATED).json({
      success: true,
      data: {
        workspace: {
          id: workspace.id,
          name: workspace.name,
          sprintStartDate: workspace.sprint_start_date,
          archivedAt: workspace.archived_at,
          createdAt: workspace.created_at,
          updatedAt: workspace.updated_at,
        },
      },
    });
  } catch (error) {
    console.error('Create workspace error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to create workspace',
      },
    });
  }
});

// PATCH /api/admin/workspaces/:id - Update workspace
router.patch('/workspaces/:id', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { name } = req.body;

  if (!name || typeof name !== 'string' || name.trim().length === 0) {
    res.status(HTTP_STATUS.BAD_REQUEST).json({
      success: false,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Workspace name is required',
      },
    });
    return;
  }

  try {
    const result = await pool.query(
      `UPDATE workspaces
       SET name = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, name, sprint_start_date, archived_at, created_at, updated_at`,
      [name.trim(), id]
    );

    if (!result.rows[0]) {
      res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        error: {
          code: ERROR_CODES.NOT_FOUND,
          message: 'Workspace not found',
        },
      });
      return;
    }

    const workspace = result.rows[0];

    await logAuditEvent({
      workspaceId: id,
      actorUserId: req.userId!,
      action: 'workspace.update',
      resourceType: 'workspace',
      resourceId: id,
      details: { name },
      req,
    });

    res.json({
      success: true,
      data: {
        workspace: {
          id: workspace.id,
          name: workspace.name,
          sprintStartDate: workspace.sprint_start_date,
          archivedAt: workspace.archived_at,
          createdAt: workspace.created_at,
          updatedAt: workspace.updated_at,
        },
      },
    });
  } catch (error) {
    console.error('Update workspace error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to update workspace',
      },
    });
  }
});

// POST /api/admin/workspaces/:id/archive - Archive workspace
router.post('/workspaces/:id/archive', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;

  try {
    const result = await pool.query(
      `UPDATE workspaces
       SET archived_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND archived_at IS NULL
       RETURNING id`,
      [id]
    );

    if (!result.rows[0]) {
      res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        error: {
          code: ERROR_CODES.NOT_FOUND,
          message: 'Workspace not found or already archived',
        },
      });
      return;
    }

    // Invalidate all sessions for this workspace
    await pool.query('DELETE FROM sessions WHERE workspace_id = $1', [id]);

    await logAuditEvent({
      workspaceId: id,
      actorUserId: req.userId!,
      action: 'workspace.archive',
      resourceType: 'workspace',
      resourceId: id,
      req,
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Archive workspace error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to archive workspace',
      },
    });
  }
});

// GET /api/admin/users - List all users
router.get('/users', async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await pool.query(
      `SELECT u.id, u.email, u.name, u.is_super_admin, u.created_at,
              COALESCE(
                json_agg(
                  json_build_object(
                    'id', wm.workspace_id,
                    'name', w.name,
                    'role', wm.role
                  )
                ) FILTER (WHERE wm.id IS NOT NULL),
                '[]'
              ) as workspaces
       FROM users u
       LEFT JOIN workspace_memberships wm ON u.id = wm.user_id
       LEFT JOIN workspaces w ON wm.workspace_id = w.id AND w.archived_at IS NULL
       GROUP BY u.id
       ORDER BY u.name`
    );

    const users = result.rows.map(row => ({
      id: row.id,
      email: row.email,
      name: row.name,
      isSuperAdmin: row.is_super_admin,
      createdAt: row.created_at,
      workspaces: row.workspaces,
    }));

    res.json({
      success: true,
      data: { users },
    });
  } catch (error) {
    console.error('List users error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to list users',
      },
    });
  }
});

// PATCH /api/admin/users/:id/super-admin - Toggle super-admin status
router.patch('/users/:id/super-admin', async (req: Request, res: Response): Promise<void> => {
  const { id } = req.params;
  const { isSuperAdmin } = req.body;

  if (typeof isSuperAdmin !== 'boolean') {
    res.status(HTTP_STATUS.BAD_REQUEST).json({
      success: false,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'isSuperAdmin must be a boolean',
      },
    });
    return;
  }

  // Prevent removing your own super-admin status
  if (id === req.userId && !isSuperAdmin) {
    res.status(HTTP_STATUS.BAD_REQUEST).json({
      success: false,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Cannot remove your own super-admin status',
      },
    });
    return;
  }

  try {
    const result = await pool.query(
      `UPDATE users
       SET is_super_admin = $1, updated_at = NOW()
       WHERE id = $2
       RETURNING id, is_super_admin`,
      [isSuperAdmin, id]
    );

    if (!result.rows[0]) {
      res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        error: {
          code: ERROR_CODES.NOT_FOUND,
          message: 'User not found',
        },
      });
      return;
    }

    await logAuditEvent({
      actorUserId: req.userId!,
      action: 'user.super_admin_toggle',
      resourceType: 'user',
      resourceId: id,
      details: { isSuperAdmin },
      req,
    });

    res.json({
      success: true,
      data: { isSuperAdmin: result.rows[0].is_super_admin },
    });
  } catch (error) {
    console.error('Toggle super-admin error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to update user',
      },
    });
  }
});

// GET /api/admin/audit-logs - Global audit logs
router.get('/audit-logs', async (req: Request, res: Response): Promise<void> => {
  const { limit = '100', offset = '0', workspaceId, userId, action } = req.query;

  try {
    let query = `
      SELECT al.id, al.workspace_id, al.action, al.resource_type, al.resource_id, al.details,
             al.ip_address, al.user_agent, al.created_at,
             u.email as actor_email, u.name as actor_name,
             iu.email as impersonating_email,
             w.name as workspace_name
      FROM audit_logs al
      JOIN users u ON al.actor_user_id = u.id
      LEFT JOIN users iu ON al.impersonating_user_id = iu.id
      LEFT JOIN workspaces w ON al.workspace_id = w.id
      WHERE 1=1
    `;
    const params: (string | number)[] = [];
    let paramIndex = 1;

    if (workspaceId) {
      query += ` AND al.workspace_id = $${paramIndex}`;
      params.push(workspaceId as string);
      paramIndex++;
    }

    if (userId) {
      query += ` AND al.actor_user_id = $${paramIndex}`;
      params.push(userId as string);
      paramIndex++;
    }

    if (action) {
      query += ` AND al.action = $${paramIndex}`;
      params.push(action as string);
      paramIndex++;
    }

    query += ` ORDER BY al.created_at DESC LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(parseInt(limit as string), parseInt(offset as string));

    const result = await pool.query(query, params);

    const logs = result.rows.map(row => ({
      id: row.id,
      workspaceId: row.workspace_id,
      workspaceName: row.workspace_name,
      action: row.action,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      details: row.details,
      ipAddress: row.ip_address,
      userAgent: row.user_agent,
      createdAt: row.created_at,
      actorEmail: row.actor_email,
      actorName: row.actor_name,
      impersonatingEmail: row.impersonating_email,
    }));

    res.json({
      success: true,
      data: { logs },
    });
  } catch (error) {
    console.error('Get global audit logs error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to get audit logs',
      },
    });
  }
});

// GET /api/admin/audit-logs/export - Export audit logs as CSV
router.get('/audit-logs/export', async (req: Request, res: Response): Promise<void> => {
  const { workspaceId, startDate, endDate } = req.query;

  try {
    let query = `
      SELECT al.created_at, w.name as workspace_name, u.email as actor_email,
             iu.email as impersonating_email, al.action, al.resource_type,
             al.resource_id, al.details, al.ip_address
      FROM audit_logs al
      JOIN users u ON al.actor_user_id = u.id
      LEFT JOIN users iu ON al.impersonating_user_id = iu.id
      LEFT JOIN workspaces w ON al.workspace_id = w.id
      WHERE 1=1
    `;
    const params: (string | Date)[] = [];
    let paramIndex = 1;

    if (workspaceId) {
      query += ` AND al.workspace_id = $${paramIndex}`;
      params.push(workspaceId as string);
      paramIndex++;
    }

    if (startDate) {
      query += ` AND al.created_at >= $${paramIndex}`;
      params.push(new Date(startDate as string));
      paramIndex++;
    }

    if (endDate) {
      query += ` AND al.created_at <= $${paramIndex}`;
      params.push(new Date(endDate as string));
      paramIndex++;
    }

    query += ' ORDER BY al.created_at DESC';

    const result = await pool.query(query, params);

    // Generate CSV
    const headers = ['Timestamp', 'Workspace', 'Actor', 'Impersonating', 'Action', 'Resource Type', 'Resource ID', 'Details', 'IP Address'];
    const rows = result.rows.map(row => [
      row.created_at.toISOString(),
      row.workspace_name || '',
      row.actor_email,
      row.impersonating_email || '',
      row.action,
      row.resource_type || '',
      row.resource_id || '',
      row.details ? JSON.stringify(row.details) : '',
      row.ip_address || '',
    ]);

    const csv = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')),
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="audit-logs-${new Date().toISOString().split('T')[0]}.csv"`);
    res.send(csv);
  } catch (error) {
    console.error('Export audit logs error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to export audit logs',
      },
    });
  }
});

// POST /api/admin/impersonate/:userId - Start impersonation
router.post('/impersonate/:userId', async (req: Request, res: Response): Promise<void> => {
  const { userId } = req.params;

  try {
    // Get target user
    const userResult = await pool.query(
      'SELECT id, email, name FROM users WHERE id = $1',
      [userId]
    );

    if (!userResult.rows[0]) {
      res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        error: {
          code: ERROR_CODES.NOT_FOUND,
          message: 'User not found',
        },
      });
      return;
    }

    // Store impersonation in session (we'll update session table to track this)
    // For now, return impersonation data that frontend can track
    await logAuditEvent({
      actorUserId: req.userId!,
      action: 'impersonation.start',
      resourceType: 'user',
      resourceId: userId,
      details: { targetEmail: userResult.rows[0].email },
      req,
    });

    res.json({
      success: true,
      data: {
        impersonating: {
          id: userResult.rows[0].id,
          email: userResult.rows[0].email,
          name: userResult.rows[0].name,
        },
      },
    });
  } catch (error) {
    console.error('Start impersonation error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to start impersonation',
      },
    });
  }
});

// DELETE /api/admin/impersonate - End impersonation
router.delete('/impersonate', async (req: Request, res: Response): Promise<void> => {
  try {
    await logAuditEvent({
      actorUserId: req.userId!,
      action: 'impersonation.end',
      req,
    });

    res.json({ success: true });
  } catch (error) {
    console.error('End impersonation error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to end impersonation',
      },
    });
  }
});

export default router;
