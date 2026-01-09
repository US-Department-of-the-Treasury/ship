import { useState, useEffect, useCallback, useMemo } from 'react';

export interface ColumnDefinition {
  key: string;
  label: string;
  hideable: boolean;
}

export interface UseColumnVisibilityOptions {
  /** All available columns with metadata */
  columns: ColumnDefinition[];
  /** localStorage key for persisting visibility state */
  storageKey: string;
  /** Default visible columns (if not all). If not provided, all columns are visible by default */
  defaultVisible?: string[];
}

export interface UseColumnVisibilityReturn {
  /** Set of currently visible column keys */
  visibleColumns: Set<string>;
  /** Filtered columns based on visibility */
  columns: ColumnDefinition[];
  /** Count of hidden columns (for badge display) */
  hiddenCount: number;
  /** Toggle a column's visibility */
  toggleColumn: (key: string) => void;
  /** Check if a column is visible */
  isVisible: (key: string) => boolean;
  /** Reset to default visibility */
  resetToDefault: () => void;
}

/**
 * Hook for managing column visibility with localStorage persistence.
 * Used by list views to let users customize which columns are shown.
 */
export function useColumnVisibility({
  columns: allColumns,
  storageKey,
  defaultVisible,
}: UseColumnVisibilityOptions): UseColumnVisibilityReturn {
  const [visibleColumns, setVisibleColumns] = useState<Set<string>>(() => {
    // Load from localStorage or use default
    try {
      const stored = localStorage.getItem(storageKey);
      if (stored) {
        const parsed = JSON.parse(stored) as string[];
        // Validate that we have at least the non-hideable columns
        const nonHideableKeys = allColumns.filter(c => !c.hideable).map(c => c.key);
        if (Array.isArray(parsed) && nonHideableKeys.every(k => parsed.includes(k))) {
          return new Set(parsed);
        }
      }
    } catch {
      // Ignore parsing errors, use default
    }
    // Default: show specified columns or all columns
    return new Set(defaultVisible ?? allColumns.map(c => c.key));
  });

  // Persist to localStorage when visibility changes
  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(Array.from(visibleColumns)));
  }, [visibleColumns, storageKey]);

  // Toggle column visibility
  const toggleColumn = useCallback((key: string) => {
    const column = allColumns.find(c => c.key === key);
    if (!column || !column.hideable) return;

    setVisibleColumns(prev => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }, [allColumns]);

  // Check if column is visible
  const isVisible = useCallback((key: string) => visibleColumns.has(key), [visibleColumns]);

  // Reset to default
  const resetToDefault = useCallback(() => {
    setVisibleColumns(new Set(defaultVisible ?? allColumns.map(c => c.key)));
  }, [allColumns, defaultVisible]);

  // Filtered columns based on visibility
  const columns = useMemo(
    () => allColumns.filter(col => visibleColumns.has(col.key)),
    [allColumns, visibleColumns]
  );

  // Count of hidden columns
  const hiddenCount = allColumns.length - visibleColumns.size;

  return {
    visibleColumns,
    columns,
    hiddenCount,
    toggleColumn,
    isVisible,
    resetToDefault,
  };
}
