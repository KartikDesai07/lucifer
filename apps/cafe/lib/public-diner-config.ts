import { selfOrderingAllowed } from "@pos/shared/public";
import { publicDinerBanners, type PublicDinerBanner } from "@pos/shared/public-diner";
import { readSettings } from "@/lib/settings";

// CB-4 — the ONE function the /m pages call to learn which diner features this
// cafe runs. Mirrors lib/public-appearance.ts exactly, and for the same
// reason: the /m server pages must have a single, narrow reach into Settings
// rather than spreading the settings doc (which is how a field this surface
// has no business publishing ends up on a diner's phone).
//
// Like readPublicAppearance, this NEVER spreads the settings document and
// returns a FRESH object built key-by-key, so a caller that mutates the result
// can never poison a shared constant for the life of the isolate.

export interface PublicDinerConfig {
  accountsEnabled: boolean;
  loyaltyEnabled: boolean;
  orderingAllowed: boolean;
  banners: readonly PublicDinerBanner[];
}

// Both OFF is the safe answer for every failure mode, and for every cafe that
// has not opted in. Note this is the OPPOSITE default from ordering (which
// stays ON for a legacy doc): ordering is behaviour live cafes already have,
// while a diner account is a NEW capability that must never switch itself on.
//
// orderingAllowed is TRUE here on purpose — this is the fallback used on a DB
// hiccup (the catch below) as well as any legacy/absent selfOrderMode. A cafe
// that already has ordering on must never have it silently switched off by a
// read failure; only "menu" mode (an explicit opt-OUT) may ever turn it off,
// and that requires a successful settings read to observe.
const DINER_FEATURES_OFF: PublicDinerConfig = {
  accountsEnabled: false,
  loyaltyEnabled: false,
  orderingAllowed: true,
  banners: [],
};

export async function readPublicDinerConfig(): Promise<PublicDinerConfig> {
  try {
    const settings = await readSettings();
    return {
      accountsEnabled: settings?.dinerAccountsEnabled === true,
      // Loyalty requires accounts — a stamp belongs to an account, so the
      // conjunction is resolved HERE rather than trusted to each caller.
      // Mirrors lib/diner-route-guard.ts's dinerLoyaltyOn on the API side.
      loyaltyEnabled: settings?.dinerAccountsEnabled === true && settings?.loyaltyEnabled === true,
      // The SHARED predicate, never a hand-written `=== "menu"` — see that
      // function's own comment on why it is written against the value that
      // DENIES rather than the values that allow.
      orderingAllowed: selfOrderingAllowed(settings?.selfOrderMode),
      // publicDinerBanners is the READ-side normaliser (trims, drops
      // titleless rows, clamps lengths, caps the count, returns FRESH
      // objects) — never a raw pass-through of the stored array, and NEVER
      // spread `settings` itself (this surface must have a single, narrow
      // reach into Settings — see this file's own top comment).
      banners: publicDinerBanners(settings?.dinerBanners),
    };
  } catch {
    // A DB hiccup must never 500 the diner's menu — the same discipline as
    // readPublicAppearance's own catch. The menu still renders; only the
    // account/stamp affordances are absent, and ordering stays ON (see
    // DINER_FEATURES_OFF's comment — a hiccup must never silently disable
    // ordering for a cafe that has it on).
    return { ...DINER_FEATURES_OFF };
  }
}
