import { WebSocketServer, WebSocket } from 'ws';
import { Server, IncomingMessage } from 'http';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { pool } from '../db/client.js';
import { extractHypothesisFromContent, extractSuccessCriteriaFromContent, extractVisionFromContent, extractGoalsFromContent } from '../utils/extractHypothesis.js';
import { SESSION_TIMEOUT_MS, ABSOLUTE_SESSION_TIMEOUT_MS } from '@ship/shared';
import cookie from 'cookie';

const messageSync = 0;
const messageAwareness = 1;
const messageCustomEvent = 2;

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

// DDoS protection: Track rate limit violations per connection for progressive penalties
const rateLimitViolations = new Map<WebSocket, number>();
const RATE_LIMIT_VIOLATION_THRESHOLD = 50; // Close connection after 50 violations

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

// Track documents loaded from content fallback (not yet saved to yjs_state)
// These should not persist empty states from stale client IndexedDB syncs
const loadedFromContentFallback = new Set<string>();

// Global events connections (separate from document collaboration)
// These persist across navigation and are used for real-time notifications
const eventConns = new Map<WebSocket, { userId: string; workspaceId: string }>();

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

    // Extract hypothesis, success criteria, vision, and goals from content
    const hypothesis = extractHypothesisFromContent(content);
    const successCriteria = extractSuccessCriteriaFromContent(content);
    const vision = extractVisionFromContent(content);
    const goals = extractGoalsFromContent(content);

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
      vision: vision,
      goals: goals,
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

// Helper to recursively clone a Y.XmlElement for restoration
// This creates NEW Yjs operations that override stale deletions from browser cache
function cloneXmlElement(element: Y.XmlElement): Y.XmlElement {
  const clone = new Y.XmlElement(element.nodeName);

  // Copy all attributes
  const attrs = element.getAttributes();
  for (const [key, value] of Object.entries(attrs)) {
    clone.setAttribute(key, value as string);
  }

  // Recursively clone children
  for (let i = 0; i < element.length; i++) {
    const child = element.get(i);
    if (child instanceof Y.XmlElement) {
      clone.push([cloneXmlElement(child)]);
    } else if (child instanceof Y.XmlText) {
      const textClone = new Y.XmlText();
      textClone.insert(0, child.toString());
      clone.push([textClone]);
    }
  }

  return clone;
}

function schedulePersist(docName: string, doc: Y.Doc) {
  const existing = pendingSaves.get(docName);
  if (existing) clearTimeout(existing);

  pendingSaves.set(docName, setTimeout(() => {
    // If document was loaded from content fallback, check if it has meaningful content
    // This prevents stale client IndexedDB state from overwriting good content
    if (loadedFromContentFallback.has(docName)) {
      const fragment = doc.getXmlFragment('default');
      const hasContent = fragment.length > 0 && !isFragmentEffectivelyEmpty(fragment);
      if (!hasContent) {
        console.log(`[Collaboration] Skipping persist for ${docName} - content would be empty (protecting content fallback)`);
        pendingSaves.delete(docName);
        return;
      }
      // Has meaningful content - allow this persist but KEEP the protection
      // Protection is only cleared when the document is explicitly closed or after manual cache invalidation
      // This ensures we never persist empty state from late-arriving stale IndexedDB syncs
      console.log(`[Collaboration] ${docName} has meaningful content, persisting (protection remains active)`);
    }
    persistDocument(docName, doc);
    pendingSaves.delete(docName);
  }, 2000));
}

