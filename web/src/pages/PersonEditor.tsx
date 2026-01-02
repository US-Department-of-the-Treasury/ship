import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Editor } from '@/components/Editor';
import { useAuth } from '@/hooks/useAuth';
import { useAutoSave } from '@/hooks/useAutoSave';

const API_URL = import.meta.env.VITE_API_URL ?? '';

interface PersonDocument {
  id: string;
  title: string;
  content: unknown;
  document_type: string;
}

export function PersonEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const [person, setPerson] = useState<PersonDocument | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchPerson() {
      if (!id) return;
      try {
        const response = await fetch(`${API_URL}/api/documents/${id}`, {
          credentials: 'include',
        });
        if (response.ok) {
          const data = await response.json();
          if (data.document_type === 'person') {
            setPerson(data);
          } else {
            // Not a person document, redirect to directory
            navigate('/team/directory');
          }
        } else {
          navigate('/team/directory');
        }
      } catch (error) {
        console.error('Failed to fetch person:', error);
        navigate('/team/directory');
      } finally {
        setLoading(false);
      }
    }
    fetchPerson();
  }, [id, navigate]);

  // Throttled title save with stale response handling
  const throttledTitleSave = useAutoSave({
    onSave: async (newTitle: string) => {
      if (!id) return;
      const title = newTitle || 'Untitled';
      await fetch(`${API_URL}/api/documents/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ title }),
      });
    },
  });

  const handleDelete = useCallback(async () => {
    if (!id || !confirm('Delete this person? This cannot be undone.')) return;

    try {
      const response = await fetch(`${API_URL}/api/documents/${id}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (response.ok) {
        navigate('/team/directory');
      }
    } catch (error) {
      console.error('Failed to delete person:', error);
    }
  }, [id, navigate]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-muted">Loading...</div>
      </div>
    );
  }

  if (!person || !id) {
    return null;
  }

  return (
    <Editor
      documentId={id}
      userName={user?.name || 'Anonymous'}
      initialTitle={person.title}
      onTitleChange={throttledTitleSave}
      onBack={() => navigate('/team/directory')}
      backLabel="Team Directory"
      roomPrefix="person"
      placeholder="Add bio, contact info, skills..."
      onDelete={handleDelete}
      sidebar={
        <div className="space-y-4 p-4">
          <PropertyRow label="Email">
            <div className="text-sm text-foreground">
              {person.title.toLowerCase().replace(/\s+/g, '.')}@example.com
            </div>
          </PropertyRow>
          <PropertyRow label="Role">
            <div className="text-sm text-muted">Not set</div>
          </PropertyRow>
          <PropertyRow label="Department">
            <div className="text-sm text-muted">Not set</div>
          </PropertyRow>
        </div>
      }
    />
  );
}

function PropertyRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-xs font-medium text-muted">{label}</label>
      {children}
    </div>
  );
}
