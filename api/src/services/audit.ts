import { Request } from 'express';
import { IncomingMessage } from 'http';
import { pool, type PoolClient } from '../db/client.js';
import {
  CloudWatchLogsClient,
  CreateLogStreamCommand,
  PutLogEventsCommand,
  ResourceAlreadyExistsException,
} from '@aws-sdk/client-cloudwatch-logs';
import * as os from 'os';

// CloudWatch Logs client (initialized lazily)
let cloudWatchClient: CloudWatchLogsClient | null = null;
let cloudWatchLogGroup: string | null = null;
let cloudWatchLogStream: string | null = null;
let cloudWatchWarningLogged = false;
let cloudWatchInitialized = false;
let cloudWatchLastError: Error | null = null;

/**
 * Initialize CloudWatch client and create log stream.
 * Safe to call multiple times - will only initialize once.
 */
async function initCloudWatch(): Promise<boolean> {
  if (cloudWatchInitialized) {
    return cloudWatchClient !== null;
  }

  cloudWatchLogGroup = process.env.CLOUDWATCH_AUDIT_LOG_GROUP || null;

  if (!cloudWatchLogGroup) {
    if (!cloudWatchWarningLogged) {
      console.warn('CloudWatch audit logging disabled: CLOUDWATCH_AUDIT_LOG_GROUP not set');
      cloudWatchWarningLogged = true;
    }
    cloudWatchInitialized = true;
    return false;
  }

  try {
    cloudWatchClient = new CloudWatchLogsClient({
      region: process.env.AWS_REGION || 'us-east-1',
    });

    // Create log stream with date and instance ID for uniqueness
    const date = new Date().toISOString().split('T')[0];
    const instanceId = process.env.EC2_INSTANCE_ID || os.hostname() || 'local';
    cloudWatchLogStream = `audit-${date}-${instanceId}`;

    // Create log stream (idempotent - will succeed if already exists)
    try {
      await cloudWatchClient.send(new CreateLogStreamCommand({
        logGroupName: cloudWatchLogGroup,
        logStreamName: cloudWatchLogStream,
      }));
    } catch (error) {
      // ResourceAlreadyExistsException is fine - stream already exists
      if (!(error instanceof ResourceAlreadyExistsException)) {
        throw error;
      }
    }

    cloudWatchInitialized = true;
    cloudWatchLastError = null;
    return true;
  } catch (error) {
    console.error('Failed to initialize CloudWatch audit logging:', error);
    cloudWatchLastError = error instanceof Error ? error : new Error(String(error));
    cloudWatchInitialized = true;
    cloudWatchClient = null;
    return false;
  }
}

/**
 * Get CloudWatch audit status for health check.
 */
export async function getCloudWatchAuditStatus(): Promise<{
  status: 'ok' | 'disabled' | 'error';
  error?: string;
}> {
  const logGroup = process.env.CLOUDWATCH_AUDIT_LOG_GROUP;

  if (!logGroup) {
    return { status: 'disabled' };
  }

  if (!cloudWatchInitialized) {
    const initialized = await initCloudWatch();
    if (!initialized && cloudWatchLastError) {
      return { status: 'error', error: cloudWatchLastError.message };
    }
  }

  if (cloudWatchLastError) {
    return { status: 'error', error: cloudWatchLastError.message };
  }

  if (cloudWatchClient) {
    return { status: 'ok' };
  }

  return { status: 'disabled' };
}

/**
 * Ship audit event to CloudWatch Logs.
 * Returns true if successful, false otherwise.
 */
async function shipToCloudWatch(event: {
  id: string;
  created_at: string;
  actor_user_id: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  workspace_id: string | null;
  ip_address: string | null;
  user_agent: string | null;
  details: Record<string, unknown> | null;
  record_hash: string | null;
}): Promise<boolean> {
  if (!cloudWatchInitialized) {
    await initCloudWatch();
  }

  if (!cloudWatchClient || !cloudWatchLogGroup || !cloudWatchLogStream) {
    return false; // CloudWatch not configured or failed to initialize
  }

  try {
    await cloudWatchClient.send(new PutLogEventsCommand({
      logGroupName: cloudWatchLogGroup,
      logStreamName: cloudWatchLogStream,
      logEvents: [{
        timestamp: new Date(event.created_at).getTime(),
        message: JSON.stringify(event),
      }],
    }));
    cloudWatchLastError = null;
    return true;
  } catch (error) {
    cloudWatchLastError = error instanceof Error ? error : new Error(String(error));
    console.error('Failed to ship audit event to CloudWatch:', error);
    return false;
  }
}

