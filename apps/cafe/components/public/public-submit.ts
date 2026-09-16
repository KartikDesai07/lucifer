// Pure submit-side helpers extracted out of PublicCart.tsx (CR2.2d split D4)
// so that component stays under this repo's ~300-line budget. Zero React
// here — message copy, promo-422 classification, target resolution, and the
// POST body builder, none of which touch state.
import {
  PROMO_INACTIVE,
  PROMO_INVALID,
  PROMO_SESSION_OPEN,
  PROMO_ALREADY_USED,
  REWARD_NEEDS_SIGN_IN,
  REWARD_NOT_ON_CARD,
  REWARD_NOT_ENOUGH_STAMPS,
  REWARD_BILL_TOO_SMALL,
  REWARD_PROMO_EXCLUSIVE,
  REWARD_ON_OPEN_TAB,
} from "@pos/shared/public";
import type { CreatePublicOrderRequestInput, PublicOrderTarget } from "@pos/shared/schemas/public-order.schema";
import type { CartLine } from "@/components/public/public-cart-store";
import type { TablePick } from "@/components/public/TableChooser";

export const GENERIC_SEND_ERROR = "Couldn't send your order — please try again.";
export const NETWORK_ERROR = "You look offline — check the cafe WiFi and try again.";
export const TIMEOUT_ERROR = "That took too long — tap Send again.";
export const SEND_FAILED_RETRY_ERROR = "Couldn't reach the counter — tap Send again.";
// 20s: generous for cafe WiFi, short enough that a diner is never stared at
// an endless "Sending…" (the field-reported failure shape on mobile).
export const SUBMIT_TIMEOUT_MS = 20_000;
export const DEVICE_ERROR = "We couldn't verify your device — please order at the counter.";
export const RATE_LIMIT_ERROR = "Too many orders from this table right now — try again in a minute.";
export const MENU_CHANGED_ERROR = "The menu just changed — please review your cart.";
export const NO_TARGET_ERROR = "Pick a table or Parcel above to continue.";
// §6.2 / FIX6: the client never sends a table NAME as a target — the tables
// list deliberately carries no tokens, so a name-only pick can never become
// one. Surfaced the moment the pick IS a name (not just at submit time), so
// TABLE_NAME_BLOCKED_ERROR doubles as both the pre-submit and submit-time copy.
export const TABLE_NAME_BLOCKED_ERROR =
  "Scan the QR sticker on your table to send this order — or choose Parcel.";
export const MALFORMED_RESPONSE_ERROR = "Something went wrong sending your order — please try again.";
// Matches PROMO_MIN_SUBTOTAL's own template (@pos/shared/public) — the ONE
// parameterized promo reason, so it can't be told apart from the other two
// by an exact-string check. The two literal reasons (PROMO_INVALID /
// PROMO_INACTIVE) are imported directly rather than duplicated.
const PROMO_MIN_SUBTOTAL_PATTERN = /^Add ₹\d+ more to use this code$/;

// CB-5B S8 — resolveRequestReward's diner-facing 422 copy, IMPORTED from
// @pos/shared/public (pure, client-safe) rather than hand-copied. The server
// gate (lib/order-request-reward.ts) imports the same constants from the same
// place, so the string this file compares against and the string the route
// returns cannot drift apart — which on a money path would silently stop the
// cart reverting a rejected reward selection.

// A 422 whose text is one of resolveRequestReward's own refusals — pure
// given the message, same shape as isPromoErrorMessage.
export function isRewardErrorMessage(message: string): boolean {
  return (
    message === REWARD_NEEDS_SIGN_IN ||
    message === REWARD_NOT_ON_CARD ||
    message === REWARD_NOT_ENOUGH_STAMPS ||
    message === REWARD_BILL_TOO_SMALL ||
    message === REWARD_PROMO_EXCLUSIVE ||
    message === REWARD_ON_OPEN_TAB
  );
}

// A 422 on this route only ever carries ONE of two shapes: a promo rejection
// (resolveRequestPromo) or "the menu changed" (priceRequestItems) — never
// both, and their copy never collides (checked against the route's own
// error strings). A promoCode was sent this submit is a precondition too, so
// this can only ever fire when there was one to reject.
export function isPromoErrorMessage(message: string): boolean {
  return (
    message === PROMO_INVALID ||
    message === PROMO_INACTIVE ||
    // CR2.5 review F2 — the create path's resolver also 422s with these two
    // (order-request-create.ts:69,84); without them here they fell through to
    // MENU_CHANGED_ERROR, telling the diner to review a cart that was fine.
    message === PROMO_SESSION_OPEN ||
    message === PROMO_ALREADY_USED ||
    PROMO_MIN_SUBTOTAL_PATTERN.test(message)
  );
}

