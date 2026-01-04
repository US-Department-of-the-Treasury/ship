import { useState } from 'react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/cn';
import type { DocumentTreeNode } from '@/lib/documentTree';

interface DocumentTreeItemProps {
  document: DocumentTreeNode;
  activeDocumentId?: string;
  depth?: number;
  onCreateChild: (parentId: string) => void;
}

function DocumentIcon({ className }: { className?: string }) {
  return (
    <svg
      className={cn('h-4 w-4', className)}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={1.5}
        d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
      />
    </svg>
  );
}

function ChevronIcon({ isOpen, className }: { isOpen: boolean; className?: string }) {
  return (
    <svg
      className={cn(
        'h-4 w-4 transition-transform',
        isOpen && 'rotate-90',
        className
      )}
      fill="none"
      stroke="currentColor"
      viewBox="0 0 24 24"
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M9 5l7 7-7 7"
      />
    </svg>
  );
}

export function DocumentTreeItem({
  document,
  activeDocumentId,
  depth = 0,
  onCreateChild,
}: DocumentTreeItemProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const isActive = activeDocumentId === document.id;
  const hasChildren = document.children.length > 0;

  return (
    <li
      role="treeitem"
      aria-expanded={hasChildren ? isOpen : undefined}
      aria-selected={isActive}
    >
      <div
        className={cn(
          'group flex items-center gap-1.5 rounded-md px-2 py-1.5 text-sm',
          'hover:bg-border/30 transition-colors',
          isActive && 'bg-accent/10 text-accent'
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Expand/collapse button - always visible for accessibility */}
        {hasChildren ? (
          <button
            type="button"
            className="w-4 h-4 flex-shrink-0 flex items-center justify-center p-0 rounded hover:bg-border/50"
            onClick={() => setIsOpen(!isOpen)}
            aria-label={isOpen ? 'Collapse' : 'Expand'}
          >
            <ChevronIcon isOpen={isOpen} className="text-muted" />
          </button>
        ) : (
          <div className="w-4 h-4 flex-shrink-0 flex items-center justify-center">
            <DocumentIcon className="text-muted" />
          </div>
        )}

        {/* Main navigation link - uses <a> for accessibility and proper href detection */}
        <Link
          to={`/docs/${document.id}`}
          className="flex-1 truncate text-left cursor-pointer"
        >
          {document.title || 'Untitled'}
        </Link>

        {/* Add child button - always visible for keyboard users, enhanced on hover */}
        <button
          type="button"
          className={cn(
            'flex-shrink-0 p-0.5 rounded hover:bg-border/50 transition-opacity',
            isHovered ? 'opacity-100' : 'opacity-50'
          )}
          onClick={() => onCreateChild(document.id)}
          aria-label="Add sub-document"
        >
          <svg
            className="h-3.5 w-3.5 text-muted"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 4v16m8-8H4"
            />
          </svg>
        </button>
      </div>

      {/* Children (collapsible) */}
      {hasChildren && isOpen && (
        <ul role="group" className="space-y-0.5">
          {document.children.map((child) => (
            <DocumentTreeItem
              key={child.id}
              document={child}
              activeDocumentId={activeDocumentId}
              depth={depth + 1}
              onCreateChild={onCreateChild}
            />
          ))}
        </ul>
      )}
    </li>
  );
}
