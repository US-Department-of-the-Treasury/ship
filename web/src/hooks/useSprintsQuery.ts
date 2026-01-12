import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api';
import { addPendingMutation, removePendingMutation, getIsOnline } from '@/lib/queryClient';

export interface SprintOwner {
  id: string;
  name: string;
  email: string;
}

export interface Sprint {
  id: string;
  name: string;
  sprint_number: number;
  owner: SprintOwner | null;
  issue_count: number;
  completed_count: number;
  started_count: number;
  total_estimate_hours?: number;
  has_plan?: boolean;
  has_retro?: boolean;
  plan_created_at?: string | null;
  retro_created_at?: string | null;
  _pending?: boolean;
  _pendingId?: string;
}

export interface SprintsResponse {
  workspace_sprint_start_date: string;
  sprints: Sprint[];
}

// Query keys
export const sprintKeys = {
  all: ['sprints'] as const,
  lists: () => [...sprintKeys.all, 'list'] as const,
  list: (programId: string) => [...sprintKeys.lists(), programId] as const,
  active: () => [...sprintKeys.all, 'active'] as const,
  details: () => [...sprintKeys.all, 'detail'] as const,
  detail: (id: string) => [...sprintKeys.details(), id] as const,
};

// Extended Sprint type for active sprints endpoint
export interface ActiveSprint extends Sprint {
  program_id: string;
  program_name: string;
  program_prefix?: string;
  days_remaining: number;
  status: 'active';
}

export interface ActiveSprintsResponse {
  sprints: ActiveSprint[];
  current_sprint_number: number;
  days_remaining: number;
  sprint_start_date: string;
  sprint_end_date: string;
}

// Fetch all active sprints across workspace
async function fetchActiveSprints(): Promise<ActiveSprintsResponse> {
  const res = await apiGet('/api/sprints');
  if (!res.ok) {
    const error = new Error('Failed to fetch active sprints') as Error & { status: number };
    error.status = res.status;
    throw error;
  }
  return res.json();
}

