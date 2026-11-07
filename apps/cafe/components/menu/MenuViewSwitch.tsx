import { AppLink } from "@/components/layout/AppLink";

import { cn } from "@/lib/utils";
import {
  MENU_VIEW_LINK_CLASS,
  MENU_VIEW_LINK_OFF_CLASS,
  MENU_VIEW_LINK_ON_CLASS,
  MENU_VIEW_SWITCH_CLASS,
} from "@/lib/menu-layout";
import { MENU_CATEGORIES_PATH, MENU_ITEMS_PATH } from "@/lib/menu-sections";
import { FolderIcon, ItemsViewIcon } from "@/components/menu/menu-icons";

const VIEWS = [
  { key: "items", label: "Items", href: MENU_ITEMS_PATH, Icon: ItemsViewIcon },
  { key: "categories", label: "Categories", href: MENU_CATEGORIES_PATH, Icon: FolderIcon },
] as const;

/** The HTML's Items / Categories switch (values 2) in the header: a 36px track of two links to the two routes (the routes
 *  stay; `prefetch={false}` as the nav's), the current one lit and marked `aria-current="page"`. The labels hide below
 *  720px (the track is then 86px of icons). The kit's links, so the header's slot rule gives them its press and sizes;
 *  the classes in lib/menu-layout.ts answer the rule where the HTML's switch differs. */
export function MenuViewSwitch({ current }: { current: "items" | "categories" }) {
  return (
    <nav aria-label="Menu view" data-ui="menu-view-switch" className={MENU_VIEW_SWITCH_CLASS}>
      {VIEWS.map(({ key, label, href, Icon }) => {
        const on = key === current;
        return (
          <AppLink
            key={key}
            href={href}
            title={label}
            data-ui={`menu-view-${key}`}
            aria-current={on ? "page" : undefined}
            className={cn(MENU_VIEW_LINK_CLASS, on ? MENU_VIEW_LINK_ON_CLASS : MENU_VIEW_LINK_OFF_CLASS)}
          >
            <Icon size={15} />
            <span className="max-tab:hidden">{label}</span>
          </AppLink>
        );
      })}
    </nav>
  );
}
