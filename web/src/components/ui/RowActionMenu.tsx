/**
 * RowActionMenu - A three-dot menu button that opens a context menu
 *
 * Used alongside right-click context menus for discoverability.
 * Shows on hover for desktop, always visible on touch devices.
 *
 * Usage:
 *   <RowActionMenu
 *     documentType="issue"
 *     item={issue}
 *     actions={actions}
 *     onClose={() => setMenuOpen(false)}
 *   />
 */

import { useState, useRef, useCallback, ReactNode } from 'react';
import { DocumentType } from '@ship/shared';
import { cn } from '@/lib/cn';
import { ContextMenu, ContextMenuItem, ContextMenuSeparator, ContextMenuSubmenu } from './ContextMenu';
import {
  getContextMenuActions,
  ContextMenuItem as ContextMenuItemType,
  ActionContext,
  ISSUE_STATE_OPTIONS,
  ISSUE_PRIORITY_OPTIONS,
  VISIBILITY_OPTIONS,
} from '@/lib/contextMenuActions';

interface RowActionMenuProps {
  /** Document type determines which actions are shown */
  documentType: DocumentType;
  /** The item being acted upon (for context) */
  item: { id: string; [key: string]: unknown };
  /** Action handlers */
  actions: Partial<ActionContext>;
  /** Additional class name for the button */
  className?: string;
  /** Whether the menu is part of a bulk selection */
  isBulkSelect?: boolean;
  /** Number of selected items (shown in menu header) */
  selectedCount?: number;
  /** Callback when menu closes */
  onClose?: () => void;
  /** Always show the button (for touch devices) */
  alwaysVisible?: boolean;
}

export function RowActionMenu({
  documentType,
  item,
  actions,
  className,
  isBulkSelect = false,
  selectedCount = 1,
  onClose,
  alwaysVisible = false,
}: RowActionMenuProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState({ x: 0, y: 0 });
  const buttonRef = useRef<HTMLButtonElement>(null);

  const handleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();

    if (buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      // Position menu below and to the left of the button
      setMenuPosition({
        x: rect.right - 180, // Menu is ~180px wide
        y: rect.bottom + 4,
      });
    }

    setIsOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    onClose?.();
  }, [onClose]);

  const menuItems = getContextMenuActions(documentType, { isBulkSelect, selectedCount });

  return (
    <>
      <button
        ref={buttonRef}
        onClick={handleClick}
        aria-label="Actions menu"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        className={cn(
          'p-1 rounded hover:bg-border/50 transition-colors',
          'text-muted hover:text-foreground',
          // Show on hover unless alwaysVisible
          !alwaysVisible && 'opacity-0 group-hover:opacity-100 focus:opacity-100',
          // Touch devices: always visible
          'touch-device:opacity-100',
          className
        )}
      >
        <MoreHorizontalIcon className="h-4 w-4" />
      </button>

      {isOpen && (
        <ContextMenu x={menuPosition.x} y={menuPosition.y} onClose={handleClose}>
          {selectedCount > 1 && (
            <div className="px-3 py-1.5 text-xs text-muted border-b border-border mb-1">
              {selectedCount} selected
            </div>
          )}
          {menuItems.map((menuItem, index) => (
            <MenuItemRenderer
              key={menuItem.type === 'separator' ? `sep-${index}` : menuItem.id}
              item={menuItem}
              actions={actions}
              onClose={handleClose}
            />
          ))}
        </ContextMenu>
      )}
    </>
  );
}

interface MenuItemRendererProps {
  item: ContextMenuItemType;
  actions: Partial<ActionContext>;
  onClose: () => void;
}

