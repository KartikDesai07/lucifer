// Task 4 (perf F8, F9; D4, D5): the tests stay in the repo but leave the Vercel upload and the deploy
// build's type-check and lint; the unused UI kit files and packages are gone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const CAFE = path.join(REPO_ROOT, "apps/cafe");
const read = (p: string): string => readFileSync(p, "utf8");

const TEST_GLOBS = ["**/*.test.ts", "**/*.test.tsx", "**/*.test.mjs", "**/*.fixtures.ts"];

const KIT_FILES = [
  "accordion", "alert", "aspect-ratio", "avatar", "breadcrumb", "carousel", "command", "context-menu", "form",
  "hover-card", "input-otp", "menubar", "navigation-menu", "pagination", "progress", "radio-group", "resizable",
  "scroll-area", "slider", "toggle", "toggle-group",
];

const DROPPED_PACKAGES = [
  "@radix-ui/react-accordion", "@radix-ui/react-aspect-ratio", "@radix-ui/react-avatar",
  "@radix-ui/react-context-menu", "@radix-ui/react-hover-card", "@radix-ui/react-menubar",
  "@radix-ui/react-navigation-menu", "@radix-ui/react-progress", "@radix-ui/react-scroll-area",
  "@radix-ui/react-slider", "@radix-ui/react-toggle", "@radix-ui/react-toggle-group", "axios", "cmdk",
  "embla-carousel-react", "input-otp", "react-resizable-panels",
];

test("D4: .vercelignore drops the test globs and keeps every older line", () => {
  const lines = read(path.join(REPO_ROOT, ".vercelignore")).split(/\r?\n/).map((l) => l.trim());
  for (const g of TEST_GLOBS) assert.ok(lines.includes(g), `.vercelignore lacks ${g}`);
  for (const keep of [
    "apps/desktop/dist", "**/.next", "/clients", "/deploy.profiles.json", ".env", "!.env.example",
    "/marketing", "**/.wrangler", "/apps/mobile", "/CLAUDE.md",
  ]) {
    assert.ok(lines.includes(keep), `.vercelignore lost ${keep}`);
  }
});

test("D4: tsconfig.build.json extends tsconfig.json and excludes node_modules, the test globs and scripts", () => {
  const cfg = JSON.parse(read(path.join(CAFE, "tsconfig.build.json"))) as { extends?: string; exclude?: string[] };
  assert.equal(cfg.extends, "./tsconfig.json");
  for (const e of ["node_modules", "scripts/**", ...TEST_GLOBS]) {
    assert.ok(cfg.exclude?.includes(e), `tsconfig.build.json does not exclude ${e}`);
  }
});

test("D4: next.config.ts type-checks tsconfig.build.json", () => {
  assert.match(read(path.join(CAFE, "next.config.ts")), /typescript:\s*\{\s*tsconfigPath:\s*"tsconfig\.build\.json"\s*\}/);
});

test("D4: eslint ignores the test globs only inside next build", () => {
  const src = read(path.join(CAFE, "eslint.config.mjs"));
  assert.match(src, /process\.env\.NEXT_PHASE\s*===\s*"phase-production-build"/);
  for (const g of TEST_GLOBS) assert.ok(src.includes(`"${g}"`), `eslint.config.mjs lacks ${g}`);
});

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs)$/.test(name)) out.push(full);
  }
  return out;
}

test("D4: no non-test source in app/ components/ hooks/ lib/ imports a test or .fixtures module", () => {
  const bad: string[] = [];
  for (const dir of ["app", "components", "hooks", "lib"]) {
    for (const file of walk(path.join(CAFE, dir), [])) {
      if (/\.(test\.(ts|tsx|mjs)|fixtures\.ts)$/.test(file)) continue;
      const text = read(file);
      if (/from\s+["'][^"']*\.(test|fixtures)(\.[a-z]+)?["']/.test(text)) bad.push(path.relative(CAFE, file));
    }
  }
  assert.deepEqual(bad, []);
});

test("D5: the 21 unused kit files and the 17 unused packages are gone", () => {
  for (const k of KIT_FILES) {
    assert.equal(existsSync(path.join(CAFE, "components/ui", `${k}.tsx`)), false, `${k}.tsx still exists`);
  }
  const pkg = JSON.parse(read(path.join(CAFE, "package.json"))) as {
    dependencies: Record<string, string>;
    testChain: string[];
  };
  for (const n of DROPPED_PACKAGES) assert.equal(n in pkg.dependencies, false, `${n} still a dependency`);
  assert.ok(pkg.testChain.includes("lib/deploy-scope-paths.test.ts"));
});
