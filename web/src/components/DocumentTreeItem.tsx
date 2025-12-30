import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { cn } from '@/lib/cn';
import type { DocumentTreeNode } from '@/lib/documentTree';

interface DocumentTreeItemProps {
  document: DocumentTreeNode;
  activeDocumentId?: string;
  depth?: number;
  onCreateChild: (parentId: string) => void;
}

export function DocumentTreeItem({
  document,
  activeDocumentId,
  depth = 0,
  onCreateChild,
}: DocumentTreeItemProps) {
  const navigate = useNavigate();
  const [isOpen, setIsOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const isActive = activeDocumentId === document.id;
  const hasChildren = document.children.length > 0;

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        className={cn(
          'group flex items-center gap-1 rounded-md px-2 py-1.5 text-sm cursor-pointer',
          'hover:bg-border/30 transition-colors',
          isActive && 'bg-accent/10 text-accent'
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={() => navigate(`/docs/${document.id}`)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            navigate(`/docs/${document.id}`);
          }
        }}
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Expand/collapse chevron */}
        {hasChildren ? (
          <button
            type="button"
            className="flex-shrink-0 p-0.5 rounded hover:bg-border/50"
            onClick={(e) => {
              e.stopPropagation();
              setIsOpen(!isOpen);
            }}
          >
            <svg
              className={cn(
                'h-3.5 w-3.5 text-muted transition-transform',
                isOpen && 'rotate-90'
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
          </button>
        ) : (
          <div className="w-4" />
        )}

        {/* Document icon */}
        <svg
          className="h-4 w-4 flex-shrink-0 text-muted"
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

        {/* Title */}
        <span className="flex-1 truncate">{document.title || 'Untitled'}</span>

        {/* Add child button (shown on hover) */}
        {isHovered && (
          <button
            type="button"
            className="flex-shrink-0 p-0.5 rounded hover:bg-border/50 opacity-0 group-hover:opacity-100 transition-opacity"
            onClick={(e) => {
              e.stopPropagation();
              onCreateChild(document.id);
            }}
            title="Add sub-document"
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
        )}
      </div>

      {/* Children (collapsible) */}
      {hasChildren && isOpen && (
        <div>
          {document.children.map((child) => (
            <DocumentTreeItem
              key={child.id}
              document={child}
              activeDocumentId={activeDocumentId}
              depth={depth + 1}
              onCreateChild={onCreateChild}
            />
          ))}
        </div>
      )}
    </div>
  );
}
