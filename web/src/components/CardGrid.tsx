import { ReactNode, useMemo } from 'react';
import { cn } from '@/lib/cn';

// Static class mappings to ensure Tailwind JIT includes these classes
const GRID_COLS: Record<number, string> = {
  1: 'grid-cols-1',
  2: 'grid-cols-2',
  3: 'grid-cols-3',
  4: 'grid-cols-4',
  5: 'grid-cols-5',
  6: 'grid-cols-6',
};

const MD_GRID_COLS: Record<number, string> = {
  1: 'md:grid-cols-1',
  2: 'md:grid-cols-2',
  3: 'md:grid-cols-3',
  4: 'md:grid-cols-4',
  5: 'md:grid-cols-5',
  6: 'md:grid-cols-6',
};

const LG_GRID_COLS: Record<number, string> = {
  1: 'lg:grid-cols-1',
  2: 'lg:grid-cols-2',
  3: 'lg:grid-cols-3',
  4: 'lg:grid-cols-4',
  5: 'lg:grid-cols-5',
  6: 'lg:grid-cols-6',
};

const XL_GRID_COLS: Record<number, string> = {
  1: 'xl:grid-cols-1',
  2: 'xl:grid-cols-2',
  3: 'xl:grid-cols-3',
  4: 'xl:grid-cols-4',
  5: 'xl:grid-cols-5',
  6: 'xl:grid-cols-6',
};

const GAP_CLASSES: Record<number, string> = {
  2: 'gap-2',
  3: 'gap-3',
  4: 'gap-4',
  5: 'gap-5',
  6: 'gap-6',
};

export interface CardGridProps<T extends { id: string }> {
  /** Items to display in the grid */
  items: T[];

  /** Loading state - shows skeleton */
  loading?: boolean;

  /** Empty state content */
  emptyState?: ReactNode;

  /** Render function for each card */
  renderCard: (item: T) => ReactNode;

  /** Get unique ID from item (defaults to item.id) */
  getItemId?: (item: T) => string;

  /** Responsive column configuration */
  columns?: {
    sm?: number;  // default: 1
    md?: number;  // default: 2
    lg?: number;  // default: 3
    xl?: number;  // default: 4
  };

  /** Gap between cards (Tailwind gap value) */
  gap?: 2 | 3 | 4 | 5 | 6;

  /** Callback when card is clicked */
  onItemClick?: (item: T) => void;

  /** Additional class name for the grid container */
  className?: string;
}

/**
 * CardGrid - Canonical component for navigable card collections
 *
 * Features:
 * - Responsive grid layout
 * - Click-to-navigate pattern
 * - Empty state support
 * - Loading skeleton
 */
export function CardGrid<T extends { id: string }>({
  items,
  loading,
  emptyState,
  renderCard,
  getItemId = (item) => item.id,
  columns = {},
  gap = 4,
  onItemClick,
  className,
}: CardGridProps<T>) {
  // Merge column defaults with provided values
  const cols = useMemo(() => ({
    sm: columns.sm ?? 1,
    md: columns.md ?? 2,
    lg: columns.lg ?? 3,
    xl: columns.xl ?? 4,
  }), [columns]);

  // Generate grid column classes using static lookups (for Tailwind JIT)
  const gridClasses = useMemo(() => {
    return cn(
      'grid',
      GRID_COLS[cols.sm] || 'grid-cols-1',
      MD_GRID_COLS[cols.md] || 'md:grid-cols-2',
      LG_GRID_COLS[cols.lg] || 'lg:grid-cols-3',
      XL_GRID_COLS[cols.xl] || 'xl:grid-cols-4',
      GAP_CLASSES[gap] || 'gap-4',
      className
    );
  }, [cols, gap, className]);

  if (loading) {
    return <CardGridSkeleton columns={cols} gap={gap} className={className} />;
  }

  if (items.length === 0 && emptyState) {
    return (
      <div className="flex h-full items-center justify-center">
        {emptyState}
      </div>
    );
  }

  return (
    <div className={gridClasses}>
      {items.map((item) => {
        const itemId = getItemId(item);

        if (onItemClick) {
          return (
            <div
              key={itemId}
              onClick={() => onItemClick(item)}
              className="cursor-pointer"
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onItemClick(item);
                }
              }}
            >
              {renderCard(item)}
            </div>
          );
        }

        return (
          <div key={itemId}>
            {renderCard(item)}
          </div>
        );
      })}
    </div>
  );
}

interface CardGridSkeletonProps {
  columns: { sm: number; md: number; lg: number; xl: number };
  gap: number;
  className?: string;
}

// Default skeleton count - shows a reasonable preview of the grid
const SKELETON_COUNT = 6;

function CardGridSkeleton({ columns, gap, className }: CardGridSkeletonProps) {
  const gridClasses = cn(
    'grid animate-pulse',
    GRID_COLS[columns.sm] || 'grid-cols-1',
    MD_GRID_COLS[columns.md] || 'md:grid-cols-2',
    LG_GRID_COLS[columns.lg] || 'lg:grid-cols-3',
    XL_GRID_COLS[columns.xl] || 'xl:grid-cols-4',
    GAP_CLASSES[gap] || 'gap-4',
    className
  );

  return (
    <div className={gridClasses}>
      {/* Static skeleton items - index keys are safe here since list never reorders */}
      {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
        <div
          key={i}
          className="h-24 rounded-lg border border-border/50 bg-border/30"
        />
      ))}
    </div>
  );
}
