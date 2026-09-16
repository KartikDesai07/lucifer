import { maskMobile } from "@pos/shared/utils";

// Only an admin sees a customer's real mobile number (owner rule): staff work
// the floor with the first few digits and nothing more.
//
// This is enforced HERE — on the way out of every route under /api/customers
// that returns one — and NOT in the components that render one. (One customer
// projection lives outside that directory: /api/reports selects `name mobile
// totalDue` unmasked for the dues report. That route is requireAdmin and
// /reports is in ADMIN_ROUTES, so its admin-only guard is load-bearing for this
// rule — a pin holds it there.) Blanking the digits in the UI
// would leave the real number sitting in the JSON response, the React Query
// cache and the browser's network tab, so it would hide the number from someone
// looking at the screen and from nobody else.
//
// The two rules that make this safe are both about NOT mutating the source:
// a customer document reaching these helpers may be the shared in-process cache
// entry (see the list route), and stamping a mask onto it would serve stars to
// the next ADMIN request as well.

const ADMIN_ROLE = "admin";

type WithMobile = { mobile?: unknown };

// Unknown/absent roles are treated as "not admin" — a role that fails to
// resolve must fail closed, never open.
export function canSeeFullMobile(role: string | undefined): boolean {
  return role === ADMIN_ROLE;
}

// Returns a COPY whenever it masks; never writes to `doc`. Documents without a
// string `mobile` (a projection that omitted it) pass through untouched.
export function maskCustomer<T extends WithMobile>(
  doc: T,
  role: string | undefined,
): T {
  if (canSeeFullMobile(role)) return doc;
  if (typeof doc?.mobile !== "string") return doc;
  return { ...doc, mobile: maskMobile(doc.mobile) };
}

// A NEW array of new objects when masking. The caller's array — which for the
// customer list IS the cached value — is left exactly as it was.
export function maskCustomers<T extends WithMobile>(
  docs: readonly T[],
  role: string | undefined,
): readonly T[] {
  if (canSeeFullMobile(role)) return docs;
  return docs.map((doc) => maskCustomer(doc, role));
}

// A staff client only ever HAS the masked number, so a `mobile` arriving from
// one can only be that mask echoed back by the edit form. Writing it would
// overwrite a unique-indexed field with "98765*****" and destroy a value the
// server cannot re-derive from anything else, so it is dropped instead.
// Admins — the only role that can see the number — keep the field.
export function stripMobileForRole<T extends WithMobile>(
  update: T,
  role: string | undefined,
): T {
  if (canSeeFullMobile(role) || update.mobile === undefined) return update;
  const { mobile: _dropped, ...rest } = update;
  return rest as T;
}
