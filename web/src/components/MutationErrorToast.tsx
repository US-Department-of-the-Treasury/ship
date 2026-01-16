import { useEffect } from 'react';
import { subscribeToMutationErrors } from '@/lib/queryClient';
import { useToast } from '@/components/ui/Toast';

/**
 * Subscribes to global mutation errors and displays toast notifications.
 * Place this component inside ToastProvider.
 */
export function MutationErrorToast() {
  const { showToast } = useToast();

  useEffect(() => {
    const unsubscribe = subscribeToMutationErrors((error, context) => {
      const message = context.operation
        ? `Failed to ${context.operation}`
        : error.message || 'Something went wrong';
      showToast(message, 'error');
    });

    return unsubscribe;
  }, [showToast]);

  return null;
}
