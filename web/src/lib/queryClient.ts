import { QueryClient, MutationCache, QueryCache } from '@tanstack/react-query';
import { get, set, del, createStore } from 'idb-keyval';
import type { PersistedClient, Persister } from '@tanstack/react-query-persist-client';

// IndexedDB store for query cache
const queryStore = createStore('ship-query-cache', 'queries');

// IndexedDB store for pending mutations (offline queue)
const mutationStore = createStore('ship-mutation-queue', 'mutations');

// Pending mutation tracking for UI
export interface PendingMutation {
  id: string;
  type: 'create' | 'update' | 'delete';
  resource: 'document' | 'issue' | 'program' | 'sprint' | 'person';
  resourceId?: string;
  data: unknown;
  timestamp: number;
  retryCount: number;
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

export function addPendingMutation(mutation: Omit<PendingMutation, 'id' | 'timestamp' | 'retryCount'>) {
  const newMutation: PendingMutation = {
    ...mutation,
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    retryCount: 0,
  };
  pendingMutations = [...pendingMutations, newMutation];
  notifyPendingMutationListeners();
  // Persist to IndexedDB
  set('pending', pendingMutations, mutationStore).catch(console.error);
  return newMutation.id;
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

if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    isOnline = true;
    notifyOnlineListeners();
  });
  window.addEventListener('offline', () => {
    isOnline = false;
    notifyOnlineListeners();
  });
}

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
      networkMode: 'offlineFirst',
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
