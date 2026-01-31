import { Router, Request, Response } from 'express';
import type { Router as RouterType } from 'express';
import { pool } from '../db/client.js';
import { authMiddleware } from '../middleware/auth.js';
import { ERROR_CODES, HTTP_STATUS } from '@ship/shared';

const router: RouterType = Router();

/**
 * Middleware to verify super-admin status.
 * Only super-admins can access cross-workspace audit logs.
 */
async function superAdminMiddleware(req: Request, res: Response, next: () => void): Promise<void> {
  try {
    const result = await pool.query(
      'SELECT is_super_admin FROM users WHERE id = $1',
      [req.userId]
    );

    if (!result.rows[0]?.is_super_admin) {
      res.status(HTTP_STATUS.FORBIDDEN).json({
        success: false,
        error: {
          code: ERROR_CODES.FORBIDDEN,
          message: 'Super-admin access required',
        },
      });
      return;
    }

    next();
  } catch (error) {
    console.error('Super-admin check error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Authorization check failed',
      },
    });
  }
}

// GET /api/audit-logs - Cross-workspace audit logs (super-admin only)
// Supports filtering by: action, resource_type, resource_id, actor_user_id, workspace_id, start_date, end_date
router.get('/', authMiddleware, superAdminMiddleware, async (req: Request, res: Response): Promise<void> => {
  const {
    limit: rawLimit = '100',
    offset: rawOffset = '0',
    action,
    resource_type,
    resource_id,
    actor_user_id,
    workspace_id,
    start_date,
    end_date,
  } = req.query;

  // Parse and enforce limits
  const limit = Math.min(Math.max(1, parseInt(rawLimit as string) || 100), 1000);
  const offset = Math.max(0, parseInt(rawOffset as string) || 0);

  try {
    // Build dynamic WHERE clause with parameterized queries
    const conditions: string[] = [];
    const params: (string | number)[] = [];
    let paramIndex = 1;

    if (action) {
      conditions.push(`al.action = $${paramIndex++}`);
      params.push(action as string);
    }
    if (resource_type) {
      conditions.push(`al.resource_type = $${paramIndex++}`);
      params.push(resource_type as string);
    }
    if (resource_id) {
      conditions.push(`al.resource_id = $${paramIndex++}`);
      params.push(resource_id as string);
    }
    if (actor_user_id) {
      conditions.push(`al.actor_user_id = $${paramIndex++}`);
      params.push(actor_user_id as string);
    }
    if (workspace_id) {
      conditions.push(`al.workspace_id = $${paramIndex++}`);
      params.push(workspace_id as string);
    }
    if (start_date) {
      conditions.push(`al.created_at >= $${paramIndex++}`);
      params.push(start_date as string);
    }
    if (end_date) {
      conditions.push(`al.created_at <= $${paramIndex++}`);
      params.push(end_date as string);
    }

    // Add pagination params
    params.push(limit, offset);

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await pool.query(
      `SELECT al.id, al.action, al.resource_type, al.resource_id, al.details,
              al.ip_address, al.user_agent, al.created_at, al.record_hash,
              al.workspace_id,
              u.email as actor_email, u.name as actor_name,
              iu.email as impersonating_email,
              w.name as workspace_name
       FROM audit_logs al
       LEFT JOIN users u ON al.actor_user_id = u.id
       LEFT JOIN users iu ON al.impersonating_user_id = iu.id
       LEFT JOIN workspaces w ON al.workspace_id = w.id
       ${whereClause}
       ORDER BY al.created_at DESC
       LIMIT $${paramIndex++} OFFSET $${paramIndex}`,
      params
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
      recordHash: row.record_hash,
      workspaceId: row.workspace_id,
      workspaceName: row.workspace_name,
      actorEmail: row.actor_email,
      actorName: row.actor_name,
      impersonatingEmail: row.impersonating_email,
    }));

    res.json({
      success: true,
      data: { logs },
    });
  } catch (error) {
    console.error('Get cross-workspace audit logs error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to get audit logs',
      },
    });
  }
});

// POST /api/audit-logs/verify - Verify audit chain integrity (super-admin only)
// Body: { workspace_id?: string, limit?: number }
// Response: { valid: boolean, records_checked: number, invalid_records?: [{id, error_message}] }
router.post('/verify', authMiddleware, superAdminMiddleware, async (req: Request, res: Response): Promise<void> => {
  const { workspace_id, limit: rawLimit = 10000 } = req.body;

  // Parse and enforce limit (default 10000 to avoid 30s timeout)
  const limit = Math.min(Math.max(1, parseInt(rawLimit) || 10000), 100000);

  try {
    // Call the verify_audit_chain PostgreSQL function
    const result = await pool.query(
      `SELECT * FROM verify_audit_chain($1, $2)`,
      [workspace_id || null, limit]
    );

    // Parse results
    const invalidRecords = result.rows.filter(row => !row.is_valid);
    const valid = invalidRecords.length === 0;

    // Count records actually checked (the function returns rows for invalid records only)
    // To get actual count, we need to query the total checked
    const countResult = await pool.query(
      `SELECT COUNT(*) as count
       FROM audit_logs
       WHERE ($1::uuid IS NULL OR workspace_id = $1)
       LIMIT $2`,
      [workspace_id || null, limit]
    );
    const recordsChecked = parseInt(countResult.rows[0].count);

    res.json({
      success: true,
      data: {
        valid,
        records_checked: recordsChecked,
        ...(invalidRecords.length > 0 && {
          invalid_records: invalidRecords.map(row => ({
            id: row.id,
            error_message: row.error_message,
          })),
        }),
      },
    });
  } catch (error) {
    console.error('Verify audit chain error:', error);
    res.status(HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
      success: false,
      error: {
        code: ERROR_CODES.INTERNAL_ERROR,
        message: 'Failed to verify audit chain',
      },
    });
  }
});

export default router;
