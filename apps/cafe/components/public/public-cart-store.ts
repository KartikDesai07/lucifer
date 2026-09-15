// Pure localStorage-backed persistence for the diner-side cart, identity and
// order-code history — CR2.2 SLICE 8. Zero React: PublicOrderFlow owns the
// React state and calls these on mount (hydrate) and on every change
// (persist), so this module only ever reads/writes plain JSON.
//
// Versioned keys (`.v1`) so a future shape change can migrate or discard
// cleanly instead of crashing on an old diner's stale localStorage entry.
//
// CACHE POLICY (SLICE 10)
// ------------------------------------------------------------------------
// localStorage here is for SMOOTHNESS ONLY. It is never a security boundary
// — every gate this data might imply (order ownership, identity, pricing)
// is re-checked server-side, and another diner's data is never cached under
// a key this device can read.
//
// Key ownership, by lifetime:
//   - CART            device-scoped. Survives logout — wiping a half-built
//                      cart on logout is hostile to the person still sitting
//                      at the table.
//   - IDENTITY         diner-scoped. Cleared on logout.
//   - CODES            diner-scoped (order-code history). Cleared on logout.
//   - MENU_PATH        diner-scoped ("Order more" context). Cleared on logout
//                      (grouped with identity/codes — it is who-you-are data).
//   - REFRESH          diner-scoped (per-order-code display timestamps).
//                      Cleared on logout. DISPLAY AID ONLY — see readRefreshAt.
//   - THEME            device preference, not diner data. Survives logout.
//   - MENU_CACHE       public data, not diner data. Survives logout.
//   - REQUESTED_REWARD diner-scoped INTENT. Cleared on logout AND on
//                      clearCart() (a submit) — see its own comment.
//   - APPLIED_PROMO    diner-scoped INTENT. Same two clear points as above.
//
// clearDinerData() (the logout-wide clear) removes exactly IDENTITY + CODES
// + MENU_PATH + REFRESH, PLUS REQUESTED_REWARD + APPLIED_PROMO (called
// directly, not via DINER_OWNED_KEYS — see clearDinerData's own comment). It
// deliberately does NOT touch CART, THEME or MENU_CACHE — see
// DINER_OWNED_KEYS below for the precise, exhaustive list of what IS in it.
const CART_KEY = "pos.public.cart.v1";
const IDENTITY_KEY = "pos.public.me.v1";
const CODES_KEY = "pos.public.codes.v1";
// CR2.6's "Order more" link (PublicOrderStatus.tsx) reads this back — the
// menu path the diner actually submitted from (their table's /m/<token>, a
// picked /m target, or bare /m), so ordering again returns them to the same
// context instead of a bare, un-tabled /m.
const MENU_PATH_KEY = "pos.public.menu.v1";
// SLICE 10 — per-order-code manual-refresh timestamps, so a countdown shown
// on PublicOrderStatus survives a tab reload. DISPLAY AID ONLY: the real
// fence is statusReadGate (lib/order-request-edit.ts) on the status GET — a
// DB-backed fixed window keyed per shortCode — so clearing or corrupting
// this key only makes the countdown look wrong, never bypasses the cooldown.
const REFRESH_KEY = "pos.public.refresh.v1";
// SLICE 10 — the diner's theme choice. A device preference, not diner data:
// never cleared by clearDinerData().
const THEME_KEY = "pos.public.theme.v1";
// SLICE 10 — a short-lived cache of the PUBLIC menu payload so the menu
// paints fast (industry bar: a QR menu must paint under 3s). POLICY: the
// menu is PUBLIC data only — never write anything diner-identifying (name,
// mobile, cart contents) into this key.
const MENU_CACHE_KEY = "pos.public.menucache.v1";
// CB-5B S8 — the diner's selected reward-claim INTENT (a milestone's `at`
// stamp count, never an amount or a dish — see buildOrderRequestBody). Bridges
// the Rewards tab (sets it) and the Cart drawer (reads it into the submit
// body) even though PublicOrderFlow sits between them and neither reaches
// into the other's React state — same cross-tab pattern CART_KEY already
// uses. Cleared on a successful submit (clearCart) AND on logout
// (clearDinerData): a reward claim requires a signed-in diner, so it must
// never survive past either of those.
const REQUESTED_REWARD_KEY = "pos.public.reward.v1";
// CB-5B S8 — mirrors REQUESTED_REWARD_KEY the other direction: the promo code
// currently applied in the Cart drawer, bridged so the Rewards tab can grey
// out its rungs while one is active (owner decision D6/A2 — reward and promo
// are mutually exclusive). Cleared wherever promoCode itself is cleared in
// usePublicCartSubmit (Remove, a server rejection, or a successful submit).
const APPLIED_PROMO_KEY = "pos.public.promo.v1";

