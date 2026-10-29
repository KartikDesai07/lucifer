// U0 Task 4, fix round 1 (ruling R8): one toaster at the root, two looks. The staff screens get the owner's HTML toast
// (values 2.8: the dark pill, bottom centre at 24 / 92 / 140 px) from a non-kit component; the diner menu (/m) keeps
// exactly its previous toast (the kit Toaster, preset-driven, rich colours, top right), so its toasts still follow the
// cafe's Appearance. Error and warning toasts keep the dark pill with a --bad / --warn glyph.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";
import { FLOOR_TOASTER_PROPS, POS_TOASTER_PROPS, STAFF_TOASTER_PROPS, isDinerRoute, toasterPropsFor } from "@/components/layout/AppToaster";
import { POS_CART_COLUMN_MIN_PX, POS_ORDER_BAR_HEIGHT_PX } from "@/lib/pos-layout";

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (rel: string): string => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8"));
const count = (src: string, needle: string): number => src.split(needle).length - 1;
const tokens = (cls: string | undefined): string[] => (cls ?? "").split(/\s+/).filter(Boolean);
/** A toaster's props without its offset: what makes its look. */
const withoutOffset = (props: typeof STAFF_TOASTER_PROPS) => {
  const copy = { ...props };
  delete copy.className;
  return copy;
};

test("isDinerRoute: /m and everything under it, nothing else", () => {
  for (const p of ["/m", "/m/abc123", "/m/o/42", "/m/abc123/cart"]) assert.equal(isDinerRoute(p), true, `${p} is the diner menu`);
  for (const p of ["/", "/menu", "/mobile", "/pos", "/login", "/orders/m"]) assert.equal(isDinerRoute(p), false, `${p} is not`);
});

test("PIN: the root layout mounts the AppToaster (never the kit Toaster directly)", () => {
  const layout = read("app/layout.tsx");
  assert.equal(count(layout, "<AppToaster />"), 1, "one <AppToaster />");
  assert.match(layout, /import \{ AppToaster \} from "@\/components\/layout\/AppToaster";/, "imported from components/layout");
  assert.ok(!layout.includes("@/components/ui/sonner"), "the layout no longer mounts the kit Toaster itself");
});

test("PIN: the diner menu keeps exactly its previous toast: the kit Toaster, rich colours, top right", () => {
  const src = read("components/layout/AppToaster.tsx");
  assert.match(src, /if \(isDinerRoute\(pathname\)\) return <Toaster richColors position="top-right" \/>;/, "the /m branch is the old mount");
  assert.match(src, /import \{ Toaster \} from "@\/components\/ui\/sonner";/, "through the kit Toaster (preset tokens)");
});

test("the staff toast is the HTML's (values 2.8): bottom centre, the dark pill, white 13.5px words, Undo in --toast-a", () => {
  assert.equal(STAFF_TOASTER_PROPS.position, "bottom-center", "bottom centre");
  const list = tokens(STAFF_TOASTER_PROPS.className);
  for (const cls of ["bottom-[140px]!", "tab:bottom-[92px]!", "lg:bottom-[24px]!"]) {
    assert.ok(list.includes(cls), `the toast sits at toastB: ${cls}`);
  }
  const options = STAFF_TOASTER_PROPS.toastOptions;
  assert.equal(options?.unstyled, true, "sonner's own look is off, so only the HTML's classes paint the toast");
  const toast = tokens(options?.classNames?.toast);
  for (const cls of ["bg-toast", "text-toast-t", "rounded-[10px]", "px-[14px]", "py-[10px]", "text-[13.5px]", "gap-[14px]", "leading-[normal]", "[box-shadow:0_8px_24px_rgba(0,0,0,0.2)]"]) {
    assert.ok(toast.includes(cls), `the toast carries ${cls}`);
  }
  const action = tokens(options?.classNames?.actionButton);
  assert.ok(action.includes("text-toast-a") && action.includes("font-semibold"), "an action (Undo) is --toast-a, 600");
  assert.ok(tokens(options?.classNames?.cancelButton).includes("text-toast-t"), "the cancel words are the toast's white");
});

