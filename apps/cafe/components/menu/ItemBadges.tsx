import { KITCHEN_NO_KOT_TAG } from "@/lib/kitchen-lines";
import { cn } from "@/lib/utils";
import { MENU_BADGE_CARD_CLASS, MENU_BADGE_TABLE_CLASS, MENU_BADGE_TONE_CLASS } from "@/lib/menu-list-layout";
import type { MenuItemBadge } from "@/lib/menu-view";
import { BoxIcon, CircleSlashIcon, EyeOffIcon, PrinterIcon } from "@/components/menu/menu-icons";

const WORDS: Record<MenuItemBadge, string> = {
  "sold-out": "Sold out",
  hidden: "Hidden on QR",
  archived: "Archived",
  "no-kot": KITCHEN_NO_KOT_TAG,
};

/** A row's badges (values 7.1): table 20px with 11px icons, card 19px with 10px icons, stroke 2.2. Spans, never <p>/<div>
 *  (the No KOT tag must not sit in a paragraph). */
export function ItemBadges({ badges, size }: { badges: readonly MenuItemBadge[]; size: "table" | "card" }) {
  const px = size === "table" ? 11 : 10;
  const icon = { size: px, strokeWidth: 2.2 };
  return (
    <>
      {badges.map((b) => (
        <span key={b} data-ui={`menu-badge-${b}`} className={cn(size === "table" ? MENU_BADGE_TABLE_CLASS : MENU_BADGE_CARD_CLASS, MENU_BADGE_TONE_CLASS[b])}>
          {b === "sold-out" ? <CircleSlashIcon {...icon} /> : b === "hidden" ? <EyeOffIcon {...icon} /> : b === "archived" ? <BoxIcon {...icon} /> : <PrinterIcon {...icon} />}
          {WORDS[b]}
        </span>
      ))}
    </>
  );
}
