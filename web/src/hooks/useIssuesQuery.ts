import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPatch } from '@/lib/api';
import { addPendingMutation, removePendingMutation, getIsOnline } from '@/lib/queryClient';

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
  _pending?: boolean;
  _pendingId?: string;
}

// Query keys
export const issueKeys = {
  all: ['issues'] as const,
  lists: () => [...issueKeys.all, 'list'] as const,
  list: (filters?: Record<string, unknown>) => [...issueKeys.lists(), filters] as const,
  details: () => [...issueKeys.all, 'detail'] as const,
  detail: (id: string) => [...issueKeys.details(), id] as const,
};

// Fetch issues
async function fetchIssues(): Promise<Issue[]> {
  const res = await apiGet('/api/issues');
  if (!res.ok) {
    const error = new Error('Failed to fetch issues') as Error & { status: number };
    error.status = res.status;
    throw error;
  }
  return res.json();
}

// Create issue
interface CreateIssueData {
  title?: string;
  program_id?: string;
  _optimisticId?: string;
}

async function createIssueApi(data: CreateIssueData): Promise<Issue> {
  const { _optimisticId, ...apiData } = data;
  const res = await apiPost('/api/issues', { title: 'Untitled', ...apiData });
  if (!res.ok) {
    const error = new Error('Failed to create issue') as Error & { status: number };
    error.status = res.status;
    throw error;
  }
  return res.json();
}

// Update issue
async function updateIssueApi(id: string, updates: Partial<Issue>): Promise<Issue> {
  const res = await apiPatch(`/api/issues/${id}`, updates);
  if (!res.ok) {
    const error = new Error('Failed to update issue') as Error & { status: number };
    error.status = res.status;
    throw error;
  }
  return res.json();
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

      // Use passed optimisticId if available (for offline creation)
      const optimisticId = newIssue?._optimisticId || `temp-${crypto.randomUUID()}`;

      // Check if issue was already added to cache (offline path adds synchronously)
      const alreadyExists = previousIssues?.some(i => i.id === optimisticId);
      if (alreadyExists) {
        // Issue already in cache from offline path - just track for rollback
        return { previousIssues, optimisticId, pendingId: undefined };
      }

      const pendingId = addPendingMutation({
        type: 'create',
        resource: 'issue',
        resourceId: optimisticId,
        data: newIssue,
      });

      const optimisticIssue: Issue = {
        id: optimisticId,
        title: newIssue?.title ?? 'Untitled',
        state: 'backlog',
        priority: 'none',
        ticket_number: -1, // Temporary
        display_id: 'PENDING',
        assignee_id: null,
        assignee_name: null,
        estimate: null,
        program_id: newIssue?.program_id ?? null,
        sprint_id: null,
        program_name: null,
        program_prefix: null,
        sprint_name: null,
        source: 'internal',
        rejection_reason: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        _pending: true,
        _pendingId: pendingId,
      };

      queryClient.setQueryData<Issue[]>(
        issueKeys.lists(),
        (old) => [optimisticIssue, ...(old || [])]
      );

      return { previousIssues, optimisticId, pendingId };
    },
    onError: (_err, _newIssue, context) => {
      if (context?.previousIssues) {
        queryClient.setQueryData(issueKeys.lists(), context.previousIssues);
      }
      if (context?.pendingId) {
        removePendingMutation(context.pendingId);
      }
    },
    onSuccess: (data, _variables, context) => {
      if (context?.optimisticId && context?.pendingId) {
        queryClient.setQueryData<Issue[]>(
          issueKeys.lists(),
          (old) => old?.map(i => i.id === context.optimisticId ? data : i) || [data]
        );
        removePendingMutation(context.pendingId);
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

      const pendingId = addPendingMutation({
        type: 'update',
        resource: 'issue',
        resourceId: id,
        data: updates,
      });

      queryClient.setQueryData<Issue[]>(
        issueKeys.lists(),
        (old) => old?.map(i => i.id === id ? { ...i, ...updates, _pending: true, _pendingId: pendingId } : i) || []
      );

      return { previousIssues, pendingId };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousIssues) {
        queryClient.setQueryData(issueKeys.lists(), context.previousIssues);
      }
      if (context?.pendingId) {
        removePendingMutation(context.pendingId);
      }
    },
    onSuccess: (data, { id }, context) => {
      queryClient.setQueryData<Issue[]>(
        issueKeys.lists(),
        (old) => old?.map(i => i.id === id ? { ...data, _pending: false } : i) || []
      );
      if (context?.pendingId) {
        removePendingMutation(context.pendingId);
      }
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

      // Optimistic update
      queryClient.setQueryData<Issue[]>(issueKeys.lists(), (old) => {
        if (!old) return old;

        if (action === 'archive' || action === 'delete') {
          // Remove from list
          return old.filter(i => !ids.includes(i.id));
        }

        if (action === 'update' && updates) {
          return old.map(i => {
            if (ids.includes(i.id)) {
              return { ...i, ...updates, _pending: true };
            }
            return i;
          });
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
  const queryClient = useQueryClient();
  const { data: issues = [], isLoading: loading, refetch } = useIssuesQuery();
  const createMutation = useCreateIssue();
  const updateMutation = useUpdateIssue();

  const createIssue = async (options?: CreateIssueOptions): Promise<Issue | null> => {
    // When offline, add to cache synchronously and return immediately
    // This avoids race condition where navigation happens before onMutate runs
    // Use getIsOnline() which is updated by the offline event handler (more reliable than navigator.onLine)
    if (!getIsOnline()) {
      const optimisticId = `temp-${crypto.randomUUID()}`;
      const optimisticIssue: Issue = {
        id: optimisticId,
        title: 'Untitled',
        state: 'backlog',
        priority: 'none',
        ticket_number: -1,
        display_id: 'PENDING',
        assignee_id: null,
        assignee_name: null,
        estimate: null,
        program_id: options?.program_id ?? null,
        sprint_id: null,
        program_name: null,
        program_prefix: null,
        sprint_name: null,
        source: 'internal',
        rejection_reason: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        _pending: true,
      };

      // Add to cache SYNCHRONOUSLY before mutate() to avoid race with navigation
      queryClient.setQueryData<Issue[]>(
        issueKeys.lists(),
        (old) => [optimisticIssue, ...(old || [])]
      );

      // Trigger mutation (will be queued for when back online)
      createMutation.mutate({ _optimisticId: optimisticId, ...options });
      return optimisticIssue;
    }

    try {
      return await createMutation.mutateAsync(options || {});
    } catch {
      return null;
    }
  };

  const updateIssue = async (id: string, updates: Partial<Issue>): Promise<Issue | null> => {
    // When offline, trigger mutation and return immediately
    if (!getIsOnline()) {
      updateMutation.mutate({ id, updates });
      return { ...updates, id } as Issue;
    }

    try {
      return await updateMutation.mutateAsync({ id, updates });
    } catch {
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
