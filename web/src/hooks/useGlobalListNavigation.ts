import { useEffect, useCallback, useRef } from 'react';
import type { UseSelectionReturn } from './useSelection';

interface UseGlobalListNavigationOptions {
  /** Selection state and actions from useSelection (can be null initially) */
  selection: UseSelectionReturn | null;
  /** Whether navigation is enabled (e.g., list is visible and active) */
  enabled?: boolean;
  /** Callback when Enter is pressed on focused item */
  onEnter?: (focusedId: string) => void;
}

/**
 * Global keyboard navigation for list views (Superhuman-style)
 *
 * Handles:
 * - j/k for down/up navigation
 * - Shift+j/k for extending selection
 * - Enter to activate focused item
 * - Escape to clear selection
 *
 * Automatically skips when focus is in input/textarea/contenteditable
 */
export function useGlobalListNavigation({
  selection,
  enabled = true,
  onEnter,
}: UseGlobalListNavigationOptions) {
  // Use refs to avoid stale closures - selection object changes on each render
  const selectionRef = useRef(selection);
  const onEnterRef = useRef(onEnter);

  // Keep refs up to date
  selectionRef.current = selection;
  onEnterRef.current = onEnter;

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const currentSelection = selectionRef.current;
    if (!enabled || !currentSelection) return;

    // Skip if we're in an input, textarea, or contenteditable
    const target = e.target as HTMLElement;
    if (
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.isContentEditable
    ) {
      return;
    }

    const isShiftKey = e.shiftKey;

    switch (e.key) {
      case 'j':
        e.preventDefault();
        if (isShiftKey) {
          currentSelection.extendSelection('down');
        } else {
          currentSelection.moveFocus('down');
        }
        break;

      case 'k':
        e.preventDefault();
        if (isShiftKey) {
          currentSelection.extendSelection('up');
        } else {
          currentSelection.moveFocus('up');
        }
        break;

      case 'Enter':
        if (currentSelection.focusedId && onEnterRef.current) {
          e.preventDefault();
          onEnterRef.current(currentSelection.focusedId);
        }
        break;

      case 'Escape':
        // Only handle if there's a selection to clear
        if (currentSelection.hasSelection) {
          e.preventDefault();
          currentSelection.clearSelection();
        }
        break;
    }
  }, [enabled]); // Only depend on enabled - refs handle the rest

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);
}
