import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';
import { pool } from '../db/client.js';
import { authMiddleware, workspaceAdminMiddleware } from '../middleware/auth.js';
import { ERROR_CODES, HTTP_STATUS } from '@ship/shared';
import { logAuditEvent } from '../services/audit.js';

const router: RouterType = Router();

// GET /api/workspaces - List user's workspaces
router.get('/', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await pool.query(
      `SELECT w.id, w.name, w.sprint_start_date, w.archived_at, w.created_at, w.updated_at,
              wm.role
       FROM workspaces w
       JOIN workspace_memberships wm ON w.id = wm.workspace_id
       WHERE wm.user_id = $1 AND w.archived_at IS NULL
       ORDER BY w.name`,
      [req.userId]
    );

    // Check if user is super-admin (they see all workspaces)
    const userResult = await pool.query(
      'SELECT is_super_admin FROM users WHERE id = $1',
      [req.userId]
    );
    const isSuperAdmin = userResult.rows[0]?.is_super_admin || false;

    let workspaces = result.rows.map(row => ({
      id: row.id,
      name: row.name,
      sprintStartDate: row.sprint_start_date,
      archivedAt: row.archived_at,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      role: row.role,
    }));

    // Super-admins see all workspaces (even ones they're not members of)
    if (isSuperAdmin) {
      const allWorkspacesResult = await pool.query(
        `SELECT id, name, sprint_start_date, archived_at, created_at, updated_at
         FROM workspaces
         WHERE archived_at IS NULL
         ORDER BY name`
      );

      const memberWorkspaceIds = new Set(workspaces.map(w => w.id));
      const additionalWorkspaces = allWorkspacesResult.rows
        .filter(row => !memberWorkspaceIds.has(row.id))
        .map(row => ({
          id: row.id,
          name: row.name,
          sprintStartDate: row.sprint_start_date,
          archivedAt: row.archived_at,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
          role: 'admin' as const, // Super-admins have admin access to all
          isSuperAdmin: true,
        }));

      workspaces = [...workspaces, ...additionalWorkspaces];
    }

    res.json({
      success: true,
      data: { workspaces, isSuperAdmin },
    });
  } catch (error) {
    console.error('List workspaces error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to list workspaces',
      },
    });
  }
});

// GET /api/workspaces/current - Get current workspace
router.get('/current', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.workspaceId) {
      res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'No workspace selected',
        },
      });
      return;
    }

    const result = await pool.query(
      `SELECT w.id, w.name, w.sprint_start_date, w.archived_at, w.created_at, w.updated_at,
              wm.role
       FROM workspaces w
       LEFT JOIN workspace_memberships wm ON w.id = wm.workspace_id AND wm.user_id = $2
       WHERE w.id = $1`,
      [req.workspaceId, req.userId]
    );

    const workspace = result.rows[0];
    if (!workspace) {
      res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        error: {
          code: ERROR_CODES.NOT_FOUND,
          message: 'Workspace not found',
        },
      });
      return;
    }

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
          role: workspace.role || 'admin', // Super-admin without membership
        },
      },
    });
  } catch (error) {
    console.error('Get current workspace error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to get current workspace',
      },
    });
  }
});

// POST /api/workspaces/:id/switch - Switch to a workspace
router.post('/:id/switch', authMiddleware, async (req: Request, res: Response): Promise<void> => {
  const { id: workspaceId } = req.params;

  try {
    // Check user has access to this workspace (member or super-admin)
    const userResult = await pool.query(
      'SELECT is_super_admin FROM users WHERE id = $1',
      [req.userId]
    );
    const isSuperAdmin = userResult.rows[0]?.is_super_admin || false;

    const membershipResult = await pool.query(
      'SELECT id FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
      [workspaceId, req.userId]
    );

    if (!membershipResult.rows[0] && !isSuperAdmin) {
      res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        error: {
          code: ERROR_CODES.FORBIDDEN,
          message: 'Access denied to this workspace',
        },
      });
      return;
    }

    // Verify workspace exists and is not archived
    const workspaceResult = await pool.query(
      'SELECT id, name, archived_at FROM workspaces WHERE id = $1',
      [workspaceId]
    );

    const workspace = workspaceResult.rows[0];
    if (!workspace) {
      res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        error: {
          code: ERROR_CODES.NOT_FOUND,
          message: 'Workspace not found',
        },
      });
      return;
    }

    if (workspace.archived_at) {
      res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        error: {
          code: ERROR_CODES.FORBIDDEN,
          message: 'Cannot switch to archived workspace',
        },
      });
      return;
    }

    // Update user's last_workspace_id
    await pool.query(
      'UPDATE users SET last_workspace_id = $1, updated_at = NOW() WHERE id = $2',
      [workspaceId, req.userId]
    );

    // Update session's workspace_id
    await pool.query(
      'UPDATE sessions SET workspace_id = $1 WHERE id = $2',
      [workspaceId, req.sessionId]
    );

    await logAuditEvent({
      workspaceId,
      actorUserId: req.userId!,
      action: 'workspace.switch',
      resourceType: 'workspace',
      resourceId: workspaceId,
      req,
    });

    res.json({
      success: true,
      data: { workspaceId },
    });
  } catch (error) {
    console.error('Switch workspace error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to switch workspace',
      },
    });
  }
});

