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
import { STAFF_TOASTER_PROPS, isDinerRoute } from "@/components/layout/AppToaster";

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (rel: string): string => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8"));
const count = (src: string, needle: string): number => src.split(needle).length - 1;
const tokens = (cls: string | undefined): string[] => (cls ?? "").split(/\s+/).filter(Boolean);

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
