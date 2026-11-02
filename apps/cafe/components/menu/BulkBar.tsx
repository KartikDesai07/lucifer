"use client";

import type { ReactNode } from "react";

import { PRODUCT_BULK_MAX } from "@pos/shared/constants";
import type { ProductBulkAction } from "@pos/shared/schemas";
import { MENU_BULK_BAR_CLASS, MENU_BULK_BUTTON_CLASS, MENU_BULK_CAP_CLASS, MENU_BULK_CLEAR_CLASS, MENU_BULK_COUNT_CLASS, MENU_BULK_LABEL_CLASS } from "@/lib/menu-list-layout";
import { BoxIcon, CircleSlashIcon, FolderIcon, RestoreIcon, TickIcon } from "@/components/menu/menu-icons";

interface BulkBarProps {
  count: number;
  isAdmin: boolean;
  archived: boolean;
  isPending: boolean;
  onAction: (action: ProductBulkAction) => void;
  onMove: () => void;
  onArchive: () => void;
  onClear: () => void;
}

function BulkButton({ label, icon, disabled, onClick }: { label: string; icon: ReactNode; disabled: boolean; onClick: () => void }) {
  return (
    <button type="button" title={label} aria-label={label} disabled={disabled} onClick={onClick} className={MENU_BULK_BUTTON_CLASS}>
      {icon}
      <span className={MENU_BULK_LABEL_CLASS}>{label}</span>
    </button>
  );
}

// R18 — the ink bar at the foot of the list while anything is selected (U5 Task 2; values 8, design 6.7, owner Q6): sticky
// at the scroller's foot, on a phone above the tab bar. Staff get the two stock actions only (the route enforces this;
// STAFF_PRODUCT_BULK_ACTIONS mirrors it for what is even offered); admins add Move to category and Archive, and the
// Archived view offers Restore. Over PRODUCT_BULK_MAX selected, every action disables with the capped-selection words.
// Below a 520px list the labels go and each button is an icon (still named by its aria-label).
export function BulkBar({ count, isAdmin, archived, isPending, onAction, onMove, onArchive, onClear }: BulkBarProps) {
  if (count === 0) return null;
  const overCap = count > PRODUCT_BULK_MAX;
  const disabled = isPending || overCap;
  const icon = { size: 14, strokeWidth: 2 };

  return (
    <div data-ui="menu-bulk-bar" className={MENU_BULK_BAR_CLASS}>
      <span className={MENU_BULK_COUNT_CLASS}>{count} {count === 1 ? "item" : "items"} selected</span>
      {overCap && <p className={MENU_BULK_CAP_CLASS}>Select up to {PRODUCT_BULK_MAX} items at a time.</p>}

      {archived ? (
        <BulkButton label="Restore" icon={<RestoreIcon {...icon} />} disabled={disabled} onClick={() => onAction("restore")} />
      ) : (
        <>
          <BulkButton label="Mark sold out" icon={<CircleSlashIcon {...icon} />} disabled={disabled} onClick={() => onAction("out-of-stock")} />
          <BulkButton label="Back in stock" icon={<TickIcon {...icon} />} disabled={disabled} onClick={() => onAction("in-stock")} />
        </>
      )}

      {isAdmin && !archived && (
        <>
          <BulkButton label="Move to category" icon={<FolderIcon {...icon} />} disabled={disabled} onClick={onMove} />
          <BulkButton label="Archive" icon={<BoxIcon {...icon} />} disabled={disabled} onClick={onArchive} />
        </>
      )}

      <button type="button" title="Clear selection" aria-label="Clear selection" onClick={onClear} className={MENU_BULK_CLEAR_CLASS}>
        <span aria-hidden="true">✕</span>
      </button>
    </div>
  );
}
