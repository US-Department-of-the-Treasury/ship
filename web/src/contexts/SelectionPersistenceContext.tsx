import { createContext, useContext, useCallback, useRef, ReactNode } from 'react';

interface SelectionState {
  selectedIds: Set<string>;
  lastSelectedId: string | null;
}

interface SelectionPersistenceContextValue {
  getSelection: (key: string) => SelectionState;
  setSelection: (key: string, state: SelectionState) => void;
  clearSelection: (key: string) => void;
  clearAllSelections: () => void;
}

const defaultState: SelectionState = {
  selectedIds: new Set(),
  lastSelectedId: null,
};

const SelectionPersistenceContext = createContext<SelectionPersistenceContextValue | null>(null);

export function SelectionPersistenceProvider({ children }: { children: ReactNode }) {
  // Use ref to avoid re-renders when selections change
  const selectionsRef = useRef<Map<string, SelectionState>>(new Map());

  const getSelection = useCallback((key: string): SelectionState => {
    return selectionsRef.current.get(key) || defaultState;
  }, []);

  const setSelection = useCallback((key: string, state: SelectionState) => {
    selectionsRef.current.set(key, state);
  }, []);

  const clearSelection = useCallback((key: string) => {
    selectionsRef.current.delete(key);
  }, []);

  const clearAllSelections = useCallback(() => {
    selectionsRef.current.clear();
  }, []);

  return (
    <SelectionPersistenceContext.Provider
      value={{ getSelection, setSelection, clearSelection, clearAllSelections }}
    >
      {children}
    </SelectionPersistenceContext.Provider>
  );
}

export function useSelectionPersistence() {
  const context = useContext(SelectionPersistenceContext);
  if (!context) {
    throw new Error('useSelectionPersistence must be used within a SelectionPersistenceProvider');
  }
  return context;
}

// Optional hook for when context might not be available
export function useSelectionPersistenceOptional() {
  return useContext(SelectionPersistenceContext);
}
