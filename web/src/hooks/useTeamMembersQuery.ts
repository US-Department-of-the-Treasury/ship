import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';

export interface TeamMember {
  id: string;
  user_id: string;
  name: string;
  email?: string;
}

// Query keys
export const teamMemberKeys = {
  all: ['teamMembers'] as const,
  lists: () => [...teamMemberKeys.all, 'list'] as const,
};

// Fetch team members (filters out pending users who don't have user_id yet)
async function fetchTeamMembers(): Promise<TeamMember[]> {
  const res = await apiGet('/api/team/people');
  if (!res.ok) {
    const error = new Error('Failed to fetch team members') as Error & { status: number };
    error.status = res.status;
    throw error;
  }
  const data: TeamMember[] = await res.json();
  // Filter out pending users (those without user_id) - they can't be assigned yet
  return data.filter(member => member.user_id);
}

// Hook to get team members with TanStack Query (supports offline via cache)
export function useTeamMembersQuery() {
  return useQuery({
    queryKey: teamMemberKeys.lists(),
    queryFn: fetchTeamMembers,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}
