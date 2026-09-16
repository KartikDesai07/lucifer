// Pure draft-editing helpers extracted out of PublicStatusItems.tsx (CR2.2d
// split D4) so that component stays under this repo's ~300-line budget.
// Zero React here — draft-line modeling, save-flow message copy, the PATCH
// body builder, and the promo-422 classification helper.
import {
  PROMO_INACTIVE,
  PROMO_INVALID,
  PROMO_SESSION_OPEN,
  PROMO_ALREADY_USED,
  type PublicStatusItem,
} from "@pos/shared/public";

export const SAVE_FAILED_MESSAGE = "Couldn't save your changes — please try again.";
export const NETWORK_ERROR = "You look offline — check the cafe WiFi and try again.";
export const TIMEOUT_ERROR = "That took too long — tap Save changes again.";
// Mirrors PublicCart.tsx's own SUBMIT_TIMEOUT_MS discipline — a stalled PATCH
// must never leave "Saving…" stuck with no way out.
export const SAVE_TIMEOUT_MS = 20_000;
export const REFRESH_MENU_HINT = " Please refresh the menu and try again.";
export const SOLD_OUT_EDIT_HINT = " Remove that item to save the rest of your order.";
export const RATE_LIMIT_MESSAGE = "Please wait a moment and try again.";
export const GENERIC_EDIT_ERROR = "Couldn't save your changes — please ask the staff at the counter.";
export const EMPTY_DRAFT_HINT = "To cancel the whole order, use Cancel order below.";
export const ACCEPTED_EDIT_NOTICE = "Being prepared — for changes, ask the staff at the counter";
// Matches PROMO_MIN_SUBTOTAL's own template (@pos/shared/public) — the ONE
// parameterized promo reason; the two literal reasons are imported directly.
const PROMO_MIN_SUBTOTAL_PATTERN = /^Add ₹\d+ more to use this code$/;
// Same idiom, mirroring lib/public-pricing.ts's SOLD_OUT_ERROR template — a
// local literal, NOT an import, because @/lib/public-pricing is forbidden in
// components/public/** (public-surface-paths.test.ts pin 8). Kept in sync by
// a parity pin (lib/public-status-edit.test.ts) that imports SOLD_OUT_ERROR
// and asserts this pattern matches its output. [\s\S] not `.`: product names
// are z.string().trim().min(1) — an interior newline is legal and must still
// match (review F4).
export const SOLD_OUT_PATTERN = /^"[\s\S]+" is sold out$/;

export function isPromoErrorMessage(message: string): boolean {
  return (
    message === PROMO_INVALID ||
    message === PROMO_INACTIVE ||
    // CR2.5 review F2 — the edit path's promo resolver also 422s with these
    // two (order-request-edit.ts:180,198); both are promo rejections and ride
    // the on-the-field contract, never the generic refresh banner.
    message === PROMO_SESSION_OPEN ||
    message === PROMO_ALREADY_USED ||
    PROMO_MIN_SUBTOTAL_PATTERN.test(message)
  );
}

// The 4xx shapes this route's non-409, non-promo-422 save responses can
// carry — pure given the status and (for 422) the envelope's own error text.
// The 409 branch (its own re-poll side effect) and the promo-422 branch (its
// own isPromoErrorMessage classification, pinned in the .tsx) stay in the
// component; this only covers the remaining, simpler status→message map.
export function classifyStatusSaveFailure(status: number, envelopeError: string | undefined): string {
  if (status === 422) {
    const message = envelopeError ?? SAVE_FAILED_MESSAGE;
    // A sold-out 422 can never be fixed by refreshing (§23.1) — the kept
    // line itself went sold-out, so the diner must remove it instead.
    const hint = envelopeError !== undefined && SOLD_OUT_PATTERN.test(envelopeError)
      ? SOLD_OUT_EDIT_HINT
      : REFRESH_MENU_HINT;
    return message + hint;
  }
  if (status === 429) return RATE_LIMIT_MESSAGE;
  if (status === 403 || status === 404 || status === 413) return GENERIC_EDIT_ERROR;
  return SAVE_FAILED_MESSAGE;
}

// A throw is NOT proof the save failed — the caller must never discard the
// draft on this path. Distinguishes the three shapes a diner can act on: a
// timeout (retry), being offline (fix WiFi), or an unknown network throw.
export function classifySaveError(e: unknown): string {
  const timedOut = e instanceof DOMException && e.name === "TimeoutError";
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  return timedOut ? TIMEOUT_ERROR : offline ? NETWORK_ERROR : SAVE_FAILED_MESSAGE;
}

export interface DraftLine extends PublicStatusItem {
  lineId: string;
}

// Deterministic per-index id (never a mutable counter) — the server hands
// back a fresh `items` array reference on EVERY poll tick even when nothing
// changed, so a counter-based id would re-key (and remount) every row on
// every tick while the diner is just looking, not editing.
export function seedDraft(items: PublicStatusItem[]): DraftLine[] {
  return items.map((item, i) => ({ ...item, lineId: `${item.productId}-${i}` }));
}

export function sameLine(a: DraftLine, b: DraftLine): boolean {
  return (
    a.productId === b.productId &&
    a.qty === b.qty &&
    a.variation === b.variation &&
    a.instructions === b.instructions &&
    // Verbatim from the pre-split source: the join separator is a literal
    // U+0001 control char, not "" — preserved exactly (any separator works
    // identically here since both sides use the SAME one; this just avoids
    // an invisible literal in source, per this repo's own lesson on those).
    a.modifiers.join("\u0001") === b.modifiers.join("\u0001")
  );
}

export function draftsEqual(a: DraftLine[], b: DraftLine[]): boolean {
  return a.length === b.length && a.every((line, i) => sameLine(line, b[i]));
}

export interface StatusPatchBodyInput {
  draft: DraftLine[];
  noteDraft: string;
  promoDraft: string | null;
  promoSeed: string | null;
}

// Three-way promo semantics, matching note's own round-trip EXCEPT the
// "keep" branch: unlike note, the client can never observe the stored
// promoCode drift on its own (no field on the GET contract beyond the seed),
// so "untouched" (promoDraft === seed) must stay OMITTED rather than
// round-tripped.
export function buildStatusPatchBody(input: StatusPatchBodyInput) {
  const { draft, noteDraft, promoDraft, promoSeed } = input;
  return {
    items: draft.map((line) => ({
      productId: line.productId,
      qty: line.qty,
      variation: line.variation,
      modifiers: line.modifiers,
      instructions: line.instructions,
    })),
    // Always sent (round-trip): "" clears the stored note, text replaces it
    // — only an ABSENT key means "keep", and this client always knows the
    // current value, so it never needs "keep".
    note: noteDraft.trim(),
    ...(promoDraft !== promoSeed ? { promoCode: promoDraft ?? "" } : {}),
    hp: "",
  };
}
