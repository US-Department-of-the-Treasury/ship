import { WebSocketServer, WebSocket } from 'ws';
import { Server, IncomingMessage } from 'http';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { pool } from '../db/client.js';
import { extractHypothesisFromContent, extractSuccessCriteriaFromContent } from '../utils/extractHypothesis.js';
import { SESSION_TIMEOUT_MS, ABSOLUTE_SESSION_TIMEOUT_MS } from '@ship/shared';
import cookie from 'cookie';

const messageSync = 0;
const messageAwareness = 1;

// Rate limiting configuration
const RATE_LIMIT = {
  // Connection rate limiting: max connections per IP in time window
  CONNECTION_WINDOW_MS: 60_000,  // 1 minute window
  MAX_CONNECTIONS_PER_IP: 30,    // 30 connections per minute per IP
  // Message rate limiting: max messages per connection in time window
  MESSAGE_WINDOW_MS: 1_000,      // 1 second window
  MAX_MESSAGES_PER_SECOND: 50,   // 50 messages per second per connection
};

// Track connection attempts per IP (sliding window)
const connectionAttempts = new Map<string, number[]>();

// Track message timestamps per WebSocket connection
const messageTimestamps = new Map<WebSocket, number[]>();

// Clean up old connection attempts periodically
setInterval(() => {
  const now = Date.now();
  connectionAttempts.forEach((timestamps, ip) => {
    const valid = timestamps.filter(t => now - t < RATE_LIMIT.CONNECTION_WINDOW_MS);
    if (valid.length === 0) {
      connectionAttempts.delete(ip);
    } else {
      connectionAttempts.set(ip, valid);
    }
  });
}, 30_000);

// Check if IP is rate limited for new connections
function isConnectionRateLimited(ip: string): boolean {
  const now = Date.now();
  const attempts = connectionAttempts.get(ip) || [];
  const recentAttempts = attempts.filter(t => now - t < RATE_LIMIT.CONNECTION_WINDOW_MS);
  return recentAttempts.length >= RATE_LIMIT.MAX_CONNECTIONS_PER_IP;
}

// Record a connection attempt from an IP
function recordConnectionAttempt(ip: string): void {
  const now = Date.now();
  const attempts = connectionAttempts.get(ip) || [];
  attempts.push(now);
  // Keep only recent attempts to limit memory usage
  const recentAttempts = attempts.filter(t => now - t < RATE_LIMIT.CONNECTION_WINDOW_MS);
  connectionAttempts.set(ip, recentAttempts);
}

// Check if a WebSocket connection is rate limited for messages
function isMessageRateLimited(ws: WebSocket): boolean {
  const now = Date.now();
  const timestamps = messageTimestamps.get(ws) || [];
  const recentMessages = timestamps.filter(t => now - t < RATE_LIMIT.MESSAGE_WINDOW_MS);
  return recentMessages.length >= RATE_LIMIT.MAX_MESSAGES_PER_SECOND;
}

// Record a message from a WebSocket connection
function recordMessage(ws: WebSocket): void {
  const now = Date.now();
  const timestamps = messageTimestamps.get(ws) || [];
  timestamps.push(now);
  // Keep only recent timestamps to limit memory usage
  const recentTimestamps = timestamps.filter(t => now - t < RATE_LIMIT.MESSAGE_WINDOW_MS);
  messageTimestamps.set(ws, recentTimestamps);
}

// Store documents and awareness by room name
const docs = new Map<string, Y.Doc>();
const awareness = new Map<string, awarenessProtocol.Awareness>();
const conns = new Map<WebSocket, { docName: string; awarenessClientId: number; userId: string; workspaceId: string }>();

// Debounce persistence (save every 2 seconds after changes)
const pendingSaves = new Map<string, NodeJS.Timeout>();

// Extract document ID from room name (format: "type:uuid")
// All document types (doc, issue, program, sprint) map to the unified documents table
function parseDocId(docName: string): string {
  const parts = docName.split(':');
  return parts.length > 1 ? parts[1]! : parts[0]!;
}

