// The dark sidebar (owner's mock-up, 2026-10-16): the row, heading and account
// styles are source-pinned here, so a restyle cannot quietly drop the active
// bar, the touch height or the readable text colours. The contrast of the
// tokens themselves is measured in lib/brand-contrast.test.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");

const CLASSES = read("components/brand/brand-classes.ts");
const BRAND = read("components/layout/SidebarBrand.tsx");
const TILE = read("components/layout/BrandTile.tsx");
const TITLE = read("components/layout/HeaderTitle.tsx");
const SIDEBAR = read("components/layout/AppSidebar.tsx");
const ACCOUNT = read("components/layout/SidebarAccount.tsx");
const HEADER = read("components/layout/Header.tsx");
const TABS = read("components/layout/HeaderQuickTabs.tsx");
const BAND = read("components/orders/RequestAlertBar.tsx");
const PRINTER = read("components/print/PrinterStatusButton.tsx");

function literal(name: string): string {
  const m = CLASSES.match(new RegExp(`export const ${name} =\\s*"([^"]*)"`));
  assert.ok(m, `${name} must be one string literal`);
  return m![1];
}

// U0 Task 2: the owner's HTML nav (values 2.3), the same sizes on touch screens (plan ruling R1). The old 32px rows
// (kept so 17 rows fit 768px) give way to the HTML's 38px rows; the nav's middle scrolls instead.
test("a nav row is the HTML's: nav-t text, white on nav-on when hovered or active, 8px radius, 60x52 in the rail and 38px wide", () => {
  const all = `${CLASSES.match(/const NAV_ACTIVE =\s*"([^"]*)"/)?.[1] ?? ""} ${literal("BRAND_NAV_ITEM_CLASS")}`;
  const tokens = all.split(/\s+/);
  for (const needle of [
    "text-nav-t",
    "hover:bg-nav-on",
    "hover:text-white",
    "data-[active=true]:bg-nav-on",
    "data-[active=true]:text-white",
    "rounded-[8px]",
    "font-medium",
    "flex-col",
    "gap-1",
    "pt-2",
    "pb-1.5",
    "text-[10.5px]",
    "wide:flex-row",
    "wide:gap-2.5",
    "wide:px-2.5",
    "wide:min-h-[38px]",
    "wide:text-[13.5px]",
  ]) {
    assert.ok(tokens.includes(needle), `the nav row classes must carry the exact token ${needle}`);
  }
  assert.ok(!tokens.some((t) => t.startsWith("pointer-coarse:")), "no touch enlargement: the HTML's sizes on touch screens too (ruling R1)");
  const bar = literal("BRAND_NAV_BAR_CLASS").split(/\s+/);
  for (const needle of ["w-[3px]", "top-[9px]", "bottom-[9px]", "rounded-r-[3px]", "bg-brand-accent", "-left-2", "wide:-left-2.5", "group-data-[active=true]/item:opacity-100"]) {
    assert.ok(bar.includes(needle), `the active bar must carry the exact token ${needle}`);
  }
});

test("the group heading is the HTML's 11px uppercase nav-t2 label, shown in the wide form only", () => {
  const label = literal("BRAND_NAV_LABEL_CLASS");
  for (const needle of ["hidden", "wide:block", "uppercase", "text-[11px]", "font-semibold", "tracking-[0.06em]", "text-nav-t2", "pt-3.5", "pb-1.5", "px-2.5"]) {
    assert.ok(label.split(/\s+/).includes(needle), `BRAND_NAV_LABEL_CLASS must carry the exact token ${needle}`);
  }
});

// Fix round 1: the nav's brand tile and the phone header's mini logo are one component (BrandTile, size nav / mini).
test("the brand tile has no multiply blend (it misrenders on dark) and puts the logo on a white tile; the nav uses it", () => {
  for (const [name, src] of [["SidebarBrand", BRAND], ["BrandTile", TILE]] as const) {
    assert.ok(!src.includes("mix-blend-multiply"), `mix-blend-multiply must be gone from ${name}`);
  }
  assert.match(TILE, /bg-white/, "the logo must sit on a white tile");
  assert.match(BRAND, /<BrandTile\b[^>]*size="nav"/, "the nav's brand block draws the 34px tile");
});

