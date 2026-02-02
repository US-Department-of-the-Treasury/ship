import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useSelection } from './useSelection';

interface TestItem {
  id: string;
  name: string;
}

const testItems: TestItem[] = [
  { id: '1', name: 'Item 1' },
  { id: '2', name: 'Item 2' },
  { id: '3', name: 'Item 3' },
  { id: '4', name: 'Item 4' },
  { id: '5', name: 'Item 5' },
];

describe('useSelection', () => {
  describe('basic selection', () => {
    it('should start with no selection by default', () => {
      const { result } = renderHook(() =>
        useSelection({
          items: testItems,
          getItemId: (item) => item.id,
        })
      );

      expect(result.current.selectedCount).toBe(0);
      expect(result.current.hasSelection).toBe(false);
    });

    it('should toggle selection of a single item', () => {
      const { result } = renderHook(() =>
        useSelection({
          items: testItems,
          getItemId: (item) => item.id,
        })
      );

      act(() => {
        result.current.toggleSelection('1');
      });

      expect(result.current.selectedCount).toBe(1);
      expect(result.current.isSelected('1')).toBe(true);
      expect(result.current.isSelected('2')).toBe(false);

      act(() => {
        result.current.toggleSelection('1');
      });

      expect(result.current.selectedCount).toBe(0);
      expect(result.current.isSelected('1')).toBe(false);
    });

    it('should select all items', () => {
      const { result } = renderHook(() =>
        useSelection({
          items: testItems,
          getItemId: (item) => item.id,
        })
      );

      act(() => {
        result.current.selectAll();
      });

      expect(result.current.selectedCount).toBe(5);
      testItems.forEach((item) => {
        expect(result.current.isSelected(item.id)).toBe(true);
      });
    });

    it('should clear selection', () => {
      const { result } = renderHook(() =>
        useSelection({
          items: testItems,
          getItemId: (item) => item.id,
        })
      );

      act(() => {
        result.current.toggleSelection('1');
        result.current.toggleSelection('2');
      });

      expect(result.current.selectedCount).toBe(2);

      act(() => {
        result.current.clearSelection();
      });

      expect(result.current.selectedCount).toBe(0);
      expect(result.current.hasSelection).toBe(false);
    });
  });

  describe('initialSelectedIds', () => {
    it('should restore selection from initialSelectedIds', () => {
      const initialIds = new Set(['1', '3', '5']);

      const { result } = renderHook(() =>
        useSelection({
          items: testItems,
          getItemId: (item) => item.id,
          initialSelectedIds: initialIds,
        })
      );

      expect(result.current.selectedCount).toBe(3);
      expect(result.current.isSelected('1')).toBe(true);
      expect(result.current.isSelected('2')).toBe(false);
      expect(result.current.isSelected('3')).toBe(true);
      expect(result.current.isSelected('4')).toBe(false);
      expect(result.current.isSelected('5')).toBe(true);
      expect(result.current.hasSelection).toBe(true);
    });

    it('should allow modifying restored selection', () => {
      const initialIds = new Set(['1', '3']);

      const { result } = renderHook(() =>
        useSelection({
          items: testItems,
          getItemId: (item) => item.id,
          initialSelectedIds: initialIds,
        })
      );

      expect(result.current.selectedCount).toBe(2);

      act(() => {
        result.current.toggleSelection('1');
      });

      expect(result.current.selectedCount).toBe(1);
      expect(result.current.isSelected('1')).toBe(false);
      expect(result.current.isSelected('3')).toBe(true);

      act(() => {
        result.current.toggleSelection('5');
      });

      expect(result.current.selectedCount).toBe(2);
      expect(result.current.isSelected('3')).toBe(true);
      expect(result.current.isSelected('5')).toBe(true);
    });
  });

  describe('range selection', () => {
    it('should select a range of items', () => {
      const { result } = renderHook(() =>
        useSelection({
          items: testItems,
          getItemId: (item) => item.id,
        })
      );

      act(() => {
        result.current.toggleSelection('1');
      });

      act(() => {
        result.current.selectRange('4');
      });

      expect(result.current.selectedCount).toBe(4);
      expect(result.current.isSelected('1')).toBe(true);
      expect(result.current.isSelected('2')).toBe(true);
      expect(result.current.isSelected('3')).toBe(true);
      expect(result.current.isSelected('4')).toBe(true);
      expect(result.current.isSelected('5')).toBe(false);
    });
  });

  describe('focus management', () => {
    it('should track focused item', () => {
      const { result } = renderHook(() =>
        useSelection({
          items: testItems,
          getItemId: (item) => item.id,
        })
      );

      expect(result.current.focusedId).toBeNull();

      act(() => {
        result.current.setFocusedId('2');
      });

      expect(result.current.focusedId).toBe('2');
      expect(result.current.isFocused('2')).toBe(true);
      expect(result.current.isFocused('1')).toBe(false);
    });

    it('should move focus with moveFocus', () => {
      const { result } = renderHook(() =>
        useSelection({
          items: testItems,
          getItemId: (item) => item.id,
        })
      );

      act(() => {
        result.current.moveFocus('down');
      });

      expect(result.current.focusedId).toBe('1');

      act(() => {
        result.current.moveFocus('down');
      });

      expect(result.current.focusedId).toBe('2');

      act(() => {
        result.current.moveFocus('up');
      });

      expect(result.current.focusedId).toBe('1');
    });

    it('should navigate to home and end', () => {
      const { result } = renderHook(() =>
        useSelection({
          items: testItems,
          getItemId: (item) => item.id,
        })
      );

      act(() => {
        result.current.moveFocus('end');
      });

      expect(result.current.focusedId).toBe('5');

      act(() => {
        result.current.moveFocus('home');
      });

      expect(result.current.focusedId).toBe('1');
    });
  });

  describe('extend selection', () => {
    it('should extend selection with shift+arrow', () => {
      const { result } = renderHook(() =>
        useSelection({
          items: testItems,
          getItemId: (item) => item.id,
        })
      );

      act(() => {
        result.current.setFocusedId('2');
      });

      act(() => {
        result.current.extendSelection('down');
      });

      expect(result.current.selectedCount).toBe(2);
      expect(result.current.isSelected('2')).toBe(true);
      expect(result.current.isSelected('3')).toBe(true);
      expect(result.current.focusedId).toBe('3');
    });
  });
});
