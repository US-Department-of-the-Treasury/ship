import { createContext, useContext, useMemo, useEffect, ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';

interface ArchivedPersonsContextValue {
  /** Set of archived person document IDs */
  archivedPersonIds: Set<string>;
  /** Whether the data is still loading */
  isLoading: boolean;
}

const ArchivedPersonsContext = createContext<ArchivedPersonsContextValue | null>(null);

// Query key for archived persons
export const archivedPersonsKey = ['archivedPersons'] as const;

// Fetch archived person IDs
async function fetchArchivedPersonIds(): Promise<string[]> {
  // Get all people including archived, then filter to just archived ones
  const res = await apiGet('/api/team/people?includeArchived=true');
  if (!res.ok) {
    throw new Error('Failed to fetch team members');
  }
  const data = await res.json();
  // Return just the IDs of archived persons
  return data
    .filter((p: { isArchived?: boolean }) => p.isArchived)
    .map((p: { id: string }) => p.id);
}

export function ArchivedPersonsProvider({ children }: { children: ReactNode }) {
  const { data: archivedIds = [], isLoading } = useQuery({
    queryKey: archivedPersonsKey,
    queryFn: fetchArchivedPersonIds,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  const archivedPersonIds = useMemo(() => new Set(archivedIds), [archivedIds]);

  // Sync to global state for TipTap NodeView access
  useEffect(() => {
    setGlobalArchivedIds(archivedPersonIds);
  }, [archivedPersonIds]);

  const value = useMemo<ArchivedPersonsContextValue>(() => ({
    archivedPersonIds,
    isLoading,
  }), [archivedPersonIds, isLoading]);

  return (
    <ArchivedPersonsContext.Provider value={value}>
      {children}
    </ArchivedPersonsContext.Provider>
  );
}

export function useArchivedPersons() {
  const context = useContext(ArchivedPersonsContext);
  if (!context) {
    throw new Error('useArchivedPersons must be used within ArchivedPersonsProvider');
  }
  return context;
}

// Global state for TipTap NodeViews with subscription support
let globalArchivedIds: Set<string> = new Set();
const listeners = new Set<() => void>();

export function setGlobalArchivedIds(ids: Set<string>) {
  globalArchivedIds = ids;
  // Notify all subscribers that the data changed
  listeners.forEach(listener => listener());
}

export function isPersonArchived(personId: string): boolean {
  return globalArchivedIds.has(personId);
}

// For useSyncExternalStore
export function subscribeToArchivedIds(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

export function getArchivedIdsSnapshot(): Set<string> {
  return globalArchivedIds;
}
