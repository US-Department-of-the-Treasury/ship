import { useQuery, useMutation, useQueryClient, onlineManager } from '@tanstack/react-query';
import { apiGet, apiPost, apiPatch, apiDelete } from '@/lib/api';
import { addPendingMutation, removePendingMutation, updateMutationSyncStatus, MutationSyncStatus } from '@/lib/queryClient';

export interface WikiDocument {
  id: string;
  title: string;
  document_type: string;
  parent_id: string | null;
  position: number;
  created_at: string;
  updated_at: string;
  created_by?: string | null;
  properties?: Record<string, unknown>;
  visibility: 'private' | 'workspace';
  _pending?: boolean;
  _pendingId?: string;
  _syncStatus?: MutationSyncStatus;
}

// Query keys - simplified to match issues/programs pattern for consistent cache persistence
export const documentKeys = {
  all: ['documents'] as const,
  lists: () => [...documentKeys.all, 'list'] as const,
  list: (type: string) => [...documentKeys.lists(), type] as const,
  // Use wikiList for the main document list query (consistent with issues/programs)
  wikiList: () => [...documentKeys.all, 'wiki'] as const,
  details: () => [...documentKeys.all, 'detail'] as const,
  detail: (id: string) => [...documentKeys.details(), id] as const,
};

// Fetch documents
async function fetchDocuments(type: string = 'wiki'): Promise<WikiDocument[]> {
  const res = await apiGet(`/api/documents?type=${type}`);
  if (!res.ok) {
    const error = new Error('Failed to fetch documents') as Error & { status: number };
    error.status = res.status;
    throw error;
  }
  return res.json();
}

// Create document
async function createDocumentApi(data: { title: string; document_type: string; parent_id?: string | null }): Promise<WikiDocument> {
  const res = await apiPost('/api/documents', data);
  if (!res.ok) {
    const error = new Error('Failed to create document') as Error & { status: number };
    error.status = res.status;
    throw error;
  }
  return res.json();
}

// Update document
async function updateDocumentApi(id: string, updates: Partial<WikiDocument>): Promise<WikiDocument> {
  const res = await apiPatch(`/api/documents/${id}`, updates);
  if (!res.ok) {
    const error = new Error('Failed to update document') as Error & { status: number };
    error.status = res.status;
    throw error;
  }
  return res.json();
}

// Delete document
async function deleteDocumentApi(id: string): Promise<void> {
  const res = await apiDelete(`/api/documents/${id}`);
  if (!res.ok) {
    const error = new Error('Failed to delete document') as Error & { status: number };
    error.status = res.status;
    throw error;
  }
}

// Hook to get documents
export function useDocumentsQuery(type: string = 'wiki') {
  // Use wikiList key for the default wiki type query (consistent cache persistence)
  const queryKey = type === 'wiki' ? documentKeys.wikiList() : documentKeys.list(type);
  return useQuery({
    queryKey,
    queryFn: () => fetchDocuments(type),
    staleTime: 1000 * 60 * 5, // 5 minutes
    refetchOnMount: 'always', // Always refetch on mount to ensure fresh data after navigation/reload
  });
}