// Check if a fragment is effectively empty (just whitespace or empty paragraphs)
// This recursively checks for actual text content, including inside special blocks
function isFragmentEffectivelyEmpty(fragment: Y.XmlFragment): boolean {
  if (fragment.length === 0) return true;

  // Recursively check if an element or fragment has any real text content
  // Only Y.XmlText nodes contain actual text - XmlElement.toString() returns XML with tags
  function hasTextContent(node: Y.XmlElement | Y.XmlFragment): boolean {
    for (let i = 0; i < node.length; i++) {
      const child = node.get(i);
      if (child instanceof Y.XmlText) {
        // XmlText.toString() returns just the text content
        if (child.toString().trim().length > 0) return true;
      } else if (child instanceof Y.XmlElement) {
        // Recursively check element children
        if (hasTextContent(child)) return true;
      }
    }
    return false;
  }

  return !hasTextContent(fragment);
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
      console.log(`[Collaboration] Loading from yjs_state for ${docName}`);
      // Protect against stale browser IndexedDB emptying this content
      // (Same protection as content fallback docs)
      loadedFromContentFallback.add(docName);
      Y.applyUpdate(doc, result.rows[0].yjs_state);

      // Cache the loaded content for quick restoration if stale sync messages arrive
      const fragment = doc.getXmlFragment('default');
      if (!isFragmentEffectivelyEmpty(fragment)) {
        const jsonContent = yjsToJson(fragment);
        protectedDocs.set(docName, {
          restoredAt: Date.now(),
          content: jsonContent,
        });
        console.log(`[Collaboration] Cached content for ${docName} (${jsonContent.content?.length || 0} nodes)`);
      }
    } else if (result.rows[0]?.content) {
      // Fallback: convert JSON content to Yjs (for seeded documents)
      console.log(`[Collaboration] Loading from content fallback for ${docName}`);
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
          console.log(`[Collaboration] Converting JSON to Yjs, ${jsonContent.content.length} nodes`);
          // Mark as loaded from content fallback BEFORE conversion
          // This is critical because jsonToYjs triggers update events synchronously,
          // and those events call schedulePersist which needs to know about this protection
          loadedFromContentFallback.add(docName);
          const fragment = doc.getXmlFragment('default');
          jsonToYjs(doc, fragment, jsonContent);
          console.log(`[Collaboration] Converted, fragment length: ${fragment.length}`);

          // Cache the loaded content for quick restoration if stale sync messages arrive
          // This is the same protection we apply to yjs_state documents
          // Note: We check JSON content existence, not Yjs fragment, because the fragment
          // structure may not have XmlText nodes yet even though content exists
          if (jsonContent.content && jsonContent.content.length > 0) {
            protectedDocs.set(docName, {
              restoredAt: Date.now(),
              content: jsonContent,
            });
            console.log(`[Collaboration] Protected content fallback ${docName} (${jsonContent.content.length} JSON nodes)`);
          }
        }
      } catch (parseErr) {
        console.error('Failed to parse JSON content:', parseErr);
        // Start with empty document if content is corrupted
      }
    } else {
      console.log(`[Collaboration] No yjs_state or content for ${docName}`);
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

// Track documents currently being restored to prevent infinite loops
const restoringDocs = new Set<string>();

// Track documents that were recently restored - during protection window, ignore sync messages that would empty content
// This prevents stale client sync messages from re-emptying content after restoration
const protectedDocs = new Map<string, { restoredAt: number; content: any }>();
const PROTECTION_WINDOW_MS = 10000; // 10 seconds protection after restoration

// Restore document content from database after stale client sync emptied it
// This is called when a content-fallback doc becomes empty after CRDT merge
async function restoreContentFromDatabase(docName: string, doc: Y.Doc): Promise<void> {
  // Prevent re-entry during restoration
  if (restoringDocs.has(docName)) {
    console.log(`[Collaboration] Skipping restore for ${docName} - already restoring`);
    return;
  }

  restoringDocs.add(docName);
  const docId = parseDocId(docName);

  try {
    const result = await pool.query(
      'SELECT yjs_state, content FROM documents WHERE id = $1',
      [docId]
    );

    // Prefer yjs_state if available (authoritative source)
    if (result.rows[0]?.yjs_state) {
      console.log(`[Collaboration] Restoring from yjs_state for ${docName}`);

      // Load stored state to get the content
      const freshDoc = new Y.Doc();
      Y.applyUpdate(freshDoc, result.rows[0].yjs_state);
      const freshFragment = freshDoc.getXmlFragment('default');

      console.log(`[Collaboration] Fresh doc fragment length: ${freshFragment.length}`);

      if (freshFragment.length > 0) {
        // Convert to JSON and back - this creates NEW insert operations
        const jsonContent = yjsToJson(freshFragment);
        console.log(`[Collaboration] Converted to JSON: ${jsonContent.content?.length || 0} nodes`);

        const fragment = doc.getXmlFragment('default');

        // Re-insert content - don't clear first, just add (CRDT will handle deduplication)
        // The key insight: we're adding NEW operations with new timestamps
        // that will survive future CRDT merges
        doc.transact(() => {
          // Clear first within same transaction
          while (fragment.length > 0) {
            fragment.delete(0, 1);
          }
          // Then add content
          if (jsonContent.content) {
            for (const node of jsonContent.content) {
              if (node.type === 'text') {
                const text = new Y.XmlText();
                fragment.push([text]);
                text.insert(0, node.text || '');
              } else {
                const element = new Y.XmlElement(node.type);
                fragment.push([element]);
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
        }, 'server');  // Mark as server origin to avoid broadcast loop

        console.log(`[Collaboration] Restored content, fragment length: ${fragment.length}`);

        // Cache restored content for quick re-restoration if stale sync messages arrive
        protectedDocs.set(docName, {
          restoredAt: Date.now(),
          content: jsonContent,
        });
        console.log(`[Collaboration] Protected ${docName} for ${PROTECTION_WINDOW_MS}ms`);

        // Send the restored state to all clients
        const fullState = Y.encodeStateAsUpdate(doc);
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, messageSync);
        syncProtocol.writeUpdate(encoder, fullState);
        const message = encoding.toUint8Array(encoder);

        conns.forEach((conn, ws) => {
          if (conn.docName === docName && ws.readyState === WebSocket.OPEN) {
            ws.send(message);
          }
        });
      }

      freshDoc.destroy();
    } else if (result.rows[0]?.content) {
      // Fallback to JSON content
      let jsonContent = result.rows[0].content;

      if (typeof jsonContent === 'string' && !jsonContent.trim().startsWith('<')) {
        jsonContent = JSON.parse(jsonContent);
      }

      if (jsonContent && jsonContent.type === 'doc' && Array.isArray(jsonContent.content)) {
        console.log(`[Collaboration] Restoring ${jsonContent.content.length} nodes from content for ${docName}`);
        const fragment = doc.getXmlFragment('default');

        // Clear the fragment first
        while (fragment.length > 0) {
          fragment.delete(0, 1);
        }

        // Re-apply the content
        jsonToYjs(doc, fragment, jsonContent);
        console.log(`[Collaboration] Restored content, fragment length: ${fragment.length}`);

        // Cache restored content for quick re-restoration if stale sync messages arrive
        protectedDocs.set(docName, {
          restoredAt: Date.now(),
          content: jsonContent,
        });
        console.log(`[Collaboration] Protected ${docName} for ${PROTECTION_WINDOW_MS}ms`);

        // Broadcast the restored state to all clients
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, messageSync);
        syncProtocol.writeUpdate(encoder, Y.encodeStateAsUpdate(doc));
        const message = encoding.toUint8Array(encoder);

        conns.forEach((conn, ws) => {
          if (conn.docName === docName && ws.readyState === WebSocket.OPEN) {
            ws.send(message);
          }
        });
      }
    }
  } catch (err) {
    console.error(`[Collaboration] Failed to restore content for ${docName}:`, err);
  } finally {
    // Clear restoration flag immediately - protection is now handled by protectedDocs cache
    restoringDocs.delete(docName);
  }
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

async function handleMessage(ws: WebSocket, message: Uint8Array, docName: string, doc: Y.Doc, aw: awarenessProtocol.Awareness) {
  const decoder = decoding.createDecoder(message);
  const messageType = decoding.readVarUint(decoder);

  switch (messageType) {
    case messageSync: {
      // For protected docs, we need to handle sync messages carefully
      // to prevent stale client state from overwriting authoritative server content
      const protection = protectedDocs.get(docName);
      const isProtected = protection && (Date.now() - protection.restoredAt) < PROTECTION_WINDOW_MS;

      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, messageSync);

      if (isProtected) {
        // For protected documents, we use a special strategy:
        // 1. Read the sync message type without applying destructive updates
        // 2. Always respond with authoritative server state
        // 3. This forces client to converge to server state

        // Peek at message type (sync step 1 = state vector, sync step 2 = update)
        const msgType = decoding.readVarUint(decoder);

        if (msgType === 0) {
          // Sync step 1: Client sending state vector, wants our diff
          // Read client's state vector
          const clientStateVector = decoding.readVarUint8Array(decoder);

          // Send sync step 2: our full state (everything client might be missing)
          // This ensures client gets ALL our content
          // CRITICAL: Use writeSyncStep2 (message type 1) not writeUpdate (message type 2)
          // The client expects sync step 2 response after sending sync step 1
          syncProtocol.writeSyncStep2(encoder, doc, clientStateVector);

          const serverUpdate = Y.encodeStateAsUpdate(doc, clientStateVector);
          console.log(`[Collaboration] Protected ${docName}: sent sync step 2 to client (${serverUpdate.length} bytes)`);
        } else if (msgType === 1) {
          // Sync step 2: Client sending update
          // For protected docs, we need to maintain CRDT convergence but ensure
          // server content wins. Strategy:
          // 1. Apply client update (required for CRDT convergence)
          // 2. Then restore authoritative content from cache
          // This allows CRDT to track what client has, while ensuring display is correct
          const updateData = decoding.readVarUint8Array(decoder);

          // Apply client update for CRDT tracking
          Y.applyUpdate(doc, updateData, ws);

          // Now restore authoritative content from cache
          // This ensures server content always wins visually
          const fragment = doc.getXmlFragment('default');
          const currentJson = yjsToJson(fragment);
          const cachedJson = protection.content;

          // Compare content - if different, restore from cache
          console.log(`[Collaboration] Protected ${docName}: comparing content...`);
          console.log(`[Collaboration]   currentJson nodes: ${currentJson.length}`);
          console.log(`[Collaboration]   cachedJson nodes: ${cachedJson.length}`);
          console.log(`[Collaboration]   currentJson[0]?.type: ${currentJson[0]?.type}`);
          console.log(`[Collaboration]   cachedJson[0]?.type: ${cachedJson[0]?.type}`);

          if (JSON.stringify(currentJson) !== JSON.stringify(cachedJson)) {
            console.log(`[Collaboration] Protected ${docName}: restoring authoritative content after client update`);
            console.log(`[Collaboration]   current: ${JSON.stringify(currentJson).substring(0, 200)}`);
            console.log(`[Collaboration]   cached: ${JSON.stringify(cachedJson).substring(0, 200)}`);
            // Clear fragment and restore from cache
            doc.transact(() => {
              while (fragment.length > 0) {
                fragment.delete(0, 1);
              }
              jsonToYjs(doc, fragment, cachedJson);
            });
            // Send restored state to all clients
            const restoredState = Y.encodeStateAsUpdate(doc);
            syncProtocol.writeUpdate(encoder, restoredState);
          } else {
            console.log(`[Collaboration] Protected ${docName}: client update maintained correct content`);
            console.log(`[Collaboration]   content: ${JSON.stringify(currentJson).substring(0, 200)}`);
          }
        }

        // Extend protection since we're actively handling sync
        protection.restoredAt = Date.now();
      } else {
        // Not protected: use standard sync protocol
        // Pass ws as origin so broadcast excludes the sender
        syncProtocol.readSyncMessage(decoder, encoder, doc, ws);

        // Check if content became empty for a content-fallback doc
        const wasLoadedFromFallback = loadedFromContentFallback.has(docName);
        const fragment = doc.getXmlFragment('default');
        const emptyAfter = isFragmentEffectivelyEmpty(fragment);

        if (emptyAfter && wasLoadedFromFallback) {
          console.log(`[Collaboration] Content became empty after sync for ${docName}, restoring from database`);
          await restoreContentFromDatabase(docName, doc);
        }
      }

      if (encoding.length(encoder) > 1) {
        ws.send(encoding.toUint8Array(encoder));
      }
      break;
    }
    case messageAwareness: {
      const awarenessData = decoding.readVarUint8Array(decoder);

      // Extract the actual client's awarenessClientId from the update
      // This is critical for proper cleanup on disconnect - the server was
      // previously storing doc.clientID (server's ID) instead of the client's
      // actual awareness clientID, causing stale states on page refresh.
      // Format: [numStates, ...for each: clientId, clock, stateJson]
      const conn = conns.get(ws);
      if (conn) {
        const updateDecoder = decoding.createDecoder(awarenessData);
        const numStates = decoding.readVarUint(updateDecoder);
        if (numStates > 0) {
          const clientId = decoding.readVarUint(updateDecoder);
          conn.awarenessClientId = clientId;
        }
      }

      awarenessProtocol.applyAwarenessUpdate(aw, awarenessData, ws);
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

/**
 * Handle document conversion.
 * When a document is converted to a different type (issue→project or project→issue),
 * notify all collaborators and redirect them to the new document.
 *
 * @param oldDocId - The original document ID that was converted
 * @param newDocId - The new document ID
 * @param oldDocType - The original document type ('issue' or 'project')
 * @param newDocType - The new document type ('issue' or 'project')
 */
/**
 * Invalidate the in-memory cache for a document.
 * Call this when document content is updated via REST API to ensure
 * the collaboration server reloads from database on next connection.
 *
 * @param docId - The document ID to invalidate
 */
export function invalidateDocumentCache(docId: string): void {
  // Find all doc names that match this docId (could be "wiki:uuid", "issue:uuid", etc.)
  const docNamesToInvalidate: string[] = [];
  docs.forEach((_, docName) => {
    if (parseDocId(docName) === docId) {
      docNamesToInvalidate.push(docName);
    }
  });

  if (docNamesToInvalidate.length === 0) {
    console.log(`[Collaboration] No cached doc found for ${docId}`);
    return;
  }

  for (const docName of docNamesToInvalidate) {
    // Close any active connections with "content updated" code
    const connectionsToClose: WebSocket[] = [];
    conns.forEach((conn, ws) => {
      if (conn.docName === docName) {
        connectionsToClose.push(ws);
      }
    });

    for (const ws of connectionsToClose) {
      if (ws.readyState === WebSocket.OPEN) {
        // Close with custom code 4101 (content updated via API)
        // Frontend should handle this by reconnecting to get fresh content
        ws.close(4101, 'Content updated');
      }
    }

    // Clear any pending saves
    const pendingSave = pendingSaves.get(docName);
    if (pendingSave) {
      clearTimeout(pendingSave);
      pendingSaves.delete(docName);
    }

    // Remove from cache - next connection will reload from database
    docs.delete(docName);
    awareness.delete(docName);

    console.log(`[Collaboration] Invalidated cache for ${docName}`);
  }
}

/**
 * Invalidate all document caches.
 * Call this after seeding to force the collaboration server to reload from database.
 * This is useful when seed.ts clears yjs_state and updates content.
 */
export function invalidateAllDocumentCaches(): number {
  const docNames = Array.from(docs.keys());

  if (docNames.length === 0) {
    console.log('[Collaboration] No cached documents to invalidate');
    return 0;
  }

  for (const docName of docNames) {
    // Close any active connections
    conns.forEach((conn, ws) => {
      if (conn.docName === docName && ws.readyState === WebSocket.OPEN) {
        ws.close(4101, 'Content updated');
      }
    });

    // Clear pending saves
    const pendingSave = pendingSaves.get(docName);
    if (pendingSave) {
      clearTimeout(pendingSave);
      pendingSaves.delete(docName);
    }

    // Remove from cache
    docs.delete(docName);
    awareness.delete(docName);
    loadedFromContentFallback.delete(docName);
  }

  console.log(`[Collaboration] Invalidated ${docNames.length} cached documents`);
  return docNames.length;
}

export function handleDocumentConversion(
  oldDocId: string,
  newDocId: string,
  oldDocType: 'issue' | 'project',
  newDocType: 'issue' | 'project'
): void {
  // Find all connections to this document (across all doc types)
  const connectionsToNotify: Array<{ ws: WebSocket; conn: { docName: string; awarenessClientId: number; userId: string; workspaceId: string } }> = [];

  conns.forEach((conn, ws) => {
    const connDocId = parseDocId(conn.docName);
    if (connDocId === oldDocId) {
      connectionsToNotify.push({ ws, conn });
    }
  });

  if (connectionsToNotify.length === 0) {
    return; // No active connections to this document
  }

  console.log(`[Collaboration] Document ${oldDocId} converted to ${newDocType} (${newDocId}), notifying ${connectionsToNotify.length} collaborators`);

  // Put conversion info in close reason (JSON fits within 123-byte limit)
  const closeReason = JSON.stringify({
    newDocId,
    newDocType,
  });

  for (const { ws } of connectionsToNotify) {
    if (ws.readyState === WebSocket.OPEN) {
      // Close with custom code 4100 (document converted) and JSON reason
      ws.close(4100, closeReason);
    }
  }
}

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

/**
 * Broadcast a custom event to all WebSocket connections for a specific user.
 * Used for real-time notifications like accountability updates.
 * Sends to both document collaboration connections and global event connections.
 *
 * @param userId - The user ID to broadcast to
 * @param eventType - The event type (e.g., 'accountability:updated')
 * @param data - Optional event data payload
 */
export function broadcastToUser(userId: string, eventType: string, data?: Record<string, unknown>): void {
  const payload = JSON.stringify({ type: eventType, data: data || {} });

  // For events connections, send as plain JSON (they're dedicated for events)
  let sentCount = 0;
  eventConns.forEach((conn, ws) => {
    if (conn.userId === userId && ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
      sentCount++;
    }
  });

  if (sentCount > 0) {
    console.log(`[Events] Broadcast '${eventType}' to user ${userId} (${sentCount} connections)`);
  }
}

// DDoS protection: Max WebSocket message size (10MB, matches REST API limit)
const MAX_WS_MESSAGE_SIZE = 10 * 1024 * 1024;

export function setupCollaboration(server: Server) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_MESSAGE_SIZE });
  const eventsWss = new WebSocketServer({ noServer: true, maxPayload: MAX_WS_MESSAGE_SIZE });

  server.on('upgrade', async (request, socket, head) => {
    const url = new URL(request.url || '', `http://${request.headers.host}`);

    // Handle /events WebSocket for real-time notifications
    if (url.pathname === '/events') {
      // Rate limit check
      const clientIp = (request.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() ||
                       request.socket.remoteAddress ||
                       'unknown';

      if (isConnectionRateLimited(clientIp)) {
        socket.write('HTTP/1.1 429 Too Many Requests\r\n\r\n');
        socket.destroy();
        return;
      }
      recordConnectionAttempt(clientIp);

      // Validate session
      const sessionData = await validateWebSocketSession(request);
      if (!sessionData) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      eventsWss.handleUpgrade(request, socket, head, (ws) => {
        eventsWss.emit('connection', ws, sessionData);
      });
      return;
    }

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
      // DDoS protection: Defense-in-depth size check (WS server also enforces maxPayload)
      if (data.length > MAX_WS_MESSAGE_SIZE) {
        ws.close(1009, 'Message too large');
        return;
      }

      // Rate limit messages to prevent message floods
      if (isMessageRateLimited(ws)) {
        // DDoS protection: Track violations and apply progressive penalties
        const violations = (rateLimitViolations.get(ws) || 0) + 1;
        rateLimitViolations.set(ws, violations);

        // After repeated violations, terminate the connection
        if (violations >= RATE_LIMIT_VIOLATION_THRESHOLD) {
          ws.close(1008, 'Rate limit exceeded');
          return;
        }

        // Drop message silently - client will retry via Yjs sync protocol
        return;
      }

      // Reset violation count on successful (non-rate-limited) messages
      rateLimitViolations.delete(ws);
      recordMessage(ws);

      // Await handleMessage since it may need to restore content from database
      handleMessage(ws, new Uint8Array(data), docName, doc, aw).catch((err) => {
        console.error(`[Collaboration] Error handling message for ${docName}:`, err);
      });
    });

    ws.on('close', () => {
      const conn = conns.get(ws);
      if (conn) {
        awarenessProtocol.removeAwarenessStates(aw, [conn.awarenessClientId], null);
        conns.delete(ws);
      }
      // Clean up rate limiting data for this connection
      messageTimestamps.delete(ws);
      rateLimitViolations.delete(ws);

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

  // Handle events WebSocket connections (for real-time notifications)
  eventsWss.on('connection', (ws: WebSocket, sessionData: { userId: string; workspaceId: string }) => {
    eventConns.set(ws, { userId: sessionData.userId, workspaceId: sessionData.workspaceId });
    console.log(`[Events] User ${sessionData.userId} connected (${eventConns.size} total connections)`);

    // Send initial connected message
    ws.send(JSON.stringify({ type: 'connected', data: {} }));

    // Handle ping/pong for keepalive with rate limiting
    ws.on('message', (data: Buffer) => {
      // DDoS protection: Rate limit events WebSocket messages
      if (isMessageRateLimited(ws)) {
        const violations = (rateLimitViolations.get(ws) || 0) + 1;
        rateLimitViolations.set(ws, violations);

        if (violations >= RATE_LIMIT_VIOLATION_THRESHOLD) {
          console.log(`[Events] Rate limit violations exceeded for user ${sessionData.userId}, closing connection`);
          ws.close(1008, 'Rate limit exceeded');
        }
        return;
      }

      // Reset violations on successful message
      rateLimitViolations.delete(ws);
      recordMessage(ws);

      try {
        const message = JSON.parse(data.toString());
        if (message.type === 'ping') {
          ws.send(JSON.stringify({ type: 'pong' }));
        }
      } catch {
        // Ignore invalid messages
      }
    });

    ws.on('close', () => {
      eventConns.delete(ws);
      rateLimitViolations.delete(ws);
      messageTimestamps.delete(ws);
      console.log(`[Events] User ${sessionData.userId} disconnected (${eventConns.size} total connections)`);
    });
  });

  console.log('Yjs collaboration server attached');
  console.log('Events WebSocket server attached');
}
