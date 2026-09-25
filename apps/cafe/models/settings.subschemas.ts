import { Schema } from "mongoose";
import { PROMO_KINDS, type PromoCodeConfig } from "@pos/shared/public";
import { LOYALTY_REWARD_KINDS } from "@pos/shared/public-diner";
import {
  PRESET_IDS,
  FONT_PAIR_KEYS,
  CORNER_RADII,
  DENSITIES,
  LOGO_PLACEMENTS,
  type AppearanceInput,
} from "@pos/shared/appearance";
import type {
  LoyaltyRulesInput,
  LoyaltyMilestoneInput,
} from "@pos/shared/schemas/settings-loyalty.schema";
import type { DinerBannerInput } from "@pos/shared/schemas/settings-diner.schema";

// CB-5A S2 — split out of models/Settings.ts (that file's own ~300-line
// budget). promoCodeSchema and appearanceMongooseSchema moved VERBATIM;
// loyaltyRulesMongooseSchema (CB-5A) is new. Settings.ts re-exports this
// whole module (`export * from "./settings.subschemas"`) so no consumer
// import path changes.

// Exported as a SCHEMA for the F2 per-cluster registry (schemas-not-models, #21);
// the default-bound `Settings` export below stays for the live v1 routes.
// One configured promo code — embedded, never saved independently, so
// `_id:false` (mirrors productVariationSchema/orderRequestItemSchema).
export const promoCodeSchema = new Schema<PromoCodeConfig>(
  {
    code: { type: String, required: true },
    label: { type: String },
    kind: { type: String, enum: [...PROMO_KINDS], required: true },
    value: { type: Number, required: true },
    minSubtotal: { type: Number },
    active: { type: Boolean, required: true },
    // SPEC P4 — no default (omit-empty), matching every other optional field
    // on this embedded row.
    oncePerCustomer: { type: Boolean },
    // CB-5D — a kind:"item" code's free dish, same D8 shape as the loyalty
    // milestone's own item rung below. MUST be declared here as well as on
    // PromoCodeConfig (packages/shared/src/public-promo.ts): Mongoose
    // `strict` defaults to true, so a path this subschema does not name is
    // silently dropped on save — this repo has paid for that trap twice
    // already (the "Zod-valid, Mongoose-strict drops it" lesson). No
    // `default:` on any of the four — every stored code predates them.
    itemProductId: { type: String, trim: true },
    item: { type: String, trim: true },
    qty: { type: Number },
    // How many days an ASSIGNED (claimed) code stays usable, counted from
    // assignment — never from configuration. Absent = no expiry.
    validDays: { type: Number },
  },
  { _id: false },
);

// CR2.4 — Appearance. `_id:false` (mirrors promoCodeSchema above). Closed
// fields are `required: true`: appearanceSchema (packages/shared) already
// requires every key whenever the object is present at all, and the WHOLE
// subdoc is what carries `default: undefined` below — never a per-field
// default here. accentOverride/heroImage must NOT carry `required`: "" is
// their documented sentinel (22.0.7 — "use preset accent" / "no hero") and
// Mongoose's String `required` rejects "" (probed: route PUTs with
// runValidators 500'd on every default-accent save). Their presence is
// enforced by the Zod all-keys rule, like `logo`/`productLogo` above.
export const appearanceMongooseSchema = new Schema<AppearanceInput>(
  {
    v: { type: Number, required: true },
    presetId: { type: String, enum: [...PRESET_IDS], required: true },
    accentOverride: { type: String, trim: true },
    fontPairKey: { type: String, enum: [...FONT_PAIR_KEYS], required: true },
    cornerRadius: { type: String, enum: [...CORNER_RADII], required: true },
    density: { type: String, enum: [...DENSITIES], required: true },
    logoPlacement: { type: String, enum: [...LOGO_PLACEMENTS], required: true },
    heroImage: { type: String, trim: true },
  },
  { _id: false },
);

