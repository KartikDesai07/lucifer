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
    "--radius": "0.625rem",
  };
  for (const [name, value] of Object.entries(want)) {
    assert.equal(declOf(main, name), value, `${name} in :root`);
  }
});

test("status set", () => {
  const want: Record<string, [string, string, string, string | null]> = {
    ok: ["#24a148", "#16733a", "#defbe6", null],
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
    sidebar: "#fafafa",
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
    ["subtle-foreground", "subtle-foreground"],
    ["primary-hover", "primary-hover"],
  ]) {
    assert.ok(themeInline.includes(`--color-${color}: var(--${v});`), `--color-${color} registered`);
  }
  assert.ok(
    themeInline.includes("--shadow-pop: 0 24px 60px rgb(0 0 0 / 0.18), 0 0 0 1px rgb(0 0 0 / 0.04);"),
    "--shadow-pop registered",
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
