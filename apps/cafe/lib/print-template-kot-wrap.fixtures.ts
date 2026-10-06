import {
  CLASSIC_WRAP_ROOT_CLASS, LEGACY_LINE_RE, LEGACY_ROOT_RE, WRAPPED_LINE,
  type KotExtra,
} from "./print-template-golden.fixtures"; // FIRST import of any suite using this file must be golden.fixtures (React production renderer)
import type { Settings } from "@/types";

// The KOT golden oracle's engine-only differences (print customization S5, 05-S5-plan D9 / D2). The legacy KOTReceipt
// is the oracle and stays byte-unchanged; the Classic KOT on the TEMPLATE path differs from it in exactly four mapped
// places, each an EXACT string rewrite (never a regex "close enough"), total: it throws rather than no-op.
//   (1) the root gains `break-words` as its last class (SlipEngine.slipRoot appends design.rootClass),
//   (2) every legacy `Line` row becomes the wrapping row (the bill's markup, A4),
//   (3) the item head's name span gains `min-w-0`,
//   (4) a VOID / MOVED slip locks the Table line on (KOT_LOCKS.withBanner), which legacy hides with kotShowTable off:
//       that one is a Settings difference, not markup, so `forceKotLocks` sets the flag the oracle is rendered with.
// `items` and `title` need nothing here: legacy always lists the dishes (a moved slip lists none, on both sides) and
// always prints the title. kotNo needs nothing: the engine now prints it iff kotShowNumber, legacy's own gate.

export const LEGACY_KOT_ITEM_HEAD = '<div class="flex justify-between font-bold"><span>';
export const WRAPPED_KOT_ITEM_HEAD = '<div class="flex justify-between font-bold"><span class="min-w-0">';
const LEGACY_KOT_HEAD_OPEN = '<div class="flex justify-between font-bold">';
const countOf = (html: string, needle: string): number => html.split(needle).length - 1;
const LEGACY_KOT_LINE_MARKER = 'class="whitespace-pre"';

/** The legacy settings with the banner locks forced on: a void / moved slip prints the Table line whatever kotShowTable says. */
export function forceKotLocks(s: Settings, extra: KotExtra): Settings {
  return extra.variant === "void" || extra.variant === "moved" ? { ...s, kotShowTable: true } : s;
}

/** The legacy kitchen ticket's markup mapped to what the Classic template path prints. Throws instead of no-op. */
export function withClassicKotWrap(legacyHtml: string): string {
  const root = LEGACY_ROOT_RE.exec(legacyHtml);
  if (!root) throw new Error("withClassicKotWrap: the first tag (after any logo preload links) is not the legacy kot root (bg-white p-3 font-mono text-black)");
  const rooted = `${root[1]}${root[2].slice(0, -1)} ${CLASSIC_WRAP_ROOT_CLASS}"${legacyHtml.slice(root[0].length)}`;
  const wrapped = rooted
    .replace(LEGACY_LINE_RE, (_all, label: string, value: string) => WRAPPED_LINE(label, value))
    .split(LEGACY_KOT_ITEM_HEAD).join(WRAPPED_KOT_ITEM_HEAD);
  if (wrapped.includes(LEGACY_KOT_LINE_MARKER)) throw new Error(`withClassicKotWrap: a legacy ${LEGACY_KOT_LINE_MARKER} survived the rewrite (a Line row of an unexpected shape)`);
  // Every item head must be the exact legacy shape just rewritten: a head of another shape (an unwrapped name span)
  // leaves the bare `<div ...font-bold">` count above the wrapped-head count.
  if (countOf(wrapped, LEGACY_KOT_HEAD_OPEN) !== countOf(wrapped, WRAPPED_KOT_ITEM_HEAD)) throw new Error("withClassicKotWrap: a legacy item head survived the rewrite (a head of an unexpected shape)");
  return wrapped;
}