test("the nav's scroller carries the HTML's 8px scrollbar (values 1.4)", () => {
  const scroll = literal("BRAND_NAV_SCROLL_CLASS").split(/\s+/);
  for (const needle of ["overflow-y-auto", "[&::-webkit-scrollbar]:w-2", "[&::-webkit-scrollbar-thumb]:rounded-[8px]", "[&::-webkit-scrollbar-thumb]:bg-border"]) {
    assert.ok(scroll.includes(needle), `BRAND_NAV_SCROLL_CLASS must carry the exact token ${needle}`);
  }
  assert.match(SIDEBAR, /className=\{BRAND_NAV_SCROLL_CLASS\}/, "AppSidebar's groups sit in that scroller");
});

test("the active nav row keeps the HTML's weight 500: NAV_ACTIVE sets no font weight", () => {
  const active = CLASSES.match(/const NAV_ACTIVE =\s*"([^"]*)"/)?.[1] ?? "";
  assert.ok(active.length > 0, "landmark: NAV_ACTIVE was read");
  assert.ok(!/font-(medium|semibold|bold)/.test(active), "NAV_ACTIVE must not change the weight (the HTML's active row is 500)");
});

// U0 Task 3 (values 2.5): the HTML's page header. 56px tall at least, white, a 1px border-colour rule under it,
// sticky at z-index 3, padding 0 20px (0 12px on a phone), 10px between its items, line-height normal; the title
// 15px/600 at 1.2, the subtitle 12px text-2 cut with an ellipsis; the same sizes on touch (ruling R1).
test("the page header is the HTML's: a sticky white 56px bar with a bottom rule, padding 0 20px / 0 12px, gap 10px", () => {
  const tokens = HEADER.match(/<header className="([^"]*)"/)?.[1].split(/\s+/) ?? [];
  for (const needle of ["sticky", "top-0", "z-[3]", "flex", "min-h-14", "items-center", "gap-2.5", "border-b", "border-border", "bg-card", "px-3", "tab:px-5", "leading-[normal]"]) {
    assert.ok(tokens.includes(needle), `the header tag must carry ${needle}`);
  }
  assert.ok(!tokens.some((t) => /bg-background|pointer-coarse:/.test(t)), "not the page colour, and no touch enlargement");
  const title = TITLE.match(/<h1 data-ui="header-title" className="([^"]*)"/)?.[1].split(/\s+/) ?? [];
  for (const needle of ["text-[15px]", "font-semibold", "leading-[1.2]"]) assert.ok(title.includes(needle), `the title carries ${needle}`);
  const sub = TITLE.match(/<p data-ui="header-subtitle" className="([^"]*)"/)?.[1].split(/\s+/) ?? [];
  for (const needle of ["text-[12px]", "text-muted-foreground", "truncate"]) assert.ok(sub.includes(needle), `the subtitle carries ${needle}`);
  assert.match(HEADER, /<BrandTile\b[^>]*size="mini"[^>]*dataUi="header-mini-logo"[^>]*className="tab:hidden"/, "the phone's mini logo is the brand tile at its mini size");
  const literal = (name: string): string[] => TILE.match(new RegExp(`const ${name} =\\s*"([^"]*)"`))?.[1].split(/\s+/) ?? [];
  assert.match(TILE, /mini: \{ px: 30, box: "size-\[30px\] rounded-\[8px\]" \}/, "mini: the HTML's 30px tile, radius 8 (values 2.5)");
  assert.match(TILE, /nav: \{ px: 34, box: "size-\[34px\] rounded-\[9px\]" \}/, "nav: the HTML's 34px tile, radius 9 (values 2.3)");
  for (const needle of ["bg-brand-red", "font-brand-script", "text-[19px]", "pt-0.5", "text-white"]) {
    assert.ok(literal("LETTER_CLASS").includes(needle), `the letter tile carries ${needle}`);
  }
});