async function persistDocument(docName: string, doc: Y.Doc) {
  const state = Y.encodeStateAsUpdate(doc);
  const docId = parseDocId(docName);

  try {
    // Convert Yjs to TipTap JSON to extract hypothesis/criteria
    const fragment = doc.getXmlFragment('default');
    const content = yjsToJson(fragment);

    // Extract hypothesis and success criteria from content
    const hypothesis = extractHypothesisFromContent(content);
    const successCriteria = extractSuccessCriteriaFromContent(content);

    // Get existing properties to merge
    const existingResult = await pool.query(
      'SELECT properties FROM documents WHERE id = $1',
      [docId]
    );
    const existingProps = existingResult.rows[0]?.properties || {};

    // Update properties with extracted values (null clears the property)
    const updatedProps = {
      ...existingProps,
      hypothesis: hypothesis,
      success_criteria: successCriteria,
    };

    // Persist yjs_state and updated properties
    await pool.query(
      `UPDATE documents SET yjs_state = $1, properties = $2, updated_at = now() WHERE id = $3`,
      [Buffer.from(state), JSON.stringify(updatedProps), docId]
    );
  } catch (err) {
    console.error('Failed to persist document:', err);
  }
}

// Convert Yjs XmlFragment to TipTap JSON
// This is the reverse of jsonToYjs
function yjsToJson(fragment: Y.XmlFragment): any {
  const content: any[] = [];

  for (let i = 0; i < fragment.length; i++) {
    const item = fragment.get(i);
    if (item instanceof Y.XmlText) {
      // Handle text nodes with formatting
      const text = item.toString();
      if (text) {
        content.push({ type: 'text', text });
      }
    } else if (item instanceof Y.XmlElement) {
      // Handle element nodes
      const node: any = { type: item.nodeName };

      // Get attributes
      const attrs = item.getAttributes();
      if (Object.keys(attrs).length > 0) {
        // Convert string attributes to proper types (e.g., level should be number)
        const typedAttrs: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(attrs)) {
          if (key === 'level' && typeof value === 'string') {
            typedAttrs[key] = parseInt(value, 10);
          } else {
            typedAttrs[key] = value;
          }
        }
        node.attrs = typedAttrs;
      }

      // Recursively convert children
      if (item.length > 0) {
        const childContent = yjsElementToJson(item);
        if (childContent.length > 0) {
          node.content = childContent;
        }
      }

      content.push(node);
    }
  }

  return { type: 'doc', content };
}

// Helper to convert element children
function yjsElementToJson(element: Y.XmlElement): any[] {
  const content: any[] = [];

  for (let i = 0; i < element.length; i++) {
    const item = element.get(i);
    if (item instanceof Y.XmlText) {
      const text = item.toString();
      if (text) {
        content.push({ type: 'text', text });
      }
    } else if (item instanceof Y.XmlElement) {
      const node: any = { type: item.nodeName };

      const attrs = item.getAttributes();
      if (Object.keys(attrs).length > 0) {
        const typedAttrs: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(attrs)) {
          if (key === 'level' && typeof value === 'string') {
            typedAttrs[key] = parseInt(value, 10);
          } else {
            typedAttrs[key] = value;
          }
        }
        node.attrs = typedAttrs;
      }

      if (item.length > 0) {
        const childContent = yjsElementToJson(item);
        if (childContent.length > 0) {
          node.content = childContent;
        }
      }

      content.push(node);
    }
  }

  return content;
}

// Convert TipTap JSON content to Yjs XmlFragment
// Must be called within a transaction for proper Yjs integration
function jsonToYjs(doc: Y.Doc, fragment: Y.XmlFragment, content: any) {
  if (!content || !Array.isArray(content.content)) return;

  doc.transact(() => {
    for (const node of content.content) {
      if (node.type === 'text') {
        // Text node - create, push to parent first, then modify
        const text = new Y.XmlText();
        fragment.push([text]);
        text.insert(0, node.text || '');
        if (node.marks) {
          const attrs: Record<string, any> = {};
          for (const mark of node.marks) {
            attrs[mark.type] = mark.attrs || true;
          }
          text.format(0, text.length, attrs);
        }
      } else {
        // Element node (paragraph, heading, bulletList, listItem, etc.)
        const element = new Y.XmlElement(node.type);
        fragment.push([element]);
        // Set attributes after adding to parent
        if (node.attrs) {
          for (const [key, value] of Object.entries(node.attrs)) {
            element.setAttribute(key, value as string);
          }
        }
        // Recursively add children
        if (node.content) {
          jsonToYjsChildren(doc, element, node.content);
        }
      }
    }
  });
}

