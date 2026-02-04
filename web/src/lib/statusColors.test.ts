import { describe, it, expect } from 'vitest';
import {
  getIssueStatusColor,
  getSprintStatusColor,
  getPriorityColor,
} from './statusColors';

describe('statusColors', () => {
  describe('getIssueStatusColor', () => {
    it('returns dark theme colors when theme is dark', () => {
      expect(getIssueStatusColor('triage', 'dark')).toBe('bg-purple-500/20 text-purple-300');
      expect(getIssueStatusColor('backlog', 'dark')).toBe('bg-gray-500/20 text-gray-300');
      expect(getIssueStatusColor('todo', 'dark')).toBe('bg-blue-500/20 text-blue-300');
      expect(getIssueStatusColor('in_progress', 'dark')).toBe('bg-yellow-500/20 text-yellow-300');
      expect(getIssueStatusColor('in_review', 'dark')).toBe('bg-cyan-500/20 text-cyan-300');
      expect(getIssueStatusColor('done', 'dark')).toBe('bg-green-500/20 text-green-300');
      expect(getIssueStatusColor('cancelled', 'dark')).toBe('bg-red-500/20 text-red-300');
    });

    it('returns light theme colors when theme is light', () => {
      expect(getIssueStatusColor('triage', 'light')).toBe('bg-purple-100 text-purple-800');
      expect(getIssueStatusColor('backlog', 'light')).toBe('bg-gray-100 text-gray-800');
      expect(getIssueStatusColor('todo', 'light')).toBe('bg-blue-100 text-blue-800');
      expect(getIssueStatusColor('in_progress', 'light')).toBe('bg-yellow-100 text-yellow-800');
      expect(getIssueStatusColor('in_review', 'light')).toBe('bg-cyan-100 text-cyan-800');
      expect(getIssueStatusColor('done', 'light')).toBe('bg-green-100 text-green-800');
      expect(getIssueStatusColor('cancelled', 'light')).toBe('bg-red-100 text-red-800');
    });

    it('returns fallback color for unknown status in dark theme', () => {
      expect(getIssueStatusColor('unknown', 'dark')).toBe('bg-gray-500/20 text-gray-300');
    });

    it('returns fallback color for unknown status in light theme', () => {
      expect(getIssueStatusColor('unknown', 'light')).toBe('bg-gray-100 text-gray-800');
    });
  });

  describe('getSprintStatusColor', () => {
    it('returns dark theme colors when theme is dark', () => {
      expect(getSprintStatusColor('planned', 'dark')).toBe('bg-gray-500/20 text-gray-300');
      expect(getSprintStatusColor('upcoming', 'dark')).toBe('bg-blue-500/20 text-blue-300');
      expect(getSprintStatusColor('active', 'dark')).toBe('bg-green-500/20 text-green-300');
      expect(getSprintStatusColor('completed', 'dark')).toBe('bg-gray-500/20 text-gray-300');
    });

    it('returns light theme colors when theme is light', () => {
      expect(getSprintStatusColor('planned', 'light')).toBe('bg-gray-100 text-gray-800');
      expect(getSprintStatusColor('upcoming', 'light')).toBe('bg-blue-100 text-blue-800');
      expect(getSprintStatusColor('active', 'light')).toBe('bg-green-100 text-green-800');
      expect(getSprintStatusColor('completed', 'light')).toBe('bg-gray-100 text-gray-800');
    });

    it('returns fallback color for unknown status', () => {
      expect(getSprintStatusColor('unknown', 'dark')).toBe('bg-gray-500/20 text-gray-300');
      expect(getSprintStatusColor('unknown', 'light')).toBe('bg-gray-100 text-gray-800');
    });
  });

  describe('getPriorityColor', () => {
    it('returns dark theme colors when theme is dark', () => {
      expect(getPriorityColor('urgent', 'dark')).toBe('text-red-300');
      expect(getPriorityColor('high', 'dark')).toBe('text-orange-300');
      expect(getPriorityColor('medium', 'dark')).toBe('text-yellow-300');
      expect(getPriorityColor('low', 'dark')).toBe('text-blue-300');
    });

    it('returns light theme colors when theme is light', () => {
      expect(getPriorityColor('urgent', 'light')).toBe('text-red-700');
      expect(getPriorityColor('high', 'light')).toBe('text-orange-700');
      expect(getPriorityColor('medium', 'light')).toBe('text-yellow-700');
      expect(getPriorityColor('low', 'light')).toBe('text-blue-700');
    });

    it('returns fallback color for unknown priority', () => {
      expect(getPriorityColor('unknown', 'dark')).toBe('text-blue-300');
      expect(getPriorityColor('unknown', 'light')).toBe('text-blue-700');
    });
  });
});
