/**
 * Upload Context - Tracks active uploads for navigation warnings
 * Subscribes to the global upload tracker for real-time updates
 */
import { createContext, useContext, useState, useEffect, ReactNode, useSyncExternalStore } from 'react';
import { useBlocker } from 'react-router-dom';
import {
  getUploadCount,
  getActiveUploads,
  subscribeToUploads,
} from '@/services/uploadTracker';

interface UploadContextValue {
  uploadCount: number;
  isUploading: boolean;
}

const UploadContext = createContext<UploadContextValue | null>(null);

export function UploadProvider({ children }: { children: ReactNode }) {
  // Subscribe to global upload tracker using useSyncExternalStore
  const uploadCount = useSyncExternalStore(
    subscribeToUploads,
    getUploadCount,
    getUploadCount
  );

  const isUploading = uploadCount > 0;

  // Browser beforeunload warning
  useEffect(() => {
    if (!isUploading) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Modern browsers ignore custom messages but still show a generic warning
      e.returnValue = `You have ${uploadCount} upload(s) in progress. Leaving will cancel them.`;
      return e.returnValue;
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isUploading, uploadCount]);

  return (
    <UploadContext.Provider
      value={{
        uploadCount,
        isUploading,
      }}
    >
      {children}
    </UploadContext.Provider>
  );
}

export function useUploads() {
  const context = useContext(UploadContext);
  if (!context) {
    throw new Error('useUploads must be used within an UploadProvider');
  }
  return context;
}

/**
 * Hook for blocking navigation while uploads are in progress
 * Shows a custom modal for in-app navigation
 */
export function useUploadNavigationWarning() {
  const { isUploading, uploadCount } = useUploads();

  // Block in-app navigation when uploads are in progress
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      isUploading && currentLocation.pathname !== nextLocation.pathname
  );

  return {
    isBlocked: blocker.state === 'blocked',
    uploadCount,
    proceed: blocker.proceed,
    reset: blocker.reset,
  };
}
