import { createContext, useContext, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

export interface QueueItem {
  personId: string;
  personName: string;
  weekNumber: number;
  weekName: string;
  type: 'plan' | 'retro';
  sprintId: string;
  docId: string;
}

interface ReviewQueueState {
  queue: QueueItem[];
  currentIndex: number;
  active: boolean;
}

interface ReviewQueueContextValue {
  state: ReviewQueueState;
  start: (queue: QueueItem[]) => void;
  advance: () => void;
  skip: () => void;
  exit: () => void;
}

const ReviewQueueContext = createContext<ReviewQueueContextValue | null>(null);

export function ReviewQueueProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const [state, setState] = useState<ReviewQueueState>({
    queue: [],
    currentIndex: 0,
    active: false,
  });

  const navigateToItem = useCallback((item: QueueItem) => {
    navigate(`/documents/${item.docId}?review=true&sprintId=${item.sprintId}`);
  }, [navigate]);

  const start = useCallback((queue: QueueItem[]) => {
    if (queue.length === 0) return;
    setState({ queue, currentIndex: 0, active: true });
    navigateToItem(queue[0]!);
  }, [navigateToItem]);

  const advanceToNext = useCallback((currentIndex: number, queue: QueueItem[]) => {
    const nextIndex = currentIndex + 1;
    if (nextIndex >= queue.length) {
      // Queue exhausted
      setState({ queue: [], currentIndex: 0, active: false });
      navigate('/team/reviews');
    } else {
      setState(prev => ({ ...prev, currentIndex: nextIndex }));
      navigateToItem(queue[nextIndex]!);
    }
  }, [navigate, navigateToItem]);

  const advance = useCallback(() => {
    if (!state.active) return;
    setTimeout(() => {
      advanceToNext(state.currentIndex, state.queue);
    }, 300);
  }, [state.active, state.currentIndex, state.queue, advanceToNext]);

  const skip = useCallback(() => {
    if (!state.active) return;
    advanceToNext(state.currentIndex, state.queue);
  }, [state.active, state.currentIndex, state.queue, advanceToNext]);

  const exit = useCallback(() => {
    setState({ queue: [], currentIndex: 0, active: false });
    navigate('/team/reviews');
  }, [navigate]);

  return (
    <ReviewQueueContext.Provider value={{ state, start, advance, skip, exit }}>
      {children}
    </ReviewQueueContext.Provider>
  );
}

export function useReviewQueue() {
  return useContext(ReviewQueueContext);
}
