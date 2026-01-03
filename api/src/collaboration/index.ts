import { WebSocketServer, WebSocket } from 'ws';
import { Server, IncomingMessage } from 'http';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { pool } from '../db/client.js';
import { SESSION_TIMEOUT_MS, ABSOLUTE_SESSION_TIMEOUT_MS } from '@ship/shared';
import cookie from 'cookie';

const messageSync = 0;
const messageAwareness = 1;

// Store documents and awareness by room name
const docs = new Map<string, Y.Doc>();
const awareness = new Map<string, awarenessProtocol.Awareness>();
const conns = new Map<WebSocket, { docName: string; awarenessClientId: number }>();

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
    // Only persist yjs_state - content column is only used for seed data fallback
    // XmlFragment.toJSON() returns XML-like strings, not TipTap JSON, so we don't update content
    await pool.query(
      `UPDATE documents SET yjs_state = $1, updated_at = now() WHERE id = $2`,
      [Buffer.from(state), docId]
    );
  } catch (err) {
    console.error('Failed to persist document:', err);
  }
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

  // Set up persistence on changes
  doc.on('update', () => {
    schedulePersist(docName, doc!);
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
      const syncMessageType = syncProtocol.readSyncMessage(decoder, encoder, doc, null);

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

export function setupCollaboration(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', async (request, socket, head) => {
    const url = new URL(request.url || '', `http://${request.headers.host}`);

    // Only handle /collaboration/* paths
    if (!url.pathname.startsWith('/collaboration/')) {
      socket.destroy();
      return;
    }

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

  wss.on('connection', async (ws: WebSocket, _request: IncomingMessage, docName: string, _sessionData: { userId: string; workspaceId: string }) => {
    const doc = await getOrCreateDoc(docName);
    const aw = getAwareness(docName, doc);

    // Track this connection
    const clientId = doc.clientID;
    conns.set(ws, { docName, awarenessClientId: clientId });

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
      handleMessage(ws, new Uint8Array(data), docName, doc, aw);
    });

    ws.on('close', () => {
      const conn = conns.get(ws);
      if (conn) {
        awarenessProtocol.removeAwarenessStates(aw, [conn.awarenessClientId], null);
        conns.delete(ws);
      }

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
