import { Extension } from '@tiptap/core';
import { Plugin, PluginKey, NodeSelection } from '@tiptap/pm/state';
import type { EditorView } from '@tiptap/pm/view';

// Selectors for blocks that should show drag handles
const BLOCK_SELECTORS = [
  'p',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul > li',
  'ol > li',
  'blockquote',
  'pre',
  'hr',
  '[data-document-embed]',
].join(', ');

// Create the drag handle button element
function createDragHandle(): HTMLButtonElement {
  const handle = document.createElement('button');
  handle.type = 'button';
  handle.className = 'editor-drag-handle';
  handle.draggable = true;
  handle.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <circle cx="9" cy="5" r="1.5"/>
      <circle cx="9" cy="12" r="1.5"/>
      <circle cx="9" cy="19" r="1.5"/>
      <circle cx="15" cy="5" r="1.5"/>
      <circle cx="15" cy="12" r="1.5"/>
      <circle cx="15" cy="19" r="1.5"/>
    </svg>
  `;
  return handle;
}

// Find the DOM element at coordinates that matches our block selectors
function getBlockAtCoords(x: number, y: number): Element | null {
  const elements = document.elementsFromPoint(x, y);
  for (const elem of elements) {
    if (elem.matches(BLOCK_SELECTORS)) {
      return elem;
    }
    // Check if we're inside a list item
    const li = elem.closest('li');
    if (li) return li;
  }
  return null;
}

// Get ProseMirror position from DOM element
function getNodePos(node: Element, view: EditorView): number | null {
  const rect = node.getBoundingClientRect();
  const pos = view.posAtCoords({
    left: rect.left + 1,
    top: rect.top + 1,
  });
  return pos?.inside ?? null;
}

export const DragHandleExtension = Extension.create({
  name: 'dragHandle',

  addProseMirrorPlugins() {
    let dragHandle: HTMLButtonElement | null = null;
    let currentBlock: Element | null = null;
    let isDragging = false;

    const hideDragHandle = () => {
      if (dragHandle && !isDragging) {
        dragHandle.style.opacity = '0';
        dragHandle.style.pointerEvents = 'none';
      }
    };

    const showDragHandle = () => {
      if (dragHandle) {
        dragHandle.style.opacity = '1';
        dragHandle.style.pointerEvents = 'auto';
      }
    };

    const positionDragHandle = (block: Element, view: EditorView) => {
      if (!dragHandle) return;

      const rect = block.getBoundingClientRect();
      const editorRect = view.dom.getBoundingClientRect();

      // Position to the left of the block
      const left = rect.left - editorRect.left - 28;
      const top = rect.top - editorRect.top;

      // Adjust for line height to center vertically
      const style = window.getComputedStyle(block);
      const lineHeight = parseInt(style.lineHeight, 10) || 24;
      const topOffset = (lineHeight - 20) / 2;

      dragHandle.style.left = `${left}px`;
      dragHandle.style.top = `${top + topOffset}px`;
    };

    return [
      new Plugin({
        key: new PluginKey('dragHandle'),
        view: (view) => {
          // Create and append drag handle to editor container
          dragHandle = createDragHandle();
          dragHandle.style.position = 'absolute';
          dragHandle.style.opacity = '0';
          dragHandle.style.pointerEvents = 'none';
          dragHandle.style.zIndex = '50';
          dragHandle.style.cursor = 'grab';

          // Ensure editor container has relative positioning
          const container = view.dom.parentElement;
          if (container) {
            container.style.position = 'relative';
            container.appendChild(dragHandle);
          }

          // Click handler - select the block
          dragHandle.addEventListener('click', (e) => {
            e.preventDefault();
            if (!currentBlock) return;

            const pos = getNodePos(currentBlock, view);
            if (pos === null || pos < 0) return;

            view.focus();
            const nodeSelection = NodeSelection.create(view.state.doc, pos);
            view.dispatch(view.state.tr.setSelection(nodeSelection));
          });

          // Drag start handler
          dragHandle.addEventListener('dragstart', (e) => {
            if (!currentBlock || !e.dataTransfer) return;

            isDragging = true;
            view.dom.classList.add('dragging');

            const pos = getNodePos(currentBlock, view);
            if (pos === null || pos < 0) return;

            view.focus();
            const nodeSelection = NodeSelection.create(view.state.doc, pos);
            view.dispatch(view.state.tr.setSelection(nodeSelection));

            const slice = view.state.selection.content();
            const { dom, text } = view.serializeForClipboard(slice);

            e.dataTransfer.clearData();
            e.dataTransfer.setData('text/html', dom.innerHTML);
            e.dataTransfer.setData('text/plain', text);
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setDragImage(currentBlock, 0, 0);

            view.dragging = { slice, move: true };
          });

          // Drag end handler
          dragHandle.addEventListener('dragend', () => {
            isDragging = false;
            view.dom.classList.remove('dragging');
            hideDragHandle();
          });

          return {
            destroy: () => {
              dragHandle?.remove();
              dragHandle = null;
            },
          };
        },
        props: {
          handleDOMEvents: {
            mousemove: (view, event) => {
              if (!view.editable || isDragging) return false;

              const block = getBlockAtCoords(event.clientX, event.clientY);

              if (!block) {
                hideDragHandle();
                currentBlock = null;
                return false;
              }

              // Don't show for the prosemirror container itself
              if (block.classList.contains('ProseMirror')) {
                hideDragHandle();
                currentBlock = null;
                return false;
              }

              currentBlock = block;
              positionDragHandle(block, view);
              showDragHandle();

              return false;
            },
            mouseleave: () => {
              // Delay hiding to allow moving to the drag handle
              setTimeout(() => {
                if (!isDragging) {
                  hideDragHandle();
                }
              }, 100);
              return false;
            },
            drop: (view, event) => {
              view.dom.classList.remove('dragging');
              hideDragHandle();
              return false;
            },
            dragenter: (view) => {
              view.dom.classList.add('dragging');
              return false;
            },
            dragend: (view) => {
              view.dom.classList.remove('dragging');
              return false;
            },
          },
        },
      }),
    ];
  },
});
