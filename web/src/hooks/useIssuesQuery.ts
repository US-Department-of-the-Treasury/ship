import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPatch } from '@/lib/api';
import type { CascadeWarning, IncompleteChild, BelongsTo, BelongsToType } from '@ship/shared';

// Custom error type for cascade warning (409 response)
export class CascadeWarningError extends Error {
  status = 409;
  warning: CascadeWarning;

  constructor(warning: CascadeWarning) {
    super(warning.message);
    this.name = 'CascadeWarningError';
    this.warning = warning;
  }
}

// Type guard for CascadeWarningError
export function isCascadeWarningError(error: unknown): error is CascadeWarningError {
  return error instanceof CascadeWarningError;
}

// Re-export for convenience
export type { CascadeWarning, IncompleteChild, BelongsTo, BelongsToType };

export interface Issue {
  id: string;
  title: string;
  state: string;
  priority: string;
  ticket_number: number;
  display_id: string;
  assignee_id: string | null;
  assignee_name: string | null;
  assignee_archived?: boolean;
  estimate: number | null;
  // belongs_to array contains all associations (program, sprint, project, parent)
  belongs_to: BelongsTo[];
  // Legacy fields - derived from belongs_to for backward compatibility
  program_id: string | null;
  sprint_id: string | null;
  program_name: string | null;
  program_prefix: string | null;
  sprint_name: string | null;
  source: 'internal' | 'external';
  rejection_reason: string | null;
  created_at?: string;
  updated_at?: string;
  created_by?: string;
  started_at?: string | null;
  completed_at?: string | null;
  cancelled_at?: string | null;
  reopened_at?: string | null;
  converted_from_id?: string | null;
}

// Helper to extract association ID by type
export function getAssociationId(issue: Issue, type: BelongsToType): string | null {
  const association = issue.belongs_to?.find(a => a.type === type);
  return association?.id ?? null;
}

// Helper to get program ID from belongs_to
export function getProgramId(issue: Issue): string | null {
  return getAssociationId(issue, 'program');
}

// Helper to get sprint ID from belongs_to
export function getSprintId(issue: Issue): string | null {
  return getAssociationId(issue, 'sprint');
}

// Query keys
export const issueKeys = {
  all: ['issues'] as const,
  lists: () => [...issueKeys.all, 'list'] as const,
  list: (filters?: Record<string, unknown>) => [...issueKeys.lists(), filters] as const,
  details: () => [...issueKeys.all, 'detail'] as const,
  detail: (id: string) => [...issueKeys.details(), id] as const,
};

// Transform API issue response to include derived legacy fields
function transformIssue(apiIssue: Record<string, unknown>): Issue {
  const belongs_to = (apiIssue.belongs_to as BelongsTo[]) || [];

  // Derive legacy fields from belongs_to for backward compatibility
  const programAssoc = belongs_to.find(a => a.type === 'program');
  const sprintAssoc = belongs_to.find(a => a.type === 'sprint');

  return {
    ...apiIssue,
    belongs_to,
    // Derive legacy fields
    program_id: programAssoc?.id ?? null,
    sprint_id: sprintAssoc?.id ?? null,
    program_name: programAssoc?.title ?? null,
    program_prefix: null, // Not available in new format
    sprint_name: sprintAssoc?.title ?? null,
  } as Issue;
}

// Fetch issues
async function fetchIssues(): Promise<Issue[]> {
  const res = await apiGet('/api/issues');
  if (!res.ok) {
    const error = new Error('Failed to fetch issues') as Error & { status: number };
    error.status = res.status;
    throw error;
  }
  const data = await res.json();
  return (data as Record<string, unknown>[]).map(transformIssue);
}

// Create issue
interface CreateIssueData {
  title?: string;
  program_id?: string;
}

async function createIssueApi(data: CreateIssueData): Promise<Issue> {
  // Convert program_id to belongs_to format
  const apiData: Record<string, unknown> = { title: 'Untitled' };
  if (data.title) apiData.title = data.title;
  if (data.program_id) {
    apiData.belongs_to = [{ id: data.program_id, type: 'program' }];
  }

  const res = await apiPost('/api/issues', apiData);
  if (!res.ok) {
    const error = new Error('Failed to create issue') as Error & { status: number };
    error.status = res.status;
    throw error;
  }
  const apiIssue = await res.json();
  return transformIssue(apiIssue);
}

