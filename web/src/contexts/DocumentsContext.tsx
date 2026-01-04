import { createContext, useContext, ReactNode } from 'react';
import { useDocuments as useDocumentsQuery, WikiDocument } from '@/hooks/useDocumentsQuery';

export type { WikiDocument };

interface DocumentsContextValue {
  documents: WikiDocument[];
  loading: boolean;
  createDocument: (parentId?: string) => Promise<WikiDocument | null>;
  updateDocument: (id: string, updates: Partial<WikiDocument>) => Promise<WikiDocument | null>;
  deleteDocument: (id: string) => Promise<boolean>;
  refreshDocuments: () => Promise<void>;
}

const DocumentsContext = createContext<DocumentsContextValue | null>(null);

export function DocumentsProvider({ children }: { children: ReactNode }) {
  const documentsData = useDocumentsQuery();

  return (
    <DocumentsContext.Provider value={documentsData}>
      {children}
    </DocumentsContext.Provider>
  );
}

export function useDocuments() {
  const context = useContext(DocumentsContext);
  if (!context) {
    throw new Error('useDocuments must be used within DocumentsProvider');
  }
  return context;
}