// CR2.5's order-history page reads this list — capped so a diner who has
// ordered here for months doesn't accumulate an unbounded localStorage blob.
const MY_CODES_MAX = 20;
// SLICE 10 — same cap discipline applied to the refresh-timestamp map: bounds
// it to at most this many order codes, pruning the oldest entries first.
const REFRESH_MAX_ENTRIES = MY_CODES_MAX;
// SLICE 10 — the public menu cache is only ever "fresh" for this long; after
// it, callers should treat readMenuCache() as a miss and refetch.
export const MENU_CACHE_TTL_MS = 60_000;

// SLICE 10 — the allowed diner theme choices, exported so other slices
// (theme picker UI) import this instead of re-declaring the string literals.
export const THEME_VALUES = ["system", "light", "dark"] as const;
export type ThemeValue = (typeof THEME_VALUES)[number];

export interface CartLine {
  lineId: string;
  productId: string;
  // DISPLAY-ONLY snapshots, taken at add-to-cart time — the submit body
  // strips both (createPublicOrderRequestSchema's items carry no name/price;
  // the server re-derives the real price from the live product at request
  // time). Kept here only so the cart screen has something to render without
  // a second fetch.
  name: string;
  price: number;
  qty: number;
  variation?: string;
  modifiers: string[];
  instructions?: string;
}

export interface PublicIdentity {
  mobile: string;
  name: string;
}

// Every read tolerates a corrupt or absent value — a diner's browser storage
// is outside this app's control (another tab, a stale schema, a full quota
// truncating a write) and must never throw and crash the menu page.
function safeRead<T>(key: string, isValid: (v: unknown) => v is T): T | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return isValid(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function safeWrite(key: string, value: unknown): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota exceeded or storage disabled — the diner keeps ordering with an
    // in-memory-only cart for this session rather than crashing the page.
  }
}

function safeRemove(key: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key);
  } catch {
    // Storage disabled — nothing was persisted to begin with.
  }
}

function isCartLineArray(v: unknown): v is CartLine[] {
  return (
    Array.isArray(v) &&
    v.every(
      (line) =>
        typeof line === "object" &&
        line !== null &&
        typeof (line as CartLine).lineId === "string" &&
        typeof (line as CartLine).productId === "string" &&
        typeof (line as CartLine).qty === "number",
    )
  );
}

function isIdentity(v: unknown): v is PublicIdentity {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as PublicIdentity).mobile === "string" &&
    typeof (v as PublicIdentity).name === "string"
  );
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((c) => typeof c === "string");
}

function isRefreshMap(v: unknown): v is Record<string, number> {
  return (
    typeof v === "object" &&
    v !== null &&
    !Array.isArray(v) &&
    Object.values(v).every((at) => typeof at === "number")
  );
}

function isThemeValue(v: unknown): v is ThemeValue {
  return typeof v === "string" && (THEME_VALUES as readonly string[]).includes(v);
}

interface MenuCacheEntry {
  at: number;
  payload: unknown;
}

// `payload` is deliberately opaque (unknown) — this module never interprets
// the public menu shape, only the envelope around it — so validation checks
// only the envelope's own fields.
function isMenuCacheEntry(v: unknown): v is MenuCacheEntry {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as MenuCacheEntry).at === "number" &&
    "payload" in v
  );
}

export function readCart(): CartLine[] {
  return safeRead(CART_KEY, isCartLineArray) ?? [];
}

export function writeCart(cart: CartLine[]): void {
  safeWrite(CART_KEY, cart);
}

export function clearCart(): void {
  safeWrite(CART_KEY, []);
  clearRequestedRewardAt();
  clearAppliedPromoCode();
}

export function readIdentity(): PublicIdentity | null {
  return safeRead(IDENTITY_KEY, isIdentity);
}

export function writeIdentity(identity: PublicIdentity): void {
  safeWrite(IDENTITY_KEY, identity);
}

// FIX5 — the "Not you? Clear" affordance on PublicIdentityForm. Wipes the
// stored identity so the next readIdentity() call returns null, same as a
// diner who has never ordered on this device.
export function clearIdentity(): void {
  safeRemove(IDENTITY_KEY);
}

// CB-5B S8 — `null` means no reward is currently selected (never written, a
// selection that was cleared, or storage disabled/corrupt).
export function readRequestedRewardAt(): number | null {
  return safeRead(REQUESTED_REWARD_KEY, (v): v is number => typeof v === "number");
}

export function writeRequestedRewardAt(at: number): void {
  safeWrite(REQUESTED_REWARD_KEY, at);
}

