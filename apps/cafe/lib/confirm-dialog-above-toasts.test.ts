// F12 (P2 follow-ups): the Refresh question ("Printing is taking long": Wait / Refresh anyway) must stay tappable while the
// lasting "KOT ... has not printed yet" toast is up. Sonner's toaster sits at a far higher z-index than Radix dialogs, so the
// shared ConfirmDialog takes an optional `aboveToasts` that lifts its content above it; the default stays z-50 for every
// other dialog. Raw source pins (no React test framework here), plus the real class merge.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { cn } from "@/lib/utils";
import { stripComments } from "@/lib/source-pin-utils";

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const readSrc = (rel: string): string => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8"));

/** Sonner's own toaster z-index, read from its shipped stylesheet (the first literal one: the `[data-sonner-toaster]` rule). */
function sonnerToasterZ(): number {
  const css = readFileSync(fileURLToPath(new URL("../../../node_modules/sonner/dist/styles.css", import.meta.url)), "utf8");
  const m = css.match(/\[data-sonner-toaster\][^{]*\{[^}]*?z-index:\s*(\d+)/);
  assert.ok(m, "sonner's styles.css must still give the toaster a literal z-index");
  return Number(m![1]);
}

const ABOVE = (): string => {
  const m = readSrc("components/shared/ConfirmDialog.tsx").match(/const ABOVE_TOASTS_CLASS = "(z-\[(\d+)\])";/);
  assert.ok(m, "ConfirmDialog.tsx must declare ABOVE_TOASTS_CLASS as one plain z-[n] utility");
  return m![2];
};

test("the aboveToasts class is a plain z-index above sonner's toaster", () => {
  assert.ok(Number(ABOVE()) > sonnerToasterZ(), "the dialog content must sit above sonner's toaster z-index");
});

test("with the class the default z-50 is merged away, without it z-50 stays", () => {
  const base = readSrc("components/ui/alert-dialog.tsx");
  assert.match(base, /fixed left-\[50%\] top-\[50%\] z-50 /, "the default dialog content keeps z-50");
  const merged = cn("fixed z-50 grid", `z-[${ABOVE()}]`);
  assert.ok(!/\bz-50\b/.test(merged) && merged.includes(`z-[${ABOVE()}]`), "the lifted class must replace z-50, not sit beside it");
});

test("ConfirmDialog applies the class to the default look's content only when aboveToasts is set", () => {
  const src = readSrc("components/shared/ConfirmDialog.tsx");
  assert.match(src, /aboveToasts\?: boolean;/, "the optional prop");
  assert.match(src, /aboveToasts = false,/, "default false: every other dialog is unchanged");
  assert.match(src, /<AlertDialogContent className=\{cn\(aboveToasts && ABOVE_TOASTS_CLASS\)\}>/, "only the content takes the class, and only when asked");
});

test("the ask-first reload hook's dialog sets aboveToasts for both its questions", () => {
  const src = readSrc("hooks/use-ask-first-reload.ts");
  assert.match(src, /dialog: \{\s*open: asking !== null,\s*aboveToasts: true,/, "the one dialog object (print question and unsent-work question) lifts above toasts");
});
