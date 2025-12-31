import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';
import { pool } from '../db/client.js';
import { ERROR_CODES, HTTP_STATUS, SESSION_TIMEOUT_MS } from '@ship/shared';
import { logAuditEvent } from '../services/audit.js';

const router: RouterType = Router();

// GET /api/invites/:token - Validate invite token
router.get('/:token', async (req: Request, res: Response): Promise<void> => {
  const { token } = req.params;

  try {
    const result = await pool.query(
      `SELECT wi.id, wi.email, wi.role, wi.expires_at, wi.used_at,
              w.id as workspace_id, w.name as workspace_name
       FROM workspace_invites wi
       JOIN workspaces w ON wi.workspace_id = w.id
       WHERE wi.token = $1`,
      [token]
    );

    const invite = result.rows[0];

    if (!invite) {
      res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        error: {
          code: ERROR_CODES.NOT_FOUND,
          message: 'Invalid invite link',
        },
      });
      return;
    }

    if (invite.used_at) {
      res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'This invite has already been used',
        },
      });
      return;
    }

    if (new Date(invite.expires_at) < new Date()) {
      res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'This invite has expired',
        },
      });
      return;
    }

    // Check if user already exists
    const existingUserResult = await pool.query(
      'SELECT id FROM users WHERE email = $1',
      [invite.email]
    );
    const userExists = !!existingUserResult.rows[0];

    res.json({
      success: true,
      data: {
        invite: {
          id: invite.id,
          email: invite.email,
          role: invite.role,
          workspaceId: invite.workspace_id,
          workspaceName: invite.workspace_name,
          expiresAt: invite.expires_at,
          userExists,
        },
      },
    });
  } catch (error) {
    console.error('Validate invite error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to validate invite',
      },
    });
  }
});

// POST /api/invites/:token/accept - Accept invite and create account
router.post('/:token/accept', async (req: Request, res: Response): Promise<void> => {
  const { token } = req.params;
  const { password, name } = req.body;

  try {
    // Get invite details
    const inviteResult = await pool.query(
      `SELECT wi.id, wi.email, wi.role, wi.expires_at, wi.used_at, wi.workspace_id,
              w.name as workspace_name
       FROM workspace_invites wi
       JOIN workspaces w ON wi.workspace_id = w.id
       WHERE wi.token = $1`,
      [token]
    );

    const invite = inviteResult.rows[0];

    if (!invite) {
      res.status(HTTP_STATUS.NOT_FOUND).json({
        success: false,
        error: {
          code: ERROR_CODES.NOT_FOUND,
          message: 'Invalid invite link',
        },
      });
      return;
    }

    if (invite.used_at) {
      res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'This invite has already been used',
        },
      });
      return;
    }

    if (new Date(invite.expires_at) < new Date()) {
      res.status(HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: 'This invite has expired',
        },
      });
      return;
    }

    // Check if user already exists
    const existingUserResult = await pool.query(
      'SELECT id, name FROM users WHERE email = $1',
      [invite.email]
    );
    let user = existingUserResult.rows[0];

    if (user) {
      // User exists - check if already member of workspace
      const existingMemberResult = await pool.query(
        'SELECT id FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
        [invite.workspace_id, user.id]
      );

      if (existingMemberResult.rows[0]) {
        res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          error: {
            code: ERROR_CODES.VALIDATION_ERROR,
            message: 'You are already a member of this workspace',
          },
        });
        return;
      }
    } else {
      // Create new user
      if (!password || password.length < 8) {
        res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          error: {
            code: ERROR_CODES.VALIDATION_ERROR,
            message: 'Password must be at least 8 characters',
          },
        });
        return;
      }

      const passwordHash = await bcrypt.hash(password, 10);
      const userName = name || invite.email.split('@')[0];

      const newUserResult = await pool.query(
        `INSERT INTO users (email, password_hash, name, last_workspace_id)
         VALUES ($1, $2, $3, $4)
         RETURNING id, name`,
        [invite.email, passwordHash, userName, invite.workspace_id]
      );

      user = newUserResult.rows[0];
    }

    // Create Person document for this user in this workspace
    const personDocResult = await pool.query(
      `INSERT INTO documents (workspace_id, document_type, title)
       VALUES ($1, 'person', $2)
       RETURNING id`,
      [invite.workspace_id, user.name]
    );
    const personDocumentId = personDocResult.rows[0].id;

    // Create membership
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, person_document_id, role)
       VALUES ($1, $2, $3, $4)`,
      [invite.workspace_id, user.id, personDocumentId, invite.role]
    );

    // Mark invite as used
    await pool.query(
      'UPDATE workspace_invites SET used_at = NOW() WHERE id = $1',
      [invite.id]
    );

    // Create session
    const sessionId = uuidv4();
    const expiresAt = new Date(Date.now() + SESSION_TIMEOUT_MS);

    await pool.query(
      `INSERT INTO sessions (id, user_id, workspace_id, expires_at, last_activity)
       VALUES ($1, $2, $3, $4, $5)`,
      [sessionId, user.id, invite.workspace_id, expiresAt, new Date()]
    );

    await logAuditEvent({
      workspaceId: invite.workspace_id,
      actorUserId: user.id,
      action: 'invite.accept',
      resourceType: 'invite',
      resourceId: invite.id,
      details: { email: invite.email, role: invite.role },
      req,
    });

    // Set cookie
    res.cookie('session_id', sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: SESSION_TIMEOUT_MS,
    });

    res.status(HTTP_STATUS.CREATED).json({
      success: true,
      data: {
        user: {
          id: user.id,
          email: invite.email,
          name: user.name,
        },
        workspace: {
          id: invite.workspace_id,
          name: invite.workspace_name,
          role: invite.role,
        },
      },
    });
  } catch (error) {
    console.error('Accept invite error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to accept invite',
      },
    });
  }
});

export default router;
