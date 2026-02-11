/**
 * PlanQualityBanner — Prominent AI quality feedback bar for weekly plan editors.
 *
 * Renders between the document title and editor content. Shows:
 * - Approval likelihood meter (collapsed view)
 * - Per-item feedback (expanded view)
 * - Prominent loading indicator during analysis
 *
 * Polls document content via API with 1s debounce. Uses request IDs
 * to ignore stale responses from race conditions.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { cn } from '@/lib/cn';
import { apiGet, apiPost, apiPatch } from '@/lib/api';

interface PlanItemAnalysis {
  text: string;
  score: number;
  feedback: string;
  issues: string[];
}

interface PlanAnalysisResult {
  overall_score: number;
  items: PlanItemAnalysis[];
  workload_assessment: 'light' | 'moderate' | 'heavy' | 'excessive';
  workload_feedback: string;
}

const WORKLOAD_COLORS = {
  light: 'text-yellow-400 bg-yellow-500/10 border-yellow-500/30',
  moderate: 'text-green-400 bg-green-500/10 border-green-500/30',
  heavy: 'text-blue-400 bg-blue-500/10 border-blue-500/30',
  excessive: 'text-red-400 bg-red-500/10 border-red-500/30',
};

export function PlanQualityBanner({
  documentId,
  editorContent,
}: {
  documentId: string;
  editorContent: Record<string, unknown> | null;
}) {
  const [analysis, setAnalysis] = useState<PlanAnalysisResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);
  const lastContentRef = useRef<string>('');
  const requestIdRef = useRef(0);

  // Check AI availability and load persisted analysis from document properties
  useEffect(() => {
    apiGet('/api/ai/status')
      .then(r => r.json())
      .then(data => setAiAvailable(data.available))
      .catch(() => setAiAvailable(false));

    // Load last analysis from document properties
    apiGet(`/api/documents/${documentId}`)
      .then(r => r.json())
      .then(doc => {
        if (doc.properties?.ai_analysis) {
          setAnalysis(doc.properties.ai_analysis);
        }
      })
      .catch(() => {});
  }, [documentId]);

  // Save analysis to document properties
  const persistAnalysis = useCallback((data: PlanAnalysisResult) => {
    apiPatch(`/api/documents/${documentId}`, {
      properties: { ai_analysis: data },
    }).catch(() => {});
  }, [documentId]);

  // Run analysis (called on content change AND on initial load)
  const runAnalysis = useCallback((content: Record<string, unknown>) => {
    const contentStr = JSON.stringify(content);
    if (contentStr === lastContentRef.current) return;
    lastContentRef.current = contentStr;

    const thisRequestId = ++requestIdRef.current;
    setLoading(true);

    apiPost('/api/ai/analyze-plan', { content })
      .then(r => r.json())
      .then(data => {
        if (thisRequestId !== requestIdRef.current) return;
        if (data && !data.error) {
          setAnalysis(data);
          persistAnalysis(data);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [persistAnalysis]);

  // Analyze when editorContent changes (debounced by Editor's onContentChange)
  useEffect(() => {
    if (!aiAvailable || !editorContent) return;
    runAnalysis(editorContent);
  }, [editorContent, aiAvailable, runAnalysis]);

  // On mount: if no persisted result, fetch content and run initial analysis
  useEffect(() => {
    if (!aiAvailable || analysis) return;
    apiGet(`/api/documents/${documentId}`)
      .then(r => r.json())
      .then(doc => { if (doc.content) runAnalysis(doc.content); })
      .catch(() => {});
  }, [aiAvailable, documentId, analysis, runAnalysis]);

  if (aiAvailable === false) return null;

  // Skeleton / waiting state — show before first analysis
  if (!analysis && !loading) {
    return (
      <div className="mb-4 pl-8">
        <div className="w-full rounded-lg border border-border/50 bg-border/10 px-4 py-2.5">
          <div className="flex items-center gap-3">
            <div className="h-5 w-5 rounded-full bg-border/30 animate-pulse" />
            <div className="flex-1 h-2 rounded-full bg-border/20 overflow-hidden max-w-xs">
              <div className="h-full w-1/3 rounded-full bg-border/30 animate-pulse" />
            </div>
            <span className="text-xs text-muted/50">AI quality check will appear as you write</span>
          </div>
        </div>
      </div>
    );
  }

  const percentage = analysis ? Math.round(analysis.overall_score * 100) : 0;
  const barColor = percentage >= 70 ? 'bg-green-500' : percentage >= 40 ? 'bg-yellow-500' : 'bg-red-500';
  const textColor = percentage >= 70 ? 'text-green-400' : percentage >= 40 ? 'text-yellow-400' : 'text-red-400';

  return (
    <div className="mb-4 pl-8">
      {/* Collapsed bar — always visible */}
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          'w-full rounded-lg border px-4 py-2.5 text-left transition-colors',
          analysis
            ? percentage >= 70
              ? 'border-green-500/30 bg-green-500/5 hover:bg-green-500/10'
              : percentage >= 40
                ? 'border-yellow-500/30 bg-yellow-500/5 hover:bg-yellow-500/10'
                : 'border-red-500/30 bg-red-500/5 hover:bg-red-500/10'
            : 'border-border bg-border/20'
        )}
      >
        <div className="flex items-center gap-3">
          {/* Loading spinner or score */}
          {loading ? (
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 animate-spin text-accent" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-sm text-muted">Analyzing plan quality...</span>
            </div>
          ) : analysis ? (
            <>
              {/* Score */}
              <span className={cn('text-lg font-bold tabular-nums', textColor)}>
                {percentage}%
              </span>

              {/* Progress bar */}
              <div className="flex-1 h-2 rounded-full bg-border/50 overflow-hidden max-w-xs">
                <div
                  className={cn('h-full rounded-full transition-all duration-700', barColor)}
                  style={{ width: `${percentage}%` }}
                />
              </div>

              {/* Label */}
              <span className="text-xs text-muted">Approval Likelihood</span>

              {/* Workload badge */}
              <span className={cn(
                'px-2 py-0.5 rounded border text-xs font-medium',
                WORKLOAD_COLORS[analysis.workload_assessment]
              )}>
                {analysis.workload_assessment.charAt(0).toUpperCase() + analysis.workload_assessment.slice(1)}
              </span>

              {/* Expand arrow */}
              <svg
                className={cn('w-4 h-4 text-muted transition-transform', expanded && 'rotate-180')}
                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </>
          ) : null}
        </div>
      </button>

      {/* Expanded per-item feedback */}
      {expanded && analysis && (
        <div className="mt-2 space-y-2 pl-2">
          {analysis.items.map((item, i) => (
            <div
              key={i}
              className={cn(
                'rounded-lg border px-4 py-3',
                item.score >= 0.7 ? 'border-green-500/20 bg-green-500/5' :
                item.score >= 0.4 ? 'border-yellow-500/20 bg-yellow-500/5' :
                'border-red-500/20 bg-red-500/5'
              )}
            >
              <div className="flex items-start gap-3">
                {/* Score indicator */}
                <span className={cn(
                  'mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold',
                  item.score >= 0.7 ? 'bg-green-500/20 text-green-400' :
                  item.score >= 0.4 ? 'bg-yellow-500/20 text-yellow-400' :
                  'bg-red-500/20 text-red-400'
                )}>
                  {Math.round(item.score * 10)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{item.text}</p>
                  <p className="mt-1 text-xs text-muted leading-relaxed">{item.feedback}</p>
                </div>
              </div>
            </div>
          ))}

          {analysis.workload_feedback && (
            <p className="text-xs text-muted italic px-2 pt-1">{analysis.workload_feedback}</p>
          )}

          <p className="text-[10px] text-muted/60 px-2">
            AI feedback is advisory — it does not block your submission.
          </p>
        </div>
      )}
    </div>
  );
}

