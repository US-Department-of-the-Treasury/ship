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
              w.id as workspace_id, w.name as workspace_name,
              u.name as invited_by_name
       FROM workspace_invites wi
       JOIN workspaces w ON wi.workspace_id = w.id
       JOIN users u ON wi.invited_by_user_id = u.id
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
      'SELECT id FROM users WHERE LOWER(email) = LOWER($1)',
      [invite.email]
    );
    const existingUser = existingUserResult.rows[0];
    const userExists = !!existingUser;

    // Check if user is already a member of this workspace
    let alreadyMember = false;
    if (existingUser) {
      const membershipResult = await pool.query(
        'SELECT id FROM workspace_memberships WHERE workspace_id = $1 AND user_id = $2',
        [invite.workspace_id, existingUser.id]
      );
      alreadyMember = !!membershipResult.rows[0];

      if (alreadyMember) {
        // Mark invite as used since user is already a member
        await pool.query(
          'UPDATE workspace_invites SET used_at = NOW() WHERE id = $1',
          [invite.id]
        );
      }
    }

    res.json({
      success: true,
      data: {
        id: invite.id,
        email: invite.email,
        role: invite.role,
        workspaceId: invite.workspace_id,
        workspaceName: invite.workspace_name,
        invitedBy: invite.invited_by_name,
        expiresAt: invite.expires_at,
        userExists,
        alreadyMember,
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

    // Check if user already exists (case-insensitive email match)
    const existingUserResult = await pool.query(
      'SELECT id, name FROM users WHERE LOWER(email) = LOWER($1)',
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
        // User is already a member - mark invite as used to clean it up
        await pool.query(
          'UPDATE workspace_invites SET used_at = NOW() WHERE id = $1',
          [invite.id]
        );

        res.status(HTTP_STATUS.BAD_REQUEST).json({
          success: false,
          error: {
            code: ERROR_CODES.VALIDATION_ERROR,
            message: 'You are already a member of this workspace. Please log in instead.',
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

    // Create membership
    await pool.query(
      `INSERT INTO workspace_memberships (workspace_id, user_id, role)
       VALUES ($1, $2, $3)`,
      [invite.workspace_id, user.id, invite.role]
    );

    // Check if user already has a non-pending person doc in this workspace
    // This can happen if they were added directly as a member before the invite
    const existingPersonDoc = await pool.query(
      `SELECT id FROM documents
       WHERE workspace_id = $1
         AND document_type = 'person'
         AND properties->>'user_id' = $2
         AND (properties->>'pending' IS NULL OR properties->>'pending' != 'true')`,
      [invite.workspace_id, user.id]
    );

    if (existingPersonDoc.rows[0]) {
      // User already has a person doc - archive the pending one FIRST
      // (before transferring invite_id, otherwise archive query would match both)
      await pool.query(
        `UPDATE documents SET archived_at = NOW()
         WHERE workspace_id = $1
           AND document_type = 'person'
           AND properties->>'invite_id' = $2`,
        [invite.workspace_id, invite.id]
      );

      // Transfer invite_id to existing doc for history tracking
      await pool.query(
        `UPDATE documents
         SET properties = properties || $1::jsonb
         WHERE id = $2`,
        [JSON.stringify({ invite_id: invite.id }), existingPersonDoc.rows[0].id]
      );
    } else {
      // Update the pending person document created at invite time
      // Set user_id, remove pending flag, update title to user's chosen name
      // Note: parentheses required due to operator precedence (- binds tighter than ||)
      await pool.query(
        `UPDATE documents
         SET title = $1,
             properties = (properties || $2::jsonb) - 'pending'
         WHERE workspace_id = $3
           AND document_type = 'person'
           AND properties->>'invite_id' = $4`,
        [user.name, JSON.stringify({ user_id: user.id }), invite.workspace_id, invite.id]
      );
    }

    // Mark invite as used
    await pool.query(
      'UPDATE workspace_invites SET used_at = NOW() WHERE id = $1',
      [invite.id]
    );

    // Defensive cleanup: Archive any other orphaned pending person docs for this email
    // This handles edge cases where previous invites were cancelled but cleanup failed
    await pool.query(
      `UPDATE documents SET archived_at = NOW()
       WHERE workspace_id = $1
         AND document_type = 'person'
         AND properties->>'pending' = 'true'
         AND archived_at IS NULL
         AND LOWER(properties->>'email') = LOWER($2)`,
      [invite.workspace_id, invite.email]
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
