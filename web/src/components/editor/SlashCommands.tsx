import { Extension } from '@tiptap/core';
import { ReactRenderer } from '@tiptap/react';
import Suggestion, { SuggestionOptions } from '@tiptap/suggestion';
import tippy, { Instance as TippyInstance } from 'tippy.js';
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
  useCallback,
} from 'react';
import { cn } from '@/lib/cn';

export interface SlashCommandItem {
  title: string;
  description: string;
  aliases: string[];
  icon: React.ReactNode;
  command: (props: { editor: any; range: any }) => void;
}

interface CommandListProps {
  items: SlashCommandItem[];
  command: (item: SlashCommandItem) => void;
}

interface CommandListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

const CommandList = forwardRef<CommandListRef, CommandListProps>(
  ({ items, command }, ref) => {
    const [selectedIndex, setSelectedIndex] = useState(0);

    const selectItem = useCallback(
      (index: number) => {
        const item = items[index];
        if (item) {
          command(item);
        }
      },
      [items, command]
    );

    useEffect(() => {
      setSelectedIndex(0);
    }, [items]);

    useImperativeHandle(ref, () => ({
      onKeyDown: ({ event }: { event: KeyboardEvent }) => {
        if (event.key === 'ArrowUp') {
          setSelectedIndex((prev) => (prev + items.length - 1) % items.length);
          return true;
        }

        if (event.key === 'ArrowDown') {
          setSelectedIndex((prev) => (prev + 1) % items.length);
          return true;
        }

        if (event.key === 'Enter') {
          selectItem(selectedIndex);
          return true;
        }

        return false;
      },
    }));

    if (items.length === 0) {
      return null;
    }

    return (
      <div className="z-50 min-w-[200px] overflow-hidden rounded-lg border border-border bg-background shadow-lg">
        {items.map((item, index) => (
          <button
            key={item.title}
            onClick={() => selectItem(index)}
            className={cn(
              'flex w-full items-center gap-3 px-3 py-2 text-left text-sm',
              'hover:bg-border/50 transition-colors',
              index === selectedIndex && 'bg-border/50'
            )}
          >
            <span className="flex h-8 w-8 items-center justify-center rounded bg-border/30 text-muted">
              {item.icon}
            </span>
            <div className="flex-1">
              <div className="font-medium text-foreground">{item.title}</div>
              <div className="text-xs text-muted">{item.description}</div>
            </div>
          </button>
        ))}
      </div>
    );
  }
);

CommandList.displayName = 'CommandList';

interface CreateSlashCommandsOptions {
  onCreateSubDocument: () => Promise<{ id: string; title: string } | null>;
}

// Icons for slash commands
const icons = {
  document: (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  ),
  heading1: (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <text x="4" y="17" fontSize="14" fontWeight="bold" fill="currentColor" stroke="none">H1</text>
    </svg>
  ),
  heading2: (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <text x="4" y="17" fontSize="14" fontWeight="bold" fill="currentColor" stroke="none">H2</text>
    </svg>
  ),
  heading3: (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <text x="4" y="17" fontSize="14" fontWeight="bold" fill="currentColor" stroke="none">H3</text>
    </svg>
  ),
  bulletList: (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
      <circle cx="2" cy="6" r="1" fill="currentColor" />
      <circle cx="2" cy="12" r="1" fill="currentColor" />
      <circle cx="2" cy="18" r="1" fill="currentColor" />
    </svg>
  ),
  numberedList: (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 6h13M7 12h13M7 18h13" />
      <text x="1" y="8" fontSize="8" fill="currentColor" stroke="none">1</text>
      <text x="1" y="14" fontSize="8" fill="currentColor" stroke="none">2</text>
      <text x="1" y="20" fontSize="8" fill="currentColor" stroke="none">3</text>
    </svg>
  ),
  quote: (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 10h.01M12 10h.01M16 10h.01M9 16H5a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v8a2 2 0 01-2 2h-5l-5 5v-5z" />
    </svg>
  ),
  code: (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
    </svg>
  ),
  divider: (
    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 12h16" />
    </svg>
  ),
};

