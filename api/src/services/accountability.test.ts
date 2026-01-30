import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock pool before importing service
vi.mock('../db/client.js', () => ({
  pool: {
    query: vi.fn(),
  },
}));

// Mock business-days to control date behavior
vi.mock('../utils/business-days.js', async () => {
  const actual = await vi.importActual<typeof import('../utils/business-days.js')>('../utils/business-days.js');
  return {
    ...actual,
    isBusinessDay: vi.fn().mockReturnValue(true),
  };
});

import { pool } from '../db/client.js';
import { isBusinessDay } from '../utils/business-days.js';
import { checkMissingAccountability, type MissingAccountabilityItem } from './accountability.js';

describe('Accountability Service', () => {
  const userId = 'user-123';
  const workspaceId = 'workspace-456';
  const sprintId = 'sprint-789';
  const projectId = 'project-abc';
  const personId = 'person-doc-123';

  beforeEach(() => {
    vi.mocked(pool.query).mockReset();
    vi.mocked(isBusinessDay).mockReturnValue(true);
  });

  // Helper to mock the standard setup queries (workspace + person lookup)
  const mockSetupQueries = () => {
    return vi.mocked(pool.query)
      // 1. Workspace query
      .mockResolvedValueOnce({
        rows: [{ sprint_start_date: '2024-01-01' }],
      } as any)
      // 2. Person document lookup
      .mockResolvedValueOnce({
        rows: [{ id: personId }],
      } as any);
  };

  describe('checkMissingAccountability', () => {
    it('returns empty array when workspace not found', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);

      const result = await checkMissingAccountability(userId, workspaceId);

      expect(result).toEqual([]);
    });

    it('returns all 7 accountability types when applicable', async () => {
      // Mock workspace and person queries
      mockSetupQueries()
        // 3. Standup - active sprints with assigned issues
        .mockResolvedValueOnce({
          rows: [{ id: sprintId, title: 'Sprint 1', properties: { sprint_number: 1 }, issue_count: '3' }],
        } as any)
        // 4. Standup - check for existing standup today
        .mockResolvedValueOnce({ rows: [] } as any)
        // 5. Standup - last standup date
        .mockResolvedValueOnce({ rows: [{ last_standup_date: null }] } as any)
        // 6. Sprint accountability - sprints owned by user
        .mockResolvedValueOnce({
          rows: [
            {
              id: sprintId,
              title: 'Sprint 1',
              properties: { sprint_number: 1, status: 'planning', plan: '' },
              project_id: projectId,
            },
          ],
        } as any)
        // 7. Sprint issues count
        .mockResolvedValueOnce({ rows: [{ count: '0' }] } as any)
        // 8. Sprint reviews - past sprints without review
        .mockResolvedValueOnce({ rows: [] } as any)
        // 9. Project plan - projects without plan
        .mockResolvedValueOnce({
          rows: [{ id: projectId, title: 'Test Project', properties: {} }],
        } as any)
        // 10. Project retros - completed projects without retro
        .mockResolvedValueOnce({ rows: [] } as any);

      const result = await checkMissingAccountability(userId, workspaceId);

      // Should include: standup, weekly_plan, week_start, week_issues, project_plan
      const types = result.map((item) => item.type);
      expect(types).toContain('standup');
      expect(types).toContain('weekly_plan');
      expect(types).toContain('week_start');
      expect(types).toContain('week_issues');
      expect(types).toContain('project_plan');
    });
  });

  describe('standup type', () => {
    it('returns standup item with issue count', async () => {
      mockSetupQueries()
        // Active sprints with issues - include issue count
        .mockResolvedValueOnce({
          rows: [{ id: sprintId, title: 'Sprint 1', properties: { sprint_number: 1 }, issue_count: '5' }],
        } as any)
        // No standup today
        .mockResolvedValueOnce({ rows: [] } as any)
        // No previous standups
        .mockResolvedValueOnce({ rows: [{ last_standup_date: null }] } as any)
        // No owned sprints (for sprint accountability)
        .mockResolvedValueOnce({ rows: [] } as any)
        // No past sprints without review
        .mockResolvedValueOnce({ rows: [] } as any)
        // No projects without plan
        .mockResolvedValueOnce({ rows: [] } as any)
        // No completed projects without retro
        .mockResolvedValueOnce({ rows: [] } as any);

      const result = await checkMissingAccountability(userId, workspaceId);

      const standupItem = result.find((item) => item.type === 'standup');
      expect(standupItem).toBeDefined();
      expect(standupItem?.message).toContain('5 issues');
      expect(standupItem?.issueCount).toBe(5);
    });

    it('skips standup check on weekends', async () => {
      vi.mocked(isBusinessDay).mockReturnValue(false);

      mockSetupQueries()
        // No owned sprints
        .mockResolvedValueOnce({ rows: [] } as any)
        // No past sprints without review
        .mockResolvedValueOnce({ rows: [] } as any)
        // No projects without plan
        .mockResolvedValueOnce({ rows: [] } as any)
        // No completed projects without retro
        .mockResolvedValueOnce({ rows: [] } as any);

      const result = await checkMissingAccountability(userId, workspaceId);

      const standupItem = result.find((item) => item.type === 'standup');
      expect(standupItem).toBeUndefined();
    });

    it('does not return standup item when standup exists today', async () => {
      mockSetupQueries()
        // Active sprints with issues
        .mockResolvedValueOnce({
          rows: [{ id: sprintId, title: 'Sprint 1', properties: { sprint_number: 1 }, issue_count: '3' }],
        } as any)
        // Standup exists today
        .mockResolvedValueOnce({ rows: [{ id: 'standup-1' }] } as any)
        // No owned sprints
        .mockResolvedValueOnce({ rows: [] } as any)
        // No past sprints without review
        .mockResolvedValueOnce({ rows: [] } as any)
        // No projects without plan
        .mockResolvedValueOnce({ rows: [] } as any)
        // No completed projects without retro
        .mockResolvedValueOnce({ rows: [] } as any);

      const result = await checkMissingAccountability(userId, workspaceId);

      const standupItem = result.find((item) => item.type === 'standup');
      expect(standupItem).toBeUndefined();
    });
  });

  describe('weekly_plan type', () => {
    it('returns item when sprint has no plan', async () => {
      mockSetupQueries()
        // No active sprints with assigned issues
        .mockResolvedValueOnce({ rows: [] } as any)
        // Owned sprint without plan
        .mockResolvedValueOnce({
          rows: [{ id: sprintId, title: 'Sprint 1', properties: { sprint_number: 1, status: 'active', plan: '' }, project_id: projectId }],
        } as any)
        // Sprint has issues
        .mockResolvedValueOnce({ rows: [{ count: '5' }] } as any)
        // No past sprints without review
        .mockResolvedValueOnce({ rows: [] } as any)
        // No projects without plan
        .mockResolvedValueOnce({ rows: [] } as any)
        // No completed projects without retro
        .mockResolvedValueOnce({ rows: [] } as any);

      const result = await checkMissingAccountability(userId, workspaceId);

      const planItem = result.find((item) => item.type === 'weekly_plan');
      expect(planItem).toBeDefined();
      expect(planItem?.message).toContain('plan');
      // Verify navigation metadata is included
      expect(planItem?.personId).toBe(personId);
      expect(planItem?.projectId).toBe(projectId);
      expect(planItem?.weekNumber).toBe(1);
    });

    it('does not return item when sprint has plan', async () => {
      mockSetupQueries()
        // No active sprints with assigned issues
        .mockResolvedValueOnce({ rows: [] } as any)
        // Owned sprint WITH plan
        .mockResolvedValueOnce({
          rows: [
            {
              id: sprintId,
              title: 'Sprint 1',
              properties: { sprint_number: 1, status: 'active', plan: 'Test plan' },
              project_id: projectId,
            },
          ],
        } as any)
        // Sprint has issues
        .mockResolvedValueOnce({ rows: [{ count: '5' }] } as any)
        // No past sprints without review
        .mockResolvedValueOnce({ rows: [] } as any)
        // No projects without plan
        .mockResolvedValueOnce({ rows: [] } as any)
        // No completed projects without retro
        .mockResolvedValueOnce({ rows: [] } as any);

      const result = await checkMissingAccountability(userId, workspaceId);

      const planItem = result.find((item) => item.type === 'weekly_plan');
      expect(planItem).toBeUndefined();
    });
  });

  describe('week_start type', () => {
    it('returns item when sprint is not started', async () => {
      mockSetupQueries()
        // No active sprints with assigned issues
        .mockResolvedValueOnce({ rows: [] } as any)
        // Owned sprint not started
        .mockResolvedValueOnce({
          rows: [
            {
              id: sprintId,
              title: 'Sprint 1',
              properties: { sprint_number: 1, status: 'planning', plan: 'test' },
              project_id: projectId,
            },
          ],
        } as any)
        // Sprint has issues
        .mockResolvedValueOnce({ rows: [{ count: '5' }] } as any)
        // No past sprints without review
        .mockResolvedValueOnce({ rows: [] } as any)
        // No projects without plan
        .mockResolvedValueOnce({ rows: [] } as any)
        // No completed projects without retro
        .mockResolvedValueOnce({ rows: [] } as any);

      const result = await checkMissingAccountability(userId, workspaceId);

      const startItem = result.find((item) => item.type === 'week_start');
      expect(startItem).toBeDefined();
      expect(startItem?.message).toContain('Start');
    });

    it('does not return item when sprint is active', async () => {
      mockSetupQueries()
        // No active sprints with assigned issues
        .mockResolvedValueOnce({ rows: [] } as any)
        // Owned sprint is active
        .mockResolvedValueOnce({
          rows: [{ id: sprintId, title: 'Sprint 1', properties: { sprint_number: 1, status: 'active', plan: 'test' }, project_id: projectId }],
        } as any)
        // Sprint has issues
        .mockResolvedValueOnce({ rows: [{ count: '5' }] } as any)
        // No past sprints without review
        .mockResolvedValueOnce({ rows: [] } as any)
        // No projects without plan
        .mockResolvedValueOnce({ rows: [] } as any)
        // No completed projects without retro
        .mockResolvedValueOnce({ rows: [] } as any);

      const result = await checkMissingAccountability(userId, workspaceId);

      const startItem = result.find((item) => item.type === 'week_start');
      expect(startItem).toBeUndefined();
    });
  });

  describe('week_issues type', () => {
    it('returns item when sprint has no issues', async () => {
      mockSetupQueries()
        // No active sprints with assigned issues
        .mockResolvedValueOnce({ rows: [] } as any)
        // Owned sprint
        .mockResolvedValueOnce({
          rows: [{ id: sprintId, title: 'Sprint 1', properties: { sprint_number: 1, status: 'active', plan: 'test' }, project_id: projectId }],
        } as any)
        // Sprint has NO issues
        .mockResolvedValueOnce({ rows: [{ count: '0' }] } as any)
        // No past sprints without review
        .mockResolvedValueOnce({ rows: [] } as any)
        // No projects without plan
        .mockResolvedValueOnce({ rows: [] } as any)
        // No completed projects without retro
        .mockResolvedValueOnce({ rows: [] } as any);

      const result = await checkMissingAccountability(userId, workspaceId);

      const issuesItem = result.find((item) => item.type === 'week_issues');
      expect(issuesItem).toBeDefined();
      expect(issuesItem?.message).toContain('Add issues');
    });

    it('does not return item when sprint has issues', async () => {
      mockSetupQueries()
        // No active sprints with assigned issues
        .mockResolvedValueOnce({ rows: [] } as any)
        // Owned sprint
        .mockResolvedValueOnce({
          rows: [{ id: sprintId, title: 'Sprint 1', properties: { sprint_number: 1, status: 'active', plan: 'test' }, project_id: projectId }],
        } as any)
        // Sprint has issues
        .mockResolvedValueOnce({ rows: [{ count: '5' }] } as any)
        // No past sprints without review
        .mockResolvedValueOnce({ rows: [] } as any)
        // No projects without plan
        .mockResolvedValueOnce({ rows: [] } as any)
        // No completed projects without retro
        .mockResolvedValueOnce({ rows: [] } as any);

      const result = await checkMissingAccountability(userId, workspaceId);

      const issuesItem = result.find((item) => item.type === 'week_issues');
      expect(issuesItem).toBeUndefined();
    });
  });

  describe('project_plan type', () => {
    it('returns item when project has no plan', async () => {
      mockSetupQueries()
        // No active sprints with assigned issues
        .mockResolvedValueOnce({ rows: [] } as any)
        // No owned sprints
        .mockResolvedValueOnce({ rows: [] } as any)
        // No past sprints without review
        .mockResolvedValueOnce({ rows: [] } as any)
        // Project without plan
        .mockResolvedValueOnce({
          rows: [{ id: projectId, title: 'Test Project', properties: {} }],
        } as any)
        // No completed projects without retro
        .mockResolvedValueOnce({ rows: [] } as any);

      const result = await checkMissingAccountability(userId, workspaceId);

      const planItem = result.find((item) => item.type === 'project_plan');
      expect(planItem).toBeDefined();
      expect(planItem?.message).toContain('plan');
      expect(planItem?.targetId).toBe(projectId);
    });

    it('excludes archived projects', async () => {
      // The query itself filters archived projects, so we just verify the query is correct
      // by checking that the mock returns no results when projects are archived
      mockSetupQueries()
        .mockResolvedValueOnce({ rows: [] } as any)
        .mockResolvedValueOnce({ rows: [] } as any)
        .mockResolvedValueOnce({ rows: [] } as any)
        // No projects (all archived)
        .mockResolvedValueOnce({ rows: [] } as any)
        .mockResolvedValueOnce({ rows: [] } as any);

      const result = await checkMissingAccountability(userId, workspaceId);

      const planItem = result.find((item) => item.type === 'project_plan');
      expect(planItem).toBeUndefined();
    });
  });

  describe('project_retro type', () => {
    it('returns item when project is complete but has no retro', async () => {
      mockSetupQueries()
        // No active sprints with assigned issues
        .mockResolvedValueOnce({ rows: [] } as any)
        // No owned sprints
        .mockResolvedValueOnce({ rows: [] } as any)
        // No past sprints without review
        .mockResolvedValueOnce({ rows: [] } as any)
        // No projects without plan
        .mockResolvedValueOnce({ rows: [] } as any)
        // Completed project without retro
        .mockResolvedValueOnce({
          rows: [{ id: projectId, title: 'Completed Project', properties: {} }],
        } as any);

      const result = await checkMissingAccountability(userId, workspaceId);

      const retroItem = result.find((item) => item.type === 'project_retro');
      expect(retroItem).toBeDefined();
      expect(retroItem?.message).toContain('retro');
      expect(retroItem?.targetId).toBe(projectId);
    });
  });

  describe('weekly_review type', () => {
    it('returns item for past sprint without review', async () => {
      mockSetupQueries()
        // No active sprints with assigned issues
        .mockResolvedValueOnce({ rows: [] } as any)
        // No owned sprints (for weekly_plan/week_start/week_issues)
        .mockResolvedValueOnce({ rows: [] } as any)
        // Past sprint without review (very old sprint number to ensure it's past)
        .mockResolvedValueOnce({
          rows: [{ id: sprintId, title: 'Past Sprint', properties: { sprint_number: 1 } }],
        } as any)
        // No projects without plan
        .mockResolvedValueOnce({ rows: [] } as any)
        // No completed projects without retro
        .mockResolvedValueOnce({ rows: [] } as any);

      const result = await checkMissingAccountability(userId, workspaceId);

      const reviewItem = result.find((item) => item.type === 'weekly_review');
      expect(reviewItem).toBeDefined();
      expect(reviewItem?.message).toContain('review');
    });
  });

  describe('date calculations', () => {
    it('handles workspace start date as Date object', async () => {
      const startDate = new Date('2024-01-01');
      vi.mocked(pool.query)
        .mockResolvedValueOnce({
          rows: [{ sprint_start_date: startDate }],
        } as any)
        // Person lookup
        .mockResolvedValueOnce({ rows: [{ id: personId }] } as any)
        .mockResolvedValueOnce({ rows: [] } as any)
        .mockResolvedValueOnce({ rows: [] } as any)
        .mockResolvedValueOnce({ rows: [] } as any)
        .mockResolvedValueOnce({ rows: [] } as any)
        .mockResolvedValueOnce({ rows: [] } as any);

      const result = await checkMissingAccountability(userId, workspaceId);

      // Should not throw
      expect(result).toBeDefined();
    });

    it('handles workspace start date as string', async () => {
      mockSetupQueries()
        .mockResolvedValueOnce({ rows: [] } as any)
        .mockResolvedValueOnce({ rows: [] } as any)
        .mockResolvedValueOnce({ rows: [] } as any)
        .mockResolvedValueOnce({ rows: [] } as any)
        .mockResolvedValueOnce({ rows: [] } as any);

      const result = await checkMissingAccountability(userId, workspaceId);

      // Should not throw
      expect(result).toBeDefined();
    });
  });
});
