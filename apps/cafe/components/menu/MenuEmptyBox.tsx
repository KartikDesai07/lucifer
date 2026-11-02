import type { ReactNode } from "react";

import {
  MENU_EMPTY_BOX_CLASS,
  MENU_EMPTY_SUB_CLASS,
  MENU_EMPTY_TILE_CLASS,
  MENU_EMPTY_TITLE_CLASS,
} from "@/lib/menu-layout";

interface MenuEmptyBoxProps {
  /** The 44px tile's glyph (20px); the HTML's magnifier for a filtered empty. */
  icon: ReactNode;
  title: string;
  description?: string;
  /** Ours, under the words: Clear filters, Add item, Add a category. */
  action?: ReactNode;
}

// The HTML's empty box (values 4.7; design 6.8): a dashed --border box, the 44px tile, a 15px title and a 13px line. The
// filtered empty takes the HTML's words; our guided empties (no categories yet, an empty menu, an empty Archived view)
// keep their own words in the same box.
export function MenuEmptyBox({ icon, title, description, action }: MenuEmptyBoxProps) {
  return (
    <div data-ui="menu-empty" className={MENU_EMPTY_BOX_CLASS}>
      <span className={MENU_EMPTY_TILE_CLASS}>{icon}</span>
      <p className={MENU_EMPTY_TITLE_CLASS}>{title}</p>
      {description && <p className={MENU_EMPTY_SUB_CLASS}>{description}</p>}
      {action}
    </div>
  );
}
