"use client";

import { ConfirmDialog } from "@/components/shared/ConfirmDialog";

interface FreeTablePromptState {
  tableNo: string;
  orderId: string;
}

interface PosPromptsProps {
  // Discard-unsent-items guard when leaving a resumed tab without settling.
  closeConfirmOpen: boolean;
  onCloseConfirmOpenChange: (open: boolean) => void;
  onConfirmCloseTab: () => void;
  // Discard-unsent-items guard when resuming a different tab mid-build.
  resumeConfirmOpen: boolean;
  onCancelResume: () => void;
  onConfirmResume: () => void;
  // Offered after a brand-new Pay-Now sale against a table (see
  // useFreeTablePrompt) — POST /api/orders occupies the table on every
  // create, so a one-shot counter sale would otherwise leave it Occupied.
  freeTablePrompt: FreeTablePromptState | null;
  onDismissFreeTable: () => void;
  onConfirmFreeTable: () => void;
  freeingTable: boolean;
}

// The three POS confirm dialogs in one place — extracted out of pos/page.tsx
// to keep that file under the line budget.
export function PosPrompts({
  closeConfirmOpen,
  onCloseConfirmOpenChange,
  onConfirmCloseTab,
  resumeConfirmOpen,
  onCancelResume,
  onConfirmResume,
  freeTablePrompt,
  onDismissFreeTable,
  onConfirmFreeTable,
  freeingTable,
}: PosPromptsProps) {
  return (
    <>
      <ConfirmDialog
        open={closeConfirmOpen}
        onOpenChange={onCloseConfirmOpenChange}
        title="Discard unsent items?"
        description="This tab has items not yet sent to the kitchen. Closing here discards them; the open tab itself stays open."
        confirmLabel="Discard & close"
        onConfirm={onConfirmCloseTab}
      />

      <ConfirmDialog
        open={resumeConfirmOpen}
        onOpenChange={(o) => !o && onCancelResume()}
        title="Discard unsent items?"
        description="You have items not yet sent to the kitchen. Resuming another tab will discard them."
        confirmLabel="Discard & resume"
        onConfirm={onConfirmResume}
      />

      <ConfirmDialog
        open={!!freeTablePrompt}
        onOpenChange={(o) => !o && onDismissFreeTable()}
        title={`Free table ${freeTablePrompt?.tableNo ?? ""}?`}
        description="Sale recorded. If the guests have left, free the table so the floor stays accurate."
        confirmLabel="Free table"
        cancelLabel="Keep Occupied"
        destructive={false}
        isLoading={freeingTable}
        onConfirm={onConfirmFreeTable}
      />
    </>
  );
}