export function createSlashCommands({ onCreateSubDocument }: CreateSlashCommandsOptions) {
  const slashCommands: SlashCommandItem[] = [
    // Sub-document (requires async callback)
    {
      title: 'Sub-document',
      description: 'Create a nested document',
      aliases: ['doc', 'document', 'sub-document', 'page', 'sub-page', 'subpage', 'subdoc'],
      icon: icons.document,
      command: async ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).run();
        const doc = await onCreateSubDocument();
        if (doc) {
          editor
            .chain()
            .focus()
            .insertContent({
              type: 'text',
              marks: [{ type: 'link', attrs: { href: `/docs/${doc.id}`, target: '_self' } }],
              text: doc.title || 'Untitled',
            })
            .run();
        }
      },
    },
    // Headings
    {
      title: 'Heading 1',
      description: 'Large section heading',
      aliases: ['h1', 'heading1', 'title'],
      icon: icons.heading1,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).setNode('heading', { level: 1 }).run();
      },
    },
    {
      title: 'Heading 2',
      description: 'Medium section heading',
      aliases: ['h2', 'heading2', 'subtitle'],
      icon: icons.heading2,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).setNode('heading', { level: 2 }).run();
      },
    },
    {
      title: 'Heading 3',
      description: 'Small section heading',
      aliases: ['h3', 'heading3'],
      icon: icons.heading3,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).setNode('heading', { level: 3 }).run();
      },
    },
    // Lists
    {
      title: 'Bullet List',
      description: 'Create a simple bullet list',
      aliases: ['ul', 'unordered', 'bullet', 'list', 'bullets'],
      icon: icons.bulletList,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).toggleBulletList().run();
      },
    },
    {
      title: 'Numbered List',
      description: 'Create a numbered list',
      aliases: ['ol', 'ordered', 'number', 'numbered'],
      icon: icons.numberedList,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).toggleOrderedList().run();
      },
    },
    // Blocks
    {
      title: 'Quote',
      description: 'Capture a quote',
      aliases: ['blockquote', 'quotation', 'cite'],
      icon: icons.quote,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).toggleBlockquote().run();
      },
    },
    {
      title: 'Code Block',
      description: 'Capture a code snippet',
      aliases: ['code', 'codeblock', 'pre', 'snippet'],
      icon: icons.code,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).toggleCodeBlock().run();
      },
    },
    {
      title: 'Divider',
      description: 'Visually divide content',
      aliases: ['hr', 'horizontal', 'rule', 'separator', 'line'],
      icon: icons.divider,
      command: ({ editor, range }) => {
        editor.chain().focus().deleteRange(range).setHorizontalRule().run();
      },
    },
  ];

  return Extension.create({
    name: 'slashCommands',

    addOptions() {
      return {
        suggestion: {
          char: '/',
          command: ({ editor, range, props }: { editor: any; range: any; props: SlashCommandItem }) => {
            props.command({ editor, range });
          },
        } as Partial<SuggestionOptions>,
      };
    },

    addProseMirrorPlugins() {
      return [
        Suggestion({
          editor: this.editor,
          ...this.options.suggestion,
          items: ({ query }: { query: string }) => {
            const search = query.toLowerCase();
            return slashCommands.filter(
              (item) =>
                item.title.toLowerCase().includes(search) ||
                item.aliases.some((alias) => alias.toLowerCase().includes(search))
            );
          },
          render: () => {
            let component: ReactRenderer<CommandListRef> | null = null;
            let popup: TippyInstance[] | null = null;

            return {
              onStart: (props: any) => {
                component = new ReactRenderer(CommandList, {
                  props,
                  editor: props.editor,
                });

                if (!props.clientRect) {
                  return;
                }

                popup = tippy('body', {
                  getReferenceClientRect: props.clientRect,
                  appendTo: () => document.body,
                  content: component.element,
                  showOnCreate: true,
                  interactive: true,
                  trigger: 'manual',
                  placement: 'bottom-start',
                });
              },

              onUpdate(props: any) {
                component?.updateProps(props);

                if (!props.clientRect) {
                  return;
                }

                popup?.[0]?.setProps({
                  getReferenceClientRect: props.clientRect,
                });
              },

              onKeyDown(props: any) {
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
        }),
      ];
    },
  });
}
