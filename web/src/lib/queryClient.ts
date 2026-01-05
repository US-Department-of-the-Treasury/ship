import { QueryClient, MutationCache, QueryCache, onlineManager } from '@tanstack/react-query';
import { get, set, del, createStore } from 'idb-keyval';
import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client';

// Document query keys (imported pattern to avoid circular deps)
const documentKeys = {
  all: ['documents'] as const,
  wikiList: () => [...documentKeys.all, 'wiki'] as const,
};

// IndexedDB store for query cache
const queryStore = createStore('ship-query-cache', 'queries');

// IndexedDB store for pending mutations (offline queue)
const mutationStore = createStore('ship-mutation-queue', 'mutations');

// Sync status for pending mutations
export type MutationSyncStatus = 'pending' | 'syncing' | 'synced' | 'conflict';

// Max retries before giving up on a mutation
export const MAX_RETRY_COUNT = 5;

// Pending mutation tracking for UI
export interface PendingMutation {
  id: string;
  type: 'create' | 'update' | 'delete';
  resource: 'document' | 'issue' | 'program' | 'sprint' | 'person';
  resourceId?: string;
  data: unknown;
  timestamp: number;
  retryCount: number;
  syncStatus: MutationSyncStatus;
  conflictError?: string; // Error message for 409 conflicts
}

let pendingMutations: PendingMutation[] = [];
let pendingMutationListeners: Array<(mutations: PendingMutation[]) => void> = [];

export function getPendingMutations(): PendingMutation[] {
  return pendingMutations;
}

export function subscribeToPendingMutations(
  listener: (mutations: PendingMutation[]) => void
): () => void {
  pendingMutationListeners.push(listener);
  return () => {
    pendingMutationListeners = pendingMutationListeners.filter(l => l !== listener);
  };
}

function notifyPendingMutationListeners() {
  pendingMutationListeners.forEach(l => l(pendingMutations));
}

export function addPendingMutation(mutation: Omit<PendingMutation, 'id' | 'timestamp' | 'retryCount' | 'syncStatus'>) {
  const newMutation: PendingMutation = {
    ...mutation,
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    retryCount: 0,
    syncStatus: 'pending',
  };
  pendingMutations = [...pendingMutations, newMutation];
  notifyPendingMutationListeners();
  // Persist to IndexedDB
  set('pending', pendingMutations, mutationStore).catch(console.error);
  return newMutation.id;
}

export function updateMutationSyncStatus(id: string, syncStatus: MutationSyncStatus) {
  pendingMutations = pendingMutations.map(m =>
    m.id === id ? { ...m, syncStatus } : m
  );
  notifyPendingMutationListeners();
  set('pending', pendingMutations, mutationStore).catch(console.error);
}

// Update document sync status in query cache (called after mutation syncs)
function updateDocumentSyncStatusInCache(pendingId: string, syncStatus: MutationSyncStatus) {
  // This needs to run after queryClient is defined, so we check
  if (typeof queryClient === 'undefined') return;

  interface CachedDocument {
    id: string;
    _pendingId?: string;
    _syncStatus?: MutationSyncStatus;
    _pending?: boolean;
  }

  const docs = queryClient.getQueryData<CachedDocument[]>(documentKeys.wikiList());
  if (!docs) return;

  const updated = docs.map(doc => {
    if (doc._pendingId === pendingId) {
      return { ...doc, _syncStatus: syncStatus };
    }
    return doc;
  });

  queryClient.setQueryData(documentKeys.wikiList(), updated);
}

export function removePendingMutation(id: string) {
  pendingMutations = pendingMutations.filter(m => m.id !== id);
  notifyPendingMutationListeners();
  set('pending', pendingMutations, mutationStore).catch(console.error);
}

export function incrementMutationRetry(id: string) {
  pendingMutations = pendingMutations.map(m =>
    m.id === id ? { ...m, retryCount: m.retryCount + 1 } : m
  );
  notifyPendingMutationListeners();
  set('pending', pendingMutations, mutationStore).catch(console.error);
}

// Mark a mutation as having a conflict (409 error)
export function markMutationConflict(id: string, errorMessage: string) {
  pendingMutations = pendingMutations.map(m =>
    m.id === id ? { ...m, syncStatus: 'conflict' as const, conflictError: errorMessage } : m
  );
  notifyPendingMutationListeners();
  set('pending', pendingMutations, mutationStore).catch(console.error);
}

