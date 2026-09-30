"use client";

import { MoreVertical, Pencil, Archive, ArchiveRestore } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Product } from "@/types";

interface ItemRowMenuProps {
  product: Product;
  archived: boolean;
  onEdit: (product: Product) => void;
  onArchive: (product: Product) => void;
  onRestore: (product: Product) => void;
}

// Admin-only ⋯ menu: Edit + Archive on the active view, Edit + Restore on the
// archived view (C17 — an archived item can still hold a categoryId a
// category-delete 409 counts, so it must stay reachable to re-home or restore
// it). Shared by ItemsTable and ItemCards so both surfaces stay in lockstep.
export function ItemRowMenu({ product, archived, onEdit, onArchive, onRestore }: ItemRowMenuProps) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={(e) => e.stopPropagation()}
          aria-label={`More actions for ${product.name}`}
        >
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuItem onClick={() => onEdit(product)}>
          <Pencil className="mr-2 h-4 w-4" /> Edit
        </DropdownMenuItem>
        {archived ? (
          <DropdownMenuItem onClick={() => onRestore(product)}>
            <ArchiveRestore className="mr-2 h-4 w-4" /> Restore
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem onClick={() => onArchive(product)} className="text-destructive">
            <Archive className="mr-2 h-4 w-4" /> Archive
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
