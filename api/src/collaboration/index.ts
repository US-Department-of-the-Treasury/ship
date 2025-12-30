import { WebSocketServer, WebSocket } from 'ws';
import { Server, IncomingMessage } from 'http';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { pool } from '../db/client.js';

const messageSync = 0;
const messageAwareness = 1;

// Store documents and awareness by room name
const docs = new Map<string, Y.Doc>();
const awareness = new Map<string, awarenessProtocol.Awareness>();
const conns = new Map<WebSocket, { docName: string; awarenessClientId: number }>();

// Debounce persistence (save every 2 seconds after changes)
const pendingSaves = new Map<string, NodeJS.Timeout>();

// Extract document ID from room name (format: "type:uuid")
// All document types (doc, issue, project, sprint) map to the unified documents table
function parseDocId(docName: string): string {
  const parts = docName.split(':');
  return parts.length > 1 ? parts[1]! : parts[0]!;
}

async function persistDocument(docName: string, doc: Y.Doc) {
  const state = Y.encodeStateAsUpdate(doc);
  const content = doc.getXmlFragment('default').toJSON();
  const docId = parseDocId(docName);

  try {
    await pool.query(
      `UPDATE documents SET yjs_state = $1, content = $2, updated_at = now() WHERE id = $3`,
      [Buffer.from(state), JSON.stringify(content), docId]
    );
  } catch (err) {
    console.error('Failed to persist document:', err);
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
      Y.applyUpdate(doc, result.rows[0].yjs_state);
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

export function setupCollaboration(server: Server) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url || '', `http://${request.headers.host}`);

    // Only handle /collaboration/* paths
    if (!url.pathname.startsWith('/collaboration/')) {
      socket.destroy();
      return;
    }

    const docName = url.pathname.replace('/collaboration/', '');

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request, docName);
    });
  });

  wss.on('connection', async (ws: WebSocket, _request: IncomingMessage, docName: string) => {
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