// Reset retry count for failed mutations and trigger reprocessing
export function retryFailedMutations() {
  // Reset retry count for mutations that have exceeded max retries
  pendingMutations = pendingMutations.map(m =>
    m.retryCount >= MAX_RETRY_COUNT ? { ...m, retryCount: 0, syncStatus: 'pending' } : m
  );
  notifyPendingMutationListeners();
  set('pending', pendingMutations, mutationStore).catch(console.error);

  // Trigger reprocessing
  if (isOnline) {
    processPendingMutations();
  }
}

// Update resourceId for pending mutations (used when temp ID is replaced with real ID)
export function updateMutationResourceId(oldId: string, newId: string) {
  pendingMutations = pendingMutations.map(m =>
    m.resourceId === oldId ? { ...m, resourceId: newId } : m
  );
  notifyPendingMutationListeners();
  set('pending', pendingMutations, mutationStore).catch(console.error);
  debugLog('[updateMutationResourceId] Updated', oldId, 'to', newId);
}

// Load pending mutations from IndexedDB on startup
export async function loadPendingMutations(): Promise<void> {
  try {
    const stored = await get<PendingMutation[]>('pending', mutationStore);
    if (stored) {
      pendingMutations = stored;
      notifyPendingMutationListeners();
    }
  } catch (error) {
    console.error('Failed to load pending mutations:', error);
  }
}

// Sync handlers for processing pending mutations when coming online
type SyncHandler = (mutation: PendingMutation) => Promise<void>;
const syncHandlers: Map<string, SyncHandler> = new Map();

export function registerSyncHandler(resource: string, type: string, handler: SyncHandler) {
  syncHandlers.set(`${resource}:${type}`, handler);
}

// Calculate backoff delay (exponential: 1s, 2s, 4s, 8s, 16s)
function getBackoffDelay(retryCount: number): number {
  return Math.min(1000 * Math.pow(2, retryCount), 16000);
}

// Track if a retry is already scheduled
let retryTimeoutId: ReturnType<typeof setTimeout> | null = null;

// Schedule a retry for failed mutations
function scheduleRetry() {
  // Find mutations that need retry (failed but not maxed out)
  const toRetry = pendingMutations.filter(
    m => m.syncStatus === 'pending' && m.retryCount > 0 && m.retryCount < MAX_RETRY_COUNT
  );

  if (toRetry.length === 0 || !isOnline) {
    return;
  }

  // Cancel existing retry timeout
  if (retryTimeoutId) {
    clearTimeout(retryTimeoutId);
    retryTimeoutId = null;
  }

  // Use the minimum backoff delay from all pending retries
  const minDelay = Math.min(...toRetry.map(m => getBackoffDelay(m.retryCount)));
  debugLog('[scheduleRetry] Scheduling retry in', minDelay, 'ms for', toRetry.length, 'mutations');

  retryTimeoutId = setTimeout(() => {
    retryTimeoutId = null;
    if (isOnline) {
      processPendingMutations();
    }
  }, minDelay);
}

// Process all pending mutations when coming online
export async function processPendingMutations(): Promise<void> {
  const toProcess = [...pendingMutations].filter(m => m.syncStatus !== 'synced');
  debugLog('[processPendingMutations] Processing', toProcess.length, 'mutations');

  let hasFailures = false;

  for (const mutation of toProcess) {
    // Skip if max retries exceeded
    if (mutation.retryCount >= MAX_RETRY_COUNT) {
      debugLog('[processPendingMutations] Skipping mutation (max retries):', mutation.id);
      // Mark as failed by setting a high retry count indicator
      continue;
    }

    const handlerKey = `${mutation.resource}:${mutation.type}`;
    const handler = syncHandlers.get(handlerKey);

    if (!handler) {
      debugLog('[processPendingMutations] No handler for', handlerKey);
      continue;
    }

    try {
      // Mark as syncing (both in pending mutations array and query cache)
      updateMutationSyncStatus(mutation.id, 'syncing');
      updateDocumentSyncStatusInCache(mutation.id, 'syncing');
      debugLog('[processPendingMutations] Syncing mutation', mutation.id, 'retry:', mutation.retryCount);

      // Execute the sync
      await handler(mutation);

      // Mark as synced (both in pending mutations array and query cache)
      updateMutationSyncStatus(mutation.id, 'synced');
      updateDocumentSyncStatusInCache(mutation.id, 'synced');
      debugLog('[processPendingMutations] Mutation synced', mutation.id);

      // Remove after brief delay to show synced state
      setTimeout(() => {
        removePendingMutation(mutation.id);
      }, 1500);
    } catch (error) {
      debugLog('[processPendingMutations] Mutation failed', mutation.id, 'error:', error);
      debugLog('[processPendingMutations] Error type:', typeof error, 'keys:', error && typeof error === 'object' ? Object.keys(error) : 'N/A');

      // Check for 409 conflict error - don't retry these
      const status = (error as { status?: number }).status;
      debugLog('[processPendingMutations] Error status:', status);
      if (status === 409) {
        debugLog('[processPendingMutations] Conflict detected (409)', mutation.id);
        markMutationConflict(mutation.id, 'Version conflict - your changes conflict with recent updates');
        updateDocumentSyncStatusInCache(mutation.id, 'conflict');
        // Don't retry conflicts - they need user resolution
        continue;
      }

      incrementMutationRetry(mutation.id);
      // Keep in pending state for retry
      updateMutationSyncStatus(mutation.id, 'pending');
      updateDocumentSyncStatusInCache(mutation.id, 'pending');
      hasFailures = true;
    }
  }

  // Schedule retry for failed mutations
  if (hasFailures && isOnline) {
    scheduleRetry();
  }
}

