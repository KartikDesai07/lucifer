// Why a new file: nothing in @pos/shared decides idempotency yet, and this rule
// must be ONE rule for both the server routes (apps/cafe/lib/order-idem.ts) and
// the POS send controller. Pure and client-safe — no Mongoose, no Node APIs.
//
// F5 — safe re-taps. A Send to Kitchen / Pay Now carries an `idemKey` (a UUID
// minted once per attempt). A re-send after "Couldn't confirm" repeats the
// same key, so a first try that actually landed is REPLAYED, never made twice.

/** kotIdemKeys backfill for a round fired without a key. Never a valid key. */
export const KOT_IDEM_KEY_NONE = "";

export const IDEM_REPLAY_CANCELLED_ERROR =
  "This order was cancelled on another device — check before sending again";
export const IDEM_KEY_MISMATCH_ERROR =
  "This send no longer matches what reached the kitchen — check the tab before sending again";

const ORDER_STATUS_CANCELLED = "Cancelled";

/** A lean doc's ObjectId or the client's hex string — both stringify to the hex. */
type IdemProductId = string | { toString(): string };

export interface IdemLine {
  productId: IdemProductId;
  variation?: string | null;
  // "NO …" removals (Product.modifiersPreselected) — part of what was sent.
  removedModifiers?: ReadonlyArray<string> | null;
  qty: number;
}

export interface IdemStoredLine extends IdemLine {
  kotRound?: number;
  reward?: boolean;
}

export type IdemReplayVerdict = { kind: "replay" } | { kind: "refuse"; error: string };

/**
 * The tab's kotIdemKeys after firing `round` with `key`. Positional, the same
 * idiom as the items route's kotNumbers build: index round-1 gets the key and
 * earlier slots keep their own (or the sentinel). No key → undefined, so the
 * route writes nothing (omit-empty).
 */
export function buildKotIdemKeys(
  old: ReadonlyArray<string> | undefined,
  round: number,
  key: string | undefined,
): string[] | undefined {
  if (!key) return undefined;
  return Array.from({ length: round }, (_, i) =>
    i === round - 1 ? key : (old?.[i] ?? KOT_IDEM_KEY_NONE),
  );
}

/** The round this key was fired as, or undefined. The sentinel never matches. */
export function kotRoundOfIdemKey(
  order: { kotIdemKeys?: ReadonlyArray<string> },
  key: string,
): number | undefined {
  if (!key) return undefined;
  const at = order.kotIdemKeys?.indexOf(key) ?? -1;
  return at < 0 ? undefined : at + 1;
}

// Separators for the removals segment — escapes, never literal control chars
// (a cashier cannot type either, so no modifier name can forge a boundary).
const IDEM_REMOVED_SEP = "\u001e";
const IDEM_REMOVED_ITEM_SEP = "\u001f";

function lineKey(l: IdemLine): string {
  const base = `${String(l.productId)}|${l.variation ?? ""}`;
  // A Pizza with NO Mushroom is not the Pizza that was sent without it: a
  // replay whose removals differ is a mismatch. Appended only when present,
  // so every key for a line without removals is byte-identical to before.
  const removed = l.removedModifiers ?? [];
  return removed.length > 0
    ? `${base}${IDEM_REMOVED_SEP}${[...removed].sort().join(IDEM_REMOVED_ITEM_SEP)}`
    : base;
}

function addQty(into: Map<string, number>, l: IdemLine): void {
  const k = lineKey(l);
  into.set(k, (into.get(k) ?? 0) + l.qty);
}

/**
 * Did round `round` land with exactly the lines this attempt sent? Compared as
 * qty per product+variation(+removals). The stored side adds the round's voids back (a
 * void between landing and the re-send is still the same round) and leaves out
 * the server's own reward lines, which the client never sends. A Map, not an
 * object literal, so no key can collide with a prototype property.
 */
export function sameRoundItems(
  sent: ReadonlyArray<IdemLine>,
  stored: ReadonlyArray<IdemStoredLine>,
  voids: ReadonlyArray<IdemStoredLine>,
  round: number,
): boolean {
  const want = new Map<string, number>();
  for (const l of sent) addQty(want, l);
  const got = new Map<string, number>();
  for (const l of [...stored, ...voids]) {
    if (l.kotRound === round && !l.reward) addQty(got, l);
  }
  if (want.size !== got.size) return false;
  for (const [k, qty] of want) {
    if (got.get(k) !== qty) return false;
  }
  return true;
}

/** Replay the order/round the key already landed as, or refuse with a reason. */
export function idemReplayVerdict(
  order: {
    status: string;
    items: ReadonlyArray<IdemStoredLine>;
    voids?: ReadonlyArray<IdemStoredLine>;
  },
  sent: ReadonlyArray<IdemLine>,
  round: number,
): IdemReplayVerdict {
  if (order.status === ORDER_STATUS_CANCELLED) {
    return { kind: "refuse", error: IDEM_REPLAY_CANCELLED_ERROR };
  }
  if (!sameRoundItems(sent, order.items, order.voids ?? [], round)) {
    return { kind: "refuse", error: IDEM_KEY_MISMATCH_ERROR };
  }
  return { kind: "replay" };
}
