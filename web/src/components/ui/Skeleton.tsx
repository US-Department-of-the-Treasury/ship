import { cn } from '@/lib/cn';

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      className={cn(
        'animate-pulse rounded-md bg-border',
        className
      )}
    />
  );
}

// Pre-built skeleton layouts for common patterns
export function SkeletonLine({ className }: SkeletonProps) {
  return <Skeleton className={cn('h-4 w-full', className)} />;
}

export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: lines }).map((_, i) => (
        <SkeletonLine
          key={i}
          className={i === lines - 1 ? 'w-3/4' : undefined}
        />
      ))}
    </div>
  );
}

export function DocumentsListSkeleton() {
  return (
    <div className="space-y-2 p-6">
      {/* Header skeleton */}
      <div className="mb-6 flex items-center justify-between">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-8 w-28" />
      </div>
      {/* Document list skeleton */}
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-2 p-2">
            <Skeleton className="h-4 w-4" />
            <Skeleton className="h-4 flex-1" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function ProjectsListSkeleton() {
  return (
    <div className="space-y-4 p-6">
      {/* Header skeleton */}
      <div className="mb-6 flex items-center justify-between">
        <Skeleton className="h-6 w-24" />
        <Skeleton className="h-8 w-32" />
      </div>
      {/* Projects grid skeleton */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="rounded-lg border border-border p-4 space-y-3"
          >
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-4 w-1/2" />
            <div className="flex gap-2 pt-2">
              <Skeleton className="h-6 w-16" />
              <Skeleton className="h-6 w-20" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function IssuesListSkeleton() {
  return (
    <div className="space-y-4 p-6">
      {/* Header skeleton */}
      <div className="mb-6 flex items-center justify-between">
        <Skeleton className="h-6 w-20" />
        <Skeleton className="h-8 w-28" />
      </div>
      {/* Kanban columns skeleton */}
      <div className="flex gap-4 overflow-x-auto">
        {Array.from({ length: 4 }).map((_, col) => (
          <div key={col} className="w-64 flex-shrink-0 space-y-2">
            <Skeleton className="h-6 w-24 mb-3" />
            {Array.from({ length: col === 0 ? 3 : 2 }).map((_, row) => (
              <div
                key={row}
                className="rounded-lg border border-border p-3 space-y-2"
              >
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-3 w-2/3" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export function EditorSkeleton() {
  return (
    <div className="flex h-full">
      {/* Sidebar skeleton */}
      <div className="w-64 border-r border-border p-4 space-y-3">
        <Skeleton className="h-6 w-32 mb-4" />
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-2">
            <Skeleton className="h-4 w-4" />
            <Skeleton className="h-4 flex-1" />
          </div>
        ))}
      </div>
      {/* Editor skeleton */}
      <div className="flex-1 p-6 space-y-4">
        <Skeleton className="h-8 w-1/2" />
        <SkeletonText lines={5} />
        <div className="pt-4">
          <SkeletonText lines={3} />
        </div>
      </div>
    </div>
  );
}

export function TeamModeSkeleton() {
  return (
    <div className="p-6 space-y-4">
      {/* Header skeleton */}
      <div className="flex items-center justify-between mb-6">
        <Skeleton className="h-6 w-24" />
        <div className="flex gap-2">
          <Skeleton className="h-8 w-8" />
          <Skeleton className="h-8 w-8" />
        </div>
      </div>
      {/* Table skeleton */}
      <div className="border border-border rounded-lg overflow-hidden">
        {/* Header row */}
        <div className="flex bg-background border-b border-border">
          <Skeleton className="h-10 w-40 m-2" />
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-10 w-24 m-2" />
          ))}
        </div>
        {/* Data rows */}
        {Array.from({ length: 6 }).map((_, row) => (
          <div key={row} className="flex border-b border-border last:border-0">
            <Skeleton className="h-10 w-40 m-2" />
            {Array.from({ length: 5 }).map((_, col) => (
              <Skeleton key={col} className="h-10 w-24 m-2" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