// Fix round 1 (ruling R6): a page's own actions, in the header or in its row on a phone, take the HTML's header
// buttons whatever classes the page gives them. Unlayered CSS (it outranks every utility, the touch sizes included:
// ruling R1). Outline: 36px, radius 8, 1px border, surface, 13.5/500, a 15px icon 7px away, padding 0 12px; filled:
// 13.5/600, a 14px icon 6px away, padding 0 14px, hover accent-h; an icon-only square 36x36.
test("a page's actions take the header buttons' look: 36px, radius 8, 13.5px, outline or filled, icon-only 36x36", () => {
  const css = read("app/globals.css");
  const rule = (selector: string): string => {
    const at = css.indexOf(`${selector} {`);
    assert.ok(at >= 0, `globals.css has the rule ${selector}`);
    return css.slice(at, css.indexOf("}", at));
  };
  const base = rule("[data-header-actions] :is(button, a)");
  for (const decl of ["height: 36px;", "min-height: 36px;", "border-radius: 8px;", "padding: 0 12px;", "gap: 7px;", "font-size: 13.5px;", "font-weight: 500;", "line-height: normal;", "letter-spacing: normal;"]) {
    assert.ok(base.includes(decl), `every page action: ${decl}`);
  }
  assert.ok(rule("[data-header-actions] :is(button, a) svg").includes("width: 15px;"), "a 15px icon");
  const outline = rule('[data-header-actions] :is(button, a)[class~="border"]');
  for (const decl of ["border: 1px solid var(--border);", "background-color: var(--card);", "color: var(--foreground);"]) {
    assert.ok(outline.includes(decl), `an outline action: ${decl}`);
  }
  assert.ok(rule('[data-header-actions] :is(button, a)[class~="border"]:hover').includes("background-color: var(--hover);"), "outline hover --hover");
  // Final review m2: the filled look is keyed on the primary fill itself (the kit's bg-primary, or the brand button's
  // bg-brand-primary, the same colour), never on a missing border.
  const FILLED = '[data-header-actions] :is(button, a):is([class~="bg-primary"], [class~="bg-brand-primary"])';
  const filled = rule(FILLED);
  for (const decl of ["padding: 0 14px;", "gap: 6px;", "font-weight: 600;"]) assert.ok(filled.includes(decl), `a filled action: ${decl}`);
  assert.ok(rule(`${FILLED}:hover`).includes("background-color: var(--primary-hover);"), "filled hover accent-h");
  assert.ok(rule(`${FILLED} svg`).includes("width: 14px;"), "a 14px icon on a filled action");
  assert.ok(/\[class~="size-10"\][^{]*\{[^}]*width: 36px;/.test(css), "an icon-only action is a 36px square");
  const before = css.slice(0, css.indexOf("[data-header-actions] :is(button, a) {"));
  // Top level (brace depth 0), not inside an @layer: unlayered CSS outranks every layered utility.
  assert.equal((before.match(/\{/g) ?? []).length - (before.match(/\}/g) ?? []).length, 0, "the rules sit at the top level, unlayered");
});

// ── which [data-header-actions] rules a control gets, from its classes (final review m2) ─────────────────────────────

const ACTION_PREFIX = "[data-header-actions] :is(button, a)";

/** Whether a compound selector of [class~="…"], :is(…), :not(…) and state pseudo-classes matches an enabled control
 *  with these classes, hovered and pressed (so a :hover or :active rule counts as applying in that state). */
function matchesCompound(sel: string, classes: ReadonlySet<string>): boolean {
  let i = 0;
  while (i < sel.length) {
    const rest = sel.slice(i);
    const cls = /^\[class~="([^"]+)"\]/.exec(rest);
    if (cls) {
      if (!classes.has(cls[1])) return false;
      i += cls[0].length;
      continue;
    }
    const fn = /^:(not|is)\(/.exec(rest);
    if (fn) {
      let depth = 1;
      let end = i + fn[0].length;
      for (; depth > 0; end++) depth += sel[end] === "(" ? 1 : sel[end] === ")" ? -1 : 0;
      const inner = sel.slice(i + fn[0].length, end - 1);
      const parts: string[] = [];
      let d = 0;
      let from = 0;
      for (let k = 0; k < inner.length; k++) {
        if (inner[k] === "(") d++;
        else if (inner[k] === ")") d--;
        else if (inner[k] === "," && d === 0) {
          parts.push(inner.slice(from, k).trim());
          from = k + 1;
        }
      }
      parts.push(inner.slice(from).trim());
      const any = parts.some((p) => matchesCompound(p, classes));
      if (fn[1] === "not" ? any : !any) return false;
      i = end;
      continue;
    }
    const pseudo = /^:(hover|active|disabled)/.exec(rest);
    assert.ok(pseudo, `the matcher knows every part of "${sel}" (stuck at "${rest}")`);
    if (pseudo![1] === "disabled") return false;
    i += pseudo![0].length;
  }
  return true;
}

/** The declarations app/globals.css gives a page action with these classes: at rest, on hover, and on its icon. */
function actionLook(classList: string): { rest: string; hover: string; svg: string } {
  const css = read("app/globals.css");
  const classes = new Set(classList.split(/\s+/).filter(Boolean));
  const look = { rest: "", hover: "", svg: "" };
  let rules = 0;
  for (const m of css.matchAll(/(^|\n)(\[data-header-actions\] [^{]+)\{([^}]*)\}/g)) {
    const selector = m[2].trim();
    if (!selector.startsWith(ACTION_PREFIX)) continue;
    rules++;
    let own = selector.slice(ACTION_PREFIX.length);
    const svg = own.endsWith(" svg");
    if (svg) own = own.slice(0, -" svg".length);
    if (!matchesCompound(own, classes)) continue;
    const key = svg ? "svg" : /:hover\b/.test(own) ? "hover" : /:active\b/.test(own) ? null : "rest";
    if (key) look[key] += m[3];
  }
  assert.ok(rules >= 8, `landmark: the header-actions rules were read (${rules})`);
  return look;
}

test("only a primary-filled control gets the header's filled look: a ghost or link button, or a plain link, keeps its own (final review m2)", async () => {
  const { buttonVariants } = await import("@/components/ui/button");
  const { cn } = await import("@/lib/utils");
  const { BRAND_BUTTON_CLASS } = await import("@/components/brand/brand-classes");
  const isFilled = (look: { rest: string; hover: string; svg: string }) =>
    look.rest.includes("padding: 0 14px;") || look.rest.includes("font-weight: 600;") || look.hover.includes("--primary-hover") || look.svg.includes("width: 14px;");
  const own: Array<[string, string]> = [
    ["a ghost Button", buttonVariants({ variant: "ghost" })],
    ["a link Button", buttonVariants({ variant: "link" })],
    ["a plain <a>", ""],
    ["a ghost icon Button", buttonVariants({ variant: "ghost", size: "icon" })],
  ];
  for (const [name, classes] of own) {
    const look = actionLook(classes);
    assert.ok(!isFilled(look), `${name} is not painted as the filled primary (rest "${look.rest.trim()}", hover "${look.hover.trim()}")`);
    assert.ok(look.rest.includes("height: 36px;") && look.rest.includes("padding: 0 12px;"), `${name} still takes the header's 36px size`);
    assert.ok(!look.hover.includes("background-color"), `${name} keeps its own hover`);
  }
  const filledOnes: Array<[string, string]> = [
    ["the kit's default Button", buttonVariants()],
    ["a small default Button (/tables/qr Print)", buttonVariants({ size: "sm" })],
    ["Expenses' Add expense (the brand button)", cn(buttonVariants(), BRAND_BUTTON_CLASS, "h-10 w-auto shrink-0 px-4")],
  ];
  for (const [name, classes] of filledOnes) {
    const look = actionLook(classes);
    assert.ok(look.rest.includes("padding: 0 14px;") && look.rest.includes("font-weight: 600;"), `${name} is the filled primary (${classes})`);
    assert.ok(look.hover.includes("background-color: var(--primary-hover);") && look.svg.includes("width: 14px;"), `${name}: hover accent-h, a 14px icon`);
  }
  const outline = actionLook(buttonVariants({ variant: "outline" }));
  assert.ok(outline.rest.includes("border: 1px solid var(--border);") && !isFilled(outline), "an outline Button is the outline look, never the filled one");
});

test("the header's buttons are the HTML's 36px outline (13.5/500, gap 7, 15px icon) and primary (13.5/600, gap 6, 14px plus)", () => {
  const classes = read("components/layout/header-classes.ts");
  const literal = (name: string): string[] => classes.match(new RegExp(`export const ${name} =\\s*"([^"]*)"`))?.[1].split(/\s+/) ?? [];
  const outline = literal("HEADER_OUTLINE_BUTTON_CLASS");
  for (const needle of ["h-9", "px-3", "gap-[7px]", "text-[13.5px]", "font-medium", "[&_svg]:size-[15px]"]) {
    assert.ok(outline.includes(needle), `HEADER_OUTLINE_BUTTON_CLASS carries ${needle}`);
  }
  const primary = literal("HEADER_PRIMARY_BUTTON_CLASS");
  for (const needle of ["h-9", "px-3.5", "gap-1.5", "text-[13.5px]", "font-semibold", "hover:bg-primary-hover", "[&_svg]:size-[14px]"]) {
    assert.ok(primary.includes(needle), `HEADER_PRIMARY_BUTTON_CLASS carries ${needle}`);
  }
  assert.ok(![...outline, ...primary].some((t) => t.startsWith("pointer-coarse:")), "the HTML's sizes on touch too (R1)");
  assert.match(TABS, /buttonVariants\(\{ variant: tab\.primary \? "default" : "outline" \}\)/, "the tabs draw the kit's outline / primary look under those sizes");
});

// Design 5.3: the order-request strip under the header, in the HTML's warn colours: one 40px line on wide screens
// (wrapping on a phone), the count 13px/600 warn-ink, "Enable sound" a 30px outline button, the note 12.5px text-2.
test("the request strip is the warn tint with warn ink, on the observed element, with design 5.3's sizes", () => {
  assert.match(BAND, /<div[^>]*ref=\{bandRef\}[^>]*bg-status-warn-tint[^>]*text-status-warn-ink/, "band tag colours");
  assert.ok(!/amber/.test(BAND), "no amber palette class may remain in the band");
  const root = BAND.match(/ref=\{bandRef\}\s+data-ui="request-strip"\s+className="([^"]*)"/)?.[1].split(/\s+/) ?? [];
  for (const needle of ["flex", "min-h-10", "flex-wrap", "items-center", "border-b", "border-border", "px-3", "tab:px-5", "text-[13px]", "leading-[normal]"]) {
    assert.ok(root.includes(needle), `the strip carries ${needle}`);
  }
  const count = BAND.match(/data-ui="request-strip-count"\s+className="([^"]*)"/)?.[1].split(/\s+/) ?? [];
  for (const needle of ["text-[13px]", "font-semibold", "text-status-warn-ink"]) assert.ok(count.includes(needle), `the count carries ${needle}`);
  const sound = BAND.match(/data-ui="request-strip-sound"\s+className="([^"]*)"/)?.[1].split(/\s+/) ?? [];
  for (const needle of ["h-[30px]", "rounded-[8px]", "border", "border-border", "bg-card", "text-foreground"]) {
    assert.ok(sound.includes(needle), `Enable sound carries ${needle}`);
  }
  const note = BAND.match(/data-ui="request-strip-note"\s+className="([^"]*)"/)?.[1].split(/\s+/) ?? [];
  for (const needle of ["text-[12.5px]", "text-muted-foreground"]) assert.ok(note.includes(needle), `the note carries ${needle}`);
});