// GET /api/workspaces/:id/members - List workspace members (admin only)
router.get('/:id/members', authMiddleware, workspaceAdminMiddleware, async (req: Request, res: Response): Promise<void> => {
  const { id: workspaceId } = req.params;

  try {
    // Query memberships and join to person docs via properties.user_id
    const result = await pool.query(
      `SELECT wm.id, wm.user_id, wm.role, wm.created_at,
              u.email, u.name,
              d.id as person_document_id
       FROM workspace_memberships wm
       JOIN users u ON wm.user_id = u.id
       LEFT JOIN documents d ON d.workspace_id = wm.workspace_id
         AND d.document_type = 'person'
         AND d.properties->>'user_id' = wm.user_id::text
       WHERE wm.workspace_id = $1
       ORDER BY u.name`,
      [workspaceId]
    );

    const members = result.rows.map(row => ({
      id: row.id,
      userId: row.user_id,
      email: row.email,
      name: row.name,
      role: row.role,
      personDocumentId: row.person_document_id,
      createdAt: row.created_at,
    }));

    res.json({
      success: true,
      data: { members },
    });
  } catch (error) {
    console.error('List members error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to list members',
      },
    });
  }
});

// POST /api/workspaces/:id/members - Add member to workspace (admin only)
router.post('/:id/members', authMiddleware, workspaceAdminMiddleware, async (req: Request, res: Response): Promise<void> => {
  const { id: workspaceId } = req.params;
  const { userId, role = 'member' } = req.body;

  if (!userId) {
    res.status(HTTP_STATUS.BAD_REQUEST).json({
      success: false,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'userId is required',
      },
    });
    return;
  }

  try {
    // Check if user exists
    const userResult = await pool.query('SELECT id, email, name FROM users WHERE id = $1', [userId]);
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

    // Check if already a member
    const existingResult = await pool.query(
      'SELECT id FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
      [workspaceId, userId]
    );
    if (existingResult.rows[0]) {
      res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'User is already a member of this workspace',
        },
      });
      return;
    }

    // Create membership
    const membershipResult = await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, $3)
       RETURNING id, created_at`,
      [workspaceId, userId, role]
    );

    // Create Person document for this user in this workspace (links via properties.user_id)
    const personDocResult = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title, properties, created_by)
       VALUES ($1, 'person', $2, $3, $4)
       RETURNING id`,
      [workspaceId, userResult.rows[0].name, JSON.stringify({ user_id: userId, email: userResult.rows[0].email }), req.userId]
    );
    const personDocumentId = personDocResult.rows[0].id;

    await logAuditEvent({
      workspaceId,
      actorUserId: req.userId!,
      action: 'membership.create',
      resourceType: 'user',
      resourceId: userId,
      details: { role },
      req,
    });

    res.status(HTTP_STATUS.CREATED).json({
      success: true,
      data: {
        membership: {
          id: membershipResult.rows[0].id,
          userId,
          email: userResult.rows[0].email,
          name: userResult.rows[0].name,
          role,
          personDocumentId,
          createdAt: membershipResult.rows[0].created_at,
        },
      },
    });
  } catch (error) {
    console.error('Add member error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to add member',
      },
    });
  }
});

