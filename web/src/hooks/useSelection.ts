import { useState, useCallback, useMemo, useEffect } from 'react';

export interface UseSelectionOptions<T> {
  items: T[];
  getItemId: (item: T) => string;
  onSelectionChange?: (selectedIds: Set<string>) => void;
  /** Optional hovered ID - used as anchor for Shift+Arrow when nothing is selected */
  hoveredId?: string | null;
}

export interface UseSelectionReturn {
  // State
  selectedIds: Set<string>;
  focusedId: string | null;

  // Actions
  toggleSelection: (id: string) => void;
  toggleInGroup: (id: string) => void;
  selectRange: (targetId: string) => void;
  selectAll: () => void;
  clearSelection: () => void;
  setFocusedId: (id: string | null) => void;

  // Keyboard navigation
  moveFocus: (direction: 'up' | 'down' | 'home' | 'end') => void;
  extendSelection: (direction: 'up' | 'down' | 'home' | 'end') => void;

  // Derived state
  isSelected: (id: string) => boolean;
  isFocused: (id: string) => boolean;
  selectedCount: number;
  hasSelection: boolean;

  // Event handlers
  handleClick: (id: string, e: React.MouseEvent) => void;
  handleKeyDown: (e: React.KeyboardEvent) => void;
}

export function useSelection<T>({
  items,
  getItemId,
  onSelectionChange,
  hoveredId,
}: UseSelectionOptions<T>): UseSelectionReturn {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [lastSelectedId, setLastSelectedId] = useState<string | null>(null);

  // Get ordered list of IDs for navigation
  const itemIds = useMemo(() => items.map(getItemId), [items, getItemId]);

  // Notify parent of selection changes
  useEffect(() => {
    onSelectionChange?.(selectedIds);
  }, [selectedIds, onSelectionChange]);

  // Toggle selection of a single item (Enter/Space or simple click)
  const toggleSelection = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    setLastSelectedId(id);
  }, []);

  // Toggle item in group (Cmd/Ctrl+click) - adds/removes without affecting others
  const toggleInGroup = useCallback((id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
    setLastSelectedId(id);
  }, []);

  // Select range from last selected to target (Shift+click)
  const selectRange = useCallback((targetId: string) => {
    if (!lastSelectedId) {
      toggleSelection(targetId);
      return;
    }

    const startIdx = itemIds.indexOf(lastSelectedId);
    const endIdx = itemIds.indexOf(targetId);

    if (startIdx === -1 || endIdx === -1) {
      toggleSelection(targetId);
      return;
    }

    const [start, end] = startIdx < endIdx
      ? [startIdx, endIdx]
      : [endIdx, startIdx];

    setSelectedIds(prev => {
      const next = new Set(prev);
      for (let i = start; i <= end; i++) {
        next.add(itemIds[i]);
      }
      return next;
    });
  }, [itemIds, lastSelectedId, toggleSelection]);

  // Select all visible items
  const selectAll = useCallback(() => {
    setSelectedIds(prev => {
      // If all are already selected, deselect all
      const allSelected = itemIds.every(id => prev.has(id));
      if (allSelected) {
        return new Set();
      }
      return new Set(itemIds);
    });
  }, [itemIds]);

  // Clear all selection
  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setLastSelectedId(null);
  }, []);

  // Move focus without changing selection
  const moveFocus = useCallback((direction: 'up' | 'down' | 'home' | 'end') => {
    if (itemIds.length === 0) return;

    setFocusedId(prev => {
      const currentIdx = prev ? itemIds.indexOf(prev) : -1;

      switch (direction) {
        case 'up':
          if (currentIdx <= 0) return itemIds[0];
          return itemIds[currentIdx - 1];
        case 'down':
          if (currentIdx === -1) return itemIds[0];
          if (currentIdx >= itemIds.length - 1) return itemIds[itemIds.length - 1];
          return itemIds[currentIdx + 1];
        case 'home':
          return itemIds[0];
        case 'end':
          return itemIds[itemIds.length - 1];
        default:
          return prev;
      }
    });
  }, [itemIds]);

  // Extend selection with arrow keys (Shift+Arrow)
  const extendSelection = useCallback((direction: 'up' | 'down' | 'home' | 'end') => {
    if (itemIds.length === 0) return;

    // Determine anchor point (where selection started)
    // Priority: lastSelectedId > focusedId > hoveredId > first item
    const anchor = lastSelectedId || focusedId || hoveredId || itemIds[0];
    const anchorIdx = itemIds.indexOf(anchor);
    if (anchorIdx === -1) return;

    // Get current position - use hovered position if nothing else is set
    const currentIdx = focusedId
      ? itemIds.indexOf(focusedId)
      : hoveredId
        ? itemIds.indexOf(hoveredId)
        : anchorIdx;

    let newIdx: number;
    switch (direction) {
      case 'up':
        newIdx = Math.max(0, currentIdx - 1);
        break;
      case 'down':
        newIdx = Math.min(itemIds.length - 1, currentIdx + 1);
        break;
      case 'home':
        newIdx = 0;
        break;
      case 'end':
        newIdx = itemIds.length - 1;
        break;
      default:
        return;
    }

    // Select range from anchor to new position
    const [start, end] = anchorIdx < newIdx
      ? [anchorIdx, newIdx]
      : [newIdx, anchorIdx];

    setSelectedIds(() => {
      const next = new Set<string>();
      for (let i = start; i <= end; i++) {
        next.add(itemIds[i]);
      }
      return next;
    });

    setFocusedId(itemIds[newIdx]);

    // Keep lastSelectedId at anchor for continued range operations
    if (!lastSelectedId) {
      setLastSelectedId(anchor);
    }
  }, [itemIds, focusedId, lastSelectedId, hoveredId]);

  // Derived state
  const isSelected = useCallback((id: string) => selectedIds.has(id), [selectedIds]);
  const isFocused = useCallback((id: string) => focusedId === id, [focusedId]);
  const selectedCount = selectedIds.size;
  const hasSelection = selectedCount > 0;

  // Click handler that handles modifiers
  const handleClick = useCallback((id: string, e: React.MouseEvent) => {
    const isCtrlKey = e.metaKey || e.ctrlKey;
    const isShiftKey = e.shiftKey;

    if (isShiftKey) {
      selectRange(id);
    } else if (isCtrlKey) {
      toggleInGroup(id);
    } else {
      // Simple click - toggle this item only
      setSelectedIds(prev => {
        const next = new Set<string>();
        if (!prev.has(id)) {
          next.add(id);
        }
        return next;
      });
      setLastSelectedId(id);
    }

    setFocusedId(id);
  }, [selectRange, toggleInGroup]);

  // Keyboard handler
  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const isCtrlKey = e.metaKey || e.ctrlKey;
    const isShiftKey = e.shiftKey;

    switch (e.key) {
      case 'ArrowUp':
        e.preventDefault();
        if (isShiftKey) {
          extendSelection('up');
        } else {
          moveFocus('up');
        }
        break;

      case 'ArrowDown':
        e.preventDefault();
        if (isShiftKey) {
          extendSelection('down');
        } else {
          moveFocus('down');
        }
        break;

      case 'Home':
        e.preventDefault();
        if (isShiftKey) {
          extendSelection('home');
        } else {
          moveFocus('home');
        }
        break;

      case 'End':
        e.preventDefault();
        if (isShiftKey) {
          extendSelection('end');
        } else {
          moveFocus('end');
        }
        break;

      case 'Enter':
      case ' ':
        e.preventDefault();
        if (focusedId) {
          if (isCtrlKey) {
            toggleInGroup(focusedId);
          } else {
            toggleSelection(focusedId);
          }
        }
        break;

      case 'a':
        if (isCtrlKey) {
          e.preventDefault();
          selectAll();
        }
        break;

      case 'Escape':
        e.preventDefault();
        clearSelection();
        break;
    }
  }, [
    focusedId,
    moveFocus,
    extendSelection,
    toggleSelection,
    toggleInGroup,
    selectAll,
    clearSelection,
  ]);

  return {
    selectedIds,
    focusedId,
    toggleSelection,
    toggleInGroup,
    selectRange,
    selectAll,
    clearSelection,
    setFocusedId,
    moveFocus,
    extendSelection,
    isSelected,
    isFocused,
    selectedCount,
    hasSelection,
    handleClick,
    handleKeyDown,
  };
}