interface AuditEventInput {
  workspaceId?: string | null;
  /** User ID of the actor. Optional for failed login attempts where user is unknown. */
  actorUserId?: string | null;
  impersonatingUserId?: string | null;
  action: string;
  resourceType?: string;
  resourceId?: string;
  details?: Record<string, unknown>;
  req?: Request;
  /** For WebSocket requests where Express req is not available */
  ipAddress?: string | null;
  userAgent?: string | null;
  /**
   * When true, audit log failure will throw an error instead of being silently logged.
   * Use for critical events (document mutations, auth) that must have an audit trail.
   */
  critical?: boolean;
  /**
   * Database client for transaction support.
   * When provided, the audit log will be inserted using this client,
   * allowing it to be part of a larger transaction.
   */
  client?: PoolClient;
}

export async function logAuditEvent(input: AuditEventInput): Promise<void> {
  const {
    workspaceId,
    actorUserId,
    impersonatingUserId,
    action,
    resourceType,
    resourceId,
    details,
    req,
    ipAddress: providedIp,
    userAgent: providedUserAgent,
    critical = false,
    client,
  } = input;

  const ipAddress = providedIp ?? req?.ip ?? req?.socket?.remoteAddress ?? null;
  const userAgent = providedUserAgent ?? req?.get('user-agent') ?? null;

  // Use provided client (for transactions) or pool
  const queryClient = client ?? pool;

  try {
    // Insert into PostgreSQL and get the record back (including hash)
    const result = await queryClient.query(
      `INSERT INTO audit_logs (workspace_id, actor_user_id, impersonating_user_id, action, resource_type, resource_id, details, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, created_at, record_hash`,
      [workspaceId || null, actorUserId || null, impersonatingUserId || null, action, resourceType || null, resourceId || null, details ? JSON.stringify(details) : null, ipAddress, userAgent]
    );

    const record = result.rows[0];

    // Ship to CloudWatch (for critical events, failure throws)
    if (process.env.CLOUDWATCH_AUDIT_LOG_GROUP) {
      const cloudWatchSuccess = await shipToCloudWatch({
        id: record.id,
        created_at: record.created_at.toISOString(),
        actor_user_id: actorUserId || null,
        action,
        resource_type: resourceType || null,
        resource_id: resourceId || null,
        workspace_id: workspaceId || null,
        ip_address: ipAddress,
        user_agent: userAgent,
        details: details || null,
        record_hash: record.record_hash,
      });

      if (!cloudWatchSuccess && critical) {
        // For critical events, CloudWatch failure should cause rollback
        throw new Error('Failed to ship critical audit event to CloudWatch');
      }
    }
  } catch (error) {
    if (critical) {
      // For critical events, propagate the error to fail the request
      throw error;
    }
    // For non-critical events, log but don't fail the request
    console.error('Failed to log audit event:', error);
  }
}

/**
 * Check if a similar audit event was logged recently (for deduplication).
 * Returns true if a matching event was found within the specified window.
 */
async function wasRecentlyLogged(
  actorUserId: string,
  resourceId: string,
  action: string,
  windowSeconds: number = 60
): Promise<boolean> {
  try {
    const result = await pool.query(
      `SELECT 1 FROM audit_logs
       WHERE actor_user_id = $1
         AND resource_id = $2
         AND action = $3
         AND created_at > NOW() - INTERVAL '${windowSeconds} seconds'
       LIMIT 1`,
      [actorUserId, resourceId, action]
    );
    return result.rows.length > 0;
  } catch (error) {
    console.error('Failed to check recent audit logs:', error);
    return false; // On error, allow logging to proceed
  }
}

interface DocumentViewInput {
  workspaceId: string;
  actorUserId: string;
  documentId: string;
  documentType: string;
  accessMethod: 'websocket' | 'api';
  req?: Request;
  /** For WebSocket requests */
  wsRequest?: IncomingMessage;
}

/**
 * Log a document view event with deduplication.
 * Skips logging if the same user viewed the same document within the last 60 seconds.
 */
interface DocumentViewDeniedInput {
  workspaceId: string;
  actorUserId: string;
  documentId: string;
  reason: 'not_found' | 'private' | 'wrong_workspace';
  req?: Request;
  /** For WebSocket requests */
  wsRequest?: IncomingMessage;
}

/**
 * Log a document access denial event.
 * No deduplication - every denial should be logged.
 */
export async function logDocumentViewDenied(input: DocumentViewDeniedInput): Promise<void> {
  const { workspaceId, actorUserId, documentId, reason, req, wsRequest } = input;

  // Extract IP and user agent from WebSocket request if available
  let ipAddress: string | null = null;
  let userAgent: string | null = null;

  if (wsRequest) {
    const forwarded = wsRequest.headers['x-forwarded-for'];
    if (forwarded) {
      const firstIp = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0];
      ipAddress = firstIp?.trim() ?? null;
    } else {
      ipAddress = wsRequest.socket?.remoteAddress ?? null;
    }
    const ua = wsRequest.headers['user-agent'];
    userAgent = ua !== undefined ? ua : null;
  }

  await logAuditEvent({
    workspaceId,
    actorUserId,
    action: 'document.view_denied',
    resourceType: 'document',
    resourceId: documentId,
    details: { reason },
    req,
    ipAddress,
    userAgent,
  });
}

