import { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/cn';
import { useToast } from '@/components/ui/Toast';
import { useAuth } from '@/hooks/useAuth';

interface Standup {
  id: string;
  sprint_id: string;
  title: string;
  content: Record<string, unknown>;
  author_id: string;
  author_name: string | null;
  author_email: string | null;
  created_at: string;
  updated_at: string;
}

interface StandupFeedProps {
  sprintId: string;
}

const API_URL = import.meta.env.VITE_API_URL ?? '';

// CSRF token cache
let csrfToken: string | null = null;

async function getCsrfToken(): Promise<string> {
  if (!csrfToken) {
    const response = await fetch(`${API_URL}/api/csrf-token`, { credentials: 'include' });
    const data = await response.json();
    csrfToken = data.token;
  }
  return csrfToken!;
}

async function fetchWithCsrf(url: string, method: string, body?: object): Promise<Response> {
  const token = await getCsrfToken();
  const options: RequestInit = {
    method,
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
    credentials: 'include',
  };
  if (body) {
    options.body = JSON.stringify(body);
  }
  let res = await fetch(url, options);
  if (res.status === 403) {
    csrfToken = null;
    const newToken = await getCsrfToken();
    options.headers = { 'Content-Type': 'application/json', 'X-CSRF-Token': newToken };
    res = await fetch(url, options);
  }
  return res;
}

export function StandupFeed({ sprintId }: StandupFeedProps) {
  const [standups, setStandups] = useState<Standup[]>([]);
  const [loading, setLoading] = useState(true);
  const [showEditor, setShowEditor] = useState(false);
  const [editorContent, setEditorContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const { showToast } = useToast();
  const { user } = useAuth();

  const fetchStandups = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/sprints/${sprintId}/standups`, { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setStandups(data);
      } else {
        showToast('Failed to load standups', 'error');
      }
    } catch (err) {
      console.error('Failed to fetch standups:', err);
      showToast('Failed to load standups. Please try again.', 'error');
    } finally {
      setLoading(false);
    }
  }, [sprintId, showToast]);

  useEffect(() => {
    fetchStandups();
  }, [fetchStandups]);

  const handleSubmit = async () => {
    if (!editorContent.trim()) return;

    setSaving(true);
    try {
      // Create simple TipTap content from plain text
      const content = {
        type: 'doc',
        content: editorContent.split('\n').map(line => ({
          type: 'paragraph',
          content: line ? [{ type: 'text', text: line }] : [],
        })),
      };

      const res = await fetchWithCsrf(`${API_URL}/api/sprints/${sprintId}/standups`, 'POST', {
        content,
        title: `Standup - ${new Date().toLocaleDateString()}`,
      });

      if (res.ok) {
        setEditorContent('');
        setShowEditor(false);
        fetchStandups();
        showToast('Standup posted', 'success');
      } else {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || 'Failed to post standup', 'error');
      }
    } catch (err) {
      console.error('Failed to create standup:', err);
      showToast('Failed to post standup. Please try again.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (standup: Standup) => {
    setEditingId(standup.id);
    setEditContent(extractTextFromContent(standup.content));
  };

  const handleSaveEdit = async (standupId: string) => {
    if (!editContent.trim()) return;

    try {
      const content = {
        type: 'doc',
        content: editContent.split('\n').map(line => ({
          type: 'paragraph',
          content: line ? [{ type: 'text', text: line }] : [],
        })),
      };

      const res = await fetchWithCsrf(`${API_URL}/api/standups/${standupId}`, 'PATCH', { content });

      if (res.ok) {
        setEditingId(null);
        setEditContent('');
        fetchStandups();
        showToast('Standup updated', 'success');
      } else if (res.status === 403) {
        showToast('You can only edit your own standups', 'error');
      } else {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || 'Failed to update standup', 'error');
      }
    } catch (err) {
      console.error('Failed to update standup:', err);
      showToast('Failed to update standup. Please try again.', 'error');
    }
  };

  const handleDelete = async (standupId: string) => {
    if (!confirm('Delete this standup update?')) return;

    try {
      const res = await fetchWithCsrf(`${API_URL}/api/standups/${standupId}`, 'DELETE');

      if (res.ok || res.status === 204) {
        fetchStandups();
        showToast('Standup deleted', 'success');
      } else if (res.status === 403) {
        showToast('You can only delete your own standups', 'error');
      } else {
        const data = await res.json().catch(() => ({}));
        showToast(data.error || 'Failed to delete standup', 'error');
      }
    } catch (err) {
      console.error('Failed to delete standup:', err);
      showToast('Failed to delete standup. Please try again.', 'error');
    }
  };

  // Group standups by date
  const groupedStandups = groupByDate(standups);

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-muted">Loading standups...</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Standup feed */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {standups.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-muted">
            <svg className="h-12 w-12 mb-4 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
            </svg>
            <p className="text-sm">No standup updates yet</p>
            <p className="text-xs mt-1">Be the first to share a status update</p>
          </div>
        ) : (
          <div className="space-y-6">
            {groupedStandups.map(({ label, standups: dateStandups }) => (
              <div key={label}>
                <div className="sticky top-0 bg-background py-2">
                  <span className="text-xs font-medium text-muted uppercase tracking-wide">
                    {label}
                  </span>
                </div>
                <div className="space-y-3">
                  {dateStandups.map((standup) => (
                    <StandupCard
                      key={standup.id}
                      standup={standup}
                      isOwner={user?.id === standup.author_id}
                      isEditing={editingId === standup.id}
                      editContent={editContent}
                      onEditContentChange={setEditContent}
                      onEdit={() => handleEdit(standup)}
                      onSaveEdit={() => handleSaveEdit(standup.id)}
                      onCancelEdit={() => { setEditingId(null); setEditContent(''); }}
                      onDelete={() => handleDelete(standup.id)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add standup form */}
      <div className="border-t border-border px-6 py-4">
        {showEditor ? (
          <div className="space-y-3">
            <textarea
              value={editorContent}
              onChange={(e) => setEditorContent(e.target.value)}
              placeholder="What did you work on? Any blockers? What's next?"
              className="w-full h-32 rounded-lg border border-border bg-background px-4 py-3 text-sm text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent resize-none"
              autoFocus
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowEditor(false);
                  setEditorContent('');
                }}
                className="rounded-md px-4 py-2 text-sm text-muted hover:bg-border transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSubmit}
                disabled={!editorContent.trim() || saving}
                className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? 'Posting...' : 'Post Update'}
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowEditor(true)}
            className="w-full rounded-lg border border-border border-dashed px-4 py-3 text-sm text-muted hover:border-accent hover:text-foreground transition-colors"
          >
            + Add Standup Update
          </button>
        )}
      </div>
    </div>
  );
}

interface StandupCardProps {
  standup: Standup;
  isOwner: boolean;
  isEditing: boolean;
  editContent: string;
  onEditContentChange: (content: string) => void;
  onEdit: () => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
}

function StandupCard({
  standup,
  isOwner,
  isEditing,
  editContent,
  onEditContentChange,
  onEdit,
  onSaveEdit,
  onCancelEdit,
  onDelete,
}: StandupCardProps) {
  // Extract text from TipTap content
  const textContent = extractTextFromContent(standup.content);

  return (
    <div className="rounded-lg border border-border bg-background p-4">
      <div className="flex items-center gap-3 mb-3">
        {/* Author avatar */}
        <div className="h-8 w-8 rounded-full bg-accent/20 flex items-center justify-center">
          <span className="text-sm font-medium text-accent">
            {standup.author_name?.[0]?.toUpperCase() || standup.author_email?.[0]?.toUpperCase() || '?'}
          </span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-foreground truncate">
            {standup.author_name || standup.author_email || 'Unknown'}
          </p>
          <p className="text-xs text-muted">
            {formatTime(standup.created_at)}
          </p>
        </div>
        {/* Edit/Delete buttons for owner */}
        {isOwner && !isEditing && (
          <div className="flex gap-1">
            <button
              onClick={onEdit}
              className="p-1.5 rounded text-muted hover:text-foreground hover:bg-border transition-colors"
              title="Edit"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
            </button>
            <button
              onClick={onDelete}
              className="p-1.5 rounded text-muted hover:text-red-500 hover:bg-red-500/10 transition-colors"
              title="Delete"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
            </button>
          </div>
        )}
      </div>
      {isEditing ? (
        <div className="space-y-2">
          <textarea
            value={editContent}
            onChange={(e) => onEditContentChange(e.target.value)}
            className="w-full h-24 rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent resize-none"
            autoFocus
          />
          <div className="flex justify-end gap-2">
            <button
              onClick={onCancelEdit}
              className="rounded-md px-3 py-1.5 text-xs text-muted hover:bg-border transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onSaveEdit}
              disabled={!editContent.trim()}
              className="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent/90 transition-colors disabled:opacity-50"
            >
              Save
            </button>
          </div>
        </div>
      ) : (
        <div className="text-sm text-foreground whitespace-pre-wrap">
          {textContent}
        </div>
      )}
    </div>
  );
}

// Helper to extract text from TipTap content
function extractTextFromContent(content: Record<string, unknown>): string {
  if (!content || typeof content !== 'object') return '';

  const doc = content as { type?: string; content?: unknown[] };
  if (doc.type !== 'doc' || !Array.isArray(doc.content)) return '';

  const lines: string[] = [];
  for (const node of doc.content) {
    const nodeObj = node as { type?: string; content?: unknown[] };
    if (nodeObj.type === 'paragraph' && Array.isArray(nodeObj.content)) {
      const texts = nodeObj.content
        .filter((c): c is { type: string; text: string } =>
          typeof c === 'object' && c !== null && 'text' in c
        )
        .map(c => c.text);
      lines.push(texts.join(''));
    } else if (nodeObj.type === 'paragraph') {
      lines.push('');
    }
  }

  return lines.join('\n');
}

// Group standups by date with friendly labels
function groupByDate(standups: Standup[]): { label: string; standups: Standup[] }[] {
  const groups: Record<string, Standup[]> = {};
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  for (const standup of standups) {
    const date = new Date(standup.created_at);
    date.setHours(0, 0, 0, 0);

    let label: string;
    if (date.getTime() === today.getTime()) {
      label = 'Today';
    } else if (date.getTime() === yesterday.getTime()) {
      label = 'Yesterday';
    } else {
      label = date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    }

    if (!groups[label]) {
      groups[label] = [];
    }
    groups[label].push(standup);
  }

  // Convert to array and maintain order (most recent first)
  return Object.entries(groups).map(([label, standups]) => ({
    label,
    standups,
  }));
}

// Format time for display
function formatTime(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}
