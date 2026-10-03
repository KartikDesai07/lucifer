import { test } from "node:test";
import assert from "node:assert/strict";

import {
  HEX_COLOR_PATTERN,
  WCAG_AA_NORMAL,
  WCAG_AA_LARGE,
  srgbLuminance,
  contrastRatio,
  bestForeground,
  checkAccent,
  accentProblemText,
  type AccentProblem,
} from "./appearance-contrast";
import { APPEARANCE_PRESETS, PUBLIC_DESTRUCTIVE } from "./appearance-presets";
import { PRESET_IDS, DEFAULT_APPEARANCE } from "./appearance";
import { appearanceSchema } from "./schemas/settings-print.schema";

// CR2.4 §22.5 A18a — the full preset-self-contrast matrix. This file is the
// GATE the palette hex values in appearance-presets.ts must clear; a failing
// assertion here means the PALETTE is wrong, never the assertion (CLAUDE.md:
// never weaken a test to make it pass).

// ── luminance / ratio spot checks against known WCAG values ─────────────────

test("srgbLuminance: pure black is 0, pure white is 1", () => {
  assert.equal(srgbLuminance("#000000"), 0);
  assert.equal(srgbLuminance("#ffffff"), 1);
});

test("contrastRatio: black vs white is the maximum, 21:1", () => {
  assert.equal(contrastRatio("#000000", "#ffffff"), 21);
});

test("contrastRatio: white vs itself is the minimum, 1:1", () => {
  assert.equal(contrastRatio("#ffffff", "#ffffff"), 1);
});

test("contrastRatio: #777777 vs #ffffff is ~4.48 (a well-known WCAG reference pair)", () => {
  assert.ok(Math.abs(contrastRatio("#777777", "#ffffff") - 4.48) < 0.01);
});

test("contrastRatio is symmetric in its two arguments", () => {
  assert.equal(contrastRatio("#123456", "#fedcba"), contrastRatio("#fedcba", "#123456"));
});

// ── bestForeground ───────────────────────────────────────────────────────────

test("bestForeground: white text on black, black text on white", () => {
  assert.equal(bestForeground("#000000"), "#ffffff");
  assert.equal(bestForeground("#ffffff"), "#000000");
});

test("bestForeground always returns the higher-contrast of the two", () => {
  for (const hex of ["#777777", "#8a4a24", "#e0a13f", "#111111", "#eeeeee"]) {
    const fg = bestForeground(hex);
    const other = fg === "#ffffff" ? "#000000" : "#ffffff";
    assert.ok(contrastRatio(fg, hex) >= contrastRatio(other, hex));
  }
});

// ── checkAccent ───────────────────────────────────────────────────────────────

test("checkAccent rejects a known-bad (near-white) accent, naming the failing pair", () => {
  const result = checkAccent("#fefdfb", "classicBistro");
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.match(result.failing, /accent vs (light|dark) (background|card): [\d.]+ < 3/);
  }
});

// NOTE: a preset's own light/dark accent are deliberately DIFFERENT colors —
// each is tuned to its own scheme's background (the MATRIX test above covers
// exactly that pairing). checkAccent gates a single admin-picked OVERRIDE
// that must hold across BOTH schemes at once (A6), a strictly harder bar, so
// neither preset half's accent is expected to pass it standing alone.

test("checkAccent accepts an override color that clears both schemes of a given preset", () => {
  // Verified against classicBistro's light/dark background+card by the tuning
  // script behind appearance-presets.ts — not a value drawn from the preset.
  const result = checkAccent("#9a6a3a", "classicBistro");
  assert.deepEqual(result, { ok: true });
});

test("checkAccent rejects a malformed hex string rather than throwing", () => {
  const result = checkAccent("not-a-color", "classicBistro");
  assert.equal(result.ok, false);
});

test("checkAccent fails closed on an unknown presetId", () => {
  const result = checkAccent("#8a4a24", "midnightDiner");
  assert.equal(result.ok, false);
});

// ── HEX_COLOR_PATTERN ────────────────────────────────────────────────────────

test("HEX_COLOR_PATTERN accepts lowercase #rrggbb only", () => {
  assert.equal(HEX_COLOR_PATTERN.test("#8a4a24"), true);
  assert.equal(HEX_COLOR_PATTERN.test("#8A4A24"), false, "uppercase must not match — values are lowercased before this runs");
  assert.equal(HEX_COLOR_PATTERN.test("#fff"), false, "3-digit shorthand is not accepted");
  assert.equal(HEX_COLOR_PATTERN.test("red"), false);
});

// ── THE MATRIX (A18a) — every semantic pair, all 6 presets, both halves ─────

