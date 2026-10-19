import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { DEFAULT_APPEARANCE, appearanceCssVars } from "@pos/shared/appearance";
import { stripComments } from "@/lib/source-pin-utils";

// Task 4 of the new look: the kit's controls (spec 4.5 and 4.7), and the
// preset-token rule (spec 3.6): kit files, and every file the diner menu
// reaches, name only colour tokens the cafe's Appearance preset sets, so the
// diner menu takes the new shapes in the cafe's own colours.

const CAFE_ROOT = fileURLToPath(new URL("../", import.meta.url));
const read = (rel: string): string => stripComments(readFileSync(path.join(CAFE_ROOT, rel), "utf8"));

const PRESET_TOKENS = new Set(
  Object.keys(appearanceCssVars(DEFAULT_APPEARANCE, "light"))
    .filter((k) => !k.endsWith("-rgb"))
    .map((k) => k.replace(/^--/, "")),
);
const ALWAYS_OK = new Set(["black", "white", "transparent", "current", "inherit"]);

// Every colour name the app's own @theme declares (staff-only ones are the
// names outside PRESET_TOKENS), so a staff-only token cannot slip into a kit file.
const THEME_COLOURS = new Set(
  [...readFileSync(path.join(CAFE_ROOT, "app/globals.css"), "utf8").matchAll(/^\s*--color-([a-z0-9-]+)\s*:/gm)].map(
    (m) => m[1],
  ),
);
const PALETTE = /^(slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)-\d+$/;

