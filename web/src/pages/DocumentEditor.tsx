import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Editor } from '@/components/Editor';
import { useAuth } from '@/hooks/useAuth';
import { cn } from '@/lib/cn';

interface Document {
  id: string;
  title: string;
  document_type: string;
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

export function DocumentEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [document, setDocument] = useState<Document | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (id) {
      fetchDocument();
    }
  }, [id]);

  async function fetchDocument() {
    try {
      const res = await fetch(`${API_URL}/api/documents/${id}`, {
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        setDocument(data);
      } else if (res.status === 404) {
        navigate('/docs');
      }
    } catch (err) {
      console.error('Failed to fetch document:', err);
    } finally {
      setLoading(false);
    }
  }

  const handleTitleChange = useCallback(async (newTitle: string) => {
    if (!id || !newTitle) return;

    setSaving(true);
    try {
      await fetch(`${API_URL}/api/documents/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ title: newTitle }),
      });
      setDocument((prev) => prev ? { ...prev, title: newTitle } : null);
    } catch (err) {
      console.error('Failed to update title:', err);
    } finally {
      setSaving(false);
    }
  }, [id]);

  // Debounce title updates
  const [titleTimeout, setTitleTimeout] = useState<ReturnType<typeof setTimeout> | null>(null);
  const debouncedTitleChange = useCallback((newTitle: string) => {
    if (titleTimeout) clearTimeout(titleTimeout);
    setTitleTimeout(setTimeout(() => handleTitleChange(newTitle), 500));
  }, [handleTitleChange, titleTimeout]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted">Loading...</div>
      </div>
    );
  }

  if (!document || !user) {
    return null;
  }

  return (
    <Editor
      documentId={document.id}
      userName={user.name}
      initialTitle={document.title}
      onTitleChange={debouncedTitleChange}
      onBack={() => navigate('/docs')}
    />
  );
}