// Pure given the two props that decide it — token (a real scan) always wins,
// then the /m (no-token) name-based pick, which may only ever resolve to
// "parcel" (a tableName pick is blocked, never sent as a target).
export function resolveTarget(
  token: string | undefined,
  pickedTable: TablePick | null,
): { ok: true; target: PublicOrderTarget } | { ok: false; message: string } {
  if (token) return { ok: true, target: { kind: "table", token } };
  if (pickedTable === null) return { ok: false, message: NO_TARGET_ERROR };
  if (pickedTable.kind === "parcel") return { ok: true, target: { kind: "parcel" } };
  return { ok: false, message: TABLE_NAME_BLOCKED_ERROR };
}

export type SubmitFailure =
  | { promoRejected: true; message: string }
  | { promoRejected: false; message: string };

// The non-201 response shapes this route can ever return — pure given the
// status code, whether a promo was sent, and (only for 422) the envelope's
// own error text. A promo rejection is surfaced on the FIELD itself,
// verbatim, never as the generic send error — and it must not read as
// "still applied" while the diner fixes it.
//
// CB-5B S8 — deliberately UNCHANGED signature/shape (a reward rejection is
// classified separately by classifyRewardFailure below, checked by the
// caller BEFORE this): pinned verbatim by public-diner-polish.test.ts's
// classifySubmitFailure(422, code, message) call and exact 2-key
// deepEqual, which a promoRejected/rewardRejected union would break.
export function classifySubmitFailure(
  status: number,
  promoCode: string | null,
  envelopeError: string | undefined,
): SubmitFailure {
  if (status === 403) return { promoRejected: false, message: DEVICE_ERROR };
  if (status === 429) return { promoRejected: false, message: RATE_LIMIT_ERROR };
  if (status === 422) {
    if (promoCode !== null && envelopeError && isPromoErrorMessage(envelopeError)) {
      return { promoRejected: true, message: envelopeError };
    }
    return { promoRejected: false, message: MENU_CHANGED_ERROR };
  }
  return { promoRejected: false, message: GENERIC_SEND_ERROR };
}

// CB-5B S8 — the reward twin of classifySubmitFailure, kept as its OWN
// function rather than folded into that one so its pinned signature/shape
// stays untouched (see the comment above). Only ever meaningful on a 422:
// 403/429/other status codes are already fully handled by
// classifySubmitFailure, so the caller checks this FIRST and falls back to
// that for everything else. Returns null when the 422 is not a reward
// rejection (no reward was sent, or the text doesn't match).
export function classifyRewardFailure(
  status: number,
  requestedRewardAt: number | null,
  envelopeError: string | undefined,
): string | null {
  if (status !== 422) return null;
  if (requestedRewardAt === null || !envelopeError) return null;
  return isRewardErrorMessage(envelopeError) ? envelopeError : null;
}

// A throw here is NOT proof the order failed — the WiFi could have dropped
// after it landed; the caller must never clear the cart/identity on this
// path. Distinguishes the three shapes a diner can actually act on: a
// timeout (retry), being offline (fix WiFi), or an unknown network throw.
export function classifySubmitError(e: unknown): string {
  const timedOut = e instanceof DOMException && e.name === "TimeoutError";
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  return timedOut ? TIMEOUT_ERROR : offline ? NETWORK_ERROR : SEND_FAILED_RETRY_ERROR;
}

export interface BuildOrderRequestBodyInput {
  target: PublicOrderTarget;
  cart: CartLine[];
  note: string;
  promoCode: string | null;
  name: string;
  mobile: string;
  // CB-5B S8 — the milestone `at` PublicRewardsTab's claim affordance
  // selected, an INTENT ONLY (never an amount or a dish — see
  // createPublicOrderRequestSchema's own comment). `null` when no rung is
  // selected, mirroring promoCode's own null-means-none shape.
  requestedRewardAt: number | null;
}

// Builds EXACTLY createPublicOrderRequestSchema's .strict() shape — items
// carry no price/name, the server derives both from the live product.
export function buildOrderRequestBody(input: BuildOrderRequestBodyInput): CreatePublicOrderRequestInput {
  const { target, cart, note, promoCode, name, mobile, requestedRewardAt } = input;
  return {
    target,
    items: cart.map((line) => ({
      productId: line.productId,
      variation: line.variation,
      modifiers: line.modifiers,
      instructions: line.instructions,
      qty: line.qty,
    })),
    note: note.trim().length > 0 ? note.trim() : undefined,
    promoCode: promoCode ?? undefined,
    requestedRewardAt: requestedRewardAt ?? undefined,
    name: name.trim(),
    mobile: mobile.trim(),
  };
}