function MenuItemRenderer({ item, actions, onClose }: MenuItemRendererProps) {
  if (item.type === 'separator') {
    return <ContextMenuSeparator />;
  }

  if (item.type === 'submenu') {
    return (
      <ContextMenuSubmenu label={item.label}>
        {renderSubmenuItems(item, actions, onClose)}
      </ContextMenuSubmenu>
    );
  }

  // Simple action
  const handler = item.handlerKey ? actions[item.handlerKey] : undefined;

  return (
    <ContextMenuItem
      onClick={() => {
        if (handler && typeof handler === 'function') {
          (handler as () => void)();
        }
        onClose();
      }}
      disabled={item.disabled}
      destructive={item.destructive}
    >
      {item.icon}
      {item.label}
    </ContextMenuItem>
  );
}

function renderSubmenuItems(
  item: ContextMenuItemType & { type: 'submenu' },
  actions: Partial<ActionContext>,
  onClose: () => void
): ReactNode {
  const handler = item.handlerKey ? actions[item.handlerKey] : undefined;

  // For status submenu
  if (item.id === 'change-status' && handler) {
    return ISSUE_STATE_OPTIONS.map((opt) => (
      <ContextMenuItem
        key={opt.value}
        onClick={() => {
          (handler as (status: string) => void)(opt.value);
          onClose();
        }}
      >
        {opt.label}
      </ContextMenuItem>
    ));
  }

  // For priority submenu
  if (item.id === 'change-priority' && handler) {
    return ISSUE_PRIORITY_OPTIONS.map((opt) => (
      <ContextMenuItem
        key={opt.value}
        onClick={() => {
          (handler as (priority: string) => void)(opt.value);
          onClose();
        }}
      >
        {opt.label}
      </ContextMenuItem>
    ));
  }

  // For visibility submenu
  if (item.id === 'change-visibility' && handler) {
    return VISIBILITY_OPTIONS.map((opt) => (
      <ContextMenuItem
        key={opt.value}
        onClick={() => {
          (handler as (visibility: string) => void)(opt.value);
          onClose();
        }}
      >
        {opt.label}
      </ContextMenuItem>
    ));
  }

  // For assign-to and move-to-sprint, these need dynamic data
  // The consuming component should provide items via the actions prop
  // For now, show a placeholder
  if (item.id === 'assign-to' || item.id === 'move-to-sprint') {
    return (
      <ContextMenuItem
        onClick={() => {
          if (handler && typeof handler === 'function') {
            (handler as (id: string | null) => void)(null);
          }
          onClose();
        }}
      >
        {item.id === 'assign-to' ? 'Unassigned' : 'No Sprint'}
      </ContextMenuItem>
    );
  }

  // For color submenu (programs)
  if (item.id === 'change-color' && handler) {
    const colors = ['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899'];
    return colors.map((color) => (
      <ContextMenuItem
        key={color}
        onClick={() => {
          (handler as (color: string) => void)(color);
          onClose();
        }}
      >
        <span
          className="w-4 h-4 rounded-full inline-block mr-2"
          style={{ backgroundColor: color }}
        />
        {color}
      </ContextMenuItem>
    ));
  }

  // Fallback: render static items from the action registry
  if (Array.isArray(item.items)) {
    return item.items.map((subItem) => (
      <ContextMenuItem
        key={subItem.id}
        onClick={() => {
          if (handler && typeof handler === 'function') {
            // Extract value from id (e.g., "status-backlog" -> "backlog")
            const value = subItem.id.split('-').slice(1).join('-');
            (handler as (value: string) => void)(value);
          }
          onClose();
        }}
        disabled={subItem.disabled}
        destructive={subItem.destructive}
      >
        {subItem.icon}
        {subItem.label}
      </ContextMenuItem>
    ));
  }

  return null;
}

function MoreHorizontalIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="1" fill="currentColor" />
      <circle cx="19" cy="12" r="1" fill="currentColor" />
      <circle cx="5" cy="12" r="1" fill="currentColor" />
    </svg>
  );
}

// CSS for touch device detection (add to global styles if not present)
// @media (pointer: coarse) { .touch-device\:opacity-100 { opacity: 1 !important; } }
