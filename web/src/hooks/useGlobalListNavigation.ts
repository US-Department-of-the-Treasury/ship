import { useEffect, useCallback, useRef, MutableRefObject } from 'react';
import type { UseSelectionReturn } from './useSelection';

interface UseGlobalListNavigationOptions {
  /** Selection state and actions from useSelection (can be null initially) */
  selection: UseSelectionReturn | null;
  /** Optional ref to selection - if provided, reads from ref for latest value (avoids race conditions) */
  selectionRef?: MutableRefObject<UseSelectionReturn | null>;
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
  selectionRef: externalSelectionRef,
  enabled = true,
  onEnter,
}: UseGlobalListNavigationOptions) {
  // Use refs to avoid stale closures - selection object changes on each render
  const internalSelectionRef = useRef(selection);
  const onEnterRef = useRef(onEnter);

  // Keep refs up to date
  internalSelectionRef.current = selection;
  onEnterRef.current = onEnter;

  // Use external ref if provided (allows reading latest value without waiting for re-render)
  const effectiveSelectionRef = externalSelectionRef || internalSelectionRef;

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const currentSelection = effectiveSelectionRef.current;

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
      case 'ArrowDown':
        e.preventDefault();
        if (isShiftKey) {
          currentSelection.extendSelection('down');
        } else {
          currentSelection.moveFocus('down');
        }
        break;

      case 'k':
      case 'ArrowUp':
        e.preventDefault();
        if (isShiftKey) {
          currentSelection.extendSelection('up');
        } else {
          currentSelection.moveFocus('up');
        }
        break;

      case 'Enter':
        // Skip Enter handling if focus is on a button inside the bulk action bar
        // Those buttons handle Enter themselves (e.g., clear selection button)
        // We check by looking for the closest region with "Bulk actions" label
        if (
          (target.tagName === 'BUTTON' || target.getAttribute('role') === 'button') &&
          target.closest('[role="region"][aria-label="Bulk actions"]')
        ) {
          return;
        }
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
