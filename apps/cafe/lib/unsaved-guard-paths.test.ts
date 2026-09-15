// Owner report 2026-09-06: closing the browser tab/window mid-order discarded
// work with no warning. These pins hold the beforeunload guard in place — its
// shape (armed on `dirty` only, cleaned up), and that the POS page actually
// wires it to the real dirty signals (a hook with no reachable, correct call
// site is the "feature still dead" class this repo keeps re-learning).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

const GUARD = "apps/cafe/hooks/use-unsaved-guard.ts";
const POS_PAGE = "apps/cafe/app/(dashboard)/pos/page.tsx";
const POS_TAB = "apps/cafe/hooks/use-pos-tab.ts";

test("PIN: useUnsavedGuard arms the beforeunload prompt ONLY while dirty and removes the listener on cleanup", () => {
  const src = stripComments(readSrc(GUARD));
  assert.match(src, /export function useUnsavedGuard\(dirty: boolean\)/, "must export useUnsavedGuard(dirty: boolean)");
  // The early return is what keeps an empty screen from ever nagging.
  assert.match(src, /if \(!dirty\) return;/, "the effect must no-op when not dirty (empty screen never prompts)");
  assert.match(src, /addEventListener\("beforeunload"/, "must add a beforeunload listener when dirty");
  assert.match(src, /return \(\) => window\.removeEventListener\("beforeunload"/, "must remove the listener on cleanup / when dirty clears");
  assert.match(src, /e\.preventDefault\(\)/, "must call preventDefault so the browser shows its leave prompt");
  // The dep array is [dirty] — arm/disarm exactly when the dirty state flips.
  assert.match(src, /\}, \[dirty\]\);/, "the effect deps must be exactly [dirty]");
});

test("PIN: pos/page.tsx wires useUnsavedGuard to pos.dirty, and usePosTab derives dirty from the real lose-work signals — reachability", () => {
  const page = stripComments(readSrc(POS_PAGE));
  assert.match(
    page,
    /import \{ useUnsavedGuard \} from "@\/hooks\/use-unsaved-guard";/,
    "pos/page.tsx must import useUnsavedGuard",
  );
  assert.match(page, /useUnsavedGuard\(pos\.dirty\);/, "pos/page.tsx must arm the guard on pos.dirty");
  // `dirty` is derived in the hook (keeping the page under its pinned line
  // count), so pin the derivation there — the two states that lose work on a
  // browser close: unsent cart items OR a resumed open tab mid-edit.
  const tab = stripComments(readSrc(POS_TAB));
  assert.match(
    tab,
    /const dirty = newCount > 0 \|\| resumedOrder !== null;/,
    "use-pos-tab.ts must derive dirty = newCount > 0 || resumedOrder !== null",
  );
  assert.match(tab, /^\s*dirty,\s*$/m, "use-pos-tab.ts must expose dirty on its return object");
});