test("the printer button is the outline square", () => {
  assert.match(PRINTER, /variant="outline"/, "PrinterStatusButton must use the outline variant");
});

// Fix round 1: the device name in "{product} · {device}" / "{role} · {device}" is free text, so both second lines
// cut a long one with an ellipsis instead of running out of the nav.
test("the brand and user second lines truncate a long device name", () => {
  const brand = read("components/layout/SidebarBrand.tsx");
  const line = (src: string, ui: string): string[] =>
    src.match(new RegExp(`dataUi="${ui}" className="([^"]*)"`))?.[1].split(/\s+/) ?? [];
  for (const [src, ui] of [[brand, "nav-brand-line"], [ACCOUNT, "nav-user-line"]] as const) {
    const tokens = line(src, ui);
    assert.ok(tokens.length > 0, `landmark: the ${ui} class string was read`);
    assert.ok(tokens.includes("truncate"), `${ui} must truncate (overflow hidden + ellipsis)`);
  }
});

test("the Collapse button and the user card share the nav's press string; the Collapse class lives with the nav classes", () => {
  assert.match(CLASSES, /export const BRAND_NAV_PRESS_CLASS =/, "the press/transition string is exported");
  const collapse = CLASSES.match(/export const BRAND_NAV_COLLAPSE_CLASS =\s*"([^"]*)"/)?.[1].split(/\s+/) ?? [];
  for (const token of ["hidden", "xl:flex", "h-[34px]", "rounded-[8px]", "px-2.5", "gap-2.5", "text-[12.5px]", "text-nav-t2", "wide:justify-start"]) {
    assert.ok(collapse.includes(token), `BRAND_NAV_COLLAPSE_CLASS must carry the HTML's ${token}`);
  }
  assert.match(CLASSES, /export const BRAND_NAV_COLLAPSE_CLASS =[^;]*BRAND_NAV_PRESS_CLASS/, "Collapse uses the press string");
  assert.match(SIDEBAR, /className=\{BRAND_NAV_COLLAPSE_CLASS\}/, "AppSidebar's Collapse button uses the shared class");
  assert.match(ACCOUNT, /BRAND_NAV_PRESS_CLASS/, "the user card uses the press string");
  assert.ok(!SIDEBAR.includes("active:scale-[0.97]") && !ACCOUNT.includes("active:scale-[0.97]"), "no inline copy of the press string");
});

test("the user card reads on dark: white name, the nav-t2 role line, and an avatar with the online dot", () => {
  assert.match(ACCOUNT, /data-ui="nav-user"[^>]*text-white/, "the user card's text is white");
  assert.match(ACCOUNT, /text-nav-t2/, "the role line must be text-nav-t2");
  assert.match(ACCOUNT, /<StaffAvatar[^>]*status="online"/, "the trigger must show a StaffAvatar with status online");
});
