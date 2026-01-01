import { Node, mergeAttributes } from '@tiptap/core';
import { ReactRenderer } from '@tiptap/react';
import tippy, { Instance as TippyInstance } from 'tippy.js';
import { EmojiList } from './EmojiList';
import Suggestion from '@tiptap/suggestion';
import { PluginKey } from '@tiptap/pm/state';

export interface EmojiItem {
  emoji: string;
  shortcode: string;
  keywords: string[];
}

interface EmojiListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

// Curated list of common emojis
export const EMOJI_LIST: EmojiItem[] = [
  { emoji: '👍', shortcode: '+1', keywords: ['thumbs', 'up', 'yes', 'approve'] },
  { emoji: '👎', shortcode: '-1', keywords: ['thumbs', 'down', 'no', 'disapprove'] },
  { emoji: '❤️', shortcode: 'heart', keywords: ['love', 'like', 'favorite'] },
  { emoji: '😊', shortcode: 'smile', keywords: ['happy', 'joy', 'pleased'] },
  { emoji: '😂', shortcode: 'joy', keywords: ['laugh', 'lol', 'funny', 'tears'] },
  { emoji: '🎉', shortcode: 'tada', keywords: ['celebration', 'party', 'congrats'] },
  { emoji: '✅', shortcode: 'check', keywords: ['done', 'complete', 'yes', 'approved'] },
  { emoji: '❌', shortcode: 'x', keywords: ['no', 'cancel', 'wrong', 'error'] },
  { emoji: '⚠️', shortcode: 'warning', keywords: ['alert', 'caution', 'attention'] },
  { emoji: '🔥', shortcode: 'fire', keywords: ['hot', 'trending', 'lit'] },
  { emoji: '💯', shortcode: '100', keywords: ['perfect', 'hundred', 'full'] },
  { emoji: '🚀', shortcode: 'rocket', keywords: ['launch', 'ship', 'deploy', 'fast'] },
  { emoji: '💡', shortcode: 'bulb', keywords: ['idea', 'light', 'think'] },
  { emoji: '📝', shortcode: 'memo', keywords: ['note', 'write', 'document'] },
  { emoji: '🐛', shortcode: 'bug', keywords: ['insect', 'error', 'issue'] },
  { emoji: '✨', shortcode: 'sparkles', keywords: ['shine', 'new', 'clean', 'special'] },
  { emoji: '🎯', shortcode: 'target', keywords: ['goal', 'aim', 'bullseye'] },
  { emoji: '💪', shortcode: 'muscle', keywords: ['strong', 'strength', 'power'] },
  { emoji: '🙏', shortcode: 'pray', keywords: ['please', 'thanks', 'hope'] },
  { emoji: '👀', shortcode: 'eyes', keywords: ['look', 'see', 'watch'] },
  { emoji: '🤔', shortcode: 'thinking', keywords: ['hmm', 'wonder', 'consider'] },
  { emoji: '😅', shortcode: 'sweat_smile', keywords: ['nervous', 'relief', 'phew'] },
  { emoji: '🙌', shortcode: 'raised_hands', keywords: ['celebrate', 'hooray', 'yay'] },
  { emoji: '👏', shortcode: 'clap', keywords: ['applause', 'congrats', 'well done'] },
  { emoji: '💪', shortcode: 'strong', keywords: ['power', 'flex', 'strength'] },
  { emoji: '🎨', shortcode: 'art', keywords: ['design', 'creative', 'paint'] },
  { emoji: '📚', shortcode: 'books', keywords: ['library', 'read', 'learn'] },
  { emoji: '⏰', shortcode: 'clock', keywords: ['time', 'alarm', 'schedule'] },
  { emoji: '📅', shortcode: 'calendar', keywords: ['date', 'schedule', 'plan'] },
  { emoji: '✏️', shortcode: 'pencil', keywords: ['write', 'edit', 'draw'] },
  { emoji: '📌', shortcode: 'pushpin', keywords: ['pin', 'important', 'note'] },
  { emoji: '🔖', shortcode: 'bookmark', keywords: ['save', 'mark', 'tag'] },
  { emoji: '🔍', shortcode: 'mag', keywords: ['search', 'find', 'look'] },
  { emoji: '💬', shortcode: 'speech_balloon', keywords: ['comment', 'chat', 'talk'] },
  { emoji: '💻', shortcode: 'computer', keywords: ['code', 'laptop', 'work'] },
  { emoji: '📱', shortcode: 'phone', keywords: ['mobile', 'device', 'cell'] },
  { emoji: '🖥️', shortcode: 'desktop', keywords: ['computer', 'monitor', 'screen'] },
  { emoji: '⚡', shortcode: 'zap', keywords: ['lightning', 'fast', 'power', 'energy'] },
  { emoji: '🌟', shortcode: 'star', keywords: ['favorite', 'special', 'shine'] },
  { emoji: '🎁', shortcode: 'gift', keywords: ['present', 'box', 'surprise'] },
  { emoji: '🏆', shortcode: 'trophy', keywords: ['win', 'award', 'champion'] },
  { emoji: '🚧', shortcode: 'construction', keywords: ['wip', 'work in progress', 'building'] },
  { emoji: '🔒', shortcode: 'lock', keywords: ['secure', 'private', 'closed'] },
  { emoji: '🔓', shortcode: 'unlock', keywords: ['open', 'public', 'unlocked'] },
  { emoji: '🆕', shortcode: 'new', keywords: ['fresh', 'latest', 'recent'] },
  { emoji: '🆙', shortcode: 'up', keywords: ['level up', 'increase', 'upgrade'] },
  { emoji: '🔴', shortcode: 'red_circle', keywords: ['dot', 'error', 'stop'] },
  { emoji: '🟢', shortcode: 'green_circle', keywords: ['dot', 'success', 'go'] },
  { emoji: '🟡', shortcode: 'yellow_circle', keywords: ['dot', 'warning', 'caution'] },
];

