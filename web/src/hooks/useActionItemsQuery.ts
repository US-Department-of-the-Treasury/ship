import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';

export interface ActionItem {
  id: string;
  title: string;
  state: string;
  priority: string;
  ticket_number: number;
  display_id: string;
  due_date: string | null;
  is_system_generated: boolean;
  accountability_type: string | null;
  accountability_target_id: string | null;
  target_title?: string;
  days_overdue: number;
}

interface ActionItemsResponse {
  items: ActionItem[];
  total: number;
}

export const actionItemsKeys = {
  all: ['action-items'] as const,
  list: () => [...actionItemsKeys.all, 'list'] as const,
};

export function useActionItemsQuery() {
  return useQuery<ActionItemsResponse>({
    queryKey: actionItemsKeys.list(),
    queryFn: async () => {
      const response = await apiGet('/api/issues/action-items');
      if (!response.ok) {
        throw new Error('Failed to fetch action items');
      }
      return response.json();
    },
    // Refetch frequently since these are important accountability items
    staleTime: 30 * 1000, // 30 seconds
    refetchInterval: 60 * 1000, // Refetch every minute
  });
}
