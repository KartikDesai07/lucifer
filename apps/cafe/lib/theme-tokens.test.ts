import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Pins the new light theme's token VALUES (owner's mock-up, 2026-10-16), the
 * new status / ink tokens, their Tailwind registration and the shape of the
 * dark set. Contrast of the pairs is measured by brand-contrast.test.ts.
 */
const css = readFileSync(join(process.cwd(), "app", "globals.css"), "utf8");

/** The `:root { … }` block whose body contains `needle`. */
function rootBlockWith(needle: string): string {
  const re = /(^|\n):root\s*\{([\s\S]*?)\n\}/g;
  for (const m of css.matchAll(re)) {
    if (m[2].includes(needle)) return m[2];
  }
  throw new Error(`no :root block holds ${needle}`);
}

function declOf(block: string, name: string): string | null {
  const m = block.match(new RegExp(`(?:^|\\n)\\s*${name}:\\s*([^;]+);`));
  return m ? m[1].trim() : null;
}

const main = rootBlockWith("--background:");
const brand = rootBlockWith("--brand-paper:");
const dark = (css.match(/\n\.dark\s*\{([\s\S]*?)\n\}/) ?? [])[1] ?? "";
const themeInline = css.slice(
  css.indexOf("@theme inline {"),
  css.indexOf("\n}", css.indexOf("@theme inline {")),
);

test("light values of the shadcn tokens", () => {
  const want: Record<string, string> = {
    "--background": "#f4f4f5",
    "--foreground": "#18181b",
    "--card": "#ffffff",
    "--popover": "#ffffff",
    "--muted": "#f2f2f4",
    "--secondary": "#f2f2f4",
    "--muted-foreground": "#52525b",
    "--secondary-foreground": "#52525b",
    "--subtle-foreground": "#6b6b74",
    "--border": "#e2e2e6",
    "--input": "#8b8b93",
    "--primary": "var(--brand-primary)",
    "--primary-hover": "#0043ce",
    "--primary-foreground": "#ffffff",
    "--accent": "#edf5ff",
    "--accent-foreground": "#0043ce",
    "--ring": "var(--brand-accent)",
    "--destructive": "#da1e28",
    "--destructive-foreground": "#ffffff",
    "--success": "#24a148",
    "--warning": "#ff832b",
    "--ink": "#18181b",
    "--on-ink": "#ffffff",
    "--on-ink-up": "#6fdc8c",
    "--on-ink-down": "#ff8389",
    "--track": "#e9e9ec",
    "--radius": "0.625rem",
  };
  for (const [name, value] of Object.entries(want)) {
    assert.equal(declOf(main, name), value, `${name} in :root`);
  }
});

test("status set", () => {
  const want: Record<string, [string, string, string, string | null]> = {
    // owner's HTML value (values 1.1 --ok-i, design 9): was #16733a for contrast
    ok: ["#24a148", "#198038", "#defbe6", null],
    warn: ["#ff832b", "#ba4e00", "#fff2e8", null],
    bad: ["#da1e28", "#a2191f", "#fff1f1", null],
    info: ["#0f62fe", "#0043ce", "#edf5ff", "#a6c8ff"],
    bill: ["#b28600", "#8e6a00", "#fcf4d6", "#f1c21b"],
    reserved: ["#8a3ffc", "#6929c4", "#f6f2ff", "#d4bbff"],
  };
  for (const [kind, [base, ink, tint, border]] of Object.entries(want)) {
    assert.equal(declOf(main, `--status-${kind}`), base, `--status-${kind}`);
    assert.equal(declOf(main, `--status-${kind}-ink`), ink, `--status-${kind}-ink`);
    assert.equal(declOf(main, `--status-${kind}-tint`), tint, `--status-${kind}-tint`);
    if (border) {
      assert.equal(declOf(main, `--status-${kind}-border`), border, `--status-${kind}-border`);
    }
  }
});

test("brand values", () => {
  const want: Record<string, string> = {
    paper: "#f4f4f5",
    sidebar: "#111113",
    wash: "#f2f2f4",
    slip: "#ffffff",
    ink: "#18181b",
    "ink-hover": "#27272a",
    muted: "#52525b",
    rule: "#e2e2e6",
    field: "#8b8b93",
    accent: "#0f62fe",
    primary: "#0f62fe",
    "primary-hover": "#0043ce",
    "primary-soft": "#edf5ff",
    danger: "#a2191f",
    up: "#16733a",
  };
  for (const [name, value] of Object.entries(want)) {
    assert.equal(declOf(brand, `--brand-${name}`), value, `--brand-${name}`);
  }
});

