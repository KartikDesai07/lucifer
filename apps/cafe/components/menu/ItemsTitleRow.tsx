import { MENU_TITLE_COUNT_CLASS, MENU_TITLE_CLASS, MENU_TITLE_ROW_CLASS } from "@/lib/menu-layout";
import { menuTitleCount } from "@/lib/menu-view";
import type { MenuStatusFilter } from "@/lib/menu-items";

// The title row over the list (values 4.6), from 720px: "All items" or the picked category, and "{n} item(s)[ · {filter}]".
export function ItemsTitleRow({ title, count, filter }: { title: string; count: number; filter: MenuStatusFilter }) {
  return (
    <div data-ui="menu-title-row" className={MENU_TITLE_ROW_CLASS}>
      <span className={MENU_TITLE_CLASS}>{title}</span>
      <span className={MENU_TITLE_COUNT_CLASS}>{menuTitleCount(count, filter)}</span>
    </div>
  );
}
