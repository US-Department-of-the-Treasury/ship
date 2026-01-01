import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, NodeViewProps } from '@tiptap/react';
import { useEffect, useState } from 'react';

interface HeadingItem {
  id: string;
  level: number;
  text: string;
  pos: number;
}

// The React component that renders the TOC
function TableOfContentsComponent({ editor }: NodeViewProps) {
  const [headings, setHeadings] = useState<HeadingItem[]>([]);

  // Scan document for headings
  const updateHeadings = () => {
    const items: HeadingItem[] = [];
    const { state } = editor;

    state.doc.descendants((node, pos) => {
      if (node.type.name === 'heading') {
        const level = node.attrs.level as number;
        const text = node.textContent;
        // Generate a simple ID based on position
        const id = `heading-${pos}`;
        items.push({ id, level, text, pos });
      }
    });

    setHeadings(items);
  };

  // Update on mount and when editor updates
  useEffect(() => {
    updateHeadings();

    // Listen to editor updates
    const handleUpdate = () => {
      updateHeadings();
    };

    editor.on('update', handleUpdate);
    return () => {
      editor.off('update', handleUpdate);
    };
  }, [editor]);

  const scrollToHeading = (pos: number) => {
    // Set cursor position to the heading
    editor.commands.focus();
    editor.commands.setTextSelection(pos);

    // Scroll the heading into view
    const { view } = editor;
    const coords = view.coordsAtPos(pos);
    const editorElement = view.dom.closest('.tiptap-wrapper');

    if (editorElement) {
      const scrollContainer = editorElement.closest('.overflow-auto');
      if (scrollContainer) {
        // Calculate scroll position (with some offset for better visibility)
        const offset = 100;
        const targetScroll = coords.top - scrollContainer.getBoundingClientRect().top + scrollContainer.scrollTop - offset;
        scrollContainer.scrollTo({ top: targetScroll, behavior: 'smooth' });
      }
    }
  };

  if (headings.length === 0) {
    return (
      <NodeViewWrapper className="table-of-contents" contentEditable={false}>
        <div className="toc-container">
          <div className="toc-header">Table of Contents</div>
          <div className="toc-empty">No headings in document</div>
        </div>
      </NodeViewWrapper>
    );
  }

  return (
    <NodeViewWrapper className="table-of-contents" contentEditable={false}>
      <div className="toc-container">
        <div className="toc-header">Table of Contents</div>
        <div className="toc-list">
          {headings.map((heading) => (
            <button
              key={heading.id}
              type="button"
              onClick={() => scrollToHeading(heading.pos)}
              className={`toc-item toc-item-h${heading.level}`}
              title={heading.text}
            >
              <span className="toc-item-text">{heading.text || 'Untitled'}</span>
            </button>
          ))}
        </div>
      </div>
    </NodeViewWrapper>
  );
}

// The TipTap node extension
export const TableOfContentsExtension = Node.create({
  name: 'tableOfContents',

  group: 'block',

  atom: true, // Non-editable, treated as a single unit

  addAttributes() {
    return {};
  },

  parseHTML() {
    return [
      {
        tag: 'div[data-table-of-contents]',
      },
    ];
  },

  renderHTML({ HTMLAttributes }) {
    return ['div', mergeAttributes(HTMLAttributes, { 'data-table-of-contents': '' })];
  },

  addNodeView() {
    return ReactNodeViewRenderer(TableOfContentsComponent);
  },
});
