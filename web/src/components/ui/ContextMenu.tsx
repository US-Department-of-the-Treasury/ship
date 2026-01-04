import { useEffect, useRef, ReactNode } from 'react';
import { cn } from '@/lib/cn';

interface ContextMenuProps {
  x: number;
  y: number;
  onClose: () => void;
  children: ReactNode;
}

export function ContextMenu({ x, y, onClose, children }: ContextMenuProps) {
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [onClose]);

  // Adjust position to keep menu in viewport
  useEffect(() => {
    if (menuRef.current) {
      const rect = menuRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;

      if (rect.right > viewportWidth) {
        menuRef.current.style.left = `${x - rect.width}px`;
      }
      if (rect.bottom > viewportHeight) {
        menuRef.current.style.top = `${y - rect.height}px`;
      }
    }
  }, [x, y]);

  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Context menu"
      className={cn(
        'fixed z-50 min-w-[180px] py-1',
        'bg-background border border-border rounded-lg shadow-xl',
        'animate-in fade-in zoom-in-95 duration-100'
      )}
      style={{ left: x, top: y }}
    >
      {children}
    </div>
  );
}

interface ContextMenuItemProps {
  onClick: () => void;
  disabled?: boolean;
  destructive?: boolean;
  children: ReactNode;
}

export function ContextMenuItem({ onClick, disabled, destructive, children }: ContextMenuItemProps) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'w-full px-3 py-2 text-left text-sm',
        'flex items-center gap-2',
        'hover:bg-border/50 transition-colors',
        'disabled:opacity-50 disabled:cursor-not-allowed',
        destructive ? 'text-red-400 hover:text-red-300' : 'text-foreground'
      )}
    >
      {children}
    </button>
  );
}

export function ContextMenuSeparator() {
  return <div className="my-1 h-px bg-border" role="separator" />;
}

interface ContextMenuSubmenuProps {
  label: string;
  children: ReactNode;
}

export function ContextMenuSubmenu({ label, children }: ContextMenuSubmenuProps) {
  return (
    <div className="relative group">
      <button
        role="menuitem"
        aria-haspopup="true"
        className={cn(
          'w-full px-3 py-2 text-left text-sm',
          'flex items-center justify-between gap-2',
          'hover:bg-border/50 transition-colors text-foreground'
        )}
      >
        {label}
        <ChevronRightIcon className="h-4 w-4 text-muted" />
      </button>
      <div
        role="menu"
        className={cn(
          'absolute left-full top-0 ml-1 min-w-[160px] py-1',
          'bg-background border border-border rounded-lg shadow-xl',
          'invisible group-hover:visible opacity-0 group-hover:opacity-100',
          'transition-all duration-100'
        )}
      >
        {children}
      </div>
    </div>
  );
}

function ChevronRightIcon({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
    </svg>
  );
}