// Helper to add children without wrapping in another transaction
function jsonToYjsChildren(doc: Y.Doc, parent: Y.XmlElement, children: any[]) {
  for (const node of children) {
    if (node.type === 'text') {
      const text = new Y.XmlText();
      parent.push([text]);
      text.insert(0, node.text || '');
      if (node.marks) {
        const attrs: Record<string, any> = {};
        for (const mark of node.marks) {
          attrs[mark.type] = mark.attrs || true;
        }
        text.format(0, text.length, attrs);
      }
    } else {
      const element = new Y.XmlElement(node.type);
      parent.push([element]);
      if (node.attrs) {
        for (const [key, value] of Object.entries(node.attrs)) {
          element.setAttribute(key, value as string);
        }
      }
      if (node.content) {
        jsonToYjsChildren(doc, element, node.content);
      }
    }
  }
}

function schedulePersist(docName: string, doc: Y.Doc) {
  const existing = pendingSaves.get(docName);
  if (existing) clearTimeout(existing);

  pendingSaves.set(docName, setTimeout(() => {
    persistDocument(docName, doc);
    pendingSaves.delete(docName);
  }, 2000));
}

async function getOrCreateDoc(docName: string): Promise<Y.Doc> {
  let doc = docs.get(docName);
  if (doc) return doc;

  doc = new Y.Doc();
  docs.set(docName, doc);

  // Load existing state from database (all document types use the unified documents table)
  const docId = parseDocId(docName);

  try {
    const result = await pool.query(
      'SELECT yjs_state, content FROM documents WHERE id = $1',
      [docId]
    );

    if (result.rows[0]?.yjs_state) {
      // Load from binary Yjs state
      Y.applyUpdate(doc, result.rows[0].yjs_state);
    } else if (result.rows[0]?.content) {
      // Fallback: convert JSON content to Yjs (for seeded documents)
      try {
        let jsonContent = result.rows[0].content;

        // Parse if it's a string (might be JSON string or XML-like from old toJSON)
        if (typeof jsonContent === 'string') {
          // Skip if it looks like XML from XmlFragment.toJSON() (starts with <)
          if (jsonContent.trim().startsWith('<')) {
            console.log('Skipping XML-like content, starting with empty document');
            jsonContent = null;
          } else {
            jsonContent = JSON.parse(jsonContent);
          }
        }

        if (jsonContent && jsonContent.type === 'doc' && Array.isArray(jsonContent.content)) {
          const fragment = doc.getXmlFragment('default');
          jsonToYjs(doc, fragment, jsonContent);
          // Persist the converted state so this only happens once
          schedulePersist(docName, doc);
        }
      } catch (parseErr) {
        console.error('Failed to parse JSON content:', parseErr);
        // Start with empty document if content is corrupted
      }
    }
  } catch (err) {
    console.error('Failed to load document:', err);
  }

  // Set up persistence and broadcast on changes
  doc.on('update', (update: Uint8Array, origin: any) => {
    schedulePersist(docName, doc!);

    // Broadcast update to all other clients in this room (except sender)
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeUpdate(encoder, update);
    const message = encoding.toUint8Array(encoder);

    conns.forEach((conn, ws) => {
      if (conn.docName === docName && ws !== origin && ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    });
  });

  return doc;
}

function getAwareness(docName: string, doc: Y.Doc): awarenessProtocol.Awareness {
  let aw = awareness.get(docName);
  if (aw) return aw;

  aw = new awarenessProtocol.Awareness(doc);
  awareness.set(docName, aw);

  aw.on('update', ({ added, updated, removed }: { added: number[]; updated: number[]; removed: number[] }) => {
    const changedClients = added.concat(updated, removed);
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageAwareness);
    encoding.writeVarUint8Array(encoder, awarenessProtocol.encodeAwarenessUpdate(aw!, changedClients));
    const message = encoding.toUint8Array(encoder);

    // Broadcast to all connections in this room
    conns.forEach((conn, ws) => {
      if (conn.docName === docName && ws.readyState === WebSocket.OPEN) {
        ws.send(message);
      }
    });
  });

  return aw;
}

