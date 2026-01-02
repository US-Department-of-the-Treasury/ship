import { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api';

export interface WikiDocument {
  id: string;
  title: string;
  document_type: string;
  parent_id: string | null;
  position: number;
  created_at: string;
  updated_at: string;
  created_by?: string | null;
  properties?: Record<string, unknown>;
}

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
  const [documents, setDocuments] = useState<WikiDocument[]>([]);
  const [loading, setLoading] = useState(true);

  const refreshDocuments = useCallback(async () => {
    try {
      const res = await apiGet('/api/documents?type=wiki');
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

  const createDocument = useCallback(async (parentId?: string): Promise<WikiDocument | null> => {
    try {
      const res = await apiPost('/api/documents', {
        title: 'Untitled',
        document_type: 'wiki',
        parent_id: parentId || null,
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

  const updateDocument = useCallback(async (id: string, updates: Partial<WikiDocument>): Promise<WikiDocument | null> => {
    try {
      const res = await apiPatch(`/api/documents/${id}`, updates);
      if (res.ok) {
        const updated = await res.json();
        setDocuments(prev => prev.map(d => d.id === id ? { ...d, ...updated } : d));
        return updated;
      }
    } catch (err) {
      console.error('Failed to update document:', err);
    }
    return null;
  }, []);

  const deleteDocument = useCallback(async (id: string): Promise<boolean> => {
    try {
      const res = await apiDelete(`/api/documents/${id}`);
      if (res.ok) {
        setDocuments(prev => prev.filter(d => d.id !== id));
        return true;
      }
    } catch (err) {
      console.error('Failed to delete document:', err);
    }
    return false;
  }, []);

  return (
    <DocumentsContext.Provider value={{ documents, loading, createDocument, updateDocument, deleteDocument, refreshDocuments }}>
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