// Owner Q19 (2026-10-22; U1 Task 14 review): on /pos the order bar and the full-screen cart sheet's Send KOT / Pay run
// up to 1279px (the HTML's 1024px cut-off moved to 1280px there), so a toast on /pos keeps the bar's 92px up to 1279px
// and drops to the HTML's 24px only beside the cart column (xl:, 1280px). Every other page keeps the HTML's lg: 24px.
test("PIN: owner Q19 — on /pos the toast clears the order bar and the sheet's buttons up to 1279px (xl:), every other page keeps lg:", () => {
  const pos = tokens(POS_TOASTER_PROPS.className);
  // Ruling P49: from 720px the bar and the sheet's foot grow by the bottom safe-area inset, so the 92px does too. Ruling
  // P56 (the audit fix round): on a phone the bar rides on the tab bar, which grows by the inset, so the 140px does too.
  for (const cls of [
    "toaster",
    "group",
    "bottom-[calc(140px+env(safe-area-inset-bottom))]!",
    "tab:bottom-[calc(92px+env(safe-area-inset-bottom))]!",
    "xl:bottom-[24px]!",
  ]) {
    assert.ok(pos.includes(cls), `the /pos toaster carries ${cls}`);
  }
  assert.ok(!pos.includes("tab:bottom-[92px]!"), "not the plain 92px on /pos (ruling P49)");
  assert.ok(!pos.includes("bottom-[140px]!"), "not the plain 140px on /pos (ruling P56)");
  assert.ok(tokens(STAFF_TOASTER_PROPS.className).includes("bottom-[140px]!"), "every other page keeps the staff toaster's plain 140px (P56: /pos and, U3 Task 5, /tables only)");
  assert.ok(!pos.includes("lg:bottom-[24px]!"), "no 24px from 1024px on /pos: the bar and the sheet's buttons are there up to 1279px");
  assert.equal(pos.length, tokens(STAFF_TOASTER_PROPS.className).length, "the same five tokens, only the 24px cut-off moves");
  assert.ok(tokens(STAFF_TOASTER_PROPS.className).includes("lg:bottom-[24px]!"), "every other page keeps the HTML's 24px from 1024px");
  // Everything but the offset is the staff toaster's own (one look).
  assert.deepEqual(withoutOffset(POS_TOASTER_PROPS), withoutOffset(STAFF_TOASTER_PROPS), "the /pos toaster is the staff toaster but for its offset");
  // The 92px clears what sits at the window's foot there: the 65px bar, and the sheet's 50px buttons over its 14px foot.
  assert.ok(92 > POS_ORDER_BAR_HEIGHT_PX, "92px clears the 65px order bar");
  assert.ok(92 > 14 + 50, "92px clears the sheet's Send KOT / Pay (50px tall, 14px above the foot: cartFootB)");
  assert.equal(POS_CART_COLUMN_MIN_PX, 80 * 16, "xl: (80rem) is where the cart column takes over on /pos");
  // U3 Task 5 (moved on purpose, design 6.8: "/pos only" → "/pos and /tables"): one element picks among three sets.
  const src = read("components/layout/AppToaster.tsx");
  assert.match(src, /import \{ isPosPath \} from "@\/lib\/pos-layout";/, "the route read through isPosPath");
  assert.match(src, /import \{ isFloorPath \} from "@\/lib\/floor-layout";/, "and through isFloorPath");
  assert.match(
    src,
    /return isPosPath\(pathname\) \? POS_TOASTER_PROPS : isFloorPath\(pathname\) \? FLOOR_TOASTER_PROPS : STAFF_TOASTER_PROPS;/,
    "the three-way choice: /pos, /tables, every other staff page",
  );
  assert.equal(count(src, "<Toaster {...toasterPropsFor(pathname)} />"), 1, "one Toaster element for all three (a navigation only changes its offset, no remount)");
  assert.equal(count(src, "<Toaster"), 2, "landmark: that element and the diner menu's");
});

// U3 Task 5 (design 6.8, U1 P49): on /tables the toasts sit at the staff offsets, each plus the bottom safe-area inset at
// every width (the page's foot and the strip respect it; no existing set did at every width). Every other staff page keeps
// the staff set (an app-wide fix is the owner's open shell item).
test("PIN: /tables gets the staff toaster with each offset plus the safe-area inset; /pos keeps its set, every other page the staff set", () => {
  assert.deepEqual(
    tokens(FLOOR_TOASTER_PROPS.className),
    [
      "toaster",
      "group",
      "bottom-[calc(140px+env(safe-area-inset-bottom))]!",
      "tab:bottom-[calc(92px+env(safe-area-inset-bottom))]!",
      "lg:bottom-[calc(24px+env(safe-area-inset-bottom))]!",
    ],
    "the staff offsets 140 / 92 / 24px at the same breakpoints, each plus the inset",
  );
  assert.deepEqual(withoutOffset(FLOOR_TOASTER_PROPS), withoutOffset(STAFF_TOASTER_PROPS), "the /tables toaster is the staff toaster but for its offset (one look)");
  assert.equal(toasterPropsFor("/tables"), FLOOR_TOASTER_PROPS, "/tables: the Floor's set");
  assert.equal(toasterPropsFor("/tables/"), FLOOR_TOASTER_PROPS, "/tables/: the Floor's set");
  assert.equal(toasterPropsFor("/pos"), POS_TOASTER_PROPS, "/pos keeps its own set (owner Q19, P49, P56)");
  for (const p of ["/", "/orders", "/tables/setup", "/tables/qr", "/customers", "/requests"]) {
    assert.equal(toasterPropsFor(p), STAFF_TOASTER_PROPS, `${p} keeps the staff set`);
  }
});

test("an error or a warning keeps the dark pill, its glyph in --bad / --warn so an alarm stands out", () => {
  const classNames = STAFF_TOASTER_PROPS.toastOptions?.classNames;
  assert.ok(tokens(classNames?.error).includes("[&_[data-icon]]:text-status-bad"), "an error's glyph is --bad");
  assert.ok(tokens(classNames?.warning).includes("[&_[data-icon]]:text-status-warn"), "a warning's glyph is --warn");
  for (const kind of ["error", "warning"] as const) {
    assert.ok(!tokens(classNames?.[kind]).some((c) => /^bg-/.test(c)), `${kind}: no fill of its own (the dark pill stays)`);
  }
  const icons = STAFF_TOASTER_PROPS.icons;
  assert.equal(icons?.success, null, "a success has no glyph (the HTML's toast)");
  assert.equal(icons?.info, null, "an info has no glyph");
  assert.ok(!("error" in (icons ?? {})) && !("warning" in (icons ?? {})), "error and warning keep sonner's glyph");
});
