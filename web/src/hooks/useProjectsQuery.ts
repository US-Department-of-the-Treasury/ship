import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api';
import { addPendingMutation, removePendingMutation, getIsOnline } from '@/lib/queryClient';
import { computeICEScore } from '@ship/shared';

// Inferred project status based on sprint relationships
export type InferredProjectStatus = 'active' | 'planned' | 'completed' | 'backlog' | 'archived';

export interface Project {
  id: string;
  title: string;
  // ICE properties
  impact: number;
  confidence: number;
  ease: number;
  ice_score: number;
  // Visual properties
  color: string;
  emoji: string | null;
  // Associations
  program_id: string | null;
  // Owner info
  owner: {
    id: string;
    name: string;
    email: string;
  } | null;
  // Counts
  sprint_count: number;
  issue_count: number;
  // Inferred status from sprint relationships
  inferred_status: InferredProjectStatus;
  // Timestamps
  archived_at: string | null;
  created_at: string;
  updated_at: string;
  // Completeness flags
  is_complete: boolean | null;
  missing_fields: string[];
  // Conversion tracking
  converted_from_id?: string | null;
  // Offline sync
  _pending?: boolean;
  _pendingId?: string;
}

// Query keys
export const projectKeys = {
  all: ['projects'] as const,
  lists: () => [...projectKeys.all, 'list'] as const,
  list: (filters?: Record<string, unknown>) => [...projectKeys.lists(), filters] as const,
  details: () => [...projectKeys.all, 'detail'] as const,
  detail: (id: string) => [...projectKeys.details(), id] as const,
};

// Fetch projects
async function fetchProjects(): Promise<Project[]> {
  const res = await apiGet('/api/projects');
  if (!res.ok) {
    const error = new Error('Failed to fetch projects') as Error & { status: number };
    error.status = res.status;
    throw error;
  }
  return res.json();
}

// Create project
interface CreateProjectData {
  title?: string;
  owner_id: string;
  impact?: number;
  confidence?: number;
  ease?: number;
  color?: string;
  program_id?: string;
  _optimisticId?: string;
}

async function createProjectApi(data: CreateProjectData): Promise<Project> {
  const { _optimisticId, ...apiData } = data;
  const res = await apiPost('/api/projects', apiData);
  if (!res.ok) {
    const error = new Error('Failed to create project') as Error & { status: number };
    error.status = res.status;
    throw error;
  }
  return res.json();
}

// Update project
async function updateProjectApi(id: string, updates: Partial<Project>): Promise<Project> {
  const res = await apiPatch(`/api/projects/${id}`, updates);
  if (!res.ok) {
    const error = new Error('Failed to update project') as Error & { status: number };
    error.status = res.status;
    throw error;
  }
  return res.json();
}

// Delete project
async function deleteProjectApi(id: string): Promise<void> {
  const res = await apiDelete(`/api/projects/${id}`);
  if (!res.ok) {
    const error = new Error('Failed to delete project') as Error & { status: number };
    error.status = res.status;
    throw error;
  }
}

// Hook to get projects
export function useProjectsQuery() {
  return useQuery({
    queryKey: projectKeys.lists(),
    queryFn: fetchProjects,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

// Hook to create project with optimistic update
export function useCreateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateProjectData) => createProjectApi(data),
    onMutate: async (newProject) => {
      await queryClient.cancelQueries({ queryKey: projectKeys.lists() });

      const previousProjects = queryClient.getQueryData<Project[]>(projectKeys.lists());

      const optimisticId = newProject._optimisticId || `temp-${crypto.randomUUID()}`;

      const alreadyExists = previousProjects?.some(p => p.id === optimisticId);
      if (alreadyExists) {
        return { previousProjects, optimisticId, pendingId: undefined };
      }

      const pendingId = addPendingMutation({
        type: 'create',
        resource: 'project',
        resourceId: optimisticId,
        data: newProject,
      });

      const impact = newProject.impact ?? 3;
      const confidence = newProject.confidence ?? 3;
      const ease = newProject.ease ?? 3;

      const optimisticProject: Project = {
        id: optimisticId,
        title: newProject.title ?? 'Untitled',
        impact,
        confidence,
        ease,
        ice_score: computeICEScore(impact, confidence, ease),
        color: newProject.color ?? '#6366f1',
        emoji: null,
        program_id: newProject.program_id ?? null,
        owner: null,
        sprint_count: 0,
        issue_count: 0,
        inferred_status: 'backlog',
        archived_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        is_complete: null,
        missing_fields: [],
        _pending: true,
        _pendingId: pendingId,
      };

      queryClient.setQueryData<Project[]>(
        projectKeys.lists(),
        (old) => [optimisticProject, ...(old || [])]
      );

      return { previousProjects, optimisticId, pendingId };
    },
    onError: (_err, _newProject, context) => {
      if (context?.previousProjects) {
        queryClient.setQueryData(projectKeys.lists(), context.previousProjects);
      }
      if (context?.pendingId) {
        removePendingMutation(context.pendingId);
      }
    },
    onSuccess: (data, _variables, context) => {
      if (context?.optimisticId && context?.pendingId) {
        queryClient.setQueryData<Project[]>(
          projectKeys.lists(),
          (old) => old?.map(p => p.id === context.optimisticId ? data : p) || [data]
        );
        removePendingMutation(context.pendingId);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
    },
  });
}

