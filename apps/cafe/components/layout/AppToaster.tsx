"use client";

import type { ComponentProps, CSSProperties } from "react";
import { usePathname } from "next/navigation";

import { Toaster } from "@/components/ui/sonner";
import { isPosPath } from "@/lib/pos-layout";

// The one toaster, mounted by the root layout (U0 Task 4, ruling R8). The staff screens get the owner's HTML toast
// (values 2.8; design 5.4); the diner menu (/m) keeps exactly its previous toast — the kit Toaster, whose look comes
// from the cafe's Appearance preset, with rich colours, top right. The HTML's names (--toast, --toast-t, --toast-a)
// are staff-only, so they live here, never in the kit file.

/** The diner menu's routes: /m and everything under it. */
export function isDinerRoute(pathname: string): boolean {
  return pathname === "/m" || pathname.startsWith("/m/");
}

/** The HTML toast: one dark pill at the bottom centre, as wide as its words (never past the screen's 16px margins),
 *  24px above the foot from 1024px, 92px below 1024px and 140px on a phone (it clears the tab bar and the POS cart
 *  bar); --toast, white 13.5px words, radius 10, padding 10px 14px, 14px between the words and an action ("Undo" in
 *  --toast-a, 600). Sonner draws it unstyled, so only these classes paint it; its own sheet still places and stacks it
 *  (its rules are unlayered, hence the important ones). A success or an info toast reads like the HTML's; an error or
 *  a warning keeps sonner's 16px glyph in --bad / --warn on the same dark pill, so an alarm never reads like a success. */
export const STAFF_TOASTER_PROPS: ComponentProps<typeof Toaster> = {
  position: "bottom-center",
  mobileOffset: 0,
  icons: { success: null, info: null },
  className: "toaster group bottom-[140px]! tab:bottom-[92px]! lg:bottom-[24px]!",
  // The list spans the screen so the centred pill can be as wide as its words.
  style: { "--width": "100vw" } as CSSProperties,
  toastOptions: {
    unstyled: true,
    classNames: {
      toast:
        "group toast pointer-events-auto right-0! left-0! mx-auto w-max! max-w-[calc(100vw-32px)] flex items-center gap-[14px] rounded-[10px] bg-toast px-[14px] py-[10px] font-sans text-[13.5px] leading-[normal] text-toast-t [box-shadow:0_8px_24px_rgba(0,0,0,0.2)]",
      title: "font-normal",
      description: "mt-0.5 text-[12.5px] text-toast-t/70",
      icon: "flex size-4 flex-none items-center justify-center [&>svg]:size-4",
      error: "[&_[data-icon]]:text-status-bad",
      warning: "[&_[data-icon]]:text-status-warn",
      actionButton: "flex-none cursor-pointer border-0 bg-transparent p-0 text-[13.5px] font-semibold text-toast-a",
      cancelButton: "flex-none cursor-pointer border-0 bg-transparent p-0 text-[13.5px] font-semibold text-toast-t",
    },
  },
};

/** /pos (owner Q19): the order bar and the full-screen cart sheet's Send KOT / Pay sit at the window's foot up to 1279px
 *  there (the HTML's 1024px cut-off moved to 1280px), so the toast keeps the bar's 92px up to 1279px and takes the
 *  HTML's 24px only beside the cart column (xl:); every other page keeps the staff toaster's lg: 24px. Ruling P49: from
 *  720px the bar and the sheet's foot grow by the bottom safe-area inset, so the 92px does too (92px at inset 0). */
export const POS_TOASTER_PROPS: ComponentProps<typeof Toaster> = {
  ...STAFF_TOASTER_PROPS,
  className: "toaster group bottom-[140px]! tab:bottom-[calc(92px+env(safe-area-inset-bottom))]! xl:bottom-[24px]!",
};

export function AppToaster() {
  const pathname = usePathname() ?? "";
  if (isDinerRoute(pathname)) return <Toaster richColors position="top-right" />;
  // One element for every staff page: moving to or from /pos only changes its offset (no remount, no toast lost).
  return <Toaster {...(isPosPath(pathname) ? POS_TOASTER_PROPS : STAFF_TOASTER_PROPS)} />;
}
