import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

export interface Program {
  id: string;
  name: string;
  prefix: string;
  color: string;
  archived_at: string | null;
  issue_count?: number;
  sprint_count?: number;
}

interface ProgramsContextValue {
  programs: Program[];
  loading: boolean;
  createProgram: () => Promise<Program | null>;
  updateProgram: (id: string, updates: Partial<Program>) => Promise<Program | null>;
  refreshPrograms: () => Promise<void>;
}

const ProgramsContext = createContext<ProgramsContextValue | null>(null);

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export function ProgramsProvider({ children }: { children: ReactNode }) {
  const [programs, setPrograms] = useState<Program[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshPrograms = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/programs`, {
        credentials: 'include',
      });
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
      const res = await fetch(`${API_URL}/api/programs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ title: 'Untitled' }),
      });
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

  const updateProgram = useCallback(async (id: string, updates: Partial<Program>): Promise<Program | null> => {
    try {
      // Map frontend field names to API field names (API uses 'title', returns as 'name')
      const apiUpdates: Record<string, unknown> = {};
      if (updates.name !== undefined) apiUpdates.title = updates.name;
      if (updates.color !== undefined) apiUpdates.color = updates.color;
      if (updates.archived_at !== undefined) apiUpdates.archived_at = updates.archived_at;

      const res = await fetch(`${API_URL}/api/programs/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(apiUpdates),
      });
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
