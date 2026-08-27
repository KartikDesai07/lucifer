import { z } from "zod";

import { VARIATION_NAME_MAX_LEN } from "../constants";
import {
  isPublicToken,
  normalizePublicMobile,
  PUBLIC_NAME_MAX_LEN,
  PUBLIC_NOTE_MAX_LEN,
  PUBLIC_MOBILE_MAX_LEN,
  PUBLIC_MOBILE_MIN_LEN,
  PUBLIC_MOBILE_PATTERN,
  PUBLIC_ORDER_MAX_ITEMS,
  PUBLIC_ORDER_MAX_MODIFIERS,
  PUBLIC_ORDER_MAX_QTY,
  PUBLIC_ORDER_MODIFIER_MAX_LEN,
} from "../public";

// The shape of a public (diner-facing, unauthenticated) order request — phase
// CR2. Pure and client-safe like public.ts: the diner's menu page bundles this
// too, so nothing here may reach for Mongoose or any server-only module.

// What the order is FOR: a specific table (proved by its opaque token, never
// by a guessable tableNo) or a parcel (no table claimed, no table charge). A
// discriminated union rather than an optional token because "table with no
// token" and "parcel" must never be conflatable — the route can switch on
// `kind` alone and never has to ask "is this token present AND non-empty".
export const publicOrderTargetSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("table"),
      token: z.string().refine(isPublicToken, "Not a valid table token"),
    })
    .strict(),
  z
    .object({
      kind: z.literal("parcel"),
    })
    .strict(),
]);

// One line of a diner's order. Deliberately carries NO price and NO name: the
// server derives both from the live product at request time (the same
// discipline effectiveUnitPrice documents in public.ts) — a client-sent price
// or name would let a diner set their own bill, and .strict() below rejects
// either outright rather than silently ignoring it.
export const publicOrderItemSchema = z
  .object({
    productId: z.string().min(1).max(64),
    variation: z.string().trim().min(1).max(VARIATION_NAME_MAX_LEN).optional(),
    modifiers: z
      .array(z.string().trim().min(1).max(PUBLIC_ORDER_MODIFIER_MAX_LEN))
      .max(PUBLIC_ORDER_MAX_MODIFIERS)
      .default([]),
    instructions: z.string().trim().min(1).max(PUBLIC_NOTE_MAX_LEN).optional(),
    qty: z.number().int().min(1).max(PUBLIC_ORDER_MAX_QTY),
  })
  .strict();

// POST /api/public/orders. The honeypot field (`hp`) is deliberately NOT a
// member of this schema: the route lifts it off the raw parsed body BEFORE
// this ever validates (app/api/public/order-request/route.ts's own comment
// has the honeypot handling itself), so a bot filling it with an over-long
// value can never surface as a Zod rejection here — a visible 400 would be a
// tell that separates a caught bot's response from a real diner's 201, which
// defeats the whole point of a honeypot.
export const createPublicOrderRequestSchema = z
  .object({
    target: publicOrderTargetSchema,
    items: z.array(publicOrderItemSchema).min(1).max(PUBLIC_ORDER_MAX_ITEMS),
    note: z.string().trim().min(1).max(PUBLIC_NOTE_MAX_LEN).optional(),
    // Shape-only here (max length = PROMO_CODE_PATTERN's own 16) — the route
    // resolves it against live Settings via resolvePromoDiscount, never here.
    promoCode: z.string().trim().min(1).max(16).optional(),
    name: z.string().trim().min(1).max(PUBLIC_NAME_MAX_LEN),
    mobile: z
      .string()
      .trim()
      .min(PUBLIC_MOBILE_MIN_LEN)
      .max(PUBLIC_MOBILE_MAX_LEN)
      .regex(PUBLIC_MOBILE_PATTERN)
      // Runs AFTER shape/pattern validation so the length/charset checks above
      // still see exactly what the diner typed; only the STORED + MATCHED
      // value is normalized.
      .transform(normalizePublicMobile)
      // A raw value like "1---------" is 10 chars and matches the pattern
      // (9 trailing chars from [0-9 -]), so it clears both checks above —
      // but normalizePublicMobile strips every hyphen, leaving just "1". This
      // re-applies the SAME minimum length to what's actually left after
      // normalizing. One-sided limitation, documented not fixed here: this
      // only guards the public diner path — staff-entered Customer mobiles
      // (createCustomerSchema) have no equivalent post-normalize check.
      .refine(
        (v) => v.length >= PUBLIC_MOBILE_MIN_LEN,
        "Mobile number is too short after normalizing",
      ),
  })
  .strict();

export type PublicOrderTarget = z.infer<typeof publicOrderTargetSchema>;
export type PublicOrderItemInput = z.infer<typeof publicOrderItemSchema>;
export type CreatePublicOrderRequestInput = z.infer<typeof createPublicOrderRequestSchema>;
