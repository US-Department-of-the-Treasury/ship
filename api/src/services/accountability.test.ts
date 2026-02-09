import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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

// Mock getAllocations to avoid fragile query ordering
vi.mock('../utils/allocation.js', () => ({
  getAllocations: vi.fn().mockResolvedValue([]),
}));

import { pool } from '../db/client.js';
import { isBusinessDay } from '../utils/business-days.js';
import { getAllocations } from '../utils/allocation.js';
import { checkMissingAccountability } from './accountability.js';

describe('Accountability Service', () => {
  const userId = 'user-123';
  const workspaceId = 'workspace-456';
  const sprintId = 'sprint-789';
  const projectId = 'project-abc';
  const personId = 'person-doc-123';

  beforeEach(() => {
    vi.mocked(pool.query).mockReset();
    vi.mocked(isBusinessDay).mockReturnValue(true);
    vi.mocked(getAllocations).mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // Helper to mock the standard setup queries (workspace + person lookup)
  const mockSetupQueries = (sprintStartDate = '2024-01-01') => {
    return vi.mocked(pool.query)
      // 1. Workspace query
      .mockResolvedValueOnce({
        rows: [{ sprint_start_date: sprintStartDate }],
      } as any)
      // 2. Person document lookup
      .mockResolvedValueOnce({
        rows: [{ id: personId }],
      } as any);
  };

  /**
   * Helper to set up a minimal mock sequence for tests that don't care about
   * specific accountability types. After setup queries, the sequence is:
   * - standup active sprints (skipped if !isBusinessDay)
   * - owned sprints (sprint accountability)
   * - (getAllocations is mocked directly)
   * - past sprints without review
   * - completed projects without retro
   */
  const mockMinimalQueries = (sprintStartDate = '2024-01-01') => {
    vi.mocked(isBusinessDay).mockReturnValue(false); // skip standup checks
    return mockSetupQueries(sprintStartDate)
      // owned sprints
      .mockResolvedValueOnce({ rows: [] } as any)
      // past sprints without review
      .mockResolvedValueOnce({ rows: [] } as any)
      // completed projects without retro
      .mockResolvedValueOnce({ rows: [] } as any);
  };

  describe('checkMissingAccountability', () => {
    it('returns empty array when workspace not found', async () => {
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);

      const result = await checkMissingAccountability(userId, workspaceId);

      expect(result).toEqual([]);
    });

    it('returns multiple accountability types when applicable', async () => {
      mockSetupQueries()
        // Standup - active sprints with assigned issues
        .mockResolvedValueOnce({
          rows: [{ id: sprintId, title: 'Sprint 1', properties: { sprint_number: 1 }, issue_count: '3' }],
        } as any)
        // Standup - check for existing standup today
        .mockResolvedValueOnce({ rows: [] } as any)
        // Standup - last standup date
        .mockResolvedValueOnce({ rows: [{ last_standup_date: null }] } as any)
        // Sprint accountability - sprints owned by user
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
        // Sprint issues count
        .mockResolvedValueOnce({ rows: [{ count: '0' }] } as any)
        // Sprint reviews - past sprints without review
        .mockResolvedValueOnce({ rows: [] } as any)
        // Completed projects without retro
        .mockResolvedValueOnce({ rows: [] } as any);

      const result = await checkMissingAccountability(userId, workspaceId);

      const types = result.map((item) => item.type);
      expect(types).toContain('standup');
      expect(types).toContain('weekly_plan');
      expect(types).toContain('week_start');
      expect(types).toContain('week_issues');
    });
  });

  describe('standup type', () => {
    it('returns standup item with issue count', async () => {
      mockSetupQueries()
        .mockResolvedValueOnce({
          rows: [{ id: sprintId, title: 'Sprint 1', properties: { sprint_number: 1 }, issue_count: '5' }],
        } as any)
        .mockResolvedValueOnce({ rows: [] } as any)
        .mockResolvedValueOnce({ rows: [{ last_standup_date: null }] } as any)
        .mockResolvedValueOnce({ rows: [] } as any)
        .mockResolvedValueOnce({ rows: [] } as any)
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
        .mockResolvedValueOnce({ rows: [] } as any)
        .mockResolvedValueOnce({ rows: [] } as any)
        .mockResolvedValueOnce({ rows: [] } as any);

      const result = await checkMissingAccountability(userId, workspaceId);

      const standupItem = result.find((item) => item.type === 'standup');
      expect(standupItem).toBeUndefined();
    });

    it('does not return standup item when standup exists today', async () => {
      mockSetupQueries()
        .mockResolvedValueOnce({
          rows: [{ id: sprintId, title: 'Sprint 1', properties: { sprint_number: 1 }, issue_count: '3' }],
        } as any)
        .mockResolvedValueOnce({ rows: [{ id: 'standup-1' }] } as any)
        .mockResolvedValueOnce({ rows: [] } as any)
        .mockResolvedValueOnce({ rows: [] } as any)
        .mockResolvedValueOnce({ rows: [] } as any);

      const result = await checkMissingAccountability(userId, workspaceId);

      const standupItem = result.find((item) => item.type === 'standup');
      expect(standupItem).toBeUndefined();
    });
  });

  describe('weekly_plan type', () => {
    it('returns item when sprint has no plan', async () => {
      mockSetupQueries()
        .mockResolvedValueOnce({ rows: [] } as any)
        .mockResolvedValueOnce({
          rows: [{ id: sprintId, title: 'Sprint 1', properties: { sprint_number: 1, status: 'active', plan: '' }, project_id: projectId }],
        } as any)
        .mockResolvedValueOnce({ rows: [{ count: '5' }] } as any)
        .mockResolvedValueOnce({ rows: [] } as any)
        .mockResolvedValueOnce({ rows: [] } as any);

      const result = await checkMissingAccountability(userId, workspaceId);

      const planItem = result.find((item) => item.type === 'weekly_plan');
      expect(planItem).toBeDefined();
      expect(planItem?.message).toContain('plan');
      expect(planItem?.personId).toBe(personId);
      expect(planItem?.projectId).toBe(projectId);
      expect(planItem?.weekNumber).toBe(1);
    });

    it('does not return item when sprint has plan', async () => {
      mockSetupQueries()
        .mockResolvedValueOnce({ rows: [] } as any)
        .mockResolvedValueOnce({
          rows: [{ id: sprintId, title: 'Sprint 1', properties: { sprint_number: 1, status: 'active', plan: 'Test plan' }, project_id: projectId }],
        } as any)
        .mockResolvedValueOnce({ rows: [{ count: '5' }] } as any)
        .mockResolvedValueOnce({ rows: [] } as any)
        .mockResolvedValueOnce({ rows: [] } as any);

      const result = await checkMissingAccountability(userId, workspaceId);

      const planItem = result.find((item) => item.type === 'weekly_plan');
      expect(planItem).toBeUndefined();
    });
  });

  describe('week_start type', () => {
    it('returns item when sprint is not started', async () => {
      mockSetupQueries()
        .mockResolvedValueOnce({ rows: [] } as any)
        .mockResolvedValueOnce({
          rows: [{ id: sprintId, title: 'Sprint 1', properties: { sprint_number: 1, status: 'planning', plan: 'test' }, project_id: projectId }],
        } as any)
        .mockResolvedValueOnce({ rows: [{ count: '5' }] } as any)
        .mockResolvedValueOnce({ rows: [] } as any)
        .mockResolvedValueOnce({ rows: [] } as any);

      const result = await checkMissingAccountability(userId, workspaceId);

      const startItem = result.find((item) => item.type === 'week_start');
      expect(startItem).toBeDefined();
      expect(startItem?.message).toContain('Start');
    });

    it('does not return item when sprint is active', async () => {
      mockSetupQueries()
        .mockResolvedValueOnce({ rows: [] } as any)
        .mockResolvedValueOnce({
          rows: [{ id: sprintId, title: 'Sprint 1', properties: { sprint_number: 1, status: 'active', plan: 'test' }, project_id: projectId }],
        } as any)
        .mockResolvedValueOnce({ rows: [{ count: '5' }] } as any)
        .mockResolvedValueOnce({ rows: [] } as any)
        .mockResolvedValueOnce({ rows: [] } as any);

      const result = await checkMissingAccountability(userId, workspaceId);

      const startItem = result.find((item) => item.type === 'week_start');
      expect(startItem).toBeUndefined();
    });
  });

  describe('week_issues type', () => {
    it('returns item when sprint has no issues', async () => {
      mockSetupQueries()
        .mockResolvedValueOnce({ rows: [] } as any)
        .mockResolvedValueOnce({
          rows: [{ id: sprintId, title: 'Sprint 1', properties: { sprint_number: 1, status: 'active', plan: 'test' }, project_id: projectId }],
        } as any)
        .mockResolvedValueOnce({ rows: [{ count: '0' }] } as any)
        .mockResolvedValueOnce({ rows: [] } as any)
        .mockResolvedValueOnce({ rows: [] } as any);

      const result = await checkMissingAccountability(userId, workspaceId);

      const issuesItem = result.find((item) => item.type === 'week_issues');
      expect(issuesItem).toBeDefined();
      expect(issuesItem?.message).toContain('Add issues');
    });

    it('does not return item when sprint has issues', async () => {
      mockSetupQueries()
        .mockResolvedValueOnce({ rows: [] } as any)
        .mockResolvedValueOnce({
          rows: [{ id: sprintId, title: 'Sprint 1', properties: { sprint_number: 1, status: 'active', plan: 'test' }, project_id: projectId }],
        } as any)
        .mockResolvedValueOnce({ rows: [{ count: '5' }] } as any)
        .mockResolvedValueOnce({ rows: [] } as any)
        .mockResolvedValueOnce({ rows: [] } as any);

      const result = await checkMissingAccountability(userId, workspaceId);

      const issuesItem = result.find((item) => item.type === 'week_issues');
      expect(issuesItem).toBeUndefined();
    });
  });

  describe('project_retro type', () => {
    it('returns item when project is complete but has no retro', async () => {
      mockSetupQueries()
        .mockResolvedValueOnce({ rows: [] } as any)
        .mockResolvedValueOnce({ rows: [] } as any)
        .mockResolvedValueOnce({ rows: [] } as any)
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
        .mockResolvedValueOnce({ rows: [] } as any)
        .mockResolvedValueOnce({ rows: [] } as any)
        .mockResolvedValueOnce({
          rows: [{ id: sprintId, title: 'Past Sprint', properties: { sprint_number: 1 } }],
        } as any)
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
        .mockResolvedValueOnce({ rows: [{ sprint_start_date: startDate }] } as any)
        .mockResolvedValueOnce({ rows: [{ id: personId }] } as any)
        .mockResolvedValueOnce({ rows: [] } as any)
        .mockResolvedValueOnce({ rows: [] } as any)
        .mockResolvedValueOnce({ rows: [] } as any)
        .mockResolvedValueOnce({ rows: [] } as any);

      const result = await checkMissingAccountability(userId, workspaceId);
      expect(result).toBeDefined();
    });

    it('handles workspace start date as string', async () => {
      mockSetupQueries()
        .mockResolvedValueOnce({ rows: [] } as any)
        .mockResolvedValueOnce({ rows: [] } as any)
        .mockResolvedValueOnce({ rows: [] } as any)
        .mockResolvedValueOnce({ rows: [] } as any);

      const result = await checkMissingAccountability(userId, workspaceId);
      expect(result).toBeDefined();
    });
  });

  // ======================================================================
  // Scenario tests for plan/retro due windows and next-sprint lookahead
  // ======================================================================

  describe('per-person weekly plan due window (Saturday through Monday EOD)', () => {
    // Workspace sprint_start_date = 2024-01-01 (Monday)
    // Week 1: Jan 1-7, Week 2: Jan 8-14

    it('shows next sprint plan as due on Saturday before the week starts', async () => {
      // Saturday Jan 6 = last day of Week 1, but 2 days before Week 2 starts
      // Plan for Week 2 should be due (weekStart - 2 = Jan 8 - 2 = Jan 6)
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-06T12:00:00Z'));
      vi.mocked(isBusinessDay).mockReturnValue(false); // Saturday

      mockMinimalQueries();
      vi.mocked(getAllocations)
        .mockResolvedValueOnce([]) // current sprint (Week 1) - no allocations
        .mockResolvedValueOnce([{ projectId, projectName: 'Test Project' }]); // next sprint (Week 2)

      // Plan query for Week 2 - no plan exists
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);

      const result = await checkMissingAccountability(userId, workspaceId);

      const planItem = result.find((item) => item.type === 'weekly_plan' && item.weekNumber === 2);
      expect(planItem).toBeDefined();
      expect(planItem?.message).toContain('week 2 plan');
    });

    it('shows current sprint plan as due on Monday (the week has started)', async () => {
      // Monday Jan 8 = start of Week 2
      // Plan was due from Saturday Jan 6, still in yellow window until Tuesday
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-08T12:00:00Z'));

      mockMinimalQueries();
      vi.mocked(getAllocations)
        .mockResolvedValueOnce([{ projectId, projectName: 'Test Project' }]) // current (Week 2)
        .mockResolvedValueOnce([]); // next sprint (Week 3) - no allocations

      // Plan query for Week 2 - no plan exists
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);

      const result = await checkMissingAccountability(userId, workspaceId);

      const planItem = result.find((item) => item.type === 'weekly_plan' && item.weekNumber === 2);
      expect(planItem).toBeDefined();
    });

    it('does NOT show next sprint plan on Friday (too early)', async () => {
      // Friday Jan 5 = day 5 of Week 1
      // Week 2 plan due from Saturday Jan 6, so Friday is too early
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-05T12:00:00Z'));

      mockMinimalQueries();
      vi.mocked(getAllocations)
        .mockResolvedValueOnce([]) // current sprint (Week 1)
        .mockResolvedValueOnce([{ projectId, projectName: 'Test Project' }]); // next sprint (Week 2)

      const result = await checkMissingAccountability(userId, workspaceId);

      const planItem = result.find((item) => item.type === 'weekly_plan' && item.weekNumber === 2);
      expect(planItem).toBeUndefined();
    });

    it('shows plan as overdue on Tuesday (after Monday EOD)', async () => {
      // Tuesday Jan 9 = weekStart + 1 = overdue threshold
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-09T12:00:00Z'));

      mockMinimalQueries();
      vi.mocked(getAllocations)
        .mockResolvedValueOnce([{ projectId, projectName: 'Test Project' }]) // current (Week 2)
        .mockResolvedValueOnce([]); // next (Week 3)

      // Plan query for Week 2 - no plan exists
      vi.mocked(pool.query).mockResolvedValueOnce({ rows: [] } as any);

      const result = await checkMissingAccountability(userId, workspaceId);

      const planItem = result.find((item) => item.type === 'weekly_plan' && item.weekNumber === 2);
      expect(planItem).toBeDefined();
      // Due date should reflect the overdue date (Tuesday = weekStart + 1)
      expect(planItem?.dueDate).toBe('2024-01-09');
    });
  });

  describe('per-person weekly retro due window (Thursday through Friday EOD)', () => {
    // Workspace sprint_start_date = 2024-01-01 (Monday)
    // Week 1: Jan 1-7

    it('shows retro as due on Thursday', async () => {
      // Thursday Jan 4 = weekStart + 3 = retro due threshold
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-04T12:00:00Z'));

      mockMinimalQueries();
      vi.mocked(getAllocations)
        .mockResolvedValueOnce([{ projectId, projectName: 'Test Project' }]) // current (Week 1)
        .mockResolvedValueOnce([]); // next (Week 2)

      // Plan query for Week 1 - plan exists (done)
      vi.mocked(pool.query)
        .mockResolvedValueOnce({ rows: [{ id: 'plan-1', content: { type: 'doc', content: [{ type: 'text', text: 'My plan' }] } }] } as any)
        // Retro query for Week 1 - no retro
        .mockResolvedValueOnce({ rows: [] } as any);

      const result = await checkMissingAccountability(userId, workspaceId);

      const retroItem = result.find((item) => item.type === 'weekly_retro' && item.weekNumber === 1);
      expect(retroItem).toBeDefined();
      expect(retroItem?.message).toContain('retro');
    });

    it('does NOT show retro on Wednesday (too early)', async () => {
      // Wednesday Jan 3 = weekStart + 2 = before retro due threshold
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-03T12:00:00Z'));

      mockMinimalQueries();
      vi.mocked(getAllocations)
        .mockResolvedValueOnce([{ projectId, projectName: 'Test Project' }]) // current (Week 1)
        .mockResolvedValueOnce([]); // next (Week 2)

      // Plan query for Week 1 - plan exists
      vi.mocked(pool.query)
        .mockResolvedValueOnce({ rows: [{ id: 'plan-1', content: { type: 'doc', content: [{ type: 'text', text: 'My plan' }] } }] } as any);
      // Retro is NOT queried because today < retroDueStr

      const result = await checkMissingAccountability(userId, workspaceId);

      const retroItem = result.find((item) => item.type === 'weekly_retro');
      expect(retroItem).toBeUndefined();
    });

    it('shows retro as overdue on Saturday', async () => {
      // Saturday Jan 6 = weekStart + 5 = retro overdue threshold
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-06T12:00:00Z'));
      vi.mocked(isBusinessDay).mockReturnValue(false);

      mockMinimalQueries();
      vi.mocked(getAllocations)
        .mockResolvedValueOnce([{ projectId, projectName: 'Test Project' }]) // current (Week 1)
        .mockResolvedValueOnce([]); // next (Week 2)

      // Plan query - plan exists
      vi.mocked(pool.query)
        .mockResolvedValueOnce({ rows: [{ id: 'plan-1', content: { type: 'doc', content: [{ type: 'text', text: 'My plan' }] } }] } as any)
        // Retro query - no retro
        .mockResolvedValueOnce({ rows: [] } as any);

      const result = await checkMissingAccountability(userId, workspaceId);

      const retroItem = result.find((item) => item.type === 'weekly_retro' && item.weekNumber === 1);
      expect(retroItem).toBeDefined();
      // Due date should reflect the overdue date (Saturday = weekStart + 5)
      expect(retroItem?.dueDate).toBe('2024-01-06');
    });
  });

  describe('next-sprint lookahead', () => {
    it('checks both current AND next sprint for accountability', async () => {
      // Sunday Jan 7 = last day of Week 1
      // Next sprint (Week 2) plan due from Jan 6 (Saturday)
      // Today (Jan 7) is in the due window for Week 2's plan
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-07T12:00:00Z'));
      vi.mocked(isBusinessDay).mockReturnValue(false);

      // getAllocations is called twice: once for current sprint, once for next
      vi.mocked(getAllocations)
        .mockResolvedValueOnce([{ projectId, projectName: 'Current Project' }])  // Week 1
        .mockResolvedValueOnce([{ projectId: 'proj-2', projectName: 'Next Project' }]); // Week 2

      // Mock queries in execution order:
      // 1. workspace, 2. person, 3. owned sprints (sprint accountability),
      // 4-5. Week 1 plan+retro queries, 6. Week 2 plan query,
      // 7. sprint reviews, 8. project retros
      mockSetupQueries()
        // owned sprints (checkSprintAccountability)
        .mockResolvedValueOnce({ rows: [] } as any)
        // Week 1 plan - exists (done)
        .mockResolvedValueOnce({ rows: [{ id: 'plan-1', content: { type: 'doc', content: [{ type: 'text', text: 'done' }] } }] } as any)
        // Week 1 retro - exists (done) (today Jan 7 >= retroDueStr Jan 4)
        .mockResolvedValueOnce({ rows: [{ id: 'retro-1', content: { type: 'doc', content: [{ type: 'text', text: 'done' }] } }] } as any)
        // Week 2 plan - NOT exists
        .mockResolvedValueOnce({ rows: [] } as any)
        // sprint reviews
        .mockResolvedValueOnce({ rows: [] } as any)
        // project retros
        .mockResolvedValueOnce({ rows: [] } as any);

      const result = await checkMissingAccountability(userId, workspaceId);

      // Current sprint (Week 1) items should NOT appear (plan and retro are done)
      const week1Items = result.filter((item) => item.weekNumber === 1 && (item.type === 'weekly_plan' || item.type === 'weekly_retro'));
      expect(week1Items).toHaveLength(0);

      // Next sprint (Week 2) plan should appear
      const week2Plan = result.find((item) => item.type === 'weekly_plan' && item.weekNumber === 2);
      expect(week2Plan).toBeDefined();
      expect(week2Plan?.message).toContain('week 2 plan');
      expect(week2Plan?.projectId).toBe('proj-2');
    });

    it('does not duplicate items when plan is due for both current and next sprint', async () => {
      // Tuesday Jan 9 = day 2 of Week 2
      // Week 2 plan is overdue, Week 3 plan is not yet due (Jan 13 is due start)
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2024-01-09T12:00:00Z'));

      mockMinimalQueries();

      vi.mocked(getAllocations)
        .mockResolvedValueOnce([{ projectId, projectName: 'Test Project' }])  // Week 2
        .mockResolvedValueOnce([{ projectId, projectName: 'Test Project' }]); // Week 3

      // Week 2 plan - NOT exists
      vi.mocked(pool.query)
        .mockResolvedValueOnce({ rows: [] } as any);
      // Week 3 plan is not checked because today < planDueStr for Week 3

      const result = await checkMissingAccountability(userId, workspaceId);

      const planItems = result.filter((item) => item.type === 'weekly_plan');
      // Only Week 2 plan should appear, not Week 3
      expect(planItems).toHaveLength(1);
      expect(planItems[0]?.weekNumber).toBe(2);
    });
  });
});
