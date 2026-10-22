"use client";

import { cn } from "@/lib/utils";
import { BRAND_PRESS_CLASS } from "@/components/brand/brand-classes";
import type { FooterLink } from "@/lib/pos-footer";

// U1 Task 5 (owner Q11; design 6.7; values 5.5 links row in docs/superpowers/specs/2026-10-20-pos-html-values.md): the
// cart footer's links — "Discount · Promo code · Reward · Extra charge · Note" (lib/pos-footer.ts decides which show and
// what each says). The first four open the Bill options panel at their own section, Note the order note; an applied
// one reads its value in --accent-i 600. Locked only while the cart is busy — never on an empty cart, so an adjustment
// that survived Clear can always be seen and removed (D9.8c).

/** A link (values 5.5): 12.5px 500 --link, no padding. */
const LINK_CLASS =
  "cursor-pointer bg-transparent p-0 text-[12.5px] font-medium text-link disabled:cursor-not-allowed disabled:opacity-50";
/** An applied link (design 6.7): --accent-i 600. */
const APPLIED_CLASS = "font-semibold text-accent-foreground";

export function CartFooterLinks({
  links,
  openKey,
  disabled,
  onOpen,
}: {
  links: FooterLink[];
  /** The link whose panel is open (its second tap closes it). */
  openKey: FooterLink["key"] | null;
  disabled?: boolean;
  onOpen: (key: FooterLink["key"]) => void;
}) {
  return (
    <div data-ui="pos-footer-links" className="flex flex-wrap gap-x-4 gap-y-1">
      {links.map((link) => (
        <button
          key={link.key}
          type="button"
          data-ui="pos-footer-link"
          data-key={link.key}
          aria-haspopup="dialog"
          aria-expanded={openKey === link.key}
          className={cn(LINK_CLASS, link.applied && APPLIED_CLASS, BRAND_PRESS_CLASS)}
          disabled={disabled}
          onClick={() => onOpen(link.key)}
        >
          {link.applied ?? link.label}
        </button>
      ))}
    </div>
  );
}