/** Same pattern for retro quality — banner between title and editor content */
export function RetroQualityBanner({
  documentId,
  editorContent,
  planContent: externalPlanContent,
}: {
  documentId: string;
  editorContent: Record<string, unknown> | null;
  planContent: Record<string, unknown> | null;
}) {
  type RetroAnalysis = {
    overall_score: number;
    plan_coverage: Array<{ plan_item: string; addressed: boolean; has_evidence: boolean; feedback: string }>;
    suggestions: string[];
  };
  const [planContent, setPlanContent] = useState<Record<string, unknown> | null>(externalPlanContent);
  const [analysis, setAnalysis] = useState<RetroAnalysis | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [aiAvailable, setAiAvailable] = useState<boolean | null>(null);
  const lastContentRef = useRef<string>('');
  const requestIdRef = useRef(0);
  const initDoneRef = useRef(false);

  // On mount: check AI, load persisted analysis, and fetch plan content
  useEffect(() => {
    if (initDoneRef.current) return;
    initDoneRef.current = true;

    apiGet('/api/ai/status')
      .then(r => r.json())
      .then(data => setAiAvailable(data.available))
      .catch(() => setAiAvailable(false));

    // Load retro doc to get persisted analysis AND plan content
    apiGet(`/api/documents/${documentId}`)
      .then(r => r.json())
      .then(async (doc) => {
        // Restore persisted analysis
        if (doc.properties?.ai_analysis) setAnalysis(doc.properties.ai_analysis);

        // Fetch corresponding plan content
        if (externalPlanContent) {
          setPlanContent(externalPlanContent);
          return;
        }
        const personId = doc.properties?.person_id;
        const projectId = doc.properties?.project_id;
        const weekNumber = doc.properties?.week_number;
        if (personId && weekNumber) {
          const params = new URLSearchParams({ person_id: personId, week_number: String(weekNumber) });
          if (projectId) params.set('project_id', projectId);
          const planRes = await apiGet(`/api/weekly-plans?${params}`);
          const plans = await planRes.json();
          if (plans && plans.length > 0 && plans[0].content) {
            setPlanContent(plans[0].content);
          } else {
            // No plan found — use empty doc so analysis can still run
            setPlanContent({ type: 'doc', content: [] });
          }
        } else {
          setPlanContent({ type: 'doc', content: [] });
        }
      })
      .catch(() => {});
  }, [documentId, externalPlanContent]);

  const persistAnalysis = useCallback((data: RetroAnalysis) => {
    apiPatch(`/api/documents/${documentId}`, {
      properties: { ai_analysis: data },
    }).catch(() => {});
  }, [documentId]);

  const runAnalysis = useCallback((retroContent: Record<string, unknown>, plan: Record<string, unknown>) => {
    const contentStr = JSON.stringify(retroContent);
    if (contentStr === lastContentRef.current) return;
    lastContentRef.current = contentStr;

    const thisRequestId = ++requestIdRef.current;
    setLoading(true);

    apiPost('/api/ai/analyze-retro', { retro_content: retroContent, plan_content: plan })
      .then(r => r.json())
      .then(data => {
        if (thisRequestId !== requestIdRef.current) return;
        if (data && !data.error) {
          setAnalysis(data);
          persistAnalysis(data);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [persistAnalysis]);

  // Analyze on editor content change
  useEffect(() => {
    if (!aiAvailable || !editorContent || !planContent) return;
    runAnalysis(editorContent, planContent);
  }, [editorContent, aiAvailable, planContent, runAnalysis]);

  // On mount: if no persisted result and plan is loaded, run initial analysis
  useEffect(() => {
    if (!aiAvailable || analysis || !planContent) return;
    apiGet(`/api/documents/${documentId}`)
      .then(r => r.json())
      .then(doc => { if (doc.content) runAnalysis(doc.content, planContent); })
      .catch(() => {});
  }, [aiAvailable, documentId, analysis, planContent, runAnalysis]);

  if (aiAvailable === false) return null;

  if (!analysis && !loading) {
    return (
      <div className="mb-4 pl-8">
        <div className="w-full rounded-lg border border-border/50 bg-border/10 px-4 py-2.5">
          <div className="flex items-center gap-3">
            <div className="h-5 w-5 rounded-full bg-border/30 animate-pulse" />
            <div className="flex-1 h-2 rounded-full bg-border/20 overflow-hidden max-w-xs">
              <div className="h-full w-1/3 rounded-full bg-border/30 animate-pulse" />
            </div>
            <span className="text-xs text-muted/50">AI quality check will appear as you write</span>
          </div>
        </div>
      </div>
    );
  }

  const percentage = analysis ? Math.round(analysis.overall_score * 100) : 0;
  const barColor = percentage >= 70 ? 'bg-green-500' : percentage >= 40 ? 'bg-yellow-500' : 'bg-red-500';
  const textColor = percentage >= 70 ? 'text-green-400' : percentage >= 40 ? 'text-yellow-400' : 'text-red-400';

  return (
    <div className="mb-4 pl-8">
      <button
        onClick={() => setExpanded(!expanded)}
        className={cn(
          'w-full rounded-lg border px-4 py-2.5 text-left transition-colors',
          analysis
            ? percentage >= 70
              ? 'border-green-500/30 bg-green-500/5 hover:bg-green-500/10'
              : percentage >= 40
                ? 'border-yellow-500/30 bg-yellow-500/5 hover:bg-yellow-500/10'
                : 'border-red-500/30 bg-red-500/5 hover:bg-red-500/10'
            : 'border-border bg-border/20'
        )}
      >
        <div className="flex items-center gap-3">
          {loading ? (
            <div className="flex items-center gap-2">
              <svg className="w-4 h-4 animate-spin text-accent" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="text-sm text-muted">Analyzing retro completeness...</span>
            </div>
          ) : analysis ? (
            <>
              <span className={cn('text-lg font-bold tabular-nums', textColor)}>
                {percentage}%
              </span>
              <div className="flex-1 h-2 rounded-full bg-border/50 overflow-hidden max-w-xs">
                <div
                  className={cn('h-full rounded-full transition-all duration-700', barColor)}
                  style={{ width: `${percentage}%` }}
                />
              </div>
              <span className="text-xs text-muted">Retro Completeness</span>
              <svg
                className={cn('w-4 h-4 text-muted transition-transform', expanded && 'rotate-180')}
                viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"
              >
                <path d="M6 9l6 6 6-6" />
              </svg>
            </>
          ) : null}
        </div>
      </button>

      {expanded && analysis && (
        <div className="mt-2 space-y-2 pl-2">
          {analysis.plan_coverage.map((item, i) => (
            <div
              key={i}
              className={cn(
                'rounded-lg border px-4 py-3 flex items-start gap-3',
                item.addressed && item.has_evidence ? 'border-green-500/20 bg-green-500/5' :
                item.addressed ? 'border-yellow-500/20 bg-yellow-500/5' :
                'border-red-500/20 bg-red-500/5'
              )}
            >
              <span className="mt-0.5 flex-shrink-0">
                {item.addressed && item.has_evidence ? (
                  <svg className="w-5 h-5 text-green-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M20 6L9 17l-5-5" /></svg>
                ) : item.addressed ? (
                  <svg className="w-5 h-5 text-yellow-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M12 8v4m0 4h.01" /></svg>
                ) : (
                  <svg className="w-5 h-5 text-red-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 6L6 18M6 6l12 12" /></svg>
                )}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">{item.plan_item}</p>
                <p className="mt-1 text-xs text-muted leading-relaxed">{item.feedback}</p>
              </div>
            </div>
          ))}

          {analysis.suggestions.length > 0 && (
            <div className="px-2 pt-1 space-y-1">
              {analysis.suggestions.map((s, i) => (
                <p key={i} className="text-xs text-muted italic">• {s}</p>
              ))}
            </div>
          )}

          <p className="text-[10px] text-muted/60 px-2">
            AI feedback is advisory — it does not block your submission.
          </p>
        </div>
      )}
    </div>
  );
}