function handleMessage(ws: WebSocket, message: Uint8Array, docName: string, doc: Y.Doc, aw: awarenessProtocol.Awareness) {
  const decoder = decoding.createDecoder(message);
  const messageType = decoding.readVarUint(decoder);

  switch (messageType) {
    case messageSync: {
      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageSync);
      // Pass ws as origin so broadcast excludes the sender
      syncProtocol.readSyncMessage(decoder, encoder, doc, ws);

      if (encoding.length(encoder) > 1) {
        ws.send(encoding.toUint8Array(encoder));
      }
      break;
    }
    case messageAwareness: {
      awarenessProtocol.applyAwarenessUpdate(aw, decoding.readVarUint8Array(decoder), ws);
      break;
    }
  }
}

// Validate session from cookie header - returns userId/workspaceId or null
async function validateWebSocketSession(request: IncomingMessage): Promise<{ userId: string; workspaceId: string } | null> {
  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) return null;

  const cookies = cookie.parse(cookieHeader);
  const sessionId = cookies.session_id;
  if (!sessionId) return null;

  try {
    const result = await pool.query(
      `SELECT user_id, workspace_id, last_activity, created_at
       FROM sessions WHERE id = $1`,
      [sessionId]
    );

    const session = result.rows[0];
    if (!session) return null;

    const now = new Date();
    const lastActivity = new Date(session.last_activity);
    const createdAt = new Date(session.created_at);
    const inactivityMs = now.getTime() - lastActivity.getTime();
    const sessionAgeMs = now.getTime() - createdAt.getTime();

    // Check absolute timeout (12 hours)
    if (sessionAgeMs > ABSOLUTE_SESSION_TIMEOUT_MS) {
      await pool.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
      return null;
    }

    // Check inactivity timeout (15 minutes)
    if (inactivityMs > SESSION_TIMEOUT_MS) {
      await pool.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
      return null;
    }

    // Update last activity
    await pool.query(
      'UPDATE sessions SET last_activity = $1 WHERE id = $2',
      [now, sessionId]
    );

    return { userId: session.user_id, workspaceId: session.workspace_id };
  } catch {
    return null;
  }
}

// Check if user can access a document for collaboration (visibility check)
async function canAccessDocumentForCollab(
  docId: string,
  userId: string,
  workspaceId: string
): Promise<boolean> {
  try {
    const result = await pool.query(
      `SELECT d.id,
              (d.visibility = 'workspace' OR d.created_by = $2 OR
               (SELECT role FROM workspace_memberships WHERE workspace_id = $3 AND user_id = $2) = 'admin') as can_access
       FROM documents d
       WHERE d.id = $1 AND d.workspace_id = $3`,
      [docId, userId, workspaceId]
    );

    if (result.rows.length === 0) {
      return false;
    }

    return result.rows[0].can_access;
  } catch {
    return false;
  }
}

/**
 * Handle document visibility change.
 * When a document's visibility changes (especially to 'private'),
 * we need to disconnect any users who no longer have access.
 *
 * @param docId - The document ID that changed visibility
 * @param newVisibility - The new visibility value ('private' or 'workspace')
 * @param creatorId - The user ID of the document creator
 */
export async function handleVisibilityChange(
  docId: string,
  newVisibility: 'private' | 'workspace',
  creatorId: string
): Promise<void> {
  // Find all connections to this document (across all doc types)
  const connectionsToCheck: Array<{ ws: WebSocket; conn: { docName: string; awarenessClientId: number; userId: string; workspaceId: string } }> = [];

  conns.forEach((conn, ws) => {
    const connDocId = parseDocId(conn.docName);
    if (connDocId === docId) {
      connectionsToCheck.push({ ws, conn });
    }
  });

  if (connectionsToCheck.length === 0) {
    return; // No active connections to this document
  }

  console.log(`[Collaboration] Visibility change for doc ${docId} to '${newVisibility}', checking ${connectionsToCheck.length} connections`);

  // For private documents, only creator and admins can access
  // For workspace documents, all workspace members can access (no action needed)
  if (newVisibility === 'workspace') {
    return; // All workspace members can access, no need to disconnect anyone
  }

  // For private documents, check each connection
  for (const { ws, conn } of connectionsToCheck) {
    // Creator always has access
    if (conn.userId === creatorId) {
      continue;
    }

    // Check if user is admin
    const canAccess = await canAccessDocumentForCollab(docId, conn.userId, conn.workspaceId);

    if (!canAccess) {
      console.log(`[Collaboration] Disconnecting user ${conn.userId} from private doc ${docId}`);

      // Close with code 4403 (custom code for "access revoked")
      // Frontend should handle this code and show appropriate message
      ws.close(4403, 'Document access revoked');
    }
  }
}

