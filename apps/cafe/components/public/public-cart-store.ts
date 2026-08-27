// Pure localStorage-backed persistence for the diner-side cart, identity and
// order-code history — CR2.2 SLICE 8. Zero React: PublicOrderFlow owns the
// React state and calls these on mount (hydrate) and on every change
// (persist), so this module only ever reads/writes plain JSON.
//
// Versioned keys (`.v1`) so a future shape change can migrate or discard
// cleanly instead of crashing on an old diner's stale localStorage entry.
const CART_KEY = "pos.public.cart.v1";
const IDENTITY_KEY = "pos.public.me.v1";
const CODES_KEY = "pos.public.codes.v1";
// CR2.6's "Order more" link (PublicOrderStatus.tsx) reads this back — the
// menu path the diner actually submitted from (their table's /m/<token>, a
// picked /m target, or bare /m), so ordering again returns them to the same
// context instead of a bare, un-tabled /m.
const MENU_PATH_KEY = "pos.public.menu.v1";

// CR2.5's order-history page reads this list — capped so a diner who has
// ordered here for months doesn't accumulate an unbounded localStorage blob.
const MY_CODES_MAX = 20;

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

export function readCart(): CartLine[] {
  return safeRead(CART_KEY, isCartLineArray) ?? [];
}

export function writeCart(cart: CartLine[]): void {
  safeWrite(CART_KEY, cart);
}

export function clearCart(): void {
  safeWrite(CART_KEY, []);
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
