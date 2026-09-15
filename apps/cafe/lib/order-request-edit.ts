import { NextResponse } from "next/server";
import { z } from "zod";

import {
  PUBLIC_ORDER_MAX_ITEMS,
  PUBLIC_NOTE_MAX_LEN,
  resolvePromoDiscount,
  PROMO_SESSION_OPEN,
  PROMO_ALREADY_USED,
  canonicalPromoMobile,
  normalizePromoCode,
  sanitizePublicText,
  type PublicStatusItem,
  PUBLIC_STATUS_REFRESH_COOLDOWN_MS,
  PUBLIC_STATUS_READ_MAX,
  PUBLIC_STATUS_READ_BUCKET_PREFIX,
} from "@pos/shared/public";
import { publicOrderItemSchema } from "@pos/shared/schemas/public-order.schema";
import { mintedPromoCodes } from "@pos/shared/loyalty-rules";
import type { IOrderRequestItem, OrderRequestStatus } from "@/models/OrderRequest";
import type { ISettings } from "@/models/Settings";
import { PromoRedemption } from "@/models/PromoRedemption";
import { assignedRewardRefusal } from "@/lib/assigned-reward-gate";
import { failure } from "@/lib/api-helpers";
import { hitRateLimit } from "@/lib/public-rate-limit";
import { quoteRequestTotals, type IntakeTable } from "@/lib/order-request-intake";
import type { PricedLine } from "@/lib/public-pricing";

// Sibling of app/api/public/order-request/[shortCode]/route.ts (CR2.2d split,
// extended CR2.3b S8) — split out purely to keep the route file under the
// ~300-line budget while GET/PATCH's own numbered control flow (pinned by
// lib/order-request-paths.test.ts) stays intact THERE. Holds the PATCH-only
// Zod schema, the promo resolver, the status->409 guard, and (S8) the GET's
// item-mapping helper the route calls into.

// GET's stored-item -> diner-facing mapping (moved here in CR2.3b S8;
// behavior-identical to the inline block it replaced). `productId` is always
// a STRING here — the model's own field is an ObjectId (CB-DL-2), so this
// String(...) is the REAL serialisation boundary, not a defensive cast.
export function toStatusItems(items: IOrderRequestItem[]): PublicStatusItem[] {
  return items.map((item) => {
    const statusItem: PublicStatusItem = {
      productId: String(item.productId),
      name: item.name,
      price: item.price,
      qty: item.qty,
      modifiers: item.modifiers,
    };
    if (item.variation) statusItem.variation = item.variation;
    if (item.instructions) statusItem.instructions = item.instructions;
    return statusItem;
  });
}

export interface EditUpdateResult {
  update: Record<string, unknown>;
  editedNote?: string;
}

// PATCH's step-14 CAS update builder (moved here in CR2.3b S8, alongside the
// route's line-cap offset — behavior-identical to the inline block it
// replaced). `note`/`quotedChargeLabel`/promo all keep the SAME omit-empty
// $set/$unset discipline (never an empty $unset object — Mongo errors on
// it). `editedNote` mirrors the note verdict so the caller's Telegram
// summary (S8) can carry the post-edit note without a second derivation.
export function buildEditUpdate(
  quote: ReturnType<typeof quoteRequestTotals>,
  noteInput: string | undefined,
  promoCode: string | undefined,
  storedNote: string | undefined,
): EditUpdateResult {
  const set: Record<string, unknown> = {
    items: quote.items,
    quotedSubtotal: quote.quotedSubtotal,
    quotedCharge: quote.quotedCharge,
    quotedTotal: quote.quotedTotal,
  };
  const unset: Record<string, ""> = {};
  if (quote.quotedChargeLabel) set.quotedChargeLabel = quote.quotedChargeLabel;
  else unset.quotedChargeLabel = "";
  let editedNote = storedNote;
  if (noteInput !== undefined) {
    const note = sanitizePublicText(noteInput);
    editedNote = note || undefined;
    if (note) set.note = note;
    else unset.note = "";
  }
  if (quote.quotedDiscount > 0) set.quotedDiscount = quote.quotedDiscount;
  else unset.quotedDiscount = "";
  if (promoCode) set.promoCode = promoCode;
  else unset.promoCode = "";
  const update: Record<string, unknown> = { $set: set };
  if (Object.keys(unset).length > 0) update.$unset = unset;
  return { update, editedNote };
}

// Every response — success included — is uncacheable: this is one diner's
// personal order state, reachable only by the capability code handed to them
// at submission time.
export function noStore<T extends { headers: Headers }>(res: T): T {
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("X-Content-Type-Options", "nosniff");
  return res;
}

