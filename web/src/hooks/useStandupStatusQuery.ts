import { useQuery, useQueryClient } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';

export interface StandupStatus {
  due: boolean;
  lastPosted: string | null;
}

// Query keys
export const standupStatusKeys = {
  all: ['standup-status'] as const,
  status: () => [...standupStatusKeys.all, 'status'] as const,
};

// Fetch standup status
async function fetchStandupStatus(): Promise<StandupStatus> {
  const res = await apiGet('/api/standups/status');
  if (!res.ok) {
    const error = new Error('Failed to fetch standup status') as Error & { status: number };
    error.status = res.status;
    throw error;
  }
  return res.json();
}

// Hook to get standup due status
export function useStandupStatusQuery() {
  return useQuery({
    queryKey: standupStatusKeys.status(),
    queryFn: fetchStandupStatus,
    staleTime: 1000 * 60 * 2, // 2 minutes
    refetchInterval: 1000 * 60 * 5, // Refetch every 5 minutes for real-time updates
  });
}

// Hook to invalidate standup status (call after posting a standup)
export function useInvalidateStandupStatus() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: standupStatusKeys.all });
}
