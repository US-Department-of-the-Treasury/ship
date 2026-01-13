import { useState, useEffect, useCallback } from 'react';
import { useEditor, EditorContent, JSONContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import { cn } from '@/lib/cn';

interface SprintReviewProps {
  sprintId: string;
}

interface ReviewData {
  id?: string;
  content: JSONContent;
  is_draft: boolean;
  hypothesis_validated?: boolean | null;
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

async function postWithCsrf(url: string, body: object): Promise<Response> {
  const token = await getCsrfToken();
  let res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  if (res.status === 403) {
    csrfToken = null;
    const newToken = await getCsrfToken();
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': newToken },
      credentials: 'include',
      body: JSON.stringify(body),
    });
  }
  return res;
}

async function patchWithCsrf(url: string, body: object): Promise<Response> {
  const token = await getCsrfToken();
  let res = await fetch(url, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': token },
    credentials: 'include',
    body: JSON.stringify(body),
  });
  if (res.status === 403) {
    csrfToken = null;
    const newToken = await getCsrfToken();
    res = await fetch(url, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': newToken },
      credentials: 'include',
      body: JSON.stringify(body),
    });
  }
  return res;
}

export function SprintReview({ sprintId }: SprintReviewProps) {
  const [reviewData, setReviewData] = useState<ReviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hypothesisValidated, setHypothesisValidated] = useState<boolean | null>(null);
  const [isDirty, setIsDirty] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Placeholder.configure({
        placeholder: 'Write your sprint review...',
      }),
    ],
    content: '',
    onUpdate: () => {
      setIsDirty(true);
    },
  });

  const fetchReview = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/sprints/${sprintId}/review`, { credentials: 'include' });
      if (res.ok) {
        const data: ReviewData = await res.json();
        setReviewData(data);
        setHypothesisValidated(data.hypothesis_validated ?? null);
        if (editor && data.content) {
          editor.commands.setContent(data.content);
        }
      }
    } catch (err) {
      console.error('Failed to fetch sprint review:', err);
    } finally {
      setLoading(false);
    }
  }, [sprintId, editor]);

  useEffect(() => {
    if (editor) {
      fetchReview();
    }
  }, [fetchReview, editor]);

  const handleSave = async () => {
    if (!editor) return;

    setSaving(true);
    try {
      const content = editor.getJSON();

      if (reviewData?.is_draft) {
        // POST to create new review
        const res = await postWithCsrf(`${API_URL}/api/sprints/${sprintId}/review`, {
          content,
          hypothesis_validated: hypothesisValidated,
        });
        if (res.ok) {
          const data = await res.json();
          setReviewData({ ...data, is_draft: false });
          setIsDirty(false);
        }
      } else {
        // PATCH to update existing review
        const res = await patchWithCsrf(`${API_URL}/api/sprints/${sprintId}/review`, {
          content,
          hypothesis_validated: hypothesisValidated,
        });
        if (res.ok) {
          setIsDirty(false);
        }
      }
    } catch (err) {
      console.error('Failed to save sprint review:', err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <div className="text-muted">Loading review...</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Review content */}
      <div className="flex-1 overflow-auto">
        <div className="flex h-full">
          {/* Editor area */}
          <div className="flex-1 px-6 py-4">
            {reviewData?.is_draft && (
              <div className="mb-4 rounded-md border border-yellow-500/50 bg-yellow-500/10 px-4 py-2 text-sm text-yellow-600">
                This is a pre-filled draft. Edit and save to finalize your sprint review.
              </div>
            )}
            <div className="prose prose-sm max-w-none">
              <EditorContent
                editor={editor}
                className="min-h-[400px] rounded-lg border border-border bg-background p-4 focus-within:border-accent focus-within:ring-1 focus-within:ring-accent [&_.ProseMirror]:outline-none [&_.ProseMirror]:min-h-[350px]"
              />
            </div>
          </div>

          {/* Properties sidebar */}
          <div className="w-64 border-l border-border p-4">
            <h3 className="text-sm font-medium text-foreground mb-4">Properties</h3>

            {/* Hypothesis Validation */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted uppercase tracking-wide">
                Hypothesis Validation
              </label>
              <div className="flex flex-col gap-2">
                <button
                  onClick={() => setHypothesisValidated(true)}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    hypothesisValidated === true
                      ? 'bg-green-500/20 text-green-600 border border-green-500'
                      : 'bg-border/50 text-muted hover:bg-border'
                  )}
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Validated
                </button>
                <button
                  onClick={() => setHypothesisValidated(false)}
                  className={cn(
                    'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                    hypothesisValidated === false
                      ? 'bg-red-500/20 text-red-600 border border-red-500'
                      : 'bg-border/50 text-muted hover:bg-border'
                  )}
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                  Invalidated
                </button>
                {hypothesisValidated !== null && (
                  <button
                    onClick={() => setHypothesisValidated(null)}
                    className="text-xs text-muted hover:text-foreground transition-colors"
                  >
                    Clear selection
                  </button>
                )}
              </div>
            </div>

            {/* Status indicator */}
            <div className="mt-6 pt-4 border-t border-border">
              <div className="text-xs text-muted">
                {reviewData?.is_draft ? (
                  <span className="text-yellow-600">Draft - not yet saved</span>
                ) : (
                  <span className="text-green-600">Saved</span>
                )}
                {isDirty && !reviewData?.is_draft && (
                  <span className="text-yellow-600"> (unsaved changes)</span>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Save button footer */}
      <div className="border-t border-border px-6 py-4 flex justify-end gap-2">
        <button
          onClick={handleSave}
          disabled={saving || (!isDirty && !reviewData?.is_draft)}
          className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {saving ? 'Saving...' : reviewData?.is_draft ? 'Save Review' : 'Update Review'}
        </button>
      </div>
    </div>
  );
}
