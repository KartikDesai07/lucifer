"use client";

import { BoxIcon, RestoreIcon } from "@/components/menu/menu-icons";
import { MENU_EDITOR_ARCHIVE_CLASS } from "@/lib/menu-editor-layout";
import type { Product } from "@/types";

interface ItemArchiveLinkProps {
  product: Product;
  /** Opens today's "Archive item?" confirm over the editor. */
  onArchive: (product: Product) => void;
  /** Restores at once (today's flow had no confirm). */
  onRestore: (product: Product) => void;
  restoring: boolean;
}

// Archive item / Restore item (values 9.2 #6): the HTML's red link at the foot of the editor, for an item being edited only.
// An active item offers Archive (the confirm is the page's), an archived one Restore.
export function ItemArchiveLink({ product, onArchive, onRestore, restoring }: ItemArchiveLinkProps) {
  const archived = product.isActive === false;
  return (
    <button
      type="button"
      data-ui="item-archive"
      className={MENU_EDITOR_ARCHIVE_CLASS}
      disabled={restoring}
      onClick={() => (archived ? onRestore(product) : onArchive(product))}
    >
      {archived ? <RestoreIcon size={15} strokeWidth={1.9} /> : <BoxIcon size={15} strokeWidth={1.9} />}
      {archived ? "Restore item" : "Archive item"}
    </button>
  );
}
