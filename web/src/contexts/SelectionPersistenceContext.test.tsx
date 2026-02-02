import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ReactNode } from 'react';
import {
  SelectionPersistenceProvider,
  useSelectionPersistence,
  useSelectionPersistenceOptional,
} from './SelectionPersistenceContext';

function wrapper({ children }: { children: ReactNode }) {
  return <SelectionPersistenceProvider>{children}</SelectionPersistenceProvider>;
}

describe('SelectionPersistenceContext', () => {
  describe('useSelectionPersistence', () => {
    it('should throw when used outside provider', () => {
      // Suppress console.error for this test
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

      // renderHook doesn't allow checking throws directly, so we catch the error
      let thrownError: Error | null = null;
      try {
        renderHook(() => useSelectionPersistence());
      } catch (error) {
        thrownError = error as Error;
      }

      expect(thrownError).not.toBeNull();
      expect(thrownError?.message).toContain('useSelectionPersistence must be used within a SelectionPersistenceProvider');

      spy.mockRestore();
    });

    it('should return default state for unknown key', () => {
      const { result } = renderHook(() => useSelectionPersistence(), { wrapper });

      const selection = result.current.getSelection('unknown-key');

      expect(selection.selectedIds.size).toBe(0);
      expect(selection.lastSelectedId).toBeNull();
    });

    it('should store and retrieve selection state', () => {
      const { result } = renderHook(() => useSelectionPersistence(), { wrapper });

      const testSelection = {
        selectedIds: new Set(['1', '2', '3']),
        lastSelectedId: '3',
      };

      act(() => {
        result.current.setSelection('test-list', testSelection);
      });

      const retrieved = result.current.getSelection('test-list');

      expect(retrieved.selectedIds.size).toBe(3);
      expect(retrieved.selectedIds.has('1')).toBe(true);
      expect(retrieved.selectedIds.has('2')).toBe(true);
      expect(retrieved.selectedIds.has('3')).toBe(true);
      expect(retrieved.lastSelectedId).toBe('3');
    });

    it('should maintain separate selections for different keys', () => {
      const { result } = renderHook(() => useSelectionPersistence(), { wrapper });

      const listA = {
        selectedIds: new Set(['a1', 'a2']),
        lastSelectedId: 'a2',
      };

      const listB = {
        selectedIds: new Set(['b1']),
        lastSelectedId: 'b1',
      };

      act(() => {
        result.current.setSelection('list-a', listA);
        result.current.setSelection('list-b', listB);
      });

      const retrievedA = result.current.getSelection('list-a');
      const retrievedB = result.current.getSelection('list-b');

      expect(retrievedA.selectedIds.size).toBe(2);
      expect(retrievedB.selectedIds.size).toBe(1);
      expect(retrievedA.selectedIds.has('a1')).toBe(true);
      expect(retrievedB.selectedIds.has('b1')).toBe(true);
    });

    it('should clear selection for a specific key', () => {
      const { result } = renderHook(() => useSelectionPersistence(), { wrapper });

      const selection = {
        selectedIds: new Set(['1', '2']),
        lastSelectedId: '2',
      };

      act(() => {
        result.current.setSelection('test-key', selection);
      });

      expect(result.current.getSelection('test-key').selectedIds.size).toBe(2);

      act(() => {
        result.current.clearSelection('test-key');
      });

      const cleared = result.current.getSelection('test-key');
      expect(cleared.selectedIds.size).toBe(0);
      expect(cleared.lastSelectedId).toBeNull();
    });

    it('should clear all selections', () => {
      const { result } = renderHook(() => useSelectionPersistence(), { wrapper });

      act(() => {
        result.current.setSelection('list-1', {
          selectedIds: new Set(['a']),
          lastSelectedId: 'a',
        });
        result.current.setSelection('list-2', {
          selectedIds: new Set(['b']),
          lastSelectedId: 'b',
        });
      });

      expect(result.current.getSelection('list-1').selectedIds.size).toBe(1);
      expect(result.current.getSelection('list-2').selectedIds.size).toBe(1);

      act(() => {
        result.current.clearAllSelections();
      });

      expect(result.current.getSelection('list-1').selectedIds.size).toBe(0);
      expect(result.current.getSelection('list-2').selectedIds.size).toBe(0);
    });
  });

  describe('useSelectionPersistenceOptional', () => {
    it('should return null when used outside provider', () => {
      const { result } = renderHook(() => useSelectionPersistenceOptional());

      expect(result.current).toBeNull();
    });

    it('should return context when used inside provider', () => {
      const { result } = renderHook(() => useSelectionPersistenceOptional(), { wrapper });

      expect(result.current).not.toBeNull();
      expect(result.current?.getSelection).toBeDefined();
      expect(result.current?.setSelection).toBeDefined();
    });
  });

  describe('persistence across re-renders', () => {
    it('should persist state when hook re-renders', () => {
      const { result, rerender } = renderHook(() => useSelectionPersistence(), { wrapper });

      act(() => {
        result.current.setSelection('persist-test', {
          selectedIds: new Set(['x', 'y', 'z']),
          lastSelectedId: 'z',
        });
      });

      rerender();

      const retrieved = result.current.getSelection('persist-test');
      expect(retrieved.selectedIds.size).toBe(3);
      expect(retrieved.lastSelectedId).toBe('z');
    });
  });
});
