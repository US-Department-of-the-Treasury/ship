import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Editor } from '@/components/Editor';
import { useAuth } from '@/hooks/useAuth';
import { EditorSkeleton } from '@/components/ui/Skeleton';
import { cn } from '@/lib/cn';

interface Feedback {
  id: string;
  title: string;
  state: string;
  feedback_status: 'draft' | 'submitted' | null;
  ticket_number: number;
  display_id: string;
  program_id: string;
  program_name: string | null;
  program_prefix: string | null;
  program_color: string | null;
  rejection_reason: string | null;
  created_at: string;
  created_by: string;
  created_by_name: string | null;
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000';

// CSRF token cache
let csrfToken: string | null = null;

async function getCsrfToken(): Promise<string> {
  if (!csrfToken) {
    const response = await fetch(`${API_URL}/api/csrf-token`, {
      credentials: 'include',
    });
    const data = await response.json();
    csrfToken = data.token;
  }
  return csrfToken!;
}

async function apiPost(endpoint: string, body?: object) {
  const token = await getCsrfToken();
  const res = await fetch(`${API_URL}${endpoint}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': token,
    },
    credentials: 'include',
    body: body ? JSON.stringify(body) : undefined,
  });

  // If CSRF token invalid, retry once
  if (res.status === 403) {
    csrfToken = null;
    const newToken = await getCsrfToken();
    return fetch(`${API_URL}${endpoint}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': newToken,
      },
      credentials: 'include',
      body: body ? JSON.stringify(body) : undefined,
    });
  }
  return res;
}