export function clearRequestedRewardAt(): void {
  safeRemove(REQUESTED_REWARD_KEY);
}

// CB-5B S8 — `null` means no promo is currently applied.
export function readAppliedPromoCode(): string | null {
  return safeRead(APPLIED_PROMO_KEY, (v): v is string => typeof v === "string");
}

export function writeAppliedPromoCode(code: string): void {
  safeWrite(APPLIED_PROMO_KEY, code);
}

export function clearAppliedPromoCode(): void {
  safeRemove(APPLIED_PROMO_KEY);
}

export function readMyCodes(): string[] {
  return safeRead(CODES_KEY, isStringArray) ?? [];
}

function writeMyCodes(codes: string[]): void {
  safeWrite(CODES_KEY, codes);
}

// Most-recent-first, capped at MY_CODES_MAX. A code that (somehow) already
// exists is moved to the front rather than duplicated.
export function pushMyCode(code: string): void {
  const existing = readMyCodes().filter((c) => c !== code);
  writeMyCodes([code, ...existing].slice(0, MY_CODES_MAX));
}

// Written by PublicCart right where it pushes the order code (submit time),
// read by PublicOrderStatus's "Order more" link. `null` when never written
// (an old localStorage predating this field, or storage disabled) — callers
// fall back to the bare menu path themselves.
export function readLastMenuPath(): string | null {
  return safeRead(MENU_PATH_KEY, (v): v is string => typeof v === "string");
}

export function writeLastMenuPath(path: string): void {
  safeWrite(MENU_PATH_KEY, path);
}

// DISPLAY AID ONLY (see REFRESH_KEY comment). `null` when the code has never
// had a refresh recorded (a fresh order, or storage disabled/corrupt).
export function readRefreshAt(code: string): number | null {
  const map = safeRead(REFRESH_KEY, isRefreshMap) ?? {};
  const at = map[code];
  return typeof at === "number" ? at : null;
}

// Capped at REFRESH_MAX_ENTRIES codes, pruning the OLDEST entries first (by
// stored timestamp) so this key cannot grow without bound.
export function writeRefreshAt(code: string, at: number): void {
  const map = safeRead(REFRESH_KEY, isRefreshMap) ?? {};
  const next: Record<string, number> = { ...map, [code]: at };
  const entries = Object.entries(next);
  if (entries.length > REFRESH_MAX_ENTRIES) {
    entries.sort((a, b) => a[1] - b[1]); // oldest timestamp first
    const dropCount = entries.length - REFRESH_MAX_ENTRIES;
    for (const [staleCode] of entries.slice(0, dropCount)) {
      delete next[staleCode];
    }
  }
  safeWrite(REFRESH_KEY, next);
}

// SLICE 10 — the diner's theme choice. Anything outside THEME_VALUES
// (missing key, corrupt JSON, an old/foreign string) reads as null so
// callers fall back to their own default.
export function readTheme(): ThemeValue | null {
  return safeRead(THEME_KEY, isThemeValue);
}

export function writeTheme(v: ThemeValue): void {
  safeWrite(THEME_KEY, v);
}

// SLICE 10 — short-lived public menu cache (see MENU_CACHE_KEY policy
// comment above). Callers are expected to compare `at` against
// MENU_CACHE_TTL_MS themselves before trusting `payload`; this reader only
// guarantees the envelope shape, never freshness.
export function readMenuCache(): { at: number; payload: unknown } | null {
  return safeRead(MENU_CACHE_KEY, isMenuCacheEntry);
}

export function writeMenuCache(payload: unknown): void {
  safeWrite(MENU_CACHE_KEY, { at: Date.now(), payload });
}

// SLICE 10 — logout-wide clear (owner-decided scope). Removes exactly the
// diner-identity-shaped keys: IDENTITY + ORDER CODES + the "Order more" menu
// path + REFRESH TIMESTAMPS. Deliberately EXCLUDES:
//   - CART        — device-scoped, not diner-scoped; wiping a half-built
//                   cart on logout is hostile to the person still at the
//                   table.
//   - THEME       — a device preference, not diner data.
//   - MENU_CACHE  — public data, not diner data.
export const DINER_OWNED_KEYS = [IDENTITY_KEY, CODES_KEY, MENU_PATH_KEY, REFRESH_KEY] as const;

export function clearDinerData(): void {
  for (const key of DINER_OWNED_KEYS) {
    safeRemove(key);
  }
  // A reward claim requires a signed-in diner (see REQUESTED_REWARD_KEY's own
  // comment) — not in DINER_OWNED_KEYS because it is also cleared by
  // clearCart(), but a logout must wipe it too even mid-cart.
  clearRequestedRewardAt();
  clearAppliedPromoCode();
}
