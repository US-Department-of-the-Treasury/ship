import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { cn } from '@/lib/cn';

// Rotating messages - mix of urgency and humor
const MESSAGES = [
  "You have {count} items demanding your attention. They're not going away.",
  "Your hypothesis awaits. The team awaits. Science awaits.",
  "Standups don't write themselves. Yet.",
  "Your future self will thank you. Your manager definitely will.",
  "The accountability police are watching. (It's us. We're the police.)",
  "{count} tasks remain. Zero excuses accepted.",
  "Procrastination is the thief of time. And credibility.",
  "Your sprint needs you. Don't leave it hanging.",
  "Remember: done is better than perfect. But started is better than nothing.",
  "The retro won't write itself. Trust us, we tried.",
  "Hypothesis-driven development starts with... a hypothesis.",
  "Your accountability items miss you. Please visit them.",
  "{count} items, {count} opportunities to be awesome.",
  "The standup ritual awaits your participation.",
  "Reviews are how we learn. Please help us learn.",
  "Your team is counting on you. Literally, they counted: {count} items.",
  "Achievement unlocked: Accountability Avoider. (Please un-unlock it.)",
  "Fun fact: completing tasks makes them disappear from this banner.",
  "These items have been waiting patiently. Their patience is running out.",
  "Sprint review: where hypotheses meet reality. Please schedule the meeting.",
];

interface AccountabilityBannerProps {
  itemCount: number;
  onBannerClick: () => void;
}

export function AccountabilityBanner({ itemCount, onBannerClick }: AccountabilityBannerProps) {
  const [messageIndex, setMessageIndex] = useState(() => Math.floor(Math.random() * MESSAGES.length));
  const [isAnimating, setIsAnimating] = useState(false);
  const lastChangeTime = useRef<number>(Date.now());
  const location = useLocation();

  // Rotate message on navigation (with 10-second throttle)
  useEffect(() => {
    const now = Date.now();
    const timeSinceLastChange = now - lastChangeTime.current;

    if (timeSinceLastChange >= 10000) {
      // Trigger animation
      setIsAnimating(true);

      // After fade out, change message
      setTimeout(() => {
        setMessageIndex(prev => (prev + 1) % MESSAGES.length);
        lastChangeTime.current = now;

        // Fade in
        setTimeout(() => {
          setIsAnimating(false);
        }, 50);
      }, 200);
    }
  }, [location.pathname]);

  const getMessage = useCallback(() => {
    return MESSAGES[messageIndex].replace(/{count}/g, String(itemCount));
  }, [messageIndex, itemCount]);

  if (itemCount === 0) {
    return null;
  }

  return (
    <button
      onClick={onBannerClick}
      className="flex w-full items-center justify-center gap-3 bg-red-600 px-4 py-2 text-white hover:bg-red-700 transition-colors cursor-pointer"
      aria-live="polite"
    >
      {/* Alert icon */}
      <svg className="h-5 w-5 flex-shrink-0 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
      </svg>

      {/* Message with animation */}
      <span
        className={cn(
          'text-sm font-medium transition-opacity duration-200',
          isAnimating ? 'opacity-0' : 'opacity-100'
        )}
      >
        {getMessage()}
      </span>

      {/* Badge count */}
      <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-white/20 px-2 text-xs font-bold">
        {itemCount}
      </span>

      {/* Click hint */}
      <span className="text-xs opacity-75 hidden sm:inline">Click to view</span>
    </button>
  );
}

export default AccountabilityBanner;