// Hook to create document with optimistic update
export function useCreateDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: { title?: string; document_type?: string; parent_id?: string | null; visibility?: 'private' | 'workspace'; _optimisticId?: string }) =>
      createDocumentApi({
        title: data.title ?? 'Untitled',
        document_type: data.document_type ?? 'wiki',
        parent_id: data.parent_id ?? null,
      }),
    onMutate: async (newDoc) => {
      console.log('[CreateDocument] onMutate called, navigator.onLine:', navigator.onLine, 'onlineManager.isOnline():', onlineManager.isOnline());
      // Cancel any outgoing refetches
      await queryClient.cancelQueries({ queryKey: documentKeys.lists() });

      // Snapshot previous value
      const previousDocs = queryClient.getQueryData<WikiDocument[]>(documentKeys.wikiList());

      // Use passed optimisticId if available (for offline creation)
      const optimisticId = newDoc._optimisticId || `temp-${crypto.randomUUID()}`;
      const pendingId = addPendingMutation({
        type: 'create',
        resource: 'document',
        resourceId: optimisticId,
        data: newDoc,
      });

      // Determine initial sync status based on online state
      const isOnline = navigator.onLine;
      const initialSyncStatus: MutationSyncStatus = isOnline ? 'syncing' : 'pending';

      const optimisticDoc: WikiDocument = {
        id: optimisticId,
        title: newDoc.title ?? 'Untitled',
        document_type: newDoc.document_type ?? 'wiki',
        parent_id: newDoc.parent_id ?? null,
        position: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        visibility: newDoc.visibility ?? 'workspace',
        _pending: true,
        _pendingId: pendingId,
        _syncStatus: initialSyncStatus,
      };

      // Update mutation status
      updateMutationSyncStatus(pendingId, initialSyncStatus);

      // Optimistically add to cache
      queryClient.setQueryData<WikiDocument[]>(
        documentKeys.wikiList(),
        (old) => [optimisticDoc, ...(old || [])]
      );

      return { previousDocs, optimisticId, pendingId };
    },
    onError: (err, _newDoc, context) => {
      console.log('[CreateDocument] onError called:', err);
      // Rollback on error
      if (context?.previousDocs) {
        queryClient.setQueryData(documentKeys.wikiList(), context.previousDocs);
      }
      if (context?.pendingId) {
        removePendingMutation(context.pendingId);
      }
    },
    onSuccess: (data, _variables, context) => {
      console.log('[CreateDocument] onSuccess called:', data);
      // Replace optimistic document with real one, show synced status briefly
      if (context?.optimisticId && context?.pendingId) {
        // First show synced status
        updateMutationSyncStatus(context.pendingId, 'synced');
        queryClient.setQueryData<WikiDocument[]>(
          documentKeys.wikiList(),
          (old) => old?.map(d => d.id === context.optimisticId ? { ...data, _syncStatus: 'synced' as MutationSyncStatus, _pendingId: context.pendingId } : d) || [data]
        );

        // After a brief delay, remove the pending indicator
        setTimeout(() => {
          queryClient.setQueryData<WikiDocument[]>(
            documentKeys.wikiList(),
            (old) => old?.map(d => d.id === data.id ? { ...d, _pending: false, _syncStatus: undefined, _pendingId: undefined } : d) || []
          );
          removePendingMutation(context.pendingId);
        }, 1500);
      }
    },
    onSettled: () => {
      // Refetch to ensure consistency
      queryClient.invalidateQueries({ queryKey: documentKeys.lists() });
    },
  });
}

// Hook to update document with optimistic update
export function useUpdateDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, updates }: { id: string; updates: Partial<WikiDocument> }) =>
      updateDocumentApi(id, updates),
    onMutate: async ({ id, updates }) => {
      await queryClient.cancelQueries({ queryKey: documentKeys.lists() });

      const previousDocs = queryClient.getQueryData<WikiDocument[]>(documentKeys.wikiList());

      const pendingId = addPendingMutation({
        type: 'update',
        resource: 'document',
        resourceId: id,
        data: updates,
      });

      // Optimistically update
      queryClient.setQueryData<WikiDocument[]>(
        documentKeys.wikiList(),
        (old) => old?.map(d => d.id === id ? { ...d, ...updates, _pending: true, _pendingId: pendingId } : d) || []
      );

      return { previousDocs, pendingId };
    },
    onError: (_err, _variables, context) => {
      if (context?.previousDocs) {
        queryClient.setQueryData(documentKeys.wikiList(), context.previousDocs);
      }
      if (context?.pendingId) {
        removePendingMutation(context.pendingId);
      }
    },
    onSuccess: (data, { id }, context) => {
      queryClient.setQueryData<WikiDocument[]>(
        documentKeys.wikiList(),
        (old) => old?.map(d => d.id === id ? { ...data, _pending: false } : d) || []
      );
      if (context?.pendingId) {
        removePendingMutation(context.pendingId);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: documentKeys.lists() });
    },
  });
}

