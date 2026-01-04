import { ReactNode, useMemo } from 'react';
import { cn } from '@/lib/cn';

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

  // Generate grid column classes
  const gridClasses = useMemo(() => {
    const smCols = cols.sm === 1 ? 'grid-cols-1' : `grid-cols-${cols.sm}`;
    const mdCols = `md:grid-cols-${cols.md}`;
    const lgCols = `lg:grid-cols-${cols.lg}`;
    const xlCols = `xl:grid-cols-${cols.xl}`;
    const gapClass = `gap-${gap}`;

    return cn('grid', smCols, mdCols, lgCols, xlCols, gapClass, className);
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

function CardGridSkeleton({ columns, gap, className }: CardGridSkeletonProps) {
  const gridClasses = cn(
    'grid animate-pulse',
    columns.sm === 1 ? 'grid-cols-1' : `grid-cols-${columns.sm}`,
    `md:grid-cols-${columns.md}`,
    `lg:grid-cols-${columns.lg}`,
    `xl:grid-cols-${columns.xl}`,
    `gap-${gap}`,
    className
  );

  return (
    <div className={gridClasses}>
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="h-24 rounded-lg border border-border/50 bg-border/30"
        />
      ))}
    </div>
  );
}