export function setupCollaboration(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', async (request, socket, head) => {
    const url = new URL(request.url || '', `http://${request.headers.host}`);

    // Only handle /collaboration/* paths
    if (!url.pathname.startsWith('/collaboration/')) {
      socket.destroy();
      return;
    }

    // Rate limit check: prevent connection floods from single IP
    const clientIp = (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
                     request.socket.remoteAddress ||
                     'unknown';

    if (isConnectionRateLimited(clientIp)) {
      socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
      socket.destroy();
      return;
    }
    recordConnectionAttempt(clientIp);

    // CRITICAL: Validate session before allowing WebSocket connection
    const sessionData = await validateWebSocketSession(request);
    if (!sessionData) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    const docName = url.pathname.replace('/collaboration/', '');
    const docId = parseDocId(docName);

    // Check document access (visibility check)
    const canAccess = await canAccessDocumentForCollab(docId, sessionData.userId, sessionData.workspaceId);
    if (!canAccess) {
      socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request, docName, sessionData);
    });
  });

  wss.on('connection', async (ws: WebSocket, _request: IncomingMessage, docName: string, sessionData: { userId: string; workspaceId: string }) => {
    const doc = await getOrCreateDoc(docName);
    const aw = getAwareness(docName, doc);

    // Track this connection with user info for visibility change handling
    const clientId = doc.clientID;
    conns.set(ws, { docName, awarenessClientId: clientId, userId: sessionData.userId, workspaceId: sessionData.workspaceId });

    // Send sync step 1
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageSync);
    syncProtocol.writeSyncStep1(encoder, doc);
    ws.send(encoding.toUint8Array(encoder));

    // Send current awareness state
    const awarenessStates = aw.getStates();
    if (awarenessStates.size > 0) {
      const awarenessEncoder = encoding.createEncoder();
      encoding.writeVarUint(awarenessEncoder, messageAwareness);
      encoding.writeVarUint8Array(awarenessEncoder, awarenessProtocol.encodeAwarenessUpdate(aw, Array.from(awarenessStates.keys())));
      ws.send(encoding.toUint8Array(awarenessEncoder));
    }

    ws.on('message', (data: Buffer) => {
      // Rate limit messages to prevent message floods
      if (isMessageRateLimited(ws)) {
        // Drop message silently - client will retry via Yjs sync protocol
        return;
      }
      recordMessage(ws);

      handleMessage(ws, new Uint8Array(data), docName, doc, aw);
    });

    ws.on('close', () => {
      const conn = conns.get(ws);
      if (conn) {
        awarenessProtocol.removeAwarenessStates(aw, [conn.awarenessClientId], null);
        conns.delete(ws);
      }
      // Clean up rate limiting data for this connection
      messageTimestamps.delete(ws);

      // Clean up if no more connections to this doc
      let hasConnections = false;
      conns.forEach((c) => {
        if (c.docName === docName) hasConnections = true;
      });

      if (!hasConnections) {
        // Final persist before cleanup
        const pending = pendingSaves.get(docName);
        if (pending) {
          clearTimeout(pending);
          persistDocument(docName, doc);
          pendingSaves.delete(docName);
        }

        // Keep doc in memory for a bit in case of quick reconnect
        setTimeout(() => {
          let stillNoConnections = true;
          conns.forEach((c) => {
            if (c.docName === docName) stillNoConnections = false;
          });
          if (stillNoConnections) {
            docs.delete(docName);
            awareness.delete(docName);
          }
        }, 30000);
      }
    });
  });

  console.log('Yjs collaboration server attached');
}