const UTILITY =
  /(?<=^|[\s"'`:])(?:bg|text|border|ring|ring-offset|outline|fill|stroke|placeholder|divide|decoration|caret|accent|shadow)-([a-z][a-z0-9-]*)(?:\/\d+)?(?=$|[\s"'`])/g;

function colourNamesIn(src: string): { cls: string; name: string }[] {
  const out: { cls: string; name: string }[] = [];
  for (const m of src.matchAll(UTILITY)) {
    const name = m[1];
    if (THEME_COLOURS.has(name) || PALETTE.test(name) || PRESET_TOKENS.has(name) || ALWAYS_OK.has(name)) {
      out.push({ cls: m[0], name });
    }
  }
  return out;
}

function walk(dirAbs: string, out: string[]): void {
  for (const entry of readdirSync(dirAbs)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const abs = path.join(dirAbs, entry);
    if (statSync(abs).isDirectory()) walk(abs, out);
    else if (/\.tsx?$/.test(entry) && !/\.test\./.test(entry)) out.push(abs);
  }
}

function resolveKit(spec: string): string | null {
  const rel = `components/${spec}.tsx`;
  return existsSync(path.join(CAFE_ROOT, rel)) ? rel : null;
}

function dinerKitFiles(): string[] {
  const roots: string[] = [];
  walk(path.join(CAFE_ROOT, "app/m"), roots);
  walk(path.join(CAFE_ROOT, "components/public"), roots);
  const found = new Set<string>();
  const queue: string[] = [];
  const scan = (src: string, onlyUi: boolean) => {
    const re = onlyUi
      ? /from\s+"@\/components\/(ui\/[A-Za-z0-9-]+)"/g
      : /from\s+"@\/components\/((?:ui|shared)\/[A-Za-z0-9-]+)"/g;
    for (const m of src.matchAll(re)) {
      const rel = resolveKit(m[1]);
      if (rel && !found.has(rel)) {
        found.add(rel);
        queue.push(rel);
      }
    }
  };
  for (const f of roots) scan(readFileSync(f, "utf8"), false);
  while (queue.length) scan(readFileSync(path.join(CAFE_ROOT, queue.pop()!), "utf8"), true);
  return [...found].sort();
}

test("the diner menu reaches the kit files we expect (the rule below is not vacuous)", () => {
  const files = dinerKitFiles();
  for (const f of ["button", "skeleton", "input", "label", "checkbox", "badge"]) {
    assert.ok(files.includes(`components/ui/${f}.tsx`), `the diner menu should reach components/ui/${f}.tsx; got ${files.join(", ")}`);
  }
  assert.ok(files.includes("components/shared/EmptyState.tsx"), "the diner menu should reach shared/EmptyState");
});

test("preset-token rule: kit files the diner menu reaches use only preset-set colour tokens", () => {
  for (const rel of dinerKitFiles()) {
    for (const { cls, name } of colourNamesIn(read(rel))) {
      assert.ok(
        PRESET_TOKENS.has(name) || ALWAYS_OK.has(name),
        `${rel}: class "${cls}" names "${name}", which the diner preset does not set`,
      );
    }
  }
});

test("no staff-only colour token in any kit file (sidebar may use sidebar-*)", () => {
  const files: string[] = [];
  walk(path.join(CAFE_ROOT, "components/ui"), files);
  // U0 Task 4 (ruling R8): the owner's HTML names Task 1 added for the staff screens are staff-only too (the toast set,
  // the nav set, the segmented control, glass, link, the extra surfaces and rule, hover, the accent border, the scrim).
  const staffOnly =
    /^(status-|brand-|ink$|on-ink$|subtle-foreground$|primary-hover$|toast(-|$)|nav(-|$)|seg$|glass$|link$|surface-[23]$|border-2$|hover$|accent-b$|scrim$)/;
  for (const name of ["toast", "toast-t", "toast-a", "nav", "nav-t2", "nav-on", "seg", "glass", "link", "surface-2", "border-2", "hover", "accent-b", "scrim"]) {
    assert.ok(staffOnly.test(name), `vision guard: ${name} is a staff-only name`);
  }
  for (const name of ["primary", "accent", "accent-foreground", "border", "card", "muted-foreground", "background"]) {
    assert.ok(!staffOnly.test(name), `vision guard: ${name} is a preset name, allowed in the kit`);
  }
  for (const abs of files) {
    const rel = path.relative(CAFE_ROOT, abs).replace(/\\/g, "/");
    const src = stripComments(readFileSync(abs, "utf8"));
    for (const { cls, name } of colourNamesIn(src)) {
      assert.ok(!staffOnly.test(name), `${rel}: class "${cls}" is a staff-only token`);
      if (!rel.endsWith("/sidebar.tsx")) {
        assert.ok(!name.startsWith("sidebar-"), `${rel}: class "${cls}" is a sidebar token outside sidebar.tsx`);
      }
    }
  }
});

test("the look: button", () => {
  const src = read("components/ui/button.tsx");
  const base = src.match(/cva\(\s*"([^"]*)"/)?.[1] ?? "";
  assert.match(base, /\brounded-md\b/, "button base is rounded-md");
  for (const c of ["focus-visible:ring-2", "focus-visible:ring-ring", "focus-visible:ring-offset-2"]) {
    assert.ok(base.split(/\s+/).includes(c), `button base has ${c}`);
  }
  const variant = (name: string): string => src.match(new RegExp(`\\b${name}:\\s*\\n?\\s*"([^"]*)"`))?.[1] ?? "";
  for (const v of ["default", "outline", "secondary", "destructive"]) {
    assert.ok(!/(^|\s)shadow(-[a-z]+)?(\s|$)/.test(variant(v)), `button ${v} has no shadow: "${variant(v)}"`);
  }
  assert.equal(
    variant("outline"),
    "border border-border bg-card text-foreground hover:bg-muted",
    "button outline is the white, 1px border, ink text look",
  );
  assert.match(src, /default:\s*"h-9 px-4/, "default size h-9 px-4");
  assert.match(src, /sm:\s*"h-8[^"]*px-3 text-xs/, "sm size h-8 px-3 text-xs");
  assert.match(src, /lg:\s*"h-10[^"]*px-8/, "lg size h-10 px-8");
  assert.match(src, /icon:\s*"h-9 w-9"/, "icon size h-9 w-9");
});

test("the look: input, card, badge, switch, skeleton, table", () => {
  const input = read("components/ui/input.tsx");
  assert.equal(input.match(/\bh-(\d+)\b/)?.[1], "9", "input's first h-N stays h-9 (pos-layout-paths)");
  assert.match(input, /\bborder-input\b/, "input has the field edge");
  assert.match(input, /\bbg-card\b/, "input is white (bg-card)");
  assert.match(input, /focus-visible:border-ring/, "input focus border is the ring colour");

  const card = read("components/ui/card.tsx");
  assert.match(card, /"rounded-xl border border-border bg-card /, "card is rounded-xl border border-border bg-card");
  assert.ok(!/\bshadow\b/.test(card), "card is flat (no shadow)");

  const badge = read("components/ui/badge.tsx");
  const badgeBase = badge.match(/cva\(\s*"([^"]*)"/)?.[1] ?? "";
  assert.ok(badgeBase.split(/\s+/).includes("rounded-full"), "badge base is a pill");
  // U0 verification (axe, 2026-10-17): text-primary on bg-primary/10 measured 4.33:1 on a card and 3.96:1 on the page,
  // and text-destructive on bg-destructive/10 3.90:1, under WCAG 1.4.3's 4.5:1.
  const variant = (name: string) => badge.match(new RegExp(`\\b${name}:\\s*"([^"]*)"`))?.[1]?.split(/\s+/) ?? [];
  for (const cls of ["bg-accent", "text-accent-foreground"]) {
    assert.ok(variant("default").includes(cls), `badge default is the accent pair (blue tint, blue ink, 7.1:1): ${cls}`);
  }
  for (const cls of ["bg-destructive", "text-destructive-foreground"]) {
    assert.ok(variant("destructive").includes(cls), `badge destructive is the solid pair (white on red, 5.0:1): ${cls}`);
  }
  assert.ok(
    !/\b(?:bg-primary|bg-destructive)\/\d+/.test(badge.slice(badge.indexOf("variants:"))),
    "no badge variant puts coloured text on its own colour's light wash",
  );

  const sw = read("components/ui/switch.tsx");
  assert.match(sw, /data-\[state=checked\]:bg-primary/, "switch on is primary");
  assert.match(sw, /data-\[state=unchecked\]:bg-input/, "switch off is the input grey");

  assert.match(read("components/ui/skeleton.tsx"), /\bbg-muted\b/, "skeleton is bg-muted");

  const table = read("components/ui/table.tsx");
  const head = table.slice(table.indexOf("const TableHead"), table.indexOf("const TableCell"));
  assert.match(head, /\btext-muted-foreground\b/, "table header cells are muted");
});

test("the look: tabs (segmented and underline variants)", () => {
  const tabs = read("components/ui/tabs.tsx");
  assert.match(tabs, /\bbg-muted rounded-lg p-1\b|\brounded-lg bg-muted p-1\b/, "segmented list is bg-muted rounded-lg p-1");
  assert.match(tabs, /data-\[state=active\]:bg-card/, "active segment is white (bg-card)");
  assert.match(tabs, /data-\[state=active\]:shadow-sm/, "active segment has the small lift");
  assert.equal((tabs.match(/\bunderline:/g) ?? []).length, 2, "underline variant exists in both cva maps (list and trigger)");
  assert.match(tabs, /variant\?:|VariantProps/, "TabsList and TabsTrigger take a variant prop");
  assert.match(tabs, /bg-primary/, "underline bar is bg-primary");
});

test("the look: dialog, alert-dialog, sheet, drawer, menus, tooltip, toast", () => {
  for (const f of ["dialog", "alert-dialog", "sheet"]) {
    const src = read(`components/ui/${f}.tsx`);
    assert.match(src, /\bshadow-pop\b/, `${f} content carries shadow-pop`);
    assert.match(src, /\bbg-black\/40\b/, `${f} overlay is bg-black/40`);
    assert.ok(!/\bbg-black\/80\b/.test(src), `${f} has no bg-black/80 scrim`);
  }
  assert.match(read("components/ui/drawer.tsx"), /\bbg-black\/40\b/, "drawer overlay is bg-black/40");
  assert.match(read("components/ui/dialog.tsx"), /\brounded-2xl\b/, "dialog content is rounded-2xl");
  for (const f of ["dropdown-menu", "popover"]) {
    const src = read(`components/ui/${f}.tsx`);
    assert.match(src, /\brounded-xl\b[^"]*\bshadow-pop\b/, `${f} content is rounded-xl ... shadow-pop`);
  }
  assert.match(read("components/ui/tooltip.tsx"), /\bbg-foreground text-background\b/, "tooltip is dark");
  // The kit toast keeps the preset-driven look (the diner menu's toasts follow the cafe's Appearance); the staff
  // screens' HTML toast lives outside the kit (components/layout/AppToaster.tsx, U0 Task 4 ruling R8).
  const sonner = read("components/ui/sonner.tsx");
  assert.match(
    sonner,
    /group-\[\.toaster\]:bg-foreground group-\[\.toaster\]:text-background/,
    "sonner toast is dark (bg-foreground text-background)",
  );
  const toastClass = sonner.match(/\btoast:\s*"([^"]*)"/)?.[1] ?? "";
  assert.ok(toastClass.length > 0 && !/\bbg-background\b/.test(toastClass), "sonner toast class has no bg-background");
});

test("the look: sonner cancel button reads on the dark toast", () => {
  const sonner = read("components/ui/sonner.tsx");
  const cancel = sonner.match(/cancelButton:\s*"([^"]*)"/)?.[1] ?? "";
  assert.ok(cancel.length > 0, "sonner has a cancelButton class");
  assert.ok(
    !(/\bbg-muted\b/.test(cancel) && /text-background/.test(cancel)),
    `cancel button must not pair bg-muted with text-background (light on light): "${cancel}"`,
  );
});

test("the dialog, alert dialog, sheet and drawer panels are white (bg-card on the page's grey), as in the mock-up", () => {
  for (const f of ["dialog", "alert-dialog", "sheet", "drawer"]) {
    const s = read(`components/ui/${f}.tsx`);
    assert.ok(/\bbg-card\b/.test(s), `${f}.tsx panel is bg-card (the mock-up's panels are --surface, white, on --bg grey)`);
    assert.ok(!/\bbg-background\b/.test(s), `${f}.tsx no longer paints its panel bg-background`);
  }
});