// CB-5A — one milestone reward on the ladder. `_id:false` (promoCodeSchema
// precedent above). `item`/`minBill` are NOT `required`: `item` only applies
// when `kind === "item"` (Zod's own superRefine enforces that conditionally,
// not Mongoose), and `minBill` is optional on the shared schema too — see the
// accentOverride comment above for why an optional String field here must
// never carry `required: true` (Mongoose rejects "" and PUT /api/settings
// runs with runValidators: true).
const loyaltyMilestoneMongooseSchema = new Schema<LoyaltyMilestoneInput>(
  {
    at: { type: Number, required: true },
    kind: { type: String, enum: [...LOYALTY_REWARD_KINDS], required: true },
    value: { type: Number, required: true },
    item: { type: String, trim: true },
    // CB-5B D8/D11 — MUST be declared here, not only on the Zod schema.
    // Mongoose `strict` defaults to true, so a path missing from THIS
    // subschema is silently dropped on write: the owner's picker would save
    // with a 200 and store nothing, leaving every free-dish rung unresolvable.
    // Neither carries `required: true` (the accentOverride precedent above):
    // both are absent on every pre-D8 row and PUT runs with runValidators.
    itemProductId: { type: String, trim: true },
    qty: { type: Number },
    minBill: { type: Number },
    // CB-5D — the promo code MINTED for this rung at CONFIG time (owner
    // decision, not claim time); the code itself lives in Settings' own
    // promo list above. Declared here for the same strict:true reason as
    // itemProductId/qty's comment above — omit this and the owner's picker
    // 200s while storing nothing. No `required`, no `default`: every stored
    // ladder predates this field.
    promoCode: { type: String, trim: true },
    // How long after EARNING this rung a diner may still claim it, in whole
    // days — distinct from the promo code's own `validDays` above (how long
    // the ASSIGNED code lives once claimed). Two independent TTLs.
    claimWithinDays: { type: Number },
  },
  { _id: false },
);

// CB-5D — membership and levels are REMOVED (owner, 2026-09-15): no client
// uses either, and the owner clears any stored data himself. Dropping the
// paths here (not just leaving them off LoyaltyRulesInput) means a v1 doc's
// stray `membership`/`levels` subdocs are never re-written back out by a
// save through this schema.
//
// CB-5A — the richer milestone-ladder loyalty contract. `_id:false` (mirrors
// appearanceMongooseSchema above): this whole subdoc is what carries
// `default: undefined` on Settings.ts's `loyaltyRules` field, never a
// per-field default here. `unitLabel` is NOT `required` — same
// accentOverride precedent as above (Mongoose String `required` rejects "").
// `milestones` carries `default: undefined` (the promoCodes/appearance
// precedent) so an absent ladder never materializes an empty array.
// CB-6C — one owner-written banner on the diner Home tab. `_id:false`
// (promoCodeSchema precedent above). `title` is `required` (the Zod schema
// requires a non-empty title too — an empty row is not a real banner);
// `body` must NOT carry `required` — Mongoose String `required` rejects ""
// (the accentOverride/heroImage precedent above) and a title-only banner's
// body is legitimately "".
export const dinerBannerMongooseSchema = new Schema<DinerBannerInput>(
  {
    title: { type: String, required: true, trim: true },
    body: { type: String, trim: true },
  },
  { _id: false },
);

export const loyaltyRulesMongooseSchema = new Schema<LoyaltyRulesInput>(
  {
    v: { type: Number, required: true },
    unitLabel: { type: String, trim: true },
    milestones: { type: [loyaltyMilestoneMongooseSchema], default: undefined },
    // CB-5C — the stamp card's box count. Declared HERE and not only on the
    // Zod side: strict:true silently DROPS a field the Mongoose schema does
    // not name, which is the "Zod-valid, Mongoose-strict drops it" bug this
    // repo has already paid for twice. No default — a doc saved before this
    // field existed must stay ABSENT, and ladderOf() then falls back to the
    // last reward's `at`, exactly as it does today.
    cardSize: { type: Number },
  },
  { _id: false },
);
