import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useState,
  useCallback,
} from 'react';
import { cn } from '@/lib/cn';
import { EmojiItem } from './EmojiExtension';

interface EmojiListProps {
  items: EmojiItem[];
  command: (item: EmojiItem) => void;
  query: string;
}

interface EmojiListRef {
  onKeyDown: (props: { event: KeyboardEvent }) => boolean;
}

export const EmojiList = forwardRef<EmojiListRef, EmojiListProps>(
  ({ items, command, query }, ref) => {
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

        if (event.key === 'Enter' || event.key === 'Tab') {
          selectItem(selectedIndex);
          return true;
        }

        return false;
      },
    }));

    // Highlight matching text in shortcode
    const highlightMatch = (shortcode: string) => {
      if (!query) return shortcode;
      const index = shortcode.toLowerCase().indexOf(query.toLowerCase());
      if (index === -1) return shortcode;
      return (
        <>
          {shortcode.slice(0, index)}
          <span className="bg-accent/30 text-accent-foreground">
            {shortcode.slice(index, index + query.length)}
          </span>
          {shortcode.slice(index + query.length)}
        </>
      );
    };

    if (items.length === 0) {
      return (
        <div
          className="emoji-picker z-50 min-w-[280px] overflow-hidden rounded-lg border border-border bg-background shadow-lg p-3"
          role="listbox"
          aria-label="Emoji picker - no results"
        >
          <p className="text-sm text-muted">No emojis found</p>
        </div>
      );
    }

    return (
      <div
        className="emoji-picker z-50 min-w-[280px] max-h-[300px] overflow-y-auto rounded-lg border border-border bg-background shadow-lg"
        role="listbox"
        aria-label="Emoji picker"
      >
        <div className="px-3 py-2 text-xs font-medium text-muted border-b border-border/50">
          Type to filter emojis
        </div>
        {items.map((item, index) => (
          <button
            key={`${item.emoji}-${item.shortcode}`}
            onClick={() => selectItem(index)}
            className={cn(
              'flex w-full items-center gap-3 px-3 py-2 text-left text-sm',
              'hover:bg-border/50 transition-colors',
              index === selectedIndex && 'bg-border/50'
            )}
            role="option"
            aria-selected={index === selectedIndex}
          >
            <span className="text-xl" role="img" aria-label={item.shortcode}>
              {item.emoji}
            </span>
            <span className="flex-1 text-foreground font-mono text-xs">
              :{highlightMatch(item.shortcode)}:
            </span>
          </button>
        ))}
      </div>
    );
  }
);

EmojiList.displayName = 'EmojiList';
