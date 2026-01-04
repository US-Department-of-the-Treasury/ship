import { createContext, useContext, ReactNode } from 'react';
import { useIssues as useIssuesQuery, Issue } from '@/hooks/useIssuesQuery';

export type { Issue };

interface IssuesContextValue {
  issues: Issue[];
  loading: boolean;
  createIssue: () => Promise<Issue | null>;
  updateIssue: (id: string, updates: Partial<Issue>) => Promise<Issue | null>;
  refreshIssues: () => Promise<void>;
}

const IssuesContext = createContext<IssuesContextValue | null>(null);

export function IssuesProvider({ children }: { children: ReactNode }) {
  const issuesData = useIssuesQuery();

  return (
    <IssuesContext.Provider value={issuesData}>
      {children}
    </IssuesContext.Provider>
  );
}

export function useIssues() {
  const context = useContext(IssuesContext);
  if (!context) {
    throw new Error('useIssues must be used within IssuesProvider');
  }
  return context;
}
