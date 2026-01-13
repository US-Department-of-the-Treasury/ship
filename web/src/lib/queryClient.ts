import { QueryClient, MutationCache, QueryCache, onlineManager } from '@tanstack/react-query';
import { get, set, del, createStore } from 'idb-keyval';
import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client';

// Document query keys (imported pattern to avoid circular deps)
const documentKeys = {
  all: ['documents'] as const,
  wikiList: () => [...documentKeys.all, 'wiki'] as const,
};

// Program query keys (must match useProgramsQuery.ts to avoid circular deps)
const programKeys = {
  all: ['programs'] as const,
  lists: () => [...programKeys.all, 'list'] as const,
};

// ===========================================
// Cache Schema Versioning
// ===========================================

// Increment this when cache schema changes to auto-clear old data
export const CACHE_SCHEMA_VERSION = 1;

// IndexedDB store for query cache
const queryStore = createStore('ship-query-cache', 'queries');

// IndexedDB store for pending mutations (offline queue)
const mutationStore = createStore('ship-mutation-queue', 'mutations');

// IndexedDB store for metadata (schema version, etc)
const metaStore = createStore('ship-meta', 'meta');

// ===========================================
// Private Browsing Mode Detection
// ===========================================

let privateMode = false;
let privateModeListeners: Array<(isPrivate: boolean) => void> = [];

export function isPrivateBrowsingMode(): boolean {
  return privateMode;
}

export function subscribeToPrivateMode(listener: (isPrivate: boolean) => void): () => void {
  privateModeListeners.push(listener);
  if (privateMode) {
    listener(true);
  }
  return () => {
    privateModeListeners = privateModeListeners.filter(l => l !== listener);
  };
}

function notifyPrivateModeListeners(isPrivate: boolean) {
  privateMode = isPrivate;
  privateModeListeners.forEach(l => l(isPrivate));
}

async function detectPrivateBrowsingMode(): Promise<boolean> {
  // Try to detect private mode by attempting IndexedDB operations
  try {
    // Some browsers in private mode will throw when opening IndexedDB
    // or will have very limited quota
    const testDB = indexedDB.open('_private_mode_test_');
    await new Promise<void>((resolve, reject) => {
      testDB.onerror = () => reject(testDB.error);
      testDB.onsuccess = () => {
        testDB.result.close();
        // Clean up test database
        indexedDB.deleteDatabase('_private_mode_test_');
        resolve();
      };
    });

    // Also check storage quota - private mode often has ~0 quota
    if (navigator?.storage?.estimate) {
      const estimate = await navigator.storage.estimate();
      // Safari private mode reports 0 quota
      if (estimate.quota === 0) {
        return true;
      }
      // Firefox private mode reports very low quota (often ~5MB vs normal ~2GB)
      if (estimate.quota && estimate.quota < 10 * 1024 * 1024) {
        return true;
      }
    }

    return false;
  } catch {
    // IndexedDB failed - likely private mode
    return true;
  }
}

// ===========================================
// Schema Migration
// ===========================================

let schemaMigrationListeners: Array<(migrated: boolean) => void> = [];

export function subscribeToSchemaMigration(listener: (migrated: boolean) => void): () => void {
  schemaMigrationListeners.push(listener);
  return () => {
    schemaMigrationListeners = schemaMigrationListeners.filter(l => l !== listener);
  };
}

function notifySchemaMigrationListeners(migrated: boolean) {
  schemaMigrationListeners.forEach(l => l(migrated));
}

async function checkAndMigrateSchema(): Promise<void> {
  try {
    const storedVersion = await get<number>('schema_version', metaStore);

    if (storedVersion === undefined) {
      // First time - just set version
      await set('schema_version', CACHE_SCHEMA_VERSION, metaStore);
      console.log('[Schema] Initialized schema version:', CACHE_SCHEMA_VERSION);
      return;
    }

    if (storedVersion !== CACHE_SCHEMA_VERSION) {
      console.log('[Schema] Version mismatch:', storedVersion, '->', CACHE_SCHEMA_VERSION);
      // Clear old cache data (preserve pending mutations)
      await del('tanstack-query', queryStore);
      // Update version
      await set('schema_version', CACHE_SCHEMA_VERSION, metaStore);
      console.log('[Schema] Cache cleared due to schema migration');
      notifySchemaMigrationListeners(true);
    }
  } catch (error) {
    console.warn('[Schema] Migration check failed:', error);
    // If we can't check schema, we might be in private mode
    // Proceed anyway - worst case we have stale data
  }
}

