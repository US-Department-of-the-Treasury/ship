import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { apiGet, apiPost, apiPatch } from '@/lib/api';

export interface ProgramOwner {
  id: string;
  name: string;
  email: string;
}

export interface Program {
  id: string;
  name: string;
  prefix: string;
  color: string;
  archived_at: string | null;
  issue_count?: number;
  sprint_count?: number;
  owner: ProgramOwner | null;
}

interface ProgramsContextValue {
  programs: Program[];
  loading: boolean;
  createProgram: () => Promise<Program | null>;
  updateProgram: (id: string, updates: Partial<Program> & { owner_id?: string | null }) => Promise<Program | null>;
  refreshPrograms: () => Promise<void>;
}

const ProgramsContext = createContext<ProgramsContextValue | null>(null);

export function ProgramsProvider({ children }: { children: ReactNode }) {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshPrograms = useCallback(async () => {
    try {
      const res = await apiGet('/api/programs');
      if (res.ok) {
        const data = await res.json();
        setPrograms(data);
      }
    } catch (err) {
      console.error('Failed to fetch programs:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshPrograms();
  }, [refreshPrograms]);

  const createProgram = useCallback(async (): Promise<Program | null> => {
    try {
      const res = await apiPost('/api/programs', { title: 'Untitled' });
      if (res.ok) {
        const program = await res.json();
        setPrograms(prev => [program, ...prev]);
        return program;
      }
    } catch (err) {
      console.error('Failed to create program:', err);
    }
    return null;
  }, []);

  const updateProgram = useCallback(async (id: string, updates: Partial<Program> & { owner_id?: string | null }): Promise<Program | null> => {
    try {
      // Map frontend field names to API field names (API uses 'title', returns as 'name')
      const apiUpdates: Record<string, unknown> = {};
      if (updates.name !== undefined) apiUpdates.title = updates.name;
      if (updates.color !== undefined) apiUpdates.color = updates.color;
      if (updates.archived_at !== undefined) apiUpdates.archived_at = updates.archived_at;
      if (updates.owner_id !== undefined) apiUpdates.owner_id = updates.owner_id;

      const res = await apiPatch(`/api/programs/${id}`, apiUpdates);
      if (res.ok) {
        const updated = await res.json();
        // Update the program in the shared state, preserving counts from existing data
        setPrograms(prev => prev.map(p => p.id === id ? {
          ...p, // preserve existing fields like issue_count, sprint_count
          ...updated // apply updates from API
        } : p));
        return updated;
      }
    } catch (err) {
      console.error('Failed to update program:', err);
    }
    return null;
  }, []);

  return (
    <ProgramsContext.Provider value={{ programs, loading, createProgram, updateProgram, refreshPrograms }}>
      {children}
    </ProgramsContext.Provider>
  );
}

export function usePrograms() {
  const context = useContext(ProgramsContext);
  if (!context) {
    throw new Error('usePrograms must be used within ProgramsProvider');
  }
  return context;
}
