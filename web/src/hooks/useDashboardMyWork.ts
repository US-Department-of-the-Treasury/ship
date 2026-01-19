import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';

// Urgency levels for work items
export type Urgency = 'overdue' | 'this_sprint' | 'later';

export interface WorkItem {
  id: string;
  title: string;
  type: 'issue' | 'project' | 'sprint';
  urgency: Urgency;
  // Issue-specific
  state?: string;
  priority?: string;
  ticket_number?: number;
  sprint_id?: string | null;
  sprint_name?: string | null;
  // Project-specific
  ice_score?: number | null;
  inferred_status?: string;
  // Sprint-specific
  sprint_number?: number;
  days_remaining?: number;
  // Common
  program_name?: string | null;
}

export interface MyWorkResponse {
  items: WorkItem[];
  grouped: {
    overdue: WorkItem[];
    this_sprint: WorkItem[];
    later: WorkItem[];
  };
  current_sprint_number: number;
  days_remaining: number;
}

async function fetchMyWork(): Promise<MyWorkResponse> {
  const res = await apiGet('/api/dashboard/my-work');
  if (!res.ok) {
    const error = new Error('Failed to fetch my work') as Error & { status: number };
    error.status = res.status;
    throw error;
  }
  return res.json();
}

export function useDashboardMyWork() {
  return useQuery({
    queryKey: ['dashboard', 'my-work'],
    queryFn: fetchMyWork,
    staleTime: 30 * 1000, // 30 seconds
    refetchOnWindowFocus: true,
  });
}
