"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { useCreateCategory, useUpdateCategory } from "@/hooks/use-categories";
import { useStations } from "@/hooks/use-print-setup";
import { StationSelect } from "@/components/print/setup/StationSelect";
import { CategoryKitchenTicketField } from "@/components/menu/CategoryKitchenTicketField";
import { MenuDialog } from "@/components/menu/MenuDialog";
import { Input } from "@/components/ui/input";
import {
  MENU_EDITOR_FIELD_CLASS,
  MENU_EDITOR_HINT_CLASS,
  MENU_EDITOR_INPUT_CLASS,
  MENU_EDITOR_LABEL_CLASS,
  MENU_EDITOR_SAVE_CLASS,
  MENU_EDITOR_SELECT_CLASS,
} from "@/lib/menu-editor-layout";
import { MENU_SELECT_TRIGGER_CLASS } from "@/lib/menu-layout";
import { cn } from "@/lib/utils";
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

// The category editor in the HTML's dialog box (U5 Task 4; values 10, design 6.11): the 440px box (the phone's bottom sheet),
// "Add category" / "Edit category", Name (42px), Kitchen station (38px kit select), the KOT card, Save (46px). Moved out of
// app/(dashboard)/categories/page.tsx verbatim by Task 1 (ruling M2); it owns its form state and its two writes, which it
// makes exactly as before (the stations read is the dialog's, always mounted: the same request timing). The HTML's Colour
// group is not drawn (no data, design 9); its name errors have no counterpart either: Save stays off until the name has a
// character, today's rule, and a duplicate name is the server's answer, toasted.
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

  const pending = createCategory.isPending || updateCategory.isPending;

  return (
    <MenuDialog
      open={formOpen}
      onOpenChange={setFormOpen}
      title={editing ? "Edit category" : "Add category"}
      sub="Categories group items in New Order and the QR menu."
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto"
      >
        <div className={MENU_EDITOR_FIELD_CLASS}>
          <label htmlFor="category-name" className={MENU_EDITOR_LABEL_CLASS}>
            Name
          </label>
          <Input
            id="category-name"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Beverages"
            className={MENU_EDITOR_INPUT_CLASS}
          />
        </div>
        <div className={MENU_EDITOR_FIELD_CLASS}>
          <label htmlFor="category-station" className={MENU_EDITOR_LABEL_CLASS}>
            Kitchen station
          </label>
          <StationSelect
            id="category-station"
            value={stationId}
            onChange={setStationId}
            stations={stations}
            inheritLabel={`Default station (${defaultStation?.name ?? "Kitchen"})`}
            triggerClassName={cn(MENU_SELECT_TRIGGER_CLASS, MENU_EDITOR_SELECT_CLASS)}
          />
          <span className={MENU_EDITOR_HINT_CLASS}>Where this category’s KOTs print.</span>
        </div>
        <CategoryKitchenTicketField id="category-no-kot" noKot={noKot} onChange={setNoKot} />
        <button type="submit" data-ui="category-save" className={cn(MENU_EDITOR_SAVE_CLASS, "flex-none")} disabled={!name.trim() || pending}>
          {pending && <Loader2 className="h-4 w-4 animate-spin" />}
          {editing ? "Save changes" : "Add category"}
        </button>
      </form>
    </MenuDialog>
  );
}
