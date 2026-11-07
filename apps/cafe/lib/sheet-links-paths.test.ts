// Ruling R34 (P2 N1): a link inside a sheet or dialog closes its sheet when it opens its page in this tab. A sheet
// left open would cover the next screen's skeleton, its 2px line and the "Still opening…" escape with its scrim, so the
// tap would look dead. Each link's own click work runs first; a modifier click (a new tab) leaves the sheet open.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import type { MouseEvent } from "react";

import { stripComments } from "@/lib/source-pin-utils";

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const code = (rel: string): string => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8"));
/** Each <AppLink …>…</AppLink> element of a file, as text (they never nest). */
const appLinks = (src: string): string[] => src.match(/<AppLink\b[\s\S]*?<\/AppLink>/g) ?? [];

// ── The helper ───────────────────────────────────────────────────────────────

type Click = Pick<MouseEvent<HTMLAnchorElement>, "button" | "metaKey" | "ctrlKey" | "shiftKey" | "altKey" | "defaultPrevented">;
const click = (over: Partial<Click> = {}): MouseEvent<HTMLAnchorElement> =>
  ({ button: 0, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, defaultPrevented: false, ...over }) as MouseEvent<HTMLAnchorElement>;

test("closeOnPlainClick closes on a plain click only (the page opens in this tab)", async () => {
  const { closeOnPlainClick } = await import("@/components/layout/AppLink");
  let closed = 0;
  const close = () => {
    closed++;
  };
  closeOnPlainClick(click(), close);
  assert.equal(closed, 1, "a plain main-button click closes the sheet");
  for (const over of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }, { defaultPrevented: true }]) {
    closeOnPlainClick(click(over), close);
    assert.equal(closed, 1, `no close for ${JSON.stringify(over)} (a new tab, or no navigation at all)`);
  }
  assert.doesNotThrow(() => closeOnPlainClick(click(), undefined), "no close given (a column, not a sheet): nothing happens");
});

// ── The sites ────────────────────────────────────────────────────────────────

test("PIN: Edit items (order detail) offers the table first, then closes the sheet (never the /orders column)", () => {
  const link = appLinks(code("components/orders/OrderDetailSheet.tsx")).find((l) => l.includes('data-ui="order-detail-edit"')) ?? "";
  assert.ok(link.length > 0, "landmark: the Edit items link");
  assert.match(
    link,
    /offerPosTable\(editTable, Date\.now\(\)\);\s*closeOnPlainClick\(e, frame === "column" \? undefined : \(\) => onOpenChange\(false\)\);/,
    "the POS hand-off is written first (session store), then the side / bottom sheet closes",
  );
});

test("PIN: the reports' day and hour sheets close when their order links open /orders", () => {
  for (const rel of ["components/reports/DaySheet.tsx", "components/reports/CancelDaySheet.tsx", "components/reports/HourSheet.tsx"]) {
    const links = appLinks(code(rel));
    assert.equal(links.length, 1, `landmark: ${rel} has its one order link`);
    assert.match(links[0], /onClick=\{\(e\) => closeOnPlainClick\(e, \(\) => onOpenChange\(false\)\)\}/, `${rel}: the link closes its sheet`);
  }
});

test("PIN: the category delete dialog's View link closes the dialog", () => {
  const links = appLinks(code("components/menu/CategoryDeleteDialog.tsx"));
  assert.equal(links.length, 1, "landmark: the View link");
  assert.match(links[0], /onClick=\{\(e\) => closeOnPlainClick\(e, onClose\)\}/, "the link closes the dialog");
});

test("PIN: a booking's Open order offers the table first, then closes the bottom sheet (never the column)", () => {
  const src = code("components/reservations/ReservationDetail.tsx");
  const link = appLinks(src).find((l) => l.includes('data-ui="reservation-detail-primary"')) ?? "";
  assert.match(link, /offerOnPlainClick\(e, tableNo\);\s*closeOnPlainClick\(e, onClose\);/, "hand-off first, then the close");
  assert.match(src, /<Primary [^>]*onClose=\{sheet \? onClose : undefined\} \/>/, "only the sheet closes; the 1280px column stays");
});

test("INVENTORY: every link in a file that draws a sheet or dialog closes it on navigation", () => {
  const files: string[] = [];
  const walk = (rel: string) => {
    for (const name of readdirSync(path.join(CAFE_ROOT, rel))) {
      const child = `${rel}/${name}`;
      if (statSync(path.join(CAFE_ROOT, child)).isDirectory()) walk(child);
      else if (name.endsWith(".tsx")) files.push(child);
    }
  };
  for (const dir of ["app", "components"]) walk(dir);
  const sheetFiles = files.filter((rel) => {
    if (rel.startsWith("app/m/") || rel.startsWith("components/public/") || rel === "components/layout/AppLink.tsx") return false;
    const src = code(rel);
    return /<AppLink\b/.test(src) && /<SheetContent\b|<DialogContent\b|DialogPrimitive\.(Content|Root)\b|<AlertDialog(Primitive\.Root|Content)?\b/.test(src);
  });
  assert.ok(sheetFiles.includes("components/orders/OrderDetailSheet.tsx"), `landmark: the scan finds the sheets (${sheetFiles.join(", ")})`);
  for (const rel of sheetFiles) {
    for (const link of appLinks(code(rel))) {
      assert.ok(
        /closeOnPlainClick\(/.test(link) || /onClick=\{onNavigate\}/.test(link),
        `${rel}: a link inside a sheet must close it when it navigates: ${link.slice(0, 80)}`,
      );
    }
  }
});
