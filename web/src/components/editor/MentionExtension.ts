import Mention from '@tiptap/extension-mention';
import { ReactRenderer, ReactNodeViewRenderer } from '@tiptap/react';
import tippy, { Instance as TippyInstance } from 'tippy.js';
import { MentionList, MentionItem } from './MentionList';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { MentionNodeView } from './MentionNodeView';

// API URL for fetching mention suggestions
const API_URL = import.meta.env.VITE_API_URL ?? '';

interface MentionListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

interface CreateMentionExtensionOptions {
  /** Callback to navigate to a document or person */
  onNavigate?: (type: 'person' | 'document', id: string) => void;
}

// Fetch mention suggestions from the API
async function fetchMentionSuggestions(query: string): Promise<MentionItem[]> {
  try {
    const response = await fetch(`${API_URL}/api/search/mentions?q=${encodeURIComponent(query)}`, {
      credentials: 'include',
    });

    if (!response.ok) {
      console.error('Failed to fetch mention suggestions:', response.status);
      return [];
    }

    const data = await response.json();
    const items: MentionItem[] = [];

    // Add people first
    if (data.people) {
      for (const person of data.people) {
        items.push({
          id: person.id,
          label: person.name || person.title,
          type: 'person',
        });
      }
    }

    // Add documents grouped by type
    if (data.documents) {
      for (const doc of data.documents) {
        items.push({
          id: doc.id,
          label: doc.title,
          type: 'document',
          documentType: doc.document_type,
        });
      }
    }

    return items;
  } catch (error) {
    console.error('Error fetching mention suggestions:', error);
    return [];
  }
}

export function createMentionExtension(options: CreateMentionExtensionOptions = {}) {
  return Mention.extend({
    // Add custom attributes for mention type
    addAttributes() {
      return {
        id: {
          default: null,
          parseHTML: (element) => element.getAttribute('data-id'),
          renderHTML: (attributes) => ({
            'data-id': attributes.id,
          }),
        },
        label: {
          default: null,
          parseHTML: (element) => element.getAttribute('data-label'),
          renderHTML: (attributes) => ({
            'data-label': attributes.label,
          }),
        },
        mentionType: {
          default: 'person',
          parseHTML: (element) => element.getAttribute('data-mention-type') || 'person',
          renderHTML: (attributes) => ({
            'data-mention-type': attributes.mentionType,
          }),
        },
        documentType: {
          default: null,
          parseHTML: (element) => element.getAttribute('data-document-type'),
          renderHTML: (attributes) => {
            if (!attributes.documentType) return {};
            return {
              'data-document-type': attributes.documentType,
            };
          },
        },
      };
    },

    // Use React NodeView for dynamic rendering (supports archived status)
    addNodeView() {
      return ReactNodeViewRenderer(MentionNodeView, {
        // Render inline, not as a block
        as: 'span',
      });
    },

    // Fallback rendering for SSR or non-React contexts
    renderHTML({ node, HTMLAttributes }) {
      const mentionType = node.attrs.mentionType || 'person';
      const documentType = node.attrs.documentType;
      const id = node.attrs.id;

      return [
        'a',
        {
          ...HTMLAttributes,
          class: `mention mention-${mentionType}${documentType ? ` mention-${documentType}` : ''}`,
          href: mentionType === 'person'
            ? `/team/${id}`
            : `/${documentType || 'documents'}/${id}`,
        },
        `@${node.attrs.label}`,
      ];
    },

    // Add click handler for mentions (while keeping parent's suggestion plugins)
    addProseMirrorPlugins() {
      const { onNavigate } = options;

      // Get parent's plugins (includes the Suggestion plugin for @ detection)
      const parentPlugins = this.parent?.() || [];

      return [
        ...parentPlugins,
        new Plugin({
          key: new PluginKey('mentionClickHandler'),
          props: {
            handleClick(view, pos, event) {
              const target = event.target as HTMLElement;
              if (target.classList.contains('mention')) {
                event.preventDefault();
                const mentionType = target.getAttribute('data-mention-type') as 'person' | 'document';
                const mentionId = target.getAttribute('data-id');

                if (mentionId && onNavigate) {
                  onNavigate(mentionType || 'person', mentionId);
                  return true;
                }
              }
              return false;
            },
          },
        }),
      ];
    },
  }).configure({
    HTMLAttributes: {
      class: 'mention',
    },
    suggestion: {
      char: '@',
      allowSpaces: true,
      items: async ({ query }): Promise<MentionItem[]> => {
        return fetchMentionSuggestions(query);
      },
      command: ({ editor, range, props }) => {
        // Insert the mention node with all custom attributes
        const mentionProps = props as MentionItem;
        editor
          .chain()
          .focus()
          .insertContentAt(range, [
            {
              type: 'mention',
              attrs: {
                id: mentionProps.id,
                label: mentionProps.label,
                mentionType: mentionProps.type,
                documentType: mentionProps.documentType,
              },
            },
            {
              type: 'text',
              text: ' ',
            },
          ])
          .run();
      },
      render: () => {
        let component: ReactRenderer<MentionListRef> | null = null;
        let popup: TippyInstance[] | null = null;

        return {
          onStart: (props) => {
            component = new ReactRenderer(MentionList, {
              props: {
                items: props.items,
                command: props.command,
                query: props.query,
              },
              editor: props.editor,
            });

            if (!props.clientRect) {
              return;
            }

            popup = tippy('body', {
              getReferenceClientRect: props.clientRect as () => DOMRect,
              appendTo: () => document.body,
              content: component.element,
              showOnCreate: true,
              interactive: true,
              trigger: 'manual',
              placement: 'bottom-start',
            });
          },

          onUpdate(props) {
            component?.updateProps({
              items: props.items,
              command: props.command,
              query: props.query,
            });

            if (!props.clientRect) {
              return;
            }

            popup?.[0]?.setProps({
              getReferenceClientRect: props.clientRect as () => DOMRect,
            });
          },

          onKeyDown(props) {
            if (props.event.key === 'Escape') {
              popup?.[0]?.hide();
              return true;
            }

            return component?.ref?.onKeyDown(props) ?? false;
          },

          onExit() {
            popup?.[0]?.destroy();
            component?.destroy();
          },
        };
      },
    },
  });
}
