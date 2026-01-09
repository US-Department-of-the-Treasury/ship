import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import { cn } from '@/lib/cn';

interface TooltipProps {
  content: string;
  children: React.ReactNode;
  side?: 'top' | 'right' | 'bottom' | 'left';
  sideOffset?: number;
  delayDuration?: number;
}

/**
 * Tooltip wrapper component using Radix UI.
 * Wraps any element to show descriptive text on hover/focus.
 *
 * Usage:
 * <Tooltip content="Delete document">
 *   <button aria-label="Delete document">
 *     <TrashIcon />
 *   </button>
 * </Tooltip>
 */
export function Tooltip({
  content,
  children,
  side = 'top',
  sideOffset = 4,
  delayDuration = 300,
}: TooltipProps) {
  return (
    <TooltipPrimitive.Root delayDuration={delayDuration}>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={sideOffset}
          className={cn(
            'z-50 rounded px-2 py-1 text-xs',
            'bg-foreground text-background',
            'animate-in fade-in-0 zoom-in-95',
            'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95'
          )}
        >
          {content}
          <TooltipPrimitive.Arrow className="fill-foreground" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

/**
 * TooltipProvider must wrap the app for tooltips to work.
 * Add this once near the root of your app.
 */
export const TooltipProvider = TooltipPrimitive.Provider;
