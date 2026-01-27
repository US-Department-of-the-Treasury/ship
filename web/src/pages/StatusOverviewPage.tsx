import { AccountabilityGrid } from '@/components/AccountabilityGrid';

export function StatusOverviewPage() {
  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <header className="flex h-10 items-center justify-between border-b border-border px-4">
        <h1 className="text-sm font-medium text-foreground">Status Overview</h1>
      </header>

      {/* Content */}
      <AccountabilityGrid />
    </div>
  );
}

export default StatusOverviewPage;
