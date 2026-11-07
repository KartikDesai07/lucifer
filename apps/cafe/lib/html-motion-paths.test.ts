import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { BRAND_NAV_PRESS_CLASS, BRAND_PRESS_CLASS, HTML_PRESS_CLASS } from "@/components/brand/brand-classes";
import { HEADER_ICON_BUTTON_CLASS, HEADER_OUTLINE_BUTTON_CLASS, HEADER_PRIMARY_BUTTON_CLASS } from "@/components/layout/header-classes";

// U0 match Task 5, fix round 1: the HTML's motion on the rebuilt shell and dashboard — its button feel (values 1.4) and
// (its pageIn fade was removed by owner D1, 2026-11-02).

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CAFE = path.join(HERE, "..");
const read = (rel: string) => stripComments(readFileSync(path.join(CAFE, rel), "utf8"));
const tokens = (s: string) => s.split(/\s+/).filter(Boolean);

test("HTML_PRESS_CLASS is the HTML's button feel: its transition list, and a press to scale(.97) when not disabled", () => {
  assert.equal(
    HTML_PRESS_CLASS,
    "transition-[background-color,border-color,color,box-shadow,transform,opacity] duration-[160ms,160ms,160ms,220ms,160ms,160ms] ease-[ease] motion-reduce:transition-none not-disabled:active:[transform:scale(.97)] motion-safe:active:scale-100",
    "background-color/border-color/color .16s, box-shadow .22s, transform/opacity .16s, ease; :not(:disabled):active scale(.97)",
  );
  for (const [name, cls] of [["BRAND_NAV_PRESS_CLASS", BRAND_NAV_PRESS_CLASS], ["BRAND_PRESS_CLASS", BRAND_PRESS_CLASS]] as const) {
    assert.ok(cls.endsWith(` ${HTML_PRESS_CLASS}`), `${name} (the nav, the tab bar, the sheets) is the HTML's press with its focus ring`);
    assert.ok(!cls.includes("active:scale-[0.97]"), `${name} drops the old scale-property press`);
  }
});

test("on the kit's Button the HTML's press replaces the kit's own (no transition-colors, no second scale)", () => {
  for (const [name, cls, variant] of [
    ["HEADER_OUTLINE_BUTTON_CLASS", HEADER_OUTLINE_BUTTON_CLASS, "outline"],
    ["HEADER_PRIMARY_BUTTON_CLASS", HEADER_PRIMARY_BUTTON_CLASS, "default"],
    ["HEADER_ICON_BUTTON_CLASS", HEADER_ICON_BUTTON_CLASS, "outline"],
  ] as const) {
    assert.ok(cls.endsWith(` ${HTML_PRESS_CLASS}`), `${name} carries the HTML's press`);
    const merged = tokens(cn(buttonVariants({ variant }), cls));
    assert.ok(!merged.includes("transition-colors"), `${name}: the kit's transition-colors gives way`);
    assert.ok(!merged.includes("motion-safe:active:scale-[0.97]"), `${name}: the kit's own press gives way`);
    for (const t of tokens(HTML_PRESS_CLASS)) assert.ok(merged.includes(t), `${name}: ${t} survives the merge`);
  }
  const printer = read("components/print/PrinterStatusButton.tsx");
  assert.ok(printer.includes("className={cn(PRINTER_ICON_BUTTON_CLASS, HTML_PRESS_CLASS)}"), "the printer button presses like the HTML's");
});

test("a page's own header actions press like the HTML's too ([data-header-actions] in app/globals.css)", () => {
  const css = readFileSync(path.join(CAFE, "app/globals.css"), "utf8");
  const rule = (selector: string) => {
    const at = css.indexOf(`${selector} {`);
    assert.ok(at >= 0, `landmark: ${selector}`);
    return css.slice(at, css.indexOf("}", at));
  };
  assert.match(
    rule("[data-header-actions] :is(button, a)").replace(/\s+/g, " "),
    /transition: background-color 0\.16s ease, border-color 0\.16s ease, color 0\.16s ease, box-shadow 0\.22s ease, transform 0\.16s ease, opacity 0\.16s ease;/,
    "the HTML's transition list",
  );
  const press = rule("[data-header-actions] :is(button, a):not(:disabled):active");
  assert.ok(press.includes("transform: scale(0.97);") && press.includes("scale: none;"), "the HTML's press, without the kit's second scale");
  assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\[data-header-actions\] :is\(button, a\) \{\s*transition: none;/, "no transition with reduced motion");
});

test("the rebuilt controls carry the press: tab bar and More, the sheets' rows and tiles, the attention and period controls", () => {
  const tabBar = read("components/layout/TabBar.tsx");
  assert.match(tabBar, /const TAB_CLASS = cn\([\s\S]*?BRAND_PRESS_CLASS[\s\S]*?\);/, "the tab bar's tabs and More");
  const sheet = read("components/layout/ProfileSheet.tsx");
  assert.match(sheet, /const TILE_CLASS = cn\([\s\S]*?BRAND_PRESS_CLASS[\s\S]*?\);/, "the More sheet's tiles");
  assert.match(sheet, /const ROW_CLASS = cn\([^;]*BRAND_PRESS_CLASS\);/, "the sheets' rows");
  const strip = read("components/dashboard/AttentionStrip.tsx");
  assert.equal((strip.match(/\bHTML_PRESS_CLASS\b/g) ?? []).length, 4, "AttentionStrip: the import, the chips, the rows and the toggle");
  assert.ok(read("components/dashboard/RangeBar.tsx").includes('button: "whitespace-nowrap rounded-[7px] px-3 text-[13px] " + HTML_PRESS_CLASS,'), "the period buttons");
});

test("owner D1 (2026-11-02): no page fade on a screen change — <main> holds only the page (in the tap's view, P2 N1)", () => {
  const layout = read("app/(dashboard)/layout.tsx");
  assert.match(
    layout,
    /<main className="flex-1 p-4 pb-\[92px\] tab:pb-4 md:p-6">\s*<NavProgressView>\s*\{children\}\s*<\/NavProgressView>\s*<\/main>/,
    "nothing but the page inside <main>, wrapped only by the tap's skeleton view",
  );
  const view = read("components/layout/NavProgressView.tsx");
  assert.ok(!/key=|animate-|transition|opacity/.test(view), "the tap's view adds no fade and keys nothing: the page stays mounted, no pageIn");
  assert.ok(!/key=/.test(layout), "nothing in the shell is keyed (the column, its header and the strip's sound unlock stay mounted)");
  assert.ok(!existsSync(path.join(CAFE, "components/layout/PageFade.tsx")), "PageFade is gone");
  const shell = read("lib/shell-layout.ts");
  assert.ok(!/PAGE_IN_KEYFRAMES|PAGE_IN_TIMING/.test(shell), "the pageIn constants are gone");
});
