import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { cn } from '@/lib/cn';

// Celebration messages when user completes an action
const CELEBRATION_MESSAGES = [
  "Done! One less thing on your plate.",
  "Nice work! Your team thanks you.",
  "Accountability level: Expert.",
  "That's how it's done!",
  "Progress feels good, doesn't it?",
  "One down, excellence achieved.",
  "Plan-driven development in action!",
  "The planning gods are pleased.",
];

// Rotating messages - mix of urgency and humor
const MESSAGES = [
  "You have {count} items demanding your attention. They're not going away.",
  "Your plan awaits. The team awaits. Action awaits.",
  "Standups don't write themselves. Yet.",
  "Your future self will thank you. Your manager definitely will.",
  "The accountability police are watching. (It's us. We're the police.)",
  "{count} tasks remain. Zero excuses accepted.",
  "Procrastination is the thief of time. And credibility.",
  "Your week needs you. Don't leave it hanging.",
  "Remember: done is better than perfect. But started is better than nothing.",
  "The retro won't write itself. Trust us, we tried.",
  "Plan-driven development starts with... a plan.",
  "Your accountability items miss you. Please visit them.",
  "{count} items, {count} opportunities to be awesome.",
  "The standup ritual awaits your participation.",
  "Reviews are how we learn. Please help us learn.",
  "Your team is counting on you. Literally, they counted: {count} items.",
  "Achievement unlocked: Accountability Avoider. (Please un-unlock it.)",
  "Fun fact: completing tasks makes them disappear from this banner.",
  "These items have been waiting patiently. Their patience is running out.",
  "Week review: where plans meet reality. Please schedule the meeting.",
];

interface AccountabilityBannerProps {
  itemCount: number;
  onBannerClick: () => void;
  isCelebrating?: boolean;
  urgency?: 'overdue' | 'due_today';
}

export function AccountabilityBanner({ itemCount, onBannerClick, isCelebrating = false, urgency = 'overdue' }: AccountabilityBannerProps) {
  const [messageIndex, setMessageIndex] = useState(() => Math.floor(Math.random() * MESSAGES.length));
  const [celebrationMessageIndex] = useState(() => Math.floor(Math.random() * CELEBRATION_MESSAGES.length));
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

  // During celebration, show even if count is 0 (we'll show success message)
  if (itemCount === 0 && !isCelebrating) {
    return null;
  }

  // Celebration mode: green background, checkmark, celebration message
  if (isCelebrating) {
    return (
      <div
        className="flex w-full items-center justify-center gap-3 bg-green-600 px-4 py-2 text-white transition-all duration-500"
        aria-live="polite"
      >
        {/* Celebration emoji */}
        <span className="text-lg" role="img" aria-label="celebration">
          🎉
        </span>

        {/* Success message */}
        <span className="text-sm font-medium">
          {CELEBRATION_MESSAGES[celebrationMessageIndex]}
        </span>

        {/* Checkmark icon */}
        <svg className="h-5 w-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      </div>
    );
  }

  const bgColor = urgency === 'due_today' ? 'bg-amber-700' : 'bg-red-600';
  const hoverColor = urgency === 'due_today' ? 'hover:bg-amber-800' : 'hover:bg-red-700';
  const badgeColor = urgency === 'due_today' ? 'bg-amber-900' : 'bg-red-800';

  return (
    <button
      onClick={onBannerClick}
      className={`flex w-full items-center justify-center gap-3 ${bgColor} px-4 py-2 text-white ${hoverColor} transition-colors cursor-pointer`}
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
      <span className={`flex h-6 min-w-6 items-center justify-center rounded-full ${badgeColor} px-2 text-xs font-bold`}>
        {itemCount}
      </span>

      {/* Click hint */}
      <span className="text-xs hidden sm:inline">Click to view</span>
    </button>
  );
}

export default AccountabilityBanner;