// Filter emojis by query
function filterEmojis(query: string): EmojiItem[] {
  if (!query) {
    return EMOJI_LIST.slice(0, 20); // Show first 20 by default
  }

  const lowerQuery = query.toLowerCase();
  return EMOJI_LIST.filter((item) => {
    // Match shortcode or keywords
    return (
      item.shortcode.toLowerCase().includes(lowerQuery) ||
      item.keywords.some((keyword) => keyword.toLowerCase().includes(lowerQuery))
    );
  }).slice(0, 20); // Limit to 20 results
}

export const EmojiExtension = Node.create({
  name: 'emoji',

  group: 'inline',

  inline: true,

  selectable: false,

  atom: true,

  addAttributes() {
    return {
      emoji: {
        default: null,
        parseHTML: (element) => element.getAttribute('data-emoji'),
        renderHTML: (attributes) => {
          if (!attributes.emoji) {
            return {};
          }
          return {
            'data-emoji': attributes.emoji,
          };
        },
      },
    };
  },

  parseHTML() {
    return [
      {
        tag: 'span[data-emoji]',
      },
    ];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(HTMLAttributes, {
        'data-emoji': node.attrs.emoji,
      }),
      node.attrs.emoji,
    ];
  },

  renderText({ node }) {
    return node.attrs.emoji;
  },

  addProseMirrorPlugins() {
    return [
      Suggestion<EmojiItem>({
        editor: this.editor,
        char: ':',
        allowSpaces: false,
        pluginKey: new PluginKey('emoji'),
        items: ({ query }) => {
          return filterEmojis(query);
        },
        command: ({ editor, range, props }) => {
          const emoji = props;
          // Replace the trigger and query with the emoji
          editor
            .chain()
            .focus()
            .deleteRange(range)
            .insertContent(emoji.emoji + ' ')
            .run();
        },
        render: () => {
          let component: ReactRenderer<EmojiListRef> | null = null;
          let popup: TippyInstance[] | null = null;

          return {
            onStart: (props) => {
              component = new ReactRenderer(EmojiList, {
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
      }),
    ];
  },
});
