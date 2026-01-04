import { createContext, useContext, ReactNode } from 'react';
import { usePrograms as useProgramsQuery, Program, ProgramOwner } from '@/hooks/useProgramsQuery';

export type { Program, ProgramOwner };

interface ProgramsContextValue {
  programs: Program[];
  loading: boolean;
  createProgram: () => Promise<Program | null>;
  updateProgram: (id: string, updates: Partial<Program> & { owner_id?: string | null }) => Promise<Program | null>;
  refreshPrograms: () => Promise<void>;
}

const ProgramsContext = createContext<ProgramsContextValue | null>(null);

export function ProgramsProvider({ children }: { children: ReactNode }) {
  const programsData = useProgramsQuery();

  return (
    <ProgramsContext.Provider value={programsData}>
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