export const ORDER_NOT_FOUND_MESSAGE = "We couldn't find that order";
export const ORDER_STATUS_FAILED_MESSAGE = "Could not look up that order";
export const BOT_DENIED_MESSAGE = "Access denied"; // same copy as POST /api/public/order-request
export const BODY_TOO_LARGE_MESSAGE = "That order is too large to send"; // same copy as POST
export const BAD_REQUEST_MESSAGE = "We couldn't read that order — please try again"; // same copy as POST
export const ORDER_EDIT_FAILED_MESSAGE = "Could not save your changes";
export const RATE_LIMITED_MESSAGE = "Too many changes to this order right now";
const EDIT_LOCKED_ERROR =
  "The cafe has already started preparing this order — please ask the staff for changes";
const EDIT_CANCELLED_ERROR = "This order was already cancelled";
// The accept bridge refuses (and the prune sweep deletes) any pending row
// older than the 12h cutoff — accepting an edit to one would hand the diner a
// "saved" order that can never be accepted.
export const EDIT_TOO_OLD_MESSAGE = "This order is too old to change — please place a fresh order";
// A table-kind request whose Table row no longer resolves (renamed/deleted
// under a pending request) AND has no open tab is doomed at accept
// (TABLE_STATE_CONFLICT there) — saying so beats a 200 with a silently
// re-priced charge. With an open tab the accept bridge takes the add-round
// branch and never reads the Table row at all, so that case still edits.
export const EDIT_TABLE_CHANGED_MESSAGE = "The cafe changed this table — please ask the staff";
// An edit may only change what the diner already ordered (quantities, or
// dropping a line) — adding a NEW product happens through "Order more",
// which goes down the create path with its create-time rules. Enforcing
// membership here is also what lets the re-pricing below use the accept
// bridge's isActive-only filter without opening a way to order a product
// that was deliberately hidden from the public menu.
export const EDIT_NEW_ITEM_MESSAGE = "You can only change the items already in this order — use Order more to add something new";
// Only reachable if the CAS misses yet a re-read still finds "pending" — no
// legitimate race reaches this (a racing PATCH that keeps the row "pending"
// would have matched the SAME CAS filter itself); defensive, never assumed.
export const EDIT_CONFLICT_MESSAGE = "Something changed while saving — please try again";

// Reuses the create schema's own item-line sub-schema + bounds — never a
// forked copy. Identity/target are NOT here (not editable, §17.C); `hp` is
// deliberately absent too, lifted off the raw body before this ever runs.
// `note` semantics (review finding 2026-08-20): ABSENT key = keep the stored
// note untouched; "" = clear it; non-empty = replace. min(1) would make ""
// unsendable and turn every qty-only edit into a silent note deletion — the
// allergy-note failure. Empty string is therefore explicitly allowed here.
// `promoCode` mirrors `note`'s own three-way semantics (CR2.2c): ABSENT key =
// keep the stored code (re-resolved against live Settings + the NEW
// subtotal); "" = remove it; non-empty = apply that code. No min(1) — same
// reasoning as `note` above, "" must stay sendable.
export const editOrderRequestSchema = z
  .object({
    items: z.array(publicOrderItemSchema).min(1).max(PUBLIC_ORDER_MAX_ITEMS),
    note: z.string().trim().max(PUBLIC_NOTE_MAX_LEN).optional(),
    promoCode: z.string().trim().max(16).optional(),
  })
  .strict();

