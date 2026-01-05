import { registerSyncHandler, PendingMutation, updateMutationResourceId } from './queryClient';
import { apiPost, apiPatch, apiDelete } from './api';

// Track temp ID to real ID mappings for offline-created documents
// When a CREATE sync completes, we store the mapping so UPDATE syncs can use the real ID
const tempToRealIdMap = new Map<string, string>();

export function getTempToRealId(tempId: string): string | undefined {
  return tempToRealIdMap.get(tempId);
}

// Register sync handlers for document operations
export function initializeSyncHandlers() {
  // Document create handler
  registerSyncHandler('document', 'create', async (mutation: PendingMutation) => {
    const data = mutation.data as { title?: string; document_type?: string; parent_id?: string | null; visibility?: string };
    const res = await apiPost('/api/documents', {
      title: data.title ?? 'Untitled',
      document_type: data.document_type ?? 'wiki',
      parent_id: data.parent_id ?? null,
    });
    if (!res.ok) {
      const error = new Error('Failed to sync document creation') as Error & { status: number };
      error.status = res.status;
      throw error;
    }

    // Store the temp-to-real ID mapping so UPDATE mutations can use the real ID
    const createdDoc = await res.json() as { id: string };
    const tempId = mutation.resourceId;
    if (tempId && tempId.startsWith('temp-')) {
      console.log('[SyncHandler] Mapping temp ID', tempId, 'to real ID', createdDoc.id);
      tempToRealIdMap.set(tempId, createdDoc.id);
      // Update any pending UPDATE mutations that reference this temp ID
      updateMutationResourceId(tempId, createdDoc.id);
    }
    return;
  });

  // Document update handler
  registerSyncHandler('document', 'update', async (mutation: PendingMutation) => {
    let { resourceId, data } = mutation;
    if (!resourceId) {
      throw new Error('No resourceId for update mutation');
    }

    // If this is a temp ID, look up the real ID from our mapping
    if (resourceId.startsWith('temp-')) {
      const realId = tempToRealIdMap.get(resourceId);
      if (!realId) {
        // CREATE mutation hasn't synced yet - this shouldn't happen if we process in order
        console.error('[SyncHandler] No real ID mapping for temp ID:', resourceId);
        throw new Error(`No real ID mapping for temp ID: ${resourceId}`);
      }
      console.log('[SyncHandler] Using real ID', realId, 'for temp ID', resourceId);
      resourceId = realId;
    }

    const res = await apiPatch(`/api/documents/${resourceId}`, data as object);
    if (!res.ok) {
      const error = new Error('Failed to sync document update') as Error & { status: number };
      error.status = res.status;
      throw error;
    }
  });

  // Document delete handler
  registerSyncHandler('document', 'delete', async (mutation: PendingMutation) => {
    const { resourceId } = mutation;
    if (!resourceId) {
      throw new Error('No resourceId for delete mutation');
    }
    const res = await apiDelete(`/api/documents/${resourceId}`);
    if (!res.ok) {
      const error = new Error('Failed to sync document deletion') as Error & { status: number };
      error.status = res.status;
      throw error;
    }
  });
}