// Sync status for pending mutations
export type MutationSyncStatus = 'pending' | 'syncing' | 'synced' | 'conflict';

// Max retries before giving up on a mutation
export const MAX_RETRY_COUNT = 5;

// Pending mutation tracking for UI
export interface PendingMutation {
  id: string;
  type: 'create' | 'update' | 'delete';
  resource: 'document' | 'issue' | 'program' | 'project' | 'sprint' | 'person';
  resourceId?: string;
  data: unknown;
  originalData?: unknown; // Original state before optimistic update, for rollback
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

// Update resource sync status in query cache (called after mutation syncs)
// Handles both documents and programs
function updateResourceSyncStatusInCache(pendingId: string, syncStatus: MutationSyncStatus) {
  // This needs to run after queryClient is defined, so we check
  if (typeof queryClient === 'undefined') return;

  interface CachedResource {
    id: string;
    _pendingId?: string;
    _syncStatus?: MutationSyncStatus;
    _pending?: boolean;
  }

  // Helper to update a resource list
  const updateList = (queryKey: readonly unknown[]) => {
    const items = queryClient.getQueryData<CachedResource[]>(queryKey);
    if (!items) return;

    const updated = items.map(item => {
      if (item._pendingId === pendingId) {
        // When synced, also clear the _pending flag
        if (syncStatus === 'synced') {
          return { ...item, _syncStatus: syncStatus, _pending: false };
        }
        return { ...item, _syncStatus: syncStatus };
      }
      return item;
    });

    queryClient.setQueryData(queryKey, updated);
  };

  // Update documents
  updateList(documentKeys.wikiList());

  // Update programs
  updateList(programKeys.lists());
}

// Alias for backwards compatibility
function updateDocumentSyncStatusInCache(pendingId: string, syncStatus: MutationSyncStatus) {
  updateResourceSyncStatusInCache(pendingId, syncStatus);
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

// ===========================================
// Sync Failure Notification
// ===========================================

export interface SyncFailure {
  resourceType: string;
  resourceId: string;
  operation: string;
  message: string;
  timestamp: number;
}

let syncFailureListeners: Array<(failure: SyncFailure) => void> = [];

export function subscribeToSyncFailures(listener: (failure: SyncFailure) => void): () => void {
  syncFailureListeners.push(listener);
  return () => {
    syncFailureListeners = syncFailureListeners.filter(l => l !== listener);
  };
}

function notifySyncFailure(failure: SyncFailure) {
  debugLog('[SyncFailure]', failure);
  syncFailureListeners.forEach(l => l(failure));
}

// ===========================================
// Optimistic Update Rollback
// ===========================================

// Rollback an optimistic update by restoring original data to cache
function rollbackOptimisticUpdate(mutation: PendingMutation): void {
  // This needs queryClient to be defined
  if (typeof queryClient === 'undefined') return;

  interface CachedResource {
    id: string;
    _pendingId?: string;
  }

  const { type, resource, resourceId, originalData } = mutation;
  debugLog('[Rollback] Rolling back mutation:', type, resource, resourceId);

  // Determine query key based on resource type
  const queryKey = resource === 'document'
    ? documentKeys.wikiList()
    : resource === 'program'
    ? programKeys.lists()
    : null;

  if (!queryKey) {
    debugLog('[Rollback] Unknown resource type:', resource);
    return;
  }

  const items = queryClient.getQueryData<CachedResource[]>(queryKey);
  if (!items) return;

  if (type === 'create') {
    // Remove the optimistically created item
    const updated = items.filter(item => item.id !== resourceId);
    queryClient.setQueryData(queryKey, updated);
    debugLog('[Rollback] Removed optimistically created item:', resourceId);
  } else if (type === 'update' && originalData) {
    // Restore the original data
    const updated = items.map(item =>
      item.id === resourceId
        ? { ...(originalData as CachedResource), _pendingId: undefined, _pending: false, _syncStatus: undefined }
        : item
    );
    queryClient.setQueryData(queryKey, updated);
    debugLog('[Rollback] Restored original data for:', resourceId);
  } else if (type === 'delete' && originalData) {
    // Re-add the optimistically deleted item
    const original = originalData as CachedResource;
    const updated = [...items, { ...original, _pendingId: undefined, _pending: false, _syncStatus: undefined }];
    queryClient.setQueryData(queryKey, updated);
    debugLog('[Rollback] Restored deleted item:', resourceId);
  }

  // Notify about the failure
  notifySyncFailure({
    resourceType: resource,
    resourceId: resourceId || 'unknown',
    operation: type,
    message: `Failed to ${type} ${resource}. Changes have been reverted.`,
    timestamp: Date.now(),
  });
}

// Process all pending mutations when coming online
export async function processPendingMutations(): Promise<void> {
  const toProcess = [...pendingMutations].filter(m => m.syncStatus !== 'synced');
  debugLog('[processPendingMutations] Processing', toProcess.length, 'mutations');

  let hasFailures = false;

  for (const mutation of toProcess) {
    // Rollback and remove if max retries exceeded
    if (mutation.retryCount >= MAX_RETRY_COUNT) {
      debugLog('[processPendingMutations] Max retries exceeded, rolling back:', mutation.id);
      rollbackOptimisticUpdate(mutation);
      removePendingMutation(mutation.id);
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

      const status = (error as { status?: number }).status;
      debugLog('[processPendingMutations] Error status:', status);

      // Check for 409 conflict error - special handling
      if (status === 409) {
        debugLog('[processPendingMutations] Conflict detected (409)', mutation.id);
        markMutationConflict(mutation.id, 'Version conflict - your changes conflict with recent updates');
        updateDocumentSyncStatusInCache(mutation.id, 'conflict');
        // Don't retry conflicts - they need user resolution
        continue;
      }

      // Don't retry 4xx client errors (except 409 handled above)
      // These are permanent failures that need user intervention
      if (status && status >= 400 && status < 500) {
        debugLog('[processPendingMutations] Client error (4xx), rolling back:', mutation.id);
        rollbackOptimisticUpdate(mutation);
        removePendingMutation(mutation.id);
        continue;
      }

      // For 5xx server errors, retry with backoff
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

// ===========================================
// Cache Corruption Detection & Recovery
// ===========================================

let cacheCorrupted = false;
let corruptionListeners: Array<(corrupted: boolean) => void> = [];

export function isCacheCorrupted(): boolean {
  return cacheCorrupted;
}

export function subscribeToCacheCorruption(listener: (corrupted: boolean) => void): () => void {
  corruptionListeners.push(listener);
  if (cacheCorrupted) {
    listener(true);
  }
  return () => {
    corruptionListeners = corruptionListeners.filter(l => l !== listener);
  };
}

function notifyCorruptionListeners(corrupted: boolean) {
  cacheCorrupted = corrupted;
  corruptionListeners.forEach(l => l(corrupted));
}

export async function clearAllCacheData(): Promise<void> {
  try {
    // Clear query cache
    await del('tanstack-query', queryStore);
    // Note: We preserve pending mutations - they're in a separate store
    debugLog('[Cache] Cleared all cache data (pending mutations preserved)');
    notifyCorruptionListeners(false);
  } catch (error) {
    console.error('[Cache] Failed to clear cache:', error);
    throw error;
  }
}

// Create IndexedDB persister for TanStack Query with corruption detection
export function createIDBPersister(): Persister {
  return {
    persistClient: async (client: PersistedClient) => {
      try {
        await set('tanstack-query', client, queryStore);
      } catch (error) {
        console.error('[Persister] Failed to persist client:', error);
        // Don't mark as corrupted on write failure - might just be quota
      }
    },
    restoreClient: async () => {
      try {
        const data = await get<PersistedClient>('tanstack-query', queryStore);
        // Validate data structure
        if (data && typeof data !== 'object') {
          throw new Error('Invalid cache data structure');
        }
        return data;
      } catch (error) {
        console.error('[Persister] Cache corruption detected:', error);
        notifyCorruptionListeners(true);
        // Return undefined to start fresh
        return undefined;
      }
    },
    removeClient: async () => {
      try {
        await del('tanstack-query', queryStore);
      } catch (error) {
        console.error('[Persister] Failed to remove client:', error);
      }
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

// ===========================================
// Storage Quota Management
// ===========================================

export interface StorageQuotaInfo {
  usage: number;
  quota: number;
  percentUsed: number;
  isWarning: boolean;
  isCritical: boolean;
}

const STORAGE_WARNING_THRESHOLD = 0.8; // 80%
const STORAGE_CRITICAL_THRESHOLD = 0.95; // 95%

let storageQuotaListeners: Array<(info: StorageQuotaInfo) => void> = [];
let cachedStorageInfo: StorageQuotaInfo | null = null;

export function subscribeToStorageQuota(listener: (info: StorageQuotaInfo) => void): () => void {
  storageQuotaListeners.push(listener);
  // Immediately notify with cached info if available
  if (cachedStorageInfo) {
    listener(cachedStorageInfo);
  }
  return () => {
    storageQuotaListeners = storageQuotaListeners.filter(l => l !== listener);
  };
}

function notifyStorageQuotaListeners(info: StorageQuotaInfo) {
  cachedStorageInfo = info;
  storageQuotaListeners.forEach(l => l(info));
}

export async function checkStorageQuota(): Promise<StorageQuotaInfo> {
  // Default fallback if StorageManager API not available
  const fallback: StorageQuotaInfo = {
    usage: 0,
    quota: 0,
    percentUsed: 0,
    isWarning: false,
    isCritical: false,
  };

  if (!navigator?.storage?.estimate) {
    return fallback;
  }

  try {
    const estimate = await navigator.storage.estimate();
    const usage = estimate.usage || 0;
    const quota = estimate.quota || 0;
    const percentUsed = quota > 0 ? usage / quota : 0;

    const info: StorageQuotaInfo = {
      usage,
      quota,
      percentUsed,
      isWarning: percentUsed >= STORAGE_WARNING_THRESHOLD,
      isCritical: percentUsed >= STORAGE_CRITICAL_THRESHOLD,
    };

    notifyStorageQuotaListeners(info);
    return info;
  } catch (error) {
    console.warn('[Storage] Failed to check quota:', error);
    return fallback;
  }
}

export async function clearOldCacheEntries(): Promise<void> {
  // Clear the TanStack Query cache but preserve pending mutations
  await del('tanstack-query', queryStore);
  debugLog('[Storage] Cleared query cache to free space');

  // Notify listeners of new quota
  await checkStorageQuota();
}

export function getStorageQuotaInfo(): StorageQuotaInfo | null {
  return cachedStorageInfo;
}

// ===========================================
// Initialization
// ===========================================

// Check storage quota periodically
if (typeof window !== 'undefined') {
  // Run initialization checks
  const initializeOfflineSupport = async () => {
    // Check for private browsing mode
    const isPrivate = await detectPrivateBrowsingMode();
    if (isPrivate) {
      notifyPrivateModeListeners(true);
      console.log('[Init] Private browsing mode detected - offline features limited');
    }

    // Check and migrate schema
    await checkAndMigrateSchema();

    // Initial storage quota check
    await checkStorageQuota();
  };

  initializeOfflineSupport();

  // Check storage quota every 5 minutes
  setInterval(() => {
    checkStorageQuota();
  }, 5 * 60 * 1000);

  // Test helper: Listen for synthetic storage quota events (for E2E tests)
  window.addEventListener('storage-quota-warning', ((event: CustomEvent<{ percentUsed: number }>) => {
    const percentUsed = event.detail.percentUsed / 100; // Convert from percentage to decimal
    const mockUsage = percentUsed * 1000000000; // 1GB * percentUsed
    const mockQuota = 1000000000; // 1GB
    const info: StorageQuotaInfo = {
      usage: mockUsage,
      quota: mockQuota,
      percentUsed,
      isWarning: percentUsed >= STORAGE_WARNING_THRESHOLD,
      isCritical: percentUsed >= STORAGE_CRITICAL_THRESHOLD,
    };
    notifyStorageQuotaListeners(info);
  }) as EventListener);
}
