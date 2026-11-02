"use client";

import { Plus } from "lucide-react";

import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/shared/PageHeader";
import { MenuViewSwitch } from "@/components/menu/MenuViewSwitch";
import { MENU_ADD_CLASS } from "@/lib/menu-layout";

interface MenuPageHeaderProps {
  /** Which route this is: lights the switch and words the Add button ("Add item" / "Add category"). */
  current: "items" | "categories";
  /** The second line (menuHeaderLine); undefined leaves the shell's default (a first-load error). */
  line?: string;
  isAdmin: boolean;
  onAdd: () => void;
}

// The Menu's header on both routes (U5 Task 1; values 2, design 6.1, owner Q5): the title "Menu" (the HTML's; the eyebrow
// goes), the counts line, and for an admin the Items / Categories switch and Add as the page's actions (staff get none,
// as today). Below 720px they stay in the header while the title block keeps 64px (the word "Menu" whole), else the body
// row (PageHeader's phone floor). "Add item" / "Add category" from 720px, "Add" below.
export function MenuPageHeader({ current, line, isAdmin, onAdd }: MenuPageHeaderProps) {
  const label = current === "items" ? "Add item" : "Add category";
  return (
    <PageHeader
      title="Menu"
      description={line}
      phoneTitleMinPx={64}
      actions={isAdmin && (
        <>
          <MenuViewSwitch current={current} />
          <Button data-ui="menu-add" aria-label={label} className={MENU_ADD_CLASS} onClick={onAdd}>
            <Plus aria-hidden="true" />
            <span className="max-tab:hidden">{label}</span>
            <span className="tab:hidden">Add</span>
          </Button>
        </>
      )}
    />
  );
}
