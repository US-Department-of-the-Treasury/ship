import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { apiGet, apiPost } from '@/lib/api';
import { cn } from '@/lib/cn';
import { useToast } from '@/components/ui/Toast';
import { useReviewQueue } from '@/contexts/ReviewQueueContext';

const OPM_RATINGS = [
  { value: 5, label: 'Outstanding', color: 'text-green-500' },
  { value: 4, label: 'Exceeds Expectations', color: 'text-blue-500' },
  { value: 3, label: 'Fully Successful', color: 'text-muted' },
  { value: 2, label: 'Minimally Satisfactory', color: 'text-orange-500' },
  { value: 1, label: 'Unacceptable', color: 'text-red-500' },
] as const;

type ReviewAction = 'approve' | 'request_changes';

type WeeklyReviewDocument = {
  document_type: 'weekly_plan' | 'weekly_retro';
  properties?: {
    week_number?: number;
    person_id?: string;
    project_id?: string;
  };
};

type SprintApprovalData = {
  id: string;
  properties: Record<string, unknown>;
};

export function ReviewSessionSubBar({
  document,
}: {
  document: WeeklyReviewDocument;
}) {
  const [searchParams] = useSearchParams();
  const sprintIdParam = searchParams.get('sprintId');
  const weekNumber = document.properties?.week_number;
  const projectId = document.properties?.project_id;
  const isRetro = document.document_type === 'weekly_retro';

  const [isComposerOpen, setIsComposerOpen] = useState(false);
  const [action, setAction] = useState<ReviewAction>('approve');
  const [comment, setComment] = useState('');
  const [selectedRating, setSelectedRating] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const reviewQueue = useReviewQueue();
  const queueActive = reviewQueue?.state.active ?? false;

  const { data: sprintData } = useQuery<SprintApprovalData>({
    queryKey: ['sprint-approval-v2', sprintIdParam || `lookup-${projectId}-${weekNumber}`],
    queryFn: async () => {
      let sid = sprintIdParam;
      if (!sid) {
        const lookupRes = await apiGet(`/api/weeks/lookup?project_id=${projectId}&sprint_number=${weekNumber}`);
        if (!lookupRes.ok) throw new Error('Sprint not found');
        const lookup = await lookupRes.json();
        sid = lookup.id as string;
      }
      const res = await apiGet(`/api/documents/${sid}`);
      if (!res.ok) throw new Error('Failed to fetch sprint');
      return res.json();
    },
    enabled: !!sprintIdParam || (!!projectId && !!weekNumber),
  });

  const sprintProps = sprintData?.properties || {};
  const planApproval = sprintProps.plan_approval as { state?: string } | null;
  const reviewApproval = sprintProps.review_approval as { state?: string } | null;
  const reviewRating = sprintProps.review_rating as { value?: number } | null;
  const approvalState = isRetro ? reviewApproval?.state : planApproval?.state;
  const currentRating = reviewRating?.value ?? null;
  const effectiveSprintId = sprintData?.id || sprintIdParam || null;

  useEffect(() => {
    if (isComposerOpen) {
      setComment('');
      setAction('approve');
      setSelectedRating(currentRating);
    }
  }, [isComposerOpen]);

  const statusLabel = useMemo(() => {
    if (approvalState === 'approved') return 'Approved';
    if (approvalState === 'changes_requested') return 'Changes requested';
    if (approvalState === 'changed_since_approved') return 'Changed since approved';
    return 'Not reviewed';
  }, [approvalState]);

  const statusClass = useMemo(() => {
    if (approvalState === 'approved') return 'border-green-500/40 bg-green-500/15 text-green-300';
    if (approvalState === 'changes_requested') return 'border-orange-500/40 bg-orange-500/15 text-orange-300';
    if (approvalState === 'changed_since_approved') return 'border-orange-500/40 bg-orange-500/15 text-orange-300';
    return 'border-border/80 bg-border/30 text-muted';
  }, [approvalState]);

  const actionLabel = action === 'approve' ? 'Approval Note (optional)' : 'What needs to change?';

  const submitLabel = action === 'approve'
    ? (isRetro ? 'Rate & Approve' : 'Approve Plan')
    : 'Request Changes';

  const feedbackRequired = action === 'request_changes' && !comment.trim();
  const ratingRequired = isRetro && action === 'approve' && !selectedRating;
  const submitDisabled = submitting || !effectiveSprintId || feedbackRequired || ratingRequired;

  async function handleSubmit() {
    if (!effectiveSprintId || submitDisabled) return;

    setSubmitting(true);
    try {
      let response: Response;

      if (action === 'approve') {
        if (isRetro) {
          response = await apiPost(`/api/weeks/${effectiveSprintId}/approve-review`, {
            rating: selectedRating,
            comment: comment.trim(),
          });
        } else {
          response = await apiPost(`/api/weeks/${effectiveSprintId}/approve-plan`, {
            comment: comment.trim(),
          });
        }
      } else {
        const endpoint = isRetro ? 'request-retro-changes' : 'request-plan-changes';
        response = await apiPost(`/api/weeks/${effectiveSprintId}/${endpoint}`, {
          feedback: comment.trim(),
        });
      }

      if (!response.ok) {
        const errorText = await response.text().catch(() => '');
        throw new Error(errorText || 'Failed to submit review');
      }

      await queryClient.invalidateQueries({ queryKey: ['sprint-approval-v2'] });
      await queryClient.invalidateQueries({ queryKey: ['document', effectiveSprintId] });

      setIsComposerOpen(false);
      setComment('');
      showToast(action === 'approve' ? 'Review approved' : 'Changes requested', 'success');

      if (queueActive) {
        reviewQueue?.advance();
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to submit review';
      showToast(message, 'error');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-accent/25 bg-accent/10 px-3 py-2">
        <div className="flex flex-wrap items-center gap-2">
          <span className="rounded bg-accent/25 px-2 py-1 text-[11px] font-semibold tracking-wide text-accent uppercase">
            Review Mode
          </span>
          <span className="text-xs text-muted">{isRetro ? 'Weekly Retro' : 'Weekly Plan'}</span>
          <span className={cn('rounded border px-2 py-1 text-xs font-medium', statusClass)}>
            {statusLabel}
          </span>
          {queueActive && reviewQueue && (
            <span className="rounded border border-border/70 bg-background/70 px-2 py-1 text-xs text-muted">
              {reviewQueue.state.currentIndex + 1} of {reviewQueue.state.queue.length}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {queueActive && reviewQueue && (
            <>
              <button
                type="button"
                onClick={reviewQueue.skip}
                className="inline-flex h-8 items-center justify-center rounded-md border border-border/80 bg-background/70 px-3 text-xs font-medium text-muted transition-colors hover:bg-border/40 hover:text-foreground"
              >
                Skip
              </button>
              <button
                type="button"
                onClick={reviewQueue.exit}
                className="inline-flex h-8 items-center justify-center rounded-md border border-border/80 bg-background/70 px-3 text-xs font-medium text-muted transition-colors hover:bg-border/40 hover:text-foreground"
              >
                Exit Review
              </button>
            </>
          )}
          <button
            type="button"
            onClick={() => setIsComposerOpen((open) => !open)}
            disabled={!effectiveSprintId}
            className={cn(
              'inline-flex h-8 items-center justify-center rounded-md px-3 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-50',
              isComposerOpen ? 'bg-green-500/20 text-green-300 hover:bg-green-500/25' : 'bg-green-600 text-white hover:bg-green-500'
            )}
          >
            {isComposerOpen ? 'Close Review' : 'Submit Review'}
          </button>
        </div>
      </div>

      {isComposerOpen && (
        <div className="rounded-md border border-border bg-background/95 p-3">
          <div className="mb-3 grid grid-cols-2 gap-2">
            <button
              type="button"
              data-testid="review-action-approve"
              aria-pressed={action === 'approve'}
              onClick={() => setAction('approve')}
              className={cn(
                'inline-flex h-9 w-full items-center justify-center rounded-md border px-3 text-sm font-medium focus-visible:outline-none',
                action === 'approve'
                  ? 'border-green-500/70 bg-green-600 text-white shadow-[0_0_0_1px] shadow-green-500/50'
                  : 'border-border/80 bg-background/70 text-muted hover:border-green-500/40 hover:text-green-200'
              )}
            >
              Approve
            </button>
            <button
              type="button"
              data-testid="review-action-request-changes"
              aria-pressed={action === 'request_changes'}
              onClick={() => setAction('request_changes')}
              className={cn(
                'inline-flex h-9 w-full items-center justify-center rounded-md border px-3 text-sm font-medium focus-visible:outline-none',
                action === 'request_changes'
                  ? 'border-orange-500/70 bg-orange-600 text-white shadow-[0_0_0_1px] shadow-orange-500/50'
                  : 'border-border/80 bg-background/70 text-muted hover:border-orange-500/40 hover:text-orange-200'
              )}
            >
              Request Changes
            </button>
          </div>

          <div className="mb-2 flex items-center gap-2 text-xs">
            <span className="text-muted">Current action:</span>
            <span
              className={cn(
                'inline-flex items-center rounded px-2 py-1 font-semibold',
                action === 'approve' ? 'bg-green-500/20 text-green-200' : 'bg-orange-500/20 text-orange-200'
              )}
            >
              {action === 'approve' ? 'Approve' : 'Request Changes'}
            </span>
          </div>

          {isRetro && action === 'approve' && (
            <div className="mb-3">
              <label className="mb-1.5 block text-xs font-semibold text-muted">Performance Rating</label>
              <div className="grid grid-cols-5 gap-1.5">
                {OPM_RATINGS.map(r => (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => setSelectedRating(r.value)}
                    className={cn(
                      'flex items-center justify-center rounded-md py-2 text-sm font-semibold transition-colors',
                      selectedRating === r.value
                        ? 'bg-accent/20 ring-1 ring-accent'
                        : 'bg-border/30 text-muted hover:bg-border/50'
                    )}
                    title={r.label}
                  >
                    <span className={r.color}>{r.value}</span>
                  </button>
                ))}
              </div>
              {!selectedRating && (
                <p className="mt-1.5 text-xs text-muted">Select a rating to approve this retrospective.</p>
              )}
            </div>
          )}

          <label className="mb-1.5 block text-xs font-semibold text-muted">{actionLabel}</label>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={action === 'approve' ? 'Add context for this decision...' : 'Explain what needs to be revised...'}
            rows={3}
            className={cn(
              'mb-3 w-full min-h-[96px] rounded-md border bg-background px-3 py-2.5 text-sm leading-5 text-foreground placeholder:text-muted resize-none transition-colors focus:outline-none focus:ring-2',
              action === 'request_changes'
                ? 'border-orange-500/35 focus:ring-orange-500/70'
                : 'border-green-500/30 focus:ring-green-500/70'
            )}
          />

          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsComposerOpen(false)}
              className="inline-flex h-9 items-center justify-center rounded-md border border-border/80 bg-background/70 px-3 text-sm font-medium text-muted transition-colors hover:bg-border/40 hover:text-foreground"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={handleSubmit}
              disabled={submitDisabled}
              className={cn(
                'inline-flex h-9 items-center justify-center rounded-md px-3 text-sm font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-50',
                action === 'request_changes' ? 'bg-orange-600 hover:bg-orange-500' : 'bg-green-600 hover:bg-green-500'
              )}
            >
              {submitting ? 'Submitting...' : submitLabel}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
