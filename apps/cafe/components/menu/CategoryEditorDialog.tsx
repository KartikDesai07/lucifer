"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { useCreateCategory, useUpdateCategory } from "@/hooks/use-categories";
import { useStations } from "@/hooks/use-print-setup";
import { StationSelect } from "@/components/print/setup/StationSelect";
import { CategoryKitchenTicketField } from "@/components/menu/CategoryKitchenTicketField";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { nextCategoryOrder } from "@/lib/category-arrange";
import type { Category } from "@/types";

interface CategoryEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The category being renamed / edited; null = Add. */
  editing: Category | null;
  /** The whole list (a new category's order comes from it). */
  categories: Category[];
}

// Today's Add / Rename category dialog, moved out of app/(dashboard)/categories/page.tsx unchanged (U5 ruling M2: the page
// keeps room while Task 1 changes its header and frame; Task 4 restyles this dialog to the HTML's category editor). It owns
// its form state and its two writes, which it makes exactly as the page did.
export function CategoryEditorDialog({ open: formOpen, onOpenChange: setFormOpen, editing, categories: list }: CategoryEditorDialogProps) {
  const createCategory = useCreateCategory();
  const updateCategory = useUpdateCategory();
  const [name, setName] = useState("");
  // Printing Phase 2 Session 2D (spec §6.2, §11): the category's kitchen station; "" is the default station (it
  // follows a moved default). Every station is listed, the default too, so a category kept on the station that is the
  // default now shows as kept and can be set back to the default (the 2D gate's review, I-2).
  const { stations } = useStations();
  const defaultStation = stations.find((station) => station.isDefault);
  const [stationId, setStationId] = useState("");
  // Skip-KOT: true = this category's items never go on a kitchen ticket (the stored flag; absent = they do).
  const [noKot, setNoKot] = useState(false);

  useEffect(() => {
    if (formOpen) setName(editing?.name ?? "");
  }, [formOpen, editing]);
  useEffect(() => {
    // The saved id as it is: a list still loading never turns it into "default" on save.
    if (formOpen) setStationId(editing?.stationId ?? "");
    if (formOpen) setNoKot(editing?.noKot === true);
  }, [formOpen, editing]);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    try {
      if (editing) {
        await updateCategory.mutateAsync({
          id: editing._id,
          // null: back to the default station (an absent key would leave the saved one).
          // noKot null: the switch is back ON (an absent key would leave the saved flag).
          data: { name: trimmed, stationId: stationId === "" ? null : stationId, noKot: noKot ? true : null },
        });
      } else {
        await createCategory.mutateAsync({ name: trimmed, order: nextCategoryOrder(list), ...(stationId !== "" ? { stationId } : {}), ...(noKot ? { noKot } : {}) });
      }
      setFormOpen(false);
    } catch {
      // hook toasts on error
    }
  };

  return (
    <Dialog open={formOpen} onOpenChange={setFormOpen}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{editing ? "Rename category" : "Add category"}</DialogTitle>
          <DialogDescription>
            {editing
              ? "Items keep their link to this category, so the new name shows everywhere."
              : "Categories group menu items in the POS."}
          </DialogDescription>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
          className="space-y-2"
        >
          <Label htmlFor="category-name">Name</Label>
          <Input
            id="category-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Beverages"
          />
          <Label htmlFor="category-station">Kitchen station</Label>
          <StationSelect
            id="category-station"
            value={stationId}
            onChange={setStationId}
            stations={stations}
            inheritLabel={`Default station (${defaultStation?.name ?? "Kitchen"})`}
          />
          <p className="text-xs text-muted-foreground">Where this category&apos;s KOTs print once printers are set up (Printer setup).</p>
          <CategoryKitchenTicketField id="category-no-kot" noKot={noKot} onChange={setNoKot} />
          <DialogFooter className="pt-2">
            <Button type="submit" disabled={!name.trim() || createCategory.isPending || updateCategory.isPending}>
              {(createCategory.isPending || updateCategory.isPending) && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editing ? "Save" : "Add"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
