import { SprintReview } from '@/components/SprintReview';
import { SprintReconciliation } from '@/components/SprintReconciliation';
import type { DocumentTabProps } from '@/lib/document-tabs';

/**
 * SprintReviewTab - Sprint review view
 *
 * This tab shows the sprint review interface with:
 * - Sprint reconciliation for handling incomplete issues
 * - Sprint review editor for notes and hypothesis validation
 *
 * Extracted from SprintViewPage.tsx review tab content.
 */
export default function SprintReviewTab({ documentId, document }: DocumentTabProps) {
  // Get program_id from belongs_to array (sprint's parent program via document_associations)
  const belongsTo = (document as { belongs_to?: Array<{ id: string; type: string }> }).belongs_to;
  const programId = belongsTo?.find(b => b.type === 'program')?.id;
  // Get sprint properties
  const properties = document.properties as { sprint_number?: number } | undefined;
  const sprintNumber = properties?.sprint_number ?? 1;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Sprint reconciliation for incomplete issues */}
      {programId && (
        <div className="border-b border-border p-4">
          <SprintReconciliation
            sprintId={documentId}
            sprintNumber={sprintNumber}
            programId={programId}
            onDecisionMade={(decision) => {
              // Refresh handled internally by SprintReconciliation
              console.log('Reconciliation decision:', decision);
            }}
          />
        </div>
      )}
      {/* Sprint review editor */}
      <div className="flex-1 overflow-auto pb-20">
        <SprintReview sprintId={documentId} />
      </div>
    </div>
  );
}