// Update issue
async function updateIssueApi(id: string, updates: Partial<Issue>): Promise<Issue> {
  // Convert program_id/sprint_id/project_id to belongs_to format for API compatibility
  const apiUpdates: Record<string, unknown> = { ...updates };

  // Build belongs_to array from program_id, sprint_id, and project_id if any is present
  if ('program_id' in updates || 'sprint_id' in updates || 'project_id' in updates) {
    const belongs_to: Array<{ id: string; type: string }> = [];

    // Handle program association
    if ('program_id' in updates && updates.program_id) {
      belongs_to.push({ id: updates.program_id, type: 'program' });
    }

    // Handle sprint association
    if ('sprint_id' in updates && updates.sprint_id) {
      belongs_to.push({ id: updates.sprint_id, type: 'sprint' });
    }

    // Handle project association
    if ('project_id' in updates && (updates as { project_id?: string | null }).project_id) {
      belongs_to.push({ id: (updates as { project_id: string }).project_id, type: 'project' });
    }

    // Set belongs_to (empty array removes all associations of these types)
    apiUpdates.belongs_to = belongs_to;

    // Remove old fields from API payload
    delete apiUpdates.program_id;
    delete apiUpdates.sprint_id;
    delete (apiUpdates as { project_id?: unknown }).project_id;
  }

  const res = await apiPatch(`/api/issues/${id}`, apiUpdates);
  if (!res.ok) {
    // Check for cascade warning (409 with incomplete_children)
    if (res.status === 409) {
      const body = await res.json();
      if (body.error === 'incomplete_children') {
        throw new CascadeWarningError(body as CascadeWarning);
      }
    }
    const error = new Error('Failed to update issue') as Error & { status: number };
    error.status = res.status;
    throw error;
  }
  const apiIssue = await res.json();
  return transformIssue(apiIssue);
}

// Hook to get issues
export function useIssuesQuery() {
  return useQuery({
    queryKey: issueKeys.lists(),
    queryFn: fetchIssues,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

// Hook to create issue with optimistic update
export function useCreateIssue() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data?: CreateIssueData) => createIssueApi(data || {}),
    onMutate: async (newIssue) => {
      await queryClient.cancelQueries({ queryKey: issueKeys.lists() });
      const previousIssues = queryClient.getQueryData<Issue[]>(issueKeys.lists());

      // Build belongs_to for optimistic issue
      const belongs_to: BelongsTo[] = newIssue?.program_id
        ? [{ id: newIssue.program_id, type: 'program' }]
        : [];

      const optimisticIssue: Issue = {
        id: `temp-${crypto.randomUUID()}`,
        title: newIssue?.title ?? 'Untitled',
        state: 'backlog',
        priority: 'none',
        ticket_number: -1,
        display_id: 'PENDING',
        assignee_id: null,
        assignee_name: null,
        estimate: null,
        belongs_to,
        program_id: newIssue?.program_id ?? null,
        sprint_id: null,
        program_name: null,
        program_prefix: null,
        sprint_name: null,
        source: 'internal',
        rejection_reason: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };

      queryClient.setQueryData<Issue[]>(
        issueKeys.lists(),
        (old) => [optimisticIssue, ...(old || [])]
      );

      return { previousIssues, optimisticId: optimisticIssue.id };
    },
    onError: (_err, _newIssue, context) => {
      if (context?.previousIssues) {
        queryClient.setQueryData(issueKeys.lists(), context.previousIssues);
      }
    },
    onSuccess: (data, _variables, context) => {
      if (context?.optimisticId) {
        queryClient.setQueryData<Issue[]>(
          issueKeys.lists(),
          (old) => old?.map(i => i.id === context.optimisticId ? data : i) || [data]
        );
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: issueKeys.lists() });
    },
  });
}