test("@theme inline registers the new names", () => {
  for (const k of ["ok", "warn", "bad", "info", "bill", "reserved"]) {
    for (const suffix of ["", "-ink", "-tint"]) {
      assert.ok(
        themeInline.includes(`--color-status-${k}${suffix}: var(--status-${k}${suffix});`),
        `--color-status-${k}${suffix} registered`,
      );
    }
  }
  for (const k of ["info", "bill", "reserved"]) {
    assert.ok(
      themeInline.includes(`--color-status-${k}-border: var(--status-${k}-border);`),
      `--color-status-${k}-border registered`,
    );
  }
  for (const [color, v] of [
    ["ink", "ink"],
    ["on-ink", "on-ink"],
    ["on-ink-up", "on-ink-up"],
    ["on-ink-down", "on-ink-down"],
    ["track", "track"],
    ["subtle-foreground", "subtle-foreground"],
    ["primary-hover", "primary-hover"],
  ]) {
    assert.ok(themeInline.includes(`--color-${color}: var(--${v});`), `--color-${color} registered`);
  }
  assert.ok(
    themeInline.includes("--shadow-pop: var(--pop);"),
    "--shadow-pop registered (the value lives in --pop, values 1.1)",
  );
});

test("the dark set keeps its alpha borders and its primary", () => {
  assert.ok(dark.length > 0, ".dark block found");
  assert.ok(/--primary:/.test(dark), ".dark declares --primary");
  for (const name of ["--border", "--input", "--sidebar-border"]) {
    const v = declOf(dark, name);
    assert.ok(v !== null && v.includes("/ "), `.dark ${name} keeps an alpha (css-compat depends on it)`);
  }
});

test("no CSS the Android WebView 109 cannot read", () => {
  for (const needle of ["light-dark(", "@starting-style", "@scope", "subgrid"]) {
    assert.ok(!css.includes(needle), `globals.css contains ${needle}`);
  }
});

test("radius steps: cards 12 px (xl) and dialogs/sheets 16 px (2xl), as spec 4.5 says", () => {
  assert.equal(declOf(themeInline, "--radius-xl"), "calc(var(--radius) + 2px)", "--radius-xl is 10 + 2 = 12 px (spec 4.5 cards)");
  assert.equal(declOf(themeInline, "--radius-2xl"), "calc(var(--radius) + 6px)", "--radius-2xl is 10 + 6 = 16 px (spec 4.5 dialogs and sheets)");
});

// U0 match Task 6 (values 3.3): the hero is the HTML's --nav card now, so its pills are the HTML's 16 % tints flattened
// over --nav #111113 (rgba(66,190,101,.16) -> #192d20, rgba(250,77,86,.16) -> #361b1e).
test("the hero's change-pill tints are opaque hex tokens (the HTML's 16 % tints flattened), registered in @theme inline", () => {
  const want = {
    "--on-ink-up-tint": ["#192d20", "#d8ebde"],
    "--on-ink-down-tint": ["#361b1e", "#f5d9dc"],
  } as const;
  for (const [name, [light, night]] of Object.entries(want)) {
    assert.equal(declOf(main, name), light, `${name} in :root is the HTML's 16 % tint flattened over --nav #111113`);
    assert.equal(declOf(dark, name), night, `${name} in .dark is the OLD 16 % tint (#42be65 / #fa4d56) over #f4f4f5 (the .dark on-ink greens over #f4f4f5 fail 4.5:1)`);
    const key = name.slice(2);
    assert.ok(themeInline.includes(`--color-${key}: var(--${key});`), `--color-${key} registered`);
  }
  const kpi = readFileSync(join(process.cwd(), "components", "dashboard", "KpiChange.tsx"), "utf8");
  assert.ok(!kpi.includes("bg-[rgb("), "KpiChange has no bg-[rgb( literal");
  assert.ok(kpi.includes("bg-on-ink-up-tint") && kpi.includes("bg-on-ink-down-tint"), "KpiChange uses the two tint tokens");
});

test("the HTML's new light tokens (values 1.1), on :root", () => {
  const want: Record<string, string> = {
    "--surface-2": "#fafafa",
    "--surface-3": "#e9e9ec",
    "--border-2": "#ececef",
    "--hover": "#f2f2f4",
    "--seg": "#ffffff",
    "--link": "#0f62fe",
    "--accent-b": "#a6c8ff",
    "--nav": "#111113",
    "--nav-2": "#27272a",
    "--nav-t": "#c8c8cc",
    "--nav-t2": "#8b8b93",
    "--nav-on": "#262628",
    "--brand-red": "#c8381f",
    "--brand-nav-name": "#ff6b4a",
    "--toast": "#18181b",
    "--toast-t": "#ffffff",
    "--toast-a": "#a9c8b2",
    "--glass": "rgba(255, 255, 255, 0.9)",
    "--seg-sh": "0 1px 2px rgba(0, 0, 0, 0.12), 0 0 0 0.5px rgba(0, 0, 0, 0.04)",
    "--pop": "0 24px 60px rgba(0, 0, 0, 0.18), 0 0 0 1px rgba(0, 0, 0, 0.04)",
  };
  for (const [name, value] of Object.entries(want)) {
    assert.equal(declOf(main, name), value, `${name} in :root (values 1.1; nav-on is rgba(255,255,255,.09) flattened over #111113)`);
    const key = name.slice(2);
    if (name === "--seg-sh") assert.ok(themeInline.includes("--shadow-seg: var(--seg-sh);"), "--shadow-seg registered");
    else if (name === "--pop") continue;
    else assert.ok(themeInline.includes(`--color-${key}: var(--${key});`), `--color-${key} registered`);
  }
});