test("MATRIX: every preset's foreground/background clears WCAG_AA_NORMAL, both halves", () => {
  for (const presetId of PRESET_IDS) {
    for (const scheme of ["light", "dark"] as const) {
      const p = APPEARANCE_PRESETS[presetId][scheme];
      const ratio = contrastRatio(p.foreground, p.background);
      assert.ok(ratio >= WCAG_AA_NORMAL, `${presetId}/${scheme} foreground/background: ${ratio} < ${WCAG_AA_NORMAL}`);
    }
  }
});

test("MATRIX: every preset's cardForeground/card clears WCAG_AA_NORMAL, both halves", () => {
  for (const presetId of PRESET_IDS) {
    for (const scheme of ["light", "dark"] as const) {
      const p = APPEARANCE_PRESETS[presetId][scheme];
      const ratio = contrastRatio(p.cardForeground, p.card);
      assert.ok(ratio >= WCAG_AA_NORMAL, `${presetId}/${scheme} cardForeground/card: ${ratio} < ${WCAG_AA_NORMAL}`);
    }
  }
});

test("MATRIX: every preset's mutedForeground/muted clears WCAG_AA_NORMAL, both halves", () => {
  for (const presetId of PRESET_IDS) {
    for (const scheme of ["light", "dark"] as const) {
      const p = APPEARANCE_PRESETS[presetId][scheme];
      const ratio = contrastRatio(p.mutedForeground, p.muted);
      assert.ok(ratio >= WCAG_AA_NORMAL, `${presetId}/${scheme} mutedForeground/muted: ${ratio} < ${WCAG_AA_NORMAL}`);
    }
  }
});

test("MATRIX: every preset's primary/primaryForeground clears WCAG_AA_NORMAL, both halves", () => {
  for (const presetId of PRESET_IDS) {
    for (const scheme of ["light", "dark"] as const) {
      const p = APPEARANCE_PRESETS[presetId][scheme];
      const ratio = contrastRatio(p.primary, p.primaryForeground);
      assert.ok(ratio >= WCAG_AA_NORMAL, `${presetId}/${scheme} primary/primaryForeground: ${ratio} < ${WCAG_AA_NORMAL}`);
    }
  }
});

test("MATRIX: every preset's accent clears WCAG_AA_LARGE vs its OWN background and card, both halves", () => {
  for (const presetId of PRESET_IDS) {
    for (const scheme of ["light", "dark"] as const) {
      const p = APPEARANCE_PRESETS[presetId][scheme];
      const bg = contrastRatio(p.accent, p.background);
      const card = contrastRatio(p.accent, p.card);
      assert.ok(bg >= WCAG_AA_LARGE, `${presetId}/${scheme} accent vs background: ${bg} < ${WCAG_AA_LARGE}`);
      assert.ok(card >= WCAG_AA_LARGE, `${presetId}/${scheme} accent vs card: ${card} < ${WCAG_AA_LARGE}`);
    }
  }
});

test("MATRIX: bestForeground(accent) clears WCAG_AA_NORMAL against the accent itself, all 12 halves (accent is a strong fill — public/** components must pair bg-accent with text-accent-foreground, never inherited foreground/muted-foreground)", () => {
  for (const presetId of PRESET_IDS) {
    for (const scheme of ["light", "dark"] as const) {
      const p = APPEARANCE_PRESETS[presetId][scheme];
      const fg = bestForeground(p.accent);
      const ratio = contrastRatio(fg, p.accent);
      assert.ok(ratio >= WCAG_AA_NORMAL, `${presetId}/${scheme} accent-foreground/accent: ${ratio} < ${WCAG_AA_NORMAL}`);
    }
  }
});

test("MATRIX: PUBLIC_DESTRUCTIVE's own fg/bg clears WCAG_AA_NORMAL, both schemes", () => {
  for (const scheme of ["light", "dark"] as const) {
    const { bg, fg } = PUBLIC_DESTRUCTIVE[scheme];
    const ratio = contrastRatio(fg, bg);
    assert.ok(ratio >= WCAG_AA_NORMAL, `destructive/${scheme} fg/bg: ${ratio} < ${WCAG_AA_NORMAL}`);
  }
});

