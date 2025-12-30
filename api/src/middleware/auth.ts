import { Request, Response, NextFunction } from 'express';
import { pool } from '../db/client.js';
import { SESSION_TIMEOUT_MS, ERROR_CODES, HTTP_STATUS } from '@ship/shared';

// Extend Express Request to include session info
declare global {
  namespace Express {
    interface Request {
      sessionId?: string;
      userId?: string;
      workspaceId?: string;
    }
  }
}

export async function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const sessionId = req.cookies?.session_id;

  if (!sessionId) {
    res.status(HTTP_STATUS.UNAUTHORIZED).json({
      success: false,
      error: {
        code: ERROR_CODES.UNAUTHORIZED,
        message: 'No session found',
      },
    });
    return;
  }

  try {
    // Get session and check if it's valid
    const result = await pool.query(
      `SELECT s.id, s.user_id, s.workspace_id, s.expires_at, s.last_activity
       FROM sessions s
       WHERE s.id = $1`,
      [sessionId]
    );

    const session = result.rows[0];

    if (!session) {
      res.status(HTTP_STATUS.UNAUTHORIZED).json({
        success: false,
        error: {
          code: ERROR_CODES.UNAUTHORIZED,
          message: 'Invalid session',
        },
      });
      return;
    }

    const now = new Date();
    const lastActivity = new Date(session.last_activity);
    const inactivityMs = now.getTime() - lastActivity.getTime();

    // Check 15-minute inactivity timeout
    if (inactivityMs > SESSION_TIMEOUT_MS) {
      // Delete expired session
      await pool.query('DELETE FROM sessions WHERE id = $1', [sessionId]);

      res.status(HTTP_STATUS.UNAUTHORIZED).json({
        success: false,
        error: {
          code: ERROR_CODES.SESSION_EXPIRED,
          message: 'Session expired due to inactivity',
        },
      });
      return;
    }

    // Update last activity
    await pool.query(
      'UPDATE sessions SET last_activity = $1 WHERE id = $2',
      [now, sessionId]
    );

    // Attach session info to request
    req.sessionId = session.id;
    req.userId = session.user_id;
    req.workspaceId = session.workspace_id;

    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Authentication failed',
      },
    });
  }
}