// Hook to update project with optimistic update
export function useUpdateProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<Project> }) =>
      updateProjectApi(id, updates),
    onMutate: async ({ id, updates }) => {
      await queryClient.cancelQueries({ queryKey: projectKeys.lists() });

      const previousProjects = queryClient.getQueryData<Project[]>(projectKeys.lists());

      const pendingId = addPendingMutation({
        type: 'update',
        resource: 'project',
        resourceId: id,
        data: updates,
      });

      queryClient.setQueryData<Project[]>(
        projectKeys.lists(),
        (old) => old?.map(p => {
          if (p.id === id) {
            const updated = { ...p, ...updates, _pending: true, _pendingId: pendingId };
            // Recompute ICE score if any ICE property changed
            if (updates.impact !== undefined || updates.confidence !== undefined || updates.ease !== undefined) {
              const impact = updates.impact ?? p.impact;
              const confidence = updates.confidence ?? p.confidence;
              const ease = updates.ease ?? p.ease;
              updated.ice_score = computeICEScore(impact, confidence, ease);
            }
            return updated;
          }
          return p;
        }) || []
      );

      return { previousProjects, pendingId };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousProjects) {
        queryClient.setQueryData(projectKeys.lists(), context.previousProjects);
      }
      if (context?.pendingId) {
        removePendingMutation(context.pendingId);
      }
    },
    onSuccess: (data, { id }, context) => {
      queryClient.setQueryData<Project[]>(
        projectKeys.lists(),
        (old) => old?.map(p => p.id === id ? { ...data, _pending: false } : p) || []
      );
      if (context?.pendingId) {
        removePendingMutation(context.pendingId);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
    },
  });
}

// Hook to delete project
export function useDeleteProject() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteProjectApi(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: projectKeys.lists() });

      const previousProjects = queryClient.getQueryData<Project[]>(projectKeys.lists());

      queryClient.setQueryData<Project[]>(
        projectKeys.lists(),
        (old) => old?.filter(p => p.id !== id) || []
      );

      return { previousProjects };
    },
    onError: (_err, _id, context) => {
      if (context?.previousProjects) {
        queryClient.setQueryData(projectKeys.lists(), context.previousProjects);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
    },
  });
}

// Options for creating a project
export interface CreateProjectOptions {
  owner_id: string;
  program_id?: string;
}

// Compatibility hook that matches the context interface
export function useProjects() {
  const queryClient = useQueryClient();
  const { data: projects = [], isLoading: loading, refetch } = useProjectsQuery();
  const createMutation = useCreateProject();
  const updateMutation = useUpdateProject();
  const deleteMutation = useDeleteProject();

  const createProject = async (options: CreateProjectOptions): Promise<Project | null> => {
    if (!getIsOnline()) {
      const optimisticId = `temp-${crypto.randomUUID()}`;
      const optimisticProject: Project = {
        id: optimisticId,
        title: 'Untitled',
        impact: 3,
        confidence: 3,
        ease: 3,
        ice_score: 27,
        color: '#6366f1',
        emoji: null,
        program_id: options.program_id ?? null,
        owner: null,
        sprint_count: 0,
        issue_count: 0,
        inferred_status: 'backlog',
        archived_at: null,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        is_complete: null,
        missing_fields: [],
        _pending: true,
      };

      queryClient.setQueryData<Project[]>(
        projectKeys.lists(),
        (old) => [optimisticProject, ...(old || [])]
      );

      createMutation.mutate({ _optimisticId: optimisticId, ...options });
      return optimisticProject;
    }

    try {
      return await createMutation.mutateAsync(options);
    } catch {
      return null;
    }
  };

  const updateProject = async (id: string, updates: Partial<Project>): Promise<Project | null> => {
    if (!getIsOnline()) {
      updateMutation.mutate({ id, updates });
      return { ...updates, id } as Project;
    }

    try {
      return await updateMutation.mutateAsync({ id, updates });
    } catch {
      return null;
    }
  };

  const deleteProject = async (id: string): Promise<boolean> => {
    try {
      await deleteMutation.mutateAsync(id);
      return true;
    } catch {
      return false;
    }
  };

  const refreshProjects = async (): Promise<void> => {
    await refetch();
  };

  return {
    projects,
    loading,
    createProject,
    updateProject,
    deleteProject,
    refreshProjects,
  };
}
