import { useRef, useState, useEffect, type ReactNode } from 'react';
import { cn } from '../../lib/cn';

interface ScrollFadeProps {
  children: ReactNode;
  className?: string;
  fadeHeight?: number;
}

/**
 * Wrapper component that shows a gradient fade at the bottom
 * when there is more content to scroll.
 */
export function ScrollFade({ children, className, fadeHeight = 40 }: ScrollFadeProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [showFade, setShowFade] = useState(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const checkScroll = () => {
      const { scrollTop, scrollHeight, clientHeight } = container;
      // Show fade if not at the bottom (with 2px threshold for rounding)
      const isAtBottom = scrollTop + clientHeight >= scrollHeight - 2;
      const hasOverflow = scrollHeight > clientHeight;
      setShowFade(hasOverflow && !isAtBottom);
    };

    // Check initial state
    checkScroll();

    // Check on scroll
    container.addEventListener('scroll', checkScroll);

    // Check on resize (content might change)
    const resizeObserver = new ResizeObserver(checkScroll);
    resizeObserver.observe(container);

    return () => {
      container.removeEventListener('scroll', checkScroll);
      resizeObserver.disconnect();
    };
  }, []);

  return (
    <div className={cn('relative h-full', className)}>
      <div
        ref={containerRef}
        className="h-full overflow-auto"
      >
        {children}
      </div>
      {/* Gradient fade indicator */}
      <div
        className={cn(
          'pointer-events-none absolute bottom-0 left-0 right-0 bg-gradient-to-t from-background to-transparent transition-opacity duration-200',
          showFade ? 'opacity-100' : 'opacity-0'
        )}
        style={{ height: fadeHeight }}
        aria-hidden="true"
      />
    </div>
  );
}
