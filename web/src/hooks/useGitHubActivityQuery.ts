import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';

export interface GitHubActivity {
  id: string;
  repo_owner: string;
  repo_name: string;
  event_type: 'pr_opened' | 'pr_merged' | 'pr_closed';
  github_id: number;
  title: string;
  url: string;
  author_login: string;
  author_avatar_url: string | null;
  issue_ids: number[];
  created_at: string;
  github_created_at: string;
}

interface GitHubActivityResponse {
  activities: GitHubActivity[];
  pagination: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}

interface FetchOptions {
  program_id?: string;
  issue_id?: number;
  author_login?: string;  // Filter by GitHub username
  limit?: number;
  offset?: number;
}

// Query keys
export const githubActivityKeys = {
  all: ['github-activity'] as const,
  lists: () => [...githubActivityKeys.all, 'list'] as const,
  list: (filters?: FetchOptions) => [...githubActivityKeys.lists(), filters] as const,
};

async function fetchGitHubActivity(options: FetchOptions = {}): Promise<GitHubActivityResponse> {
  const params = new URLSearchParams();
  if (options.program_id) params.set('program_id', options.program_id);
  if (options.issue_id) params.set('issue_id', String(options.issue_id));
  if (options.author_login) params.set('author_login', options.author_login);
  if (options.limit) params.set('limit', String(options.limit));
  if (options.offset) params.set('offset', String(options.offset));

  const queryString = params.toString();
  const url = `/api/github/activity${queryString ? `?${queryString}` : ''}`;

  const res = await apiGet(url);
  if (!res.ok) {
    throw new Error('Failed to fetch GitHub activity');
  }
  return res.json();
}

export function useGitHubActivityQuery(options: FetchOptions = {}) {
  return useQuery({
    queryKey: githubActivityKeys.list(options),
    queryFn: () => fetchGitHubActivity(options),
    staleTime: 30_000, // 30 seconds
  });
}
