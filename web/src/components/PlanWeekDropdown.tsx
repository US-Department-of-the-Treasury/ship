import { useState, useRef, useEffect } from 'react';
import { cn } from '@/lib/cn';

interface Sprint {
  id: string;
  name: string;
  status?: 'planning' | 'active' | 'completed';
}

interface PlanSprintDropdownProps {
  sprints: Sprint[];
  onSelectSprint: (sprintId: string) => void;
  onCreateNew: () => void;
}

/**
 * PlanSprintDropdown - Dropdown for selecting a week to plan or creating a new one
 *
 * If no planning weeks exist, shows "Create Week Plan" button.
 * If planning weeks exist, shows "Plan Week" button with dropdown.
 */
export function PlanSprintDropdown({
  sprints,
  onSelectSprint,
  onCreateNew,
}: PlanSprintDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // If no sprints available for planning, show simple create button
  if (sprints.length === 0) {
    return (
      <button
        onClick={onCreateNew}
        className="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-border/50 transition-colors flex items-center gap-1.5"
      >
        <CalendarPlanIcon />
        Create Week Plan
      </button>
    );
  }

  return (
    <div ref={dropdownRef} className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="rounded-md border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground hover:bg-border/50 transition-colors flex items-center gap-1.5"
      >
        <CalendarPlanIcon />
        Plan Week
        <ChevronDownIcon className={cn('transition-transform', isOpen && 'rotate-180')} />
      </button>

      {isOpen && (
        <div className="absolute right-0 top-full mt-1 z-50 min-w-[200px] rounded-md border border-border bg-background shadow-lg">
          <div className="py-1">
            {sprints.map((sprint) => (
              <button
                key={sprint.id}
                onClick={() => {
                  onSelectSprint(sprint.id);
                  setIsOpen(false);
                }}
                className="w-full px-3 py-2 text-left text-sm text-foreground hover:bg-border/50 transition-colors flex items-center justify-between"
              >
                <span className="truncate">{sprint.name}</span>
                <span className="text-xs text-muted ml-2 flex-shrink-0">
                  {sprint.status === 'planning' ? 'Planning' : ''}
                </span>
              </button>
            ))}
            <div className="border-t border-border mt-1 pt-1">
              <button
                onClick={() => {
                  onCreateNew();
                  setIsOpen(false);
                }}
                className="w-full px-3 py-2 text-left text-sm text-accent hover:bg-border/50 transition-colors flex items-center gap-2"
              >
                <PlusIcon />
                Create New Week
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function CalendarPlanIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
      <line x1="16" y1="2" x2="16" y2="6" />
      <line x1="8" y1="2" x2="8" y2="6" />
      <line x1="3" y1="10" x2="21" y2="10" />
      <path d="M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01" />
    </svg>
  );
}

function ChevronDownIcon({ className }: { className?: string }) {
  return (
    <svg className={cn('h-4 w-4', className)} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