// Resolves the promo code an edit should end up with — three-way semantics
// matching `note`'s own (CR2.2c): `data.promoCode === undefined` keeps the
// STORED code (re-resolved against live Settings + the NEW subtotal, never
// trusted as-is), an empty string removes it, non-empty text applies it.
// Shared shape with the create route's own resolver — never a diner-sent
// amount, only a code goes in.
export async function resolveEditPromo(
  data: { promoCode?: string },
  // The loaded request row — read here rather than as two scalar params so
  // the identity field this reads (see the SPEC P4 comment below) never has
  // to be typed out in the route file itself: the sibling status GET in that
  // SAME file is banned (pinned in order-request-paths.test.ts) from ever
  // mentioning it, anywhere in the file, since it must never leak to a diner.
  stored: { _id?: unknown; promoCode?: string; mobile: string },
  lines: PricedLine[],
  table: IntakeTable | null,
  settings: ISettings | null,
  chargeApplies: boolean,
): Promise<{ discount: number; code?: string } | { error: string }> {
  const requested = data.promoCode !== undefined ? data.promoCode : stored.promoCode;
  if (!requested) return { discount: 0 };
  // SERVER-side session gate, mirroring the create route (review 2026-08-20):
  // a NEW code may only be applied while this request is still the table's
  // first of the session (`chargeApplies` = no open tab, no sibling carrying
  // the charge). An ALREADY-STORED code is exempt — it was granted when the
  // session did start here, and re-resolving it is how drift gets caught.
  // Without this, the pending-edit screen was a way to re-apply one flat code
  // to every round of a tab and walk out with a zero bill.
  const isNewCode = normalizePromoCode(requested) !== normalizePromoCode(stored.promoCode ?? "");
  if (isNewCode && !chargeApplies) return { error: PROMO_SESSION_OPEN };
  const probe = quoteRequestTotals(lines, table, settings, chargeApplies);
  // CB-5D part 2 FINAL — a milestone-minted code is single-use regardless of
  // its Settings row's own tick (owner: "code sirf usi customer ka, ek baar").
  const resolved = resolvePromoDiscount(
    settings?.promoCodes,
    requested,
    probe.quotedSubtotal,
    mintedPromoCodes(settings?.loyaltyRules?.milestones),
  );
  if ("error" in resolved) return { error: resolved.error };
  // CB-5D part 2 DEFECT FIX — same single-homed expiry gate as the create
  // route (lib/assigned-reward-gate.ts). Checked AFTER resolvePromoDiscount so
  // an invalid/inactive code still says so, never "expired". The identity
  // field is always the request's own STORED mobile — it is not editable.
  const expired = await assignedRewardRefusal(resolved.code, stored.mobile, Date.now());
  if (expired) return { error: expired };
  // SPEC P4 — same quote-time courtesy check as the create route (see
  // order-request-create.ts's resolveRequestPromo). The identity field is
  // always the request's own STORED value — it is not editable.
  if (resolved.oncePerCustomer) {
    // Canonical mobile (the fence's own key), and THIS request's own claim is
    // excluded: a claimed-then-reverted accept leaves a redemption row keyed
    // to this requestId, and without the exclusion the request could never be
    // edited again while a staff re-accept of it would succeed via replay —
    // two surfaces disagreeing about the same row (review MED #3).
    const used = await PromoRedemption.exists({
      code: resolved.code,
      mobile: canonicalPromoMobile(stored.mobile),
      ...(stored._id ? { requestId: { $ne: String(stored._id) } } : {}),
    });
    if (used) return { error: PROMO_ALREADY_USED };
  }
  return { discount: resolved.discount, code: resolved.code };
}

// Maps the LOCKED/CANCELLED statuses to their 409s, `null` for "pending"
// (proceed). Shared by the fresh status gate and the post-CAS-miss re-read
// so the two can never disagree about what a status means.
export function editStatusGuard(status: OrderRequestStatus): NextResponse | null {
  if (status === "accepting" || status === "accepted") return failure(EDIT_LOCKED_ERROR, 409);
  if (status === "rejected") return failure(EDIT_CANCELLED_ERROR, 409);
  return null;
}


// ── The diner STATUS-READ cooldown (CB-6A S4) ───────────────────────────────
// Lives here, not in the route, for the same reason the edit helpers above do:
// the [shortCode] route sits at this repo's ~300-line file budget.
//
// Keyed PER SHORTCODE, never per-source/IP — this key shape is LOAD-BEARING.
// PublicMyOrdersTab.tsx fans out up to 8 concurrent GETs for 8 DISTINCT codes
// on mount, and PublicStatusTimeline.tsx fetches up to 4 more sibling codes;
// a shared or IP-keyed bucket would starve those surfaces against their own
// reads. Distinct codes = distinct buckets, so only hammering ONE code trips.
export function statusReadBucket(shortCode: string): string {
  return `${PUBLIC_STATUS_READ_BUCKET_PREFIX}:${shortCode}`;
}

// Records one status read and returns a ready 429 (carrying Retry-After) when
// the window is spent, or `null` to proceed. Callers MUST have shape-validated
// the code first — a malformed code must never burn a window slot.
export async function statusReadGate(
  shortCode: string,
  now: number,
  noStoreFn: (res: NextResponse) => NextResponse,
): Promise<NextResponse | null> {
  const decision = await hitRateLimit(statusReadBucket(shortCode), PUBLIC_STATUS_READ_MAX, now);
  if (decision.allowed) return null;
  const res = noStoreFn(failure(RATE_LIMITED_MESSAGE, 429));
  res.headers.set("Retry-After", String(decision.retryAfterSec));
  return res;
}

// The cooldown, in seconds, named on every successful status read so the diner
// UI's refresh button can show a countdown that stays correct even after a tab
// reload. A HEADER, deliberately: a body-shape change would force a
// cached-blob version bump elsewhere.
export const REFRESH_AFTER_HEADER = "X-Refresh-After";
export function refreshAfterSeconds(): string {
  return String(PUBLIC_STATUS_REFRESH_COOLDOWN_MS / 1000);
}
