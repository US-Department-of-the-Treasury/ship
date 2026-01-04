import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPatch } from '@/lib/api';
import { addPendingMutation, removePendingMutation } from '@/lib/queryClient';

export interface ProgramOwner {
  id: string;
  name: string;
  email: string;
}

export interface Program {
  id: string;
  name: string;
  prefix: string;
  color: string;
  archived_at: string | null;
  issue_count?: number;
  sprint_count?: number;
  owner: ProgramOwner | null;
  _pending?: boolean;
  _pendingId?: string;
}

// Query keys
export const programKeys = {
  all: ['programs'] as const,
  lists: () => [...programKeys.all, 'list'] as const,
  list: (filters?: Record<string, unknown>) => [...programKeys.lists(), filters] as const,
  details: () => [...programKeys.all, 'detail'] as const,
  detail: (id: string) => [...programKeys.details(), id] as const,
};

// Fetch programs
async function fetchPrograms(): Promise<Program[]> {
  const res = await apiGet('/api/programs');
  if (!res.ok) {
    const error = new Error('Failed to fetch programs') as Error & { status: number };
    error.status = res.status;
    throw error;
  }
  return res.json();
}

// Create program
async function createProgramApi(data: { title: string }): Promise<Program> {
  const res = await apiPost('/api/programs', data);
  if (!res.ok) {
    const error = new Error('Failed to create program') as Error & { status: number };
    error.status = res.status;
    throw error;
  }
  return res.json();
}

// Update program
async function updateProgramApi(id: string, updates: Record<string, unknown>): Promise<Program> {
  const res = await apiPatch(`/api/programs/${id}`, updates);
  if (!res.ok) {
    const error = new Error('Failed to update program') as Error & { status: number };
    error.status = res.status;
    throw error;
  }
  return res.json();
}

// Hook to get programs
export function useProgramsQuery() {
  return useQuery({
    queryKey: programKeys.lists(),
    queryFn: fetchPrograms,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

// Hook to create program with optimistic update
export function useCreateProgram() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data?: { title?: string; _optimisticId?: string }) =>
      createProgramApi({ title: data?.title ?? 'Untitled' }),
    onMutate: async (newProgram) => {
      await queryClient.cancelQueries({ queryKey: programKeys.lists() });

      const previousPrograms = queryClient.getQueryData<Program[]>(programKeys.lists());

      // Use passed optimisticId if available (for offline creation)
      const optimisticId = newProgram?._optimisticId || `temp-${crypto.randomUUID()}`;
      const pendingId = addPendingMutation({
        type: 'create',
        resource: 'program',
        resourceId: optimisticId,
        data: newProgram,
      });

      const optimisticProgram: Program = {
        id: optimisticId,
        name: newProgram?.title ?? 'Untitled',
        prefix: 'NEW',
        color: '#6B7280',
        archived_at: null,
        issue_count: 0,
        sprint_count: 0,
        owner: null,
        _pending: true,
        _pendingId: pendingId,
      };

      queryClient.setQueryData<Program[]>(
        programKeys.lists(),
        (old) => [optimisticProgram, ...(old || [])]
      );

      return { previousPrograms, optimisticId, pendingId };
    },
    onError: (_err, _newProgram, context) => {
      if (context?.previousPrograms) {
        queryClient.setQueryData(programKeys.lists(), context.previousPrograms);
      }
      if (context?.pendingId) {
        removePendingMutation(context.pendingId);
      }
    },
    onSuccess: (data, _variables, context) => {
      if (context?.optimisticId && context?.pendingId) {
        queryClient.setQueryData<Program[]>(
          programKeys.lists(),
          (old) => old?.map(p => p.id === context.optimisticId ? data : p) || [data]
        );
        removePendingMutation(context.pendingId);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: programKeys.lists() });
    },
  });
}

// Hook to update program with optimistic update
export function useUpdateProgram() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<Program> & { owner_id?: string | null } }) => {
      // Map frontend field names to API field names
      const apiUpdates: Record<string, unknown> = {};
      if (updates.name !== undefined) apiUpdates.title = updates.name;
      if (updates.color !== undefined) apiUpdates.color = updates.color;
      if (updates.archived_at !== undefined) apiUpdates.archived_at = updates.archived_at;
      if (updates.owner_id !== undefined) apiUpdates.owner_id = updates.owner_id;
      return updateProgramApi(id, apiUpdates);
    },
    onMutate: async ({ id, updates }) => {
      await queryClient.cancelQueries({ queryKey: programKeys.lists() });

      const previousPrograms = queryClient.getQueryData<Program[]>(programKeys.lists());

      const pendingId = addPendingMutation({
        type: 'update',
        resource: 'program',
        resourceId: id,
        data: updates,
      });

      queryClient.setQueryData<Program[]>(
        programKeys.lists(),
        (old) => old?.map(p => p.id === id ? { ...p, ...updates, _pending: true, _pendingId: pendingId } : p) || []
      );

      return { previousPrograms, pendingId };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousPrograms) {
        queryClient.setQueryData(programKeys.lists(), context.previousPrograms);
      }
      if (context?.pendingId) {
        removePendingMutation(context.pendingId);
      }
    },
    onSuccess: (data, { id }, context) => {
      queryClient.setQueryData<Program[]>(
        programKeys.lists(),
        (old) => old?.map(p => p.id === id ? { ...p, ...data, _pending: false } : p) || []
      );
      if (context?.pendingId) {
        removePendingMutation(context.pendingId);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: programKeys.lists() });
    },
  });
}

// Compatibility hook that matches the old usePrograms interface
export function usePrograms() {
  const { data: programs = [], isLoading: loading, refetch } = useProgramsQuery();
  const createMutation = useCreateProgram();
  const updateMutation = useUpdateProgram();

  const createProgram = async (): Promise<Program | null> => {
    // When offline, return optimistic data immediately instead of waiting for mutateAsync
    if (!navigator.onLine) {
      const optimisticId = `temp-${crypto.randomUUID()}`;
      const optimisticProgram: Program = {
        id: optimisticId,
        name: 'Untitled',
        prefix: 'NEW',
        color: '#6B7280',
        archived_at: null,
        issue_count: 0,
        sprint_count: 0,
        owner: null,
        _pending: true,
      };
      // Trigger mutation (will be queued)
      createMutation.mutate({ _optimisticId: optimisticId } as { title?: string; _optimisticId?: string });
      return optimisticProgram;
    }

    try {
      return await createMutation.mutateAsync({});
    } catch {
      return null;
    }
  };

  const updateProgram = async (id: string, updates: Partial<Program> & { owner_id?: string | null }): Promise<Program | null> => {
    // When offline, trigger mutation and return immediately
    if (!navigator.onLine) {
      updateMutation.mutate({ id, updates });
      return { ...updates, id } as Program;
    }

    try {
      return await updateMutation.mutateAsync({ id, updates });
    } catch {
      return null;
    }
  };

  const refreshPrograms = async (): Promise<void> => {
    await refetch();
  };

  return {
    programs,
    loading,
    createProgram,
    updateProgram,
    refreshPrograms,
  };
}