// Hook to get all active sprints across the workspace
export function useActiveSprintsQuery() {
  return useQuery({
    queryKey: sprintKeys.active(),
    queryFn: fetchActiveSprints,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

// Fetch sprints for a program
async function fetchSprints(programId: string): Promise<SprintsResponse> {
  const res = await apiGet(`/api/programs/${programId}/sprints`);
  if (!res.ok) {
    const error = new Error('Failed to fetch sprints') as Error & { status: number };
    error.status = res.status;
    throw error;
  }
  return res.json();
}

// Create sprint
interface CreateSprintData {
  program_id: string;
  title: string;
  sprint_number: number;
  owner_id: string;
}

async function createSprintApi(data: CreateSprintData): Promise<Sprint> {
  const res = await apiPost('/api/sprints', data);
  if (!res.ok) {
    const error = new Error('Failed to create sprint') as Error & { status: number };
    error.status = res.status;
    throw error;
  }
  return res.json();
}

// Update sprint
async function updateSprintApi(id: string, updates: Partial<Sprint> & { owner_id?: string }): Promise<Sprint> {
  const res = await apiPatch(`/api/sprints/${id}`, updates);
  if (!res.ok) {
    const error = new Error('Failed to update sprint') as Error & { status: number };
    error.status = res.status;
    throw error;
  }
  return res.json();
}

// Delete sprint
async function deleteSprintApi(id: string): Promise<void> {
  const res = await apiDelete(`/api/sprints/${id}`);
  if (!res.ok) {
    const error = new Error('Failed to delete sprint') as Error & { status: number };
    error.status = res.status;
    throw error;
  }
}

// Hook to get sprints for a program
export function useSprintsQuery(programId: string | undefined) {
  return useQuery({
    queryKey: programId ? sprintKeys.list(programId) : sprintKeys.lists(),
    queryFn: () => {
      if (!programId) {
        return { workspace_sprint_start_date: new Date().toISOString(), sprints: [] };
      }
      return fetchSprints(programId);
    },
    enabled: !!programId,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

// Hook to create sprint with optimistic update
export function useCreateSprint() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateSprintData & { _optimisticId?: string }) =>
      createSprintApi(data),
    onMutate: async (newSprint) => {
      const programId = newSprint.program_id;
      await queryClient.cancelQueries({ queryKey: sprintKeys.list(programId) });

      const previousData = queryClient.getQueryData<SprintsResponse>(sprintKeys.list(programId));

      const optimisticId = newSprint._optimisticId || `temp-${crypto.randomUUID()}`;
      const pendingId = addPendingMutation({
        type: 'create',
        resource: 'sprint',
        resourceId: optimisticId,
        data: newSprint,
      });

      const optimisticSprint: Sprint = {
        id: optimisticId,
        name: newSprint.title,
        sprint_number: newSprint.sprint_number,
        owner: null, // Will be filled in after server response
        issue_count: 0,
        completed_count: 0,
        started_count: 0,
        total_estimate_hours: 0,
        _pending: true,
        _pendingId: pendingId,
      };

      queryClient.setQueryData<SprintsResponse>(
        sprintKeys.list(programId),
        (old) => old ? {
          ...old,
          sprints: [...old.sprints, optimisticSprint].sort((a, b) => a.sprint_number - b.sprint_number),
        } : {
          workspace_sprint_start_date: new Date().toISOString(),
          sprints: [optimisticSprint],
        }
      );

      return { previousData, optimisticId, pendingId, programId };
    },
    onError: (_err, newSprint, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(sprintKeys.list(newSprint.program_id), context.previousData);
      }
      if (context?.pendingId) {
        removePendingMutation(context.pendingId);
      }
    },
    onSuccess: (data, _variables, context) => {
      if (context?.optimisticId && context?.pendingId && context?.programId) {
        queryClient.setQueryData<SprintsResponse>(
          sprintKeys.list(context.programId),
          (old) => old ? {
            ...old,
            sprints: old.sprints.map(s => s.id === context.optimisticId ? data : s),
          } : { workspace_sprint_start_date: new Date().toISOString(), sprints: [data] }
        );
        removePendingMutation(context.pendingId);
      }
    },
    onSettled: (_data, _error, variables) => {
      queryClient.invalidateQueries({ queryKey: sprintKeys.list(variables.program_id) });
    },
  });
}

// Hook to update sprint with optimistic update
export function useUpdateSprint() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<Sprint> & { owner_id?: string } }) =>
      updateSprintApi(id, updates),
    onMutate: async ({ id, updates }) => {
      // Find which program's cache this sprint is in
      const allProgramCaches = queryClient.getQueriesData<SprintsResponse>({
        queryKey: sprintKeys.lists(),
      });

      let programId: string | undefined;
      let previousData: SprintsResponse | undefined;

      for (const [queryKey, data] of allProgramCaches) {
        if (data?.sprints.some(s => s.id === id)) {
          programId = queryKey[2] as string;
          previousData = data;
          break;
        }
      }

      if (!programId || !previousData) {
        return { previousData: undefined, pendingId: undefined, programId: undefined };
      }

      await queryClient.cancelQueries({ queryKey: sprintKeys.list(programId) });

      const pendingId = addPendingMutation({
        type: 'update',
        resource: 'sprint',
        resourceId: id,
        data: updates,
      });

      queryClient.setQueryData<SprintsResponse>(
        sprintKeys.list(programId),
        (old) => old ? {
          ...old,
          sprints: old.sprints.map(s => s.id === id ? { ...s, ...updates, _pending: true, _pendingId: pendingId } : s),
        } : old
      );

      return { previousData, pendingId, programId };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousData && context?.programId) {
        queryClient.setQueryData(sprintKeys.list(context.programId), context.previousData);
      }
      if (context?.pendingId) {
        removePendingMutation(context.pendingId);
      }
    },
    onSuccess: (data, { id }, context) => {
      if (context?.programId) {
        queryClient.setQueryData<SprintsResponse>(
          sprintKeys.list(context.programId),
          (old) => old ? {
            ...old,
            sprints: old.sprints.map(s => s.id === id ? { ...data, _pending: false } : s),
          } : old
        );
      }
      if (context?.pendingId) {
        removePendingMutation(context.pendingId);
      }
    },
    onSettled: (_data, _error, _variables, context) => {
      if (context?.programId) {
        queryClient.invalidateQueries({ queryKey: sprintKeys.list(context.programId) });
      }
    },
  });
}