test("the HTML's dark values for the new names (values 1.1; translucent ones flattened where a twin is needed)", () => {
  const want: Record<string, string> = {
    "--surface-2": "#1c1c20",
    "--surface-3": "#27272b",
    "--border-2": "#242428",
    "--hover": "#222226",
    "--seg": "#3a3a40",
    "--link": "#78a9ff",
    "--accent-b": "#305698",
    "--nav": "#08080a",
    "--nav-2": "#202024",
    "--nav-t": "#a9a9b2",
    "--nav-t2": "#73737c",
    "--nav-on": "#1c1c1e",
    "--brand-red": "#ff7b5e",
    "--toast": "#f2f2f3",
    "--toast-t": "#0f0f10",
    "--toast-a": "#6faf85",
    "--glass": "rgba(23, 23, 26, 0.9)",
    "--seg-sh": "0 1px 2px rgba(0, 0, 0, 0.5)",
    "--pop": "0 24px 60px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.06)",
  };
  for (const [name, value] of Object.entries(want)) {
    assert.equal(declOf(dark, name), value, `${name} in .dark (values 1.1 dark column)`);
  }
});

test("breakpoints tab 45rem (720 px) and desk 68.75rem (1100 px) are declared in @theme inline", () => {
  assert.equal(declOf(themeInline, "--breakpoint-tab"), "45rem", "--breakpoint-tab is 720 px (values 0.1)");
  assert.equal(declOf(themeInline, "--breakpoint-desk"), "68.75rem", "--breakpoint-desk is 1100 px (values 0.1)");
});

// U0 match Task 7 (values 3.5, 1.5): the hour chart's bars are color-mix(in oklab, var(--accent) 60%, var(--surface))
// precomputed (no runtime color-mix on WebView 109), they grow in with the HTML's growY, and the Live tables dot pulses
// with the HTML's pulse.
test("the hour chart's 60 % bar tint as a hex token, and the HTML's growY and pulse motions", () => {
  assert.equal(declOf(main, "--chart-bar"), "#75a7ff", "--chart-bar in :root: #0F62FE 60 % over #FFFFFF in oklab");
  assert.equal(declOf(dark, "--chart-bar"), "#1b459b", "--chart-bar in .dark: #0F62FE 60 % over #17171A in oklab");
  assert.ok(themeInline.includes("--color-chart-bar: var(--chart-bar);"), "--color-chart-bar registered");
  assert.ok(css.includes("--animate-grow-y: grow-y 0.7s cubic-bezier(0.2, 0.8, 0.2, 1) both;"), "the bars' growY, .7s with the HTML's easing");
  assert.match(css, /@keyframes grow-y \{\s*from \{\s*transform: scaleY\(0\);\s*\}\s*to \{\s*transform: scaleY\(1\);\s*\}\s*\}/, "growY verbatim");
  assert.ok(css.includes("--animate-live-pulse: live-pulse 2s infinite;"), "the live dot's pulse, 2s, forever");
  // U0 match Task 8 (values 1.5, 3.9, 3.10): the payment bar's and the sources' fills grow in from the left.
  assert.ok(css.includes("--animate-grow-x: grow-x 0.8s cubic-bezier(0.2, 0.8, 0.2, 1) both;"), "the fills' growX, .8s with the HTML's easing");
  assert.match(css, /@keyframes grow-x \{\s*from \{\s*transform: scaleX\(0\);\s*\}\s*to \{\s*transform: scaleX\(1\);\s*\}\s*\}/, "growX verbatim");
  assert.match(
    css,
    /@keyframes live-pulse \{\s*0% \{\s*box-shadow: 0 0 0 0 rgba\(36, 161, 72, 0\.45\);\s*\}\s*70% \{\s*box-shadow: 0 0 0 7px rgba\(36, 161, 72, 0\);\s*\}\s*100% \{\s*box-shadow: 0 0 0 0 rgba\(36, 161, 72, 0\);\s*\}\s*\}/,
    "pulse verbatim (values 1.5)",
  );
});