// Create IndexedDB persister for TanStack Query
export function createIDBPersister(): Persister {
  return {
    persistClient: async (client: PersistedClient) => {
      await set('tanstack-query', client, queryStore);
    },
    restoreClient: async () => {
      return await get<PersistedClient>('tanstack-query', queryStore);
    },
    removeClient: async () => {
      await del('tanstack-query', queryStore);
    },
  };
}

// Online status tracking
let isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true;
let onlineListeners: Array<(online: boolean) => void> = [];

export function getIsOnline(): boolean {
  return isOnline;
}

export function subscribeToOnlineStatus(listener: (online: boolean) => void): () => void {
  onlineListeners.push(listener);
  return () => {
    onlineListeners = onlineListeners.filter(l => l !== listener);
  };
}

function notifyOnlineListeners() {
  onlineListeners.forEach(l => l(isOnline));
}

// Note: Online event listeners are set up after queryClient is created (see bottom of file)

// Create the query client with offline support
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5, // 5 minutes
      gcTime: 1000 * 60 * 60 * 24, // 24 hours (was cacheTime)
      retry: (failureCount, error) => {
        // Don't retry on 4xx errors (client errors)
        if (error instanceof Error && 'status' in error) {
          const status = (error as { status: number }).status;
          if (status >= 400 && status < 500) return false;
        }
        return failureCount < 3;
      },
      networkMode: 'offlineFirst',
    },
    mutations: {
      retry: (failureCount, error) => {
        // Don't retry on 4xx errors
        if (error instanceof Error && 'status' in error) {
          const status = (error as { status: number }).status;
          if (status >= 400 && status < 500) return false;
        }
        return failureCount < 3;
      },
      // Use 'online' mode so mutations pause when offline and auto-resume when online
      networkMode: 'online',
    },
  },
  queryCache: new QueryCache({
    onError: (error, query) => {
      console.error(`Query ${query.queryKey} failed:`, error);
    },
  }),
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      console.error(`Mutation failed:`, error, mutation);
    },
  }),
});

// Persister instance
export const queryPersister = createIDBPersister();

// Debug logging helper
function debugLog(msg: string, ...args: unknown[]) {
  console.log(msg, ...args);
  try {
    const logs = JSON.parse(localStorage.getItem('__debug_logs__') || '[]');
    logs.push({ ts: Date.now(), msg, args: JSON.stringify(args) });
    localStorage.setItem('__debug_logs__', JSON.stringify(logs.slice(-50)));
  } catch {}
}

// Set up online/offline event listeners after queryClient is created
// This ensures we can process pending mutations when going online
if (typeof window !== 'undefined') {
  let processingMutations = false;

  window.addEventListener('online', () => {
    debugLog('[QueryClient] Online event received');
    isOnline = true;
    // Explicitly tell TanStack Query's onlineManager we're online
    onlineManager.setOnline(true);
    notifyOnlineListeners();

    // Process our custom pending mutations queue
    // Use a flag to prevent double-processing if event fires multiple times
    if (!processingMutations) {
      processingMutations = true;
      debugLog('[QueryClient] Starting processPendingMutations');
      processPendingMutations().finally(() => {
        processingMutations = false;
        debugLog('[QueryClient] processPendingMutations completed');
      });
    }

    // Also resume any TanStack Query paused mutations (for mutations still in memory)
    queryClient.resumePausedMutations();
  });
  window.addEventListener('offline', () => {
    debugLog('[QueryClient] Offline event received');
    isOnline = false;
    // Explicitly tell TanStack Query's onlineManager we're offline
    onlineManager.setOnline(false);
    notifyOnlineListeners();
  });
}