// Hook to delete sprint with optimistic update
export function useDeleteSprint() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteSprintApi(id),
    onMutate: async (id) => {
      // Find which program's cache this sprint is in
      const allProgramCaches = queryClient.getQueriesData<SprintsResponse>({
        queryKey: sprintKeys.lists(),
      });

      let programId: string | undefined;
      let previousData: SprintsResponse | undefined;

      for (const [queryKey, data] of allProgramCaches) {
        if (data?.sprints.some(s => s.id === id)) {
          programId = queryKey[2] as string;
          previousData = data;
          break;
        }
      }

      if (!programId || !previousData) {
        return { previousData: undefined, programId: undefined };
      }

      await queryClient.cancelQueries({ queryKey: sprintKeys.list(programId) });

      queryClient.setQueryData<SprintsResponse>(
        sprintKeys.list(programId),
        (old) => old ? {
          ...old,
          sprints: old.sprints.filter(s => s.id !== id),
        } : old
      );

      return { previousData, programId };
    },
    onError: (_err, _id, context) => {
      if (context?.previousData && context?.programId) {
        queryClient.setQueryData(sprintKeys.list(context.programId), context.previousData);
      }
    },
    onSettled: (_data, _error, _id, context) => {
      if (context?.programId) {
        queryClient.invalidateQueries({ queryKey: sprintKeys.list(context.programId) });
      }
    },
  });
}

// Compatibility hook that provides sprints data with the workspace start date
export function useSprints(programId: string | undefined) {
  const queryClient = useQueryClient();
  const { data, isLoading: loading, refetch } = useSprintsQuery(programId);
  const createMutation = useCreateSprint();
  const updateMutation = useUpdateSprint();
  const deleteMutation = useDeleteSprint();

  const sprints = data?.sprints ?? [];
  const workspaceSprintStartDate = data?.workspace_sprint_start_date
    ? new Date(data.workspace_sprint_start_date)
    : new Date();

  const createSprint = async (
    sprintNumber: number,
    ownerId: string,
    title?: string
  ): Promise<Sprint | null> => {
    if (!programId) return null;

    const sprintData = {
      program_id: programId,
      title: title || `Sprint ${sprintNumber}`,
      sprint_number: sprintNumber,
      owner_id: ownerId,
    };

    // When offline, add to cache synchronously and return immediately
    if (!getIsOnline()) {
      const optimisticId = `temp-${crypto.randomUUID()}`;
      const optimisticSprint: Sprint = {
        id: optimisticId,
        name: sprintData.title,
        sprint_number: sprintNumber,
        owner: null,
        issue_count: 0,
        completed_count: 0,
        started_count: 0,
        total_estimate_hours: 0,
        _pending: true,
      };

      // Add to cache synchronously
      queryClient.setQueryData<SprintsResponse>(
        sprintKeys.list(programId),
        (old) => old ? {
          ...old,
          sprints: [...old.sprints, optimisticSprint].sort((a, b) => a.sprint_number - b.sprint_number),
        } : {
          workspace_sprint_start_date: new Date().toISOString(),
          sprints: [optimisticSprint],
        }
      );

      // Trigger mutation (will be queued)
      createMutation.mutate({ ...sprintData, _optimisticId: optimisticId });
      return optimisticSprint;
    }

    try {
      return await createMutation.mutateAsync(sprintData);
    } catch {
      return null;
    }
  };

  const updateSprint = async (
    id: string,
    updates: Partial<Sprint> & { owner_id?: string }
  ): Promise<Sprint | null> => {
    // When offline, trigger mutation and return immediately
    if (!getIsOnline()) {
      updateMutation.mutate({ id, updates });
      return { ...updates, id } as Sprint;
    }

    try {
      return await updateMutation.mutateAsync({ id, updates });
    } catch {
      return null;
    }
  };

  const deleteSprint = async (id: string): Promise<boolean> => {
    // When offline, trigger mutation and return immediately
    if (!getIsOnline()) {
      deleteMutation.mutate(id);
      return true;
    }

    try {
      await deleteMutation.mutateAsync(id);
      return true;
    } catch {
      return false;
    }
  };

  const refreshSprints = async (): Promise<void> => {
    await refetch();
  };

  return {
    sprints,
    loading,
    workspaceSprintStartDate,
    createSprint,
    updateSprint,
    deleteSprint,
    refreshSprints,
  };
}