// PATCH /api/workspaces/:id/members/:userId - Update member role (admin only)
router.patch('/:id/members/:userId', authMiddleware, workspaceAdminMiddleware, async (req: Request, res: Response): Promise<void> => {
  const { id: workspaceId, userId } = req.params;
  const { role } = req.body;

  if (!role || !['admin', 'member'].includes(role)) {
    res.status(HTTP_STATUS.BAD_REQUEST).json({
      success: false,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Valid role (admin or member) is required',
      },
    });
    return;
  }

  try {
    // If demoting to member, check this isn't the last admin
    if (role === 'member') {
      const adminCountResult = await pool.query(
        `SELECT COUNT(*) as count FROM workspace_memberships
         WHERE workspace_id = $1 AND role = 'admin'`,
        [workspaceId]
      );

      const currentMemberResult = await pool.query(
        'SELECT role FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
        [workspaceId, userId]
      );

      if (
        currentMemberResult.rows[0]?.role === 'admin' &&
        parseInt(adminCountResult.rows[0].count) <= 1
      ) {
        res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          error: {
            code: ERROR_CODES.VALIDATION_ERROR,
            message: 'Cannot demote the last admin. Workspace must have at least one admin.',
          },
        });
        return;
      }
    }

    const result = await pool.query(
      `UPDATE workspace_memberships
       SET role = $1, updated_at = NOW()
       WHERE workspace_id = $2 AND user_id = $3
       RETURNING id, role`,
      [role, workspaceId, userId]
    );

    if (!result.rows[0]) {
      res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        error: {
          code: ERROR_CODES.NOT_FOUND,
          message: 'Membership not found',
        },
      });
      return;
    }

    await logAuditEvent({
      workspaceId,
      actorUserId: req.userId!,
      action: 'membership.update',
      resourceType: 'user',
      resourceId: userId,
      details: { newRole: role },
      req,
    });

    res.json({
      success: true,
      data: { role },
    });
  } catch (error) {
    console.error('Update member role error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to update member role',
      },
    });
  }
});

// DELETE /api/workspaces/:id/members/:userId - Remove member (admin only)
router.delete('/:id/members/:userId', authMiddleware, workspaceAdminMiddleware, async (req: Request, res: Response): Promise<void> => {
  const { id: workspaceId, userId } = req.params;

  try {
    // Check this isn't the last admin
    const memberResult = await pool.query(
      'SELECT role FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
      [workspaceId, userId]
    );

    if (!memberResult.rows[0]) {
      res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        error: {
          code: ERROR_CODES.NOT_FOUND,
          message: 'Membership not found',
        },
      });
      return;
    }

    if (memberResult.rows[0].role === 'admin') {
      const adminCountResult = await pool.query(
        `SELECT COUNT(*) as count FROM workspace_memberships
         WHERE workspace_id = $1 AND role = 'admin'`,
        [workspaceId]
      );

      if (parseInt(adminCountResult.rows[0].count) <= 1) {
        res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          error: {
            code: ERROR_CODES.VALIDATION_ERROR,
            message: 'Cannot remove the last admin. Workspace must have at least one admin.',
          },
        });
        return;
      }
    }

    // Delete membership
    await pool.query(
      'DELETE FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
      [workspaceId, userId]
    );

    // Archive the person document (preserve for audit history)
    await pool.query(
      `UPDATE documents SET archived_at = NOW()
       WHERE workspace_id = $1 AND document_type = 'person' AND properties->>'user_id' = $2`,
      [workspaceId, userId]
    );

    // Invalidate all sessions for this user in this workspace
    await pool.query(
      'DELETE FROM sessions WHERE user_id = $1 AND workspace_id = $2',
      [userId, workspaceId]
    );

    await logAuditEvent({
      workspaceId,
      actorUserId: req.userId!,
      action: 'membership.delete',
      resourceType: 'user',
      resourceId: userId,
      req,
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Remove member error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to remove member',
      },
    });
  }
});

// GET /api/workspaces/:id/invites - List pending invites (admin only)
router.get('/:id/invites', authMiddleware, workspaceAdminMiddleware, async (req: Request, res: Response): Promise<void> => {
  const { id: workspaceId } = req.params;

  try {
    const result = await pool.query(
      `SELECT wi.id, wi.email, wi.token, wi.role, wi.expires_at, wi.created_at,
              u.name as invited_by_name
       FROM workspace_invites wi
       JOIN users u ON wi.invited_by_user_id = u.id
       WHERE wi.workspace_id = $1 AND wi.used_at IS NULL AND wi.expires_at > NOW()
       ORDER BY wi.created_at DESC`,
      [workspaceId]
    );

    const invites = result.rows.map(row => ({
      id: row.id,
      email: row.email,
      token: row.token,
      role: row.role,
      expiresAt: row.expires_at,
      createdAt: row.created_at,
      invitedByName: row.invited_by_name,
    }));

    res.json({
      success: true,
      data: { invites },
    });
  } catch (error) {
    console.error('List invites error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to list invites',
      },
    });
  }
});

