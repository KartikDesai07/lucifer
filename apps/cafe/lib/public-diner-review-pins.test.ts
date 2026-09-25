import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

// CB-6C adversarial review (2026-09-21) — regression pins for the four
// arbiter-CONFIRMED findings. Each one names the exact code shape the fix
// landed, paired with a positive landmark so a gutted file cannot pass.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

const PUBLIC_DIR = "apps/cafe/components/public";
const MENU_ITEM = `${PUBLIC_DIR}/PublicMenuItem.tsx`;
const ACCOUNT_TAB = `${PUBLIC_DIR}/PublicAccountTab.tsx`;
const REWARD_CODES = `${PUBLIC_DIR}/PublicRewardCodes.tsx`;
const PROMO_FIELD = `${PUBLIC_DIR}/PublicPromoField.tsx`;

const SKIP_DIRS = new Set(["node_modules", ".next"]);
const CODE_FILE_PATTERN = /\.(ts|tsx)$/;

function walk(dirAbs: string, out: string[]): void {
  for (const entry of readdirSync(dirAbs)) {
    if (SKIP_DIRS.has(entry)) continue;
    const abs = path.join(dirAbs, entry);
    if (statSync(abs).isDirectory()) walk(abs, out);
    else if (CODE_FILE_PATTERN.test(entry)) out.push(abs);
  }
}

// ── F1 (MAJOR) — the tile stepper's − / + buttons are real 44px targets ─────
test("REVIEW F1: PublicMenuItem's stepper − and + buttons are each 44px (h-11 w-11) inside the unchanged h-11 w-28 footprint — no 36px (h-9 w-9) tap target remains", () => {
  const src = stripComments(readSrc(MENU_ITEM));
  // Landmarks: the two buttons still exist and the footprint is unchanged.
  assert.match(src, /aria-label=\{`Decrease \$\{product\.name\} quantity`\}/, "decrement button landmark");
  assert.match(src, /aria-label=\{`Increase \$\{product\.name\} quantity`\}/, "increment button landmark");
  assert.match(src, /const CONTROL_FOOTPRINT = "ml-auto h-11 w-28";/, "CONTROL_FOOTPRINT landmark");
  const buttons = [...src.matchAll(/className="grid h-11 w-11 place-items-center rounded active:scale-95"/g)];
  assert.equal(buttons.length, 2, "both stepper buttons must carry the 44px h-11 w-11 box");
  assert.ok(!/\bh-9 w-9\b/.test(src), "no 36px (h-9 w-9) tap target may remain on the tile");
  // The w-28 footprint is border-box (110px of content inside its 1px border):
  // 44 + 20 + 44 = 108px, so a fixed w-5 digit and no wrapper padding keep both
  // buttons at a full 44px instead of flex-shrinking them under the floor.
  assert.match(src, /className="w-5 text-center text-sm font-semibold tabular-nums/, "the qty digit is a fixed w-5 (44 + 20 + 44 = 108px fits the 110px content box of the bordered w-28 footprint)");
  assert.ok(
    !/bg-primary\/10 px-1"/.test(src),
    "the stepper wrapper must not carry px-1 — 44 + 24 + 44 already fills the w-28 footprint",
  );
});

// ── F2 (MINOR) — the "Never mind" text link has the padded hit box ──────────
test('REVIEW F2: PublicAccountTab\'s "Never mind" link carries PUBLIC_TOUCH_TEXT_CLASS like every other text-style control on /m', () => {
  const src = stripComments(readSrc(ACCOUNT_TAB));
  const idx = src.indexOf("Never mind");
  assert.ok(idx >= 0, "landmark: the Never mind control must still exist");
  const openTag = src.lastIndexOf("<button", idx);
  assert.ok(openTag >= 0, "Never mind must be rendered by a <button");
  const tag = src.slice(openTag, idx);
  assert.match(tag, /PUBLIC_TOUCH_TEXT_CLASS/, "the Never mind button must apply PUBLIC_TOUCH_TEXT_CLASS (min-h-11 padded hit box)");
  assert.match(src, /PUBLIC_TOUCH_TEXT_CLASS,\n\} from "@\/components\/public\/public-shell-layout";/, "the class must be imported from the shared layout module, not re-typed");
});

// ── F3 (MINOR) — class strings are whole literals composed via cn(), never
// template-literal interpolation ──────────────────────────────────────────────
test("REVIEW F3: no file under components/public/** builds a className from a template literal — PUB_* constants compose through cn(CONST, \"literal\")", () => {
  const files: string[] = [];
  walk(path.join(REPO_ROOT, PUBLIC_DIR), files);
  assert.ok(files.length >= 40, `vision guard: expected to scan at least 40 files, scanned ${files.length}`);
  const needle = "className={" + "`";
  let cnComposed = 0;
  for (const abs of files) {
    const src = stripComments(readFileSync(abs, "utf8"));
    assert.ok(
      !src.includes(needle),
      `${path.relative(REPO_ROOT, abs)} builds a className from a template literal — use cn(CONST, "…") so the utilities stay whole literals and twMerge resolves conflicts`,
    );
    if (/cn\(PUB_[A-Z_]+/.test(src)) cnComposed += 1;
  }
  assert.ok(cnComposed >= 5, `positive landmark: at least 5 files compose PUB_* constants through cn( (found ${cnComposed})`);
});

// ── F4 (MINOR) — ONE expiry-date formatter for the diner surface ────────────
test("REVIEW F4: expiryLabel is declared ONCE (exported by PublicPromoField) and PublicRewardCodes imports it rather than carrying a copy", () => {
  const promo = stripComments(readSrc(PROMO_FIELD));
  const codes = stripComments(readSrc(REWARD_CODES));
  assert.match(promo, /export function expiryLabel\(/, "PublicPromoField must export expiryLabel");
  assert.match(
    codes,
    /import \{ expiryLabel, type AssignedRewardOffer \} from "@\/components\/public\/PublicPromoField";/,
    "PublicRewardCodes must import expiryLabel from PublicPromoField",
  );
  assert.match(codes, /expiryLabel\(/, "landmark: PublicRewardCodes still renders an expiry label");
  assert.ok(!/EXPIRY_DATE_FORMAT/.test(codes), "PublicRewardCodes must not carry its own EXPIRY_DATE_FORMAT copy");
  // Directory-wide: exactly one declaration of the helper on the surface.
  const files: string[] = [];
  walk(path.join(REPO_ROOT, PUBLIC_DIR), files);
  const declarations = files.filter((abs) => /function expiryLabel\(/.test(stripComments(readFileSync(abs, "utf8"))));
  assert.deepEqual(
    declarations.map((abs) => path.relative(REPO_ROOT, abs).replace(/\\/g, "/")),
    [PROMO_FIELD],
    "expiryLabel must be declared in exactly one file",
  );
});
