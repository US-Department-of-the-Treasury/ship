import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

export interface WikiDocument {
  id: string;
  title: string;
  document_type: string;
  created_at: string;
  updated_at: string;
}

interface DocumentsContextValue {
  documents: WikiDocument[];
  loading: boolean;
  createDocument: () => Promise<WikiDocument | null>;
  refreshDocuments: () => Promise<void>;
}

const DocumentsContext = createContext<DocumentsContextValue | null>(null);

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export function DocumentsProvider({ children }: { children: ReactNode }) {
  const [documents, setDocuments] = useState<WikiDocument[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshDocuments = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/documents?type=wiki`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setDocuments(data);
      }
    } catch (err) {
      console.error('Failed to fetch documents:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshDocuments();
  }, [refreshDocuments]);

  const createDocument = useCallback(async (): Promise<WikiDocument | null> => {
    try {
      const res = await fetch(`${API_URL}/api/documents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ title: 'Untitled', document_type: 'wiki' }),
      });
      if (res.ok) {
        const doc = await res.json();
        setDocuments(prev => [doc, ...prev]);
        return doc;
      }
    } catch (err) {
      console.error('Failed to create document:', err);
    }
    return null;
  }, []);

  return (
    <DocumentsContext.Provider value={{ documents, loading, createDocument, refreshDocuments }}>
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