// POST /api/workspaces/:id/invites - Create invite (admin only)
router.post('/:id/invites', authMiddleware, workspaceAdminMiddleware, async (req: Request, res: Response): Promise<void> => {
  const { id: workspaceId } = req.params;
  const { email, role = 'member' } = req.body;

  if (!email) {
    res.status(HTTP_STATUS.BAD_REQUEST).json({
      success: false,
      error: {
        code: ERROR_CODES.VALIDATION_ERROR,
        message: 'Email is required',
      },
    });
    return;
  }

  try {
    // Check if user already exists and is a member
    const existingUserResult = await pool.query(
      `SELECT u.id FROM users u
       JOIN workspace_memberships wm ON u.id = wm.user_id
       WHERE u.email = $1 AND wm.workspace_id = $2`,
      [email, workspaceId]
    );

    if (existingUserResult.rows[0]) {
      res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'User is already a member of this workspace',
        },
      });
      return;
    }

    // Check for existing pending invite
    const existingInviteResult = await pool.query(
      `SELECT id FROM workspace_invites
       WHERE workspace_id = $1 AND email = $2 AND used_at IS NULL AND expires_at > NOW()`,
      [workspaceId, email]
    );

    if (existingInviteResult.rows[0]) {
      res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'An invite is already pending for this email',
        },
      });
      return;
    }

    // Generate unique token
    const { v4: uuidv4 } = await import('uuid');
    const token = uuidv4();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const result = await pool.query(
      `INSERT INTO workspace_invites (workspace_id, email, token, role, invited_by_user_id, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, email, role, expires_at, created_at`,
      [workspaceId, email, token, role, req.userId, expiresAt]
    );

    await logAuditEvent({
      workspaceId,
      actorUserId: req.userId!,
      action: 'invite.create',
      resourceType: 'invite',
      resourceId: result.rows[0].id,
      details: { email, role },
      req,
    });

    res.status(HTTP_STATUS.CREATED).json({
      success: true,
      data: {
        invite: {
          id: result.rows[0].id,
          email: result.rows[0].email,
          role: result.rows[0].role,
          token, // Include token for the admin to share
          expiresAt: result.rows[0].expires_at,
          createdAt: result.rows[0].created_at,
        },
      },
    });
  } catch (error) {
    console.error('Create invite error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to create invite',
      },
    });
  }
});

// DELETE /api/workspaces/:id/invites/:inviteId - Revoke invite (admin only)
router.delete('/:id/invites/:inviteId', authMiddleware, workspaceAdminMiddleware, async (req: Request, res: Response): Promise<void> => {
  const { id: workspaceId, inviteId } = req.params;

  try {
    const result = await pool.query(
      'DELETE FROM workspace_invites WHERE id = $1 AND workspace_id = $2 RETURNING id',
      [inviteId, workspaceId]
    );

    if (!result.rows[0]) {
      res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        error: {
          code: ERROR_CODES.NOT_FOUND,
          message: 'Invite not found',
        },
      });
      return;
    }

    await logAuditEvent({
      workspaceId,
      actorUserId: req.userId!,
      action: 'invite.delete',
      resourceType: 'invite',
      resourceId: inviteId,
      req,
    });

    res.json({ success: true });
  } catch (error) {
    console.error('Revoke invite error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to revoke invite',
      },
    });
  }
});

// GET /api/workspaces/:id/audit-logs - Get workspace audit logs (admin only)
router.get('/:id/audit-logs', authMiddleware, workspaceAdminMiddleware, async (req: Request, res: Response): Promise<void> => {
  const { id: workspaceId } = req.params;
  const { limit = '100', offset = '0' } = req.query;

  try {
    const result = await pool.query(
      `SELECT al.id, al.action, al.resource_type, al.resource_id, al.details,
              al.ip_address, al.user_agent, al.created_at,
              u.email as actor_email, u.name as actor_name,
              iu.email as impersonating_email
       FROM audit_logs al
       JOIN users u ON al.actor_user_id = u.id
       LEFT JOIN users iu ON al.impersonating_user_id = iu.id
       WHERE al.workspace_id = $1
       ORDER BY al.created_at DESC
       LIMIT $2 OFFSET $3`,
      [workspaceId, parseInt(limit as string), parseInt(offset as string)]
    );

    const logs = result.rows.map(row => ({
      id: row.id,
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
    console.error('Get audit logs error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to get audit logs',
      },
    });
  }
});

export default router;