interface DocumentCreateInput {
  workspaceId: string;
  actorUserId: string;
  documentId: string;
  documentType: string;
  title: string;
  req?: Request;
  /** When true, audit log failure will throw an error */
  critical?: boolean;
  /** Database client for transaction support */
  client?: PoolClient;
}

/**
 * Log a document creation event.
 */
export async function logDocumentCreate(input: DocumentCreateInput): Promise<void> {
  const { workspaceId, actorUserId, documentId, documentType, title, req, critical, client } = input;

  await logAuditEvent({
    workspaceId,
    actorUserId,
    action: 'document.create',
    resourceType: 'document',
    resourceId: documentId,
    details: {
      document_type: documentType,
      title,
    },
    req,
    critical,
    client,
  });
}

interface DocumentUpdateInput {
  workspaceId: string;
  actorUserId: string;
  documentId: string;
  changedFields: string[];
  changes: Record<string, { old: unknown; new: unknown }>;
  req?: Request;
  /** When true, audit log failure will throw an error */
  critical?: boolean;
  /** Database client for transaction support */
  client?: PoolClient;
}

/**
 * Log a document update event.
 * Only logs if fields actually changed.
 */
export async function logDocumentUpdate(input: DocumentUpdateInput): Promise<void> {
  const { workspaceId, actorUserId, documentId, changedFields, changes, req, critical, client } = input;

  // Skip logging if no fields actually changed
  if (changedFields.length === 0) {
    return;
  }

  await logAuditEvent({
    workspaceId,
    actorUserId,
    action: 'document.update',
    resourceType: 'document',
    resourceId: documentId,
    details: {
      changed_fields: changedFields,
      changes,
    },
    req,
    critical,
    client,
  });
}

interface DocumentDeleteInput {
  workspaceId: string;
  actorUserId: string;
  documentId: string;
  documentType: string;
  title: string;
  properties: Record<string, unknown>;
  req?: Request;
  /** When true, audit log failure will throw an error */
  critical?: boolean;
  /** Database client for transaction support */
  client?: PoolClient;
}

/**
 * Log a document deletion event with a snapshot of the deleted document.
 */
export async function logDocumentDelete(input: DocumentDeleteInput): Promise<void> {
  const { workspaceId, actorUserId, documentId, documentType, title, properties, req, critical, client } = input;

  await logAuditEvent({
    workspaceId,
    actorUserId,
    action: 'document.delete',
    resourceType: 'document',
    resourceId: documentId,
    details: {
      document_type: documentType,
      title,
      properties,
    },
    req,
    critical,
    client,
  });
}

interface DocumentContentSaveInput {
  workspaceId: string;
  actorUserId: string;
  documentId: string;
  contentLength: number;
}

/**
 * Log a document content save event from collaboration.
 * Only logs content length, NOT the actual content.
 */
export async function logDocumentContentSave(input: DocumentContentSaveInput): Promise<void> {
  const { workspaceId, actorUserId, documentId, contentLength } = input;

  await logAuditEvent({
    workspaceId,
    actorUserId,
    action: 'document.content_save',
    resourceType: 'document',
    resourceId: documentId,
    details: {
      content_length: contentLength,
    },
  });
}

export async function logDocumentView(input: DocumentViewInput): Promise<void> {
  const { workspaceId, actorUserId, documentId, documentType, accessMethod, req, wsRequest } = input;

  // Check for deduplication
  const wasRecent = await wasRecentlyLogged(actorUserId, documentId, 'document.view');
  if (wasRecent) {
    return; // Skip duplicate logging
  }

  // Extract IP and user agent from WebSocket request if available
  let ipAddress: string | null = null;
  let userAgent: string | null = null;

  if (wsRequest) {
    // For WebSocket: check X-Forwarded-For first (for proxy), then fall back to socket address
    const forwarded = wsRequest.headers['x-forwarded-for'];
    if (forwarded) {
      const firstIp = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0];
      ipAddress = firstIp?.trim() ?? null;
    } else {
      ipAddress = wsRequest.socket?.remoteAddress ?? null;
    }
    const ua = wsRequest.headers['user-agent'];
    userAgent = ua !== undefined ? ua : null;
  }

  await logAuditEvent({
    workspaceId,
    actorUserId,
    action: 'document.view',
    resourceType: 'document',
    resourceId: documentId,
    details: {
      document_type: documentType,
      access_method: accessMethod,
    },
    req,
    ipAddress,
    userAgent,
  });
}