// Hook to delete document with optimistic update
export function useDeleteDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => deleteDocumentApi(id),
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: documentKeys.lists() });

      const previousDocs = queryClient.getQueryData<WikiDocument[]>(documentKeys.wikiList());

      const pendingId = addPendingMutation({
        type: 'delete',
        resource: 'document',
        resourceId: id,
        data: null,
      });

      // Optimistically remove (but keep with deleted flag for UI)
      queryClient.setQueryData<WikiDocument[]>(
        documentKeys.wikiList(),
        (old) => old?.filter(d => d.id !== id) || []
      );

      return { previousDocs, pendingId };
    },
    onError: (_err, _id, context) => {
      if (context?.previousDocs) {
        queryClient.setQueryData(documentKeys.wikiList(), context.previousDocs);
      }
      if (context?.pendingId) {
        removePendingMutation(context.pendingId);
      }
    },
    onSuccess: (_data, _id, context) => {
      if (context?.pendingId) {
        removePendingMutation(context.pendingId);
      }
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: documentKeys.lists() });
    },
  });
}

// Compatibility hook that matches the old useDocuments interface
export function useDocuments() {
  const queryClient = useQueryClient();
  const { data: documents = [], isLoading: loading, refetch } = useDocumentsQuery('wiki');
  const createMutation = useCreateDocument();
  const updateMutation = useUpdateDocument();
  const deleteMutation = useDeleteDocument();

  const createDocument = async (parentId?: string): Promise<WikiDocument | null> => {
    // When offline, manually handle optimistic update since onMutate won't run
    // with networkMode: 'online' (mutation is paused, onMutate only runs when resumed)
    if (!navigator.onLine) {
      const optimisticId = `temp-${crypto.randomUUID()}`;

      // Add to our custom pending mutations tracking
      const pendingId = addPendingMutation({
        type: 'create',
        resource: 'document',
        resourceId: optimisticId,
        data: { title: 'Untitled', document_type: 'wiki', parent_id: parentId ?? null },
      });

      const optimisticDoc: WikiDocument = {
        id: optimisticId,
        title: 'Untitled',
        document_type: 'wiki',
        parent_id: parentId ?? null,
        position: 0,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        visibility: 'workspace',
        _pending: true,
        _pendingId: pendingId,
        _syncStatus: 'pending',
      };

      // Manually update the query cache with the optimistic document
      queryClient.setQueryData<WikiDocument[]>(
        documentKeys.wikiList(),
        (old) => [optimisticDoc, ...(old || [])]
      );

      // Don't call createMutation.mutate() - our custom sync handler via
      // processPendingMutations() will handle the API call when going online.
      // Calling the mutation here would cause both handlers to fire.
      return optimisticDoc;
    }

    try {
      return await createMutation.mutateAsync({ parent_id: parentId });
    } catch {
      return null;
    }
  };

  const updateDocument = async (id: string, updates: Partial<WikiDocument>): Promise<WikiDocument | null> => {
    // When offline, manually handle optimistic update since onMutate won't run
    if (!navigator.onLine) {
      // Add to our custom pending mutations tracking
      const pendingId = addPendingMutation({
        type: 'update',
        resource: 'document',
        resourceId: id,
        data: updates,
      });

      // Manually update the query cache
      queryClient.setQueryData<WikiDocument[]>(
        documentKeys.wikiList(),
        (old) => old?.map(d => d.id === id ? {
          ...d,
          ...updates,
          _pending: true,
          _pendingId: pendingId,
          _syncStatus: 'pending' as MutationSyncStatus,
        } : d) || []
      );

      // Don't call updateMutation.mutate() - our custom sync handler handles it
      return { ...updates, id } as WikiDocument;
    }

    try {
      return await updateMutation.mutateAsync({ id, updates });
    } catch {
      return null;
    }
  };

  const deleteDocument = async (id: string): Promise<boolean> => {
    // When offline, manually handle optimistic update since onMutate won't run
    if (!navigator.onLine) {
      // Add to our custom pending mutations tracking
      addPendingMutation({
        type: 'delete',
        resource: 'document',
        resourceId: id,
        data: null,
      });

      // Manually update the query cache (remove the document)
      queryClient.setQueryData<WikiDocument[]>(
        documentKeys.wikiList(),
        (old) => old?.filter(d => d.id !== id) || []
      );

      // Don't call deleteMutation.mutate() - our custom sync handler handles it
      return true;
    }

    try {
      await deleteMutation.mutateAsync(id);
      return true;
    } catch {
      return false;
    }
  };

  const refreshDocuments = async (): Promise<void> => {
    await refetch();
  };

  return {
    documents,
    loading,
    createDocument,
    updateDocument,
    deleteDocument,
    refreshDocuments,
  };
}