// Hook to update issue with optimistic update
export function useUpdateIssue() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<Issue> }) =>
      updateIssueApi(id, updates),
    onMutate: async ({ id, updates }) => {
      await queryClient.cancelQueries({ queryKey: issueKeys.lists() });
      const previousIssues = queryClient.getQueryData<Issue[]>(issueKeys.lists());

      queryClient.setQueryData<Issue[]>(
        issueKeys.lists(),
        (old) => old?.map(i => {
          if (i.id !== id) return i;

          // Build updated belongs_to array
          let newBelongsTo = [...(i.belongs_to || [])];
          if ('program_id' in updates) {
            newBelongsTo = newBelongsTo.filter(a => a.type !== 'program');
            if (updates.program_id) {
              newBelongsTo.push({ id: updates.program_id, type: 'program' });
            }
          }
          if ('sprint_id' in updates) {
            newBelongsTo = newBelongsTo.filter(a => a.type !== 'sprint');
            if (updates.sprint_id) {
              newBelongsTo.push({ id: updates.sprint_id, type: 'sprint' });
            }
          }
          if ('project_id' in updates) {
            newBelongsTo = newBelongsTo.filter(a => a.type !== 'project');
            if ((updates as { project_id?: string | null }).project_id) {
              newBelongsTo.push({ id: (updates as { project_id: string }).project_id, type: 'project' });
            }
          }

          return { ...i, ...updates, belongs_to: newBelongsTo };
        }) || []
      );

      return { previousIssues };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousIssues) {
        queryClient.setQueryData(issueKeys.lists(), context.previousIssues);
      }
    },
    onSuccess: (data, { id }) => {
      queryClient.setQueryData<Issue[]>(
        issueKeys.lists(),
        (old) => old?.map(i => i.id === id ? data : i) || []
      );
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: issueKeys.lists() });
    },
  });
}

// Bulk update issues
interface BulkUpdateRequest {
  ids: string[];
  action: 'archive' | 'delete' | 'restore' | 'update';
  updates?: {
    state?: string;
    sprint_id?: string | null;
    assignee_id?: string | null;
    project_id?: string | null;
  };
}

interface BulkUpdateResponse {
  updated: Issue[];
  failed: { id: string; error: string }[];
}

async function bulkUpdateIssuesApi(data: BulkUpdateRequest): Promise<BulkUpdateResponse> {
  const res = await apiPost('/api/issues/bulk', data);
  if (!res.ok) {
    const error = new Error('Failed to bulk update issues') as Error & { status: number };
    error.status = res.status;
    throw error;
  }
  return res.json();
}

// Hook for bulk updates
export function useBulkUpdateIssues() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: BulkUpdateRequest) => bulkUpdateIssuesApi(data),
    onMutate: async ({ ids, action, updates }) => {
      await queryClient.cancelQueries({ queryKey: issueKeys.lists() });
      const previousIssues = queryClient.getQueryData<Issue[]>(issueKeys.lists());

      queryClient.setQueryData<Issue[]>(issueKeys.lists(), (old) => {
        if (!old) return old;

        if (action === 'archive' || action === 'delete') {
          return old.filter(i => !ids.includes(i.id));
        }

        if (action === 'update' && updates) {
          return old.map(i => ids.includes(i.id) ? { ...i, ...updates } : i);
        }

        return old;
      });

      return { previousIssues };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousIssues) {
        queryClient.setQueryData(issueKeys.lists(), context.previousIssues);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: issueKeys.lists() });
    },
  });
}

// Options for creating an issue
export interface CreateIssueOptions {
  program_id?: string;
}

// Compatibility hook that matches the old useIssues interface
export function useIssues() {
  const { data: issues = [], isLoading: loading, refetch } = useIssuesQuery();
  const createMutation = useCreateIssue();
  const updateMutation = useUpdateIssue();

  const createIssue = async (options?: CreateIssueOptions): Promise<Issue | null> => {
    try {
      return await createMutation.mutateAsync(options || {});
    } catch {
      return null;
    }
  };

  const updateIssue = async (id: string, updates: Partial<Issue>): Promise<Issue | null> => {
    try {
      return await updateMutation.mutateAsync({ id, updates });
    } catch (error) {
      // Re-throw CascadeWarningError so UI can handle it (show confirmation dialog)
      if (isCascadeWarningError(error)) {
        throw error;
      }
      return null;
    }
  };

  const refreshIssues = async (): Promise<void> => {
    await refetch();
  };

  return {
    issues,
    loading,
    createIssue,
    updateIssue,
    refreshIssues,
  };
}