async function apiPatch(endpoint: string, body: object) {
  const token = await getCsrfToken();
  const res = await fetch(`${API_URL}${endpoint}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'X-CSRF-Token': token,
    },
    credentials: 'include',
    body: JSON.stringify(body),
  });

  if (res.status === 403) {
    csrfToken = null;
    const newToken = await getCsrfToken();
    return fetch(`${API_URL}${endpoint}`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        'X-CSRF-Token': newToken,
      },
      credentials: 'include',
      body: JSON.stringify(body),
    });
  }
  return res;
}

export function FeedbackEditorPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [loading, setLoading] = useState(true);
  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectReason, setRejectReason] = useState('');

  // Fetch the feedback data
  useEffect(() => {
    if (!id) {
      navigate('/programs');
      return;
    }

    setLoading(true);
    fetch(`${API_URL}/api/feedback/${id}`, { credentials: 'include' })
      .then(res => {
        if (!res.ok) {
          if (res.status === 404) {
            navigate('/programs');
          }
          throw new Error('Failed to fetch feedback');
        }
        return res.json();
      })
      .then(setFeedback)
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id, navigate]);

  // Handle title change
  const handleTitleChange = useCallback(async (newTitle: string) => {
    if (!feedback) return;

    try {
      const res = await apiPatch(`/api/issues/${feedback.id}`, { title: newTitle });

      if (res.ok) {
        setFeedback(prev => prev ? { ...prev, title: newTitle } : null);
      }
    } catch (err) {
      console.error('Failed to update title:', err);
    }
  }, [feedback]);

  // Handle accept action
  const handleAccept = useCallback(async () => {
    if (!feedback) return;

    try {
      const res = await apiPost(`/api/feedback/${feedback.id}/accept`);

      if (res.ok) {
        const updated = await res.json();
        setFeedback(prev => prev ? { ...prev, feedback_status: updated.feedback_status } : null);
      }
    } catch (err) {
      console.error('Failed to accept feedback:', err);
    }
  }, [feedback]);

  // Handle submit action (draft → submitted)
  const handleSubmit = useCallback(async () => {
    if (!feedback) return;

    try {
      const res = await apiPost(`/api/feedback/${feedback.id}/submit`);

      if (res.ok) {
        const updated = await res.json();
        setFeedback(prev => prev ? { ...prev, feedback_status: updated.feedback_status } : null);
      }
    } catch (err) {
      console.error('Failed to submit feedback:', err);
    }
  }, [feedback]);

  // Handle reject action
  const handleReject = useCallback(async () => {
    if (!feedback || !rejectReason.trim()) return;

    try {
      const res = await apiPost(`/api/feedback/${feedback.id}/reject`, { reason: rejectReason.trim() });

      if (res.ok) {
        const updated = await res.json();
        setFeedback(prev => prev ? { ...prev, feedback_status: updated.feedback_status, rejection_reason: updated.rejection_reason } : null);
        setShowRejectModal(false);
        setRejectReason('');
      }
    } catch (err) {
      console.error('Failed to reject feedback:', err);
    }
  }, [feedback, rejectReason]);

  // Navigate back to program feedback tab
  const handleBack = useCallback(() => {
    if (feedback?.program_id) {
      navigate(`/programs/${feedback.program_id}`);
    } else {
      navigate('/programs');
    }
  }, [feedback?.program_id, navigate]);

  if (loading) {
    return <EditorSkeleton />;
  }

  if (!user) {
    return null;
  }

  if (!feedback) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-muted">Feedback not found</p>
      </div>
    );
  }

  // Determine display status based on feedback_status and rejection_reason
  const getDisplayStatus = () => {
    if (feedback.feedback_status === 'draft') return 'draft';
    if (feedback.feedback_status === 'submitted') return 'submitted';
    if (feedback.rejection_reason) return 'rejected';
    return 'accepted';
  };

  const displayStatus = getDisplayStatus();

  const statusColors: Record<string, string> = {
    draft: 'bg-gray-500/20 text-gray-400',
    submitted: 'bg-purple-500/20 text-purple-400',
    accepted: 'bg-green-500/20 text-green-400',
    rejected: 'bg-red-500/20 text-red-400',
  };

  const statusLabels: Record<string, string> = {
    draft: 'Draft',
    submitted: 'Submitted',
    accepted: 'Accepted',
    rejected: 'Rejected',
  };

  return (
    <>
      <Editor
        documentId={feedback.id}
        userName={user.name}
        initialTitle={feedback.title}
        onTitleChange={handleTitleChange}
        onBack={handleBack}
        roomPrefix="issue"
        placeholder="Describe your feedback..."
        headerBadge={
          <div className="flex items-center gap-2">
            <span className="rounded bg-border px-2 py-0.5 text-xs font-mono font-medium text-muted">
              {feedback.display_id}
            </span>
            {feedback.feedback_status === 'draft' && (
              <button
                onClick={handleSubmit}
                className="rounded-md bg-accent px-3 py-1 text-xs font-medium text-white hover:bg-accent/90 transition-colors"
              >
                Submit Feedback
              </button>
            )}
            {feedback.feedback_status === 'submitted' && (
              <>
                <button
                  onClick={handleAccept}
                  className="rounded-md bg-green-600 px-2 py-1 text-xs font-medium text-white hover:bg-green-700 transition-colors"
                >
                  Accept
                </button>
                <button
                  onClick={() => setShowRejectModal(true)}
                  className="rounded-md bg-red-600 px-2 py-1 text-xs font-medium text-white hover:bg-red-700 transition-colors"
                >
                  Reject
                </button>
              </>
            )}
          </div>
        }
        sidebar={
          <div className="space-y-4 p-4">
            <PropertyRow label="Status">
              <span className={cn('inline-block rounded px-2 py-0.5 text-xs font-medium', statusColors[displayStatus])}>
                {statusLabels[displayStatus]}
              </span>
            </PropertyRow>

            <PropertyRow label="Program">
              {feedback.program_name ? (
                <button
                  onClick={() => navigate(`/programs/${feedback.program_id}`)}
                  className="flex items-center gap-2 text-sm text-foreground hover:text-accent transition-colors"
                >
                  {feedback.program_color && (
                    <span
                      className="inline-block h-3 w-3 rounded-full"
                      style={{ backgroundColor: feedback.program_color }}
                    />
                  )}
                  {feedback.program_name}
                </button>
              ) : (
                <span className="text-sm text-muted">None</span>
              )}
            </PropertyRow>

            <PropertyRow label="Submitted by">
              <span className="text-sm text-foreground">
                {feedback.created_by_name || 'Unknown'}
              </span>
            </PropertyRow>

            <PropertyRow label="Submitted">
              <span className="text-sm text-muted">
                {new Date(feedback.created_at).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </span>
            </PropertyRow>

            {displayStatus === 'rejected' && feedback.rejection_reason && (
              <PropertyRow label="Rejection Reason">
                <p className="text-sm text-red-400">
                  {feedback.rejection_reason}
                </p>
              </PropertyRow>
            )}
          </div>
        }
      />

      {/* Reject Modal */}
      {showRejectModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
          <div className="w-full max-w-md rounded-lg border border-border bg-background p-6">
            <h2 className="text-lg font-semibold text-foreground">Reject Feedback</h2>
            <p className="mt-1 text-sm text-muted">Why are you rejecting this feedback?</p>

            <div className="mt-4 space-y-2">
              {['Duplicate', 'Out of scope', 'Already exists', 'Won\'t fix'].map((reason) => (
                <button
                  key={reason}
                  onClick={() => setRejectReason(reason)}
                  className={cn(
                    'w-full rounded-md px-3 py-2 text-left text-sm transition-colors',
                    rejectReason === reason
                      ? 'bg-accent text-white'
                      : 'bg-border/50 text-foreground hover:bg-border'
                  )}
                >
                  {reason}
                </button>
              ))}
            </div>

            <textarea
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              placeholder="Or enter a custom reason..."
              rows={2}
              className="mt-4 w-full rounded-md border border-border bg-background px-3 py-2 text-foreground placeholder:text-muted focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
            />

            <div className="mt-4 flex justify-end gap-2">
              <button
                onClick={() => {
                  setShowRejectModal(false);
                  setRejectReason('');
                }}
                className="rounded-md px-4 py-2 text-sm text-muted hover:bg-border transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleReject}
                disabled={!rejectReason.trim()}
                className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Reject
              </button>
            </div>
          </div>
        </div>
      )}
    </>
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