test("MATRIX: PUBLIC_DESTRUCTIVE's bg clears WCAG_AA_LARGE vs EVERY preset's background and card, both schemes (the fixed pair must work everywhere — a failing preset gets adjusted, never the fixed pair)", () => {
  for (const scheme of ["light", "dark"] as const) {
    const { bg } = PUBLIC_DESTRUCTIVE[scheme];
    for (const presetId of PRESET_IDS) {
      const p = APPEARANCE_PRESETS[presetId][scheme];
      const bgRatio = contrastRatio(bg, p.background);
      const cardRatio = contrastRatio(bg, p.card);
      assert.ok(bgRatio >= WCAG_AA_LARGE, `destructive/${scheme} vs ${presetId} background: ${bgRatio} < ${WCAG_AA_LARGE}`);
      assert.ok(cardRatio >= WCAG_AA_LARGE, `destructive/${scheme} vs ${presetId} card: ${cardRatio} < ${WCAG_AA_LARGE}`);
    }
  }
});

// ── reason + plain-English text (Settings slice 9) ───────────────────────────

const ALL_REASONS: AccentProblem[] = ["invalid", "unknown-preset", "text", "light", "dark"];

function reasonOf(hex: string, presetId: string): AccentProblem | "ok" {
  const result = checkAccent(hex, presetId);
  return result.ok ? "ok" : result.reason;
}

test("checkAccent reason: a near-white accent fails as \"light\" on every preset, with the raw failing string unchanged", () => {
  for (const presetId of PRESET_IDS) {
    assert.equal(reasonOf("#fefdfb", presetId), "light", presetId);
  }
  const result = checkAccent("#fefdfb", "classicBistro");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.failing, /^accent vs light background: [\d.]+ < 3$/);
});

test("checkAccent reason: a near-black accent fails as \"dark\" on every preset, with the raw failing string unchanged", () => {
  for (const presetId of PRESET_IDS) {
    assert.equal(reasonOf("#050505", presetId), "dark", presetId);
  }
  const result = checkAccent("#050505", "classicBistro");
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.failing, /^accent vs dark (background|card): [\d.]+ < 3$/);
});

test("checkAccent reason: a malformed hex is \"invalid\" and an unknown preset is \"unknown-preset\"", () => {
  assert.equal(reasonOf("zzz", "classicBistro"), "invalid");
  assert.equal(reasonOf("#8A4A24", "classicBistro"), "invalid", "uppercase is not normalized here");
  assert.equal(reasonOf("#9a6a3a", "midnightDiner"), "unknown-preset");
  const result = checkAccent("zzz", "classicBistro");
  if (!result.ok) assert.equal(result.failing, "accent is not a valid hex color");
});

test("checkAccent reason: the \"text\" branch is a guard the current thresholds cannot reach — the best of black/white on ANY colour clears 4.5, so no hex lands on it (a coarse sweep of the whole RGB cube finds none)", () => {
  const hex2 = (v: number) => v.toString(16).padStart(2, "0");
  const STEP = 15;
  let sampled = 0;
  for (let r = 0; r < 256; r += STEP) {
    for (let g = 0; g < 256; g += STEP) {
      for (let b = 0; b < 256; b += STEP) {
        sampled += 1;
        assert.notEqual(reasonOf("#" + hex2(r) + hex2(g) + hex2(b), "classicBistro"), "text");
      }
    }
  }
  assert.ok(sampled > 1000, "the sweep must actually sample the cube");
});

test("accentProblemText: every reason has plain English — non-empty, no digits, no \"vs\", no hex", () => {
  for (const reason of ALL_REASONS) {
    const text = accentProblemText(reason);
    assert.ok(text.length > 0, reason);
    assert.ok(!/\d/.test(text), `${reason}: no digits in ${text}`);
    assert.ok(!/vs/i.test(text), `${reason}: no "vs" in ${text}`);
    assert.ok(!/#/.test(text), `${reason}: no hex in ${text}`);
  }
  assert.equal(new Set(ALL_REASONS.map(accentProblemText)).size, ALL_REASONS.length, "every reason reads differently");
});

test("appearanceSchema: a failing accent is rejected with the plain message for its reason, never the raw failing string", () => {
  const cases: Array<[string, AccentProblem]> = [
    ["#fefdfb", "light"],
    ["#050505", "dark"],
  ];
  for (const [hex, reason] of cases) {
    const parsed = appearanceSchema.safeParse({ ...DEFAULT_APPEARANCE, accentOverride: hex });
    assert.equal(parsed.success, false, hex);
    if (parsed.success) continue;
    const issue = parsed.error.issues.find((i) => i.path.includes("accentOverride"));
    assert.ok(issue, "the rejection must land on accentOverride");
    assert.equal(issue.message, accentProblemText(reason));
    const result = checkAccent(hex, DEFAULT_APPEARANCE.presetId);
    assert.ok(!result.ok && !issue.message.includes(result.failing), "the raw failing string must not leak into the message");
  }
});
