import { z } from "zod";
import { PAYMENT_MODES, ORDER_STATUSES, GST_MODES, DISCOUNT_KINDS } from "../constants";
import { ORDER_CHARGE_TYPES } from "../order-charges";

// ─────────────────────────────────────────────────────────────────────────────
// Print-host plan, PH-1 — the payload contract. `printOrderSnapshotSchema`
// enumerates every order-level field `OrderReceipt.tsx`/`KOTReceipt.tsx` read
// (directly, or via the shared `orderItemLabel`/`receiptGst` helpers they
// call), PLUS the fields `use-pos-print.ts` reads to synthesize renderer
// props — the host must rebuild those props from the snapshot alone (§B1).
// A superset of the reads is fine; PH-10's parity test pins the exact set.
// Everything here is `.strict()` — a whole live Order (voids trail, customerId,
// cancelledBy/At) must never ride in as a "snapshot" past the write/claim gates.
// ─────────────────────────────────────────────────────────────────────────────

/** One item line, render-complete: every field a receipt/KOT line, a void
 *  trail entry, or `orderItemLabel` needs (name, variation, modifiers,
 *  instructions, qty, price, kotRound — the round a job's `round` filters
 *  items by). */
export const printOrderSnapshotItemSchema = z.object({
  productId: z.string(),
  name: z.string(),
  price: z.number(),
  qty: z.number().int(),
  variation: z.string().optional(),
  modifiers: z.array(z.string()),
  instructions: z.string(),
  kotRound: z.number().int(),
  // CB-5B S14 — this line was GIVEN as a loyalty reward (a free dish claimed
  // off the stamp ladder). The ONE flag the whole feature is managed by: the
  // line keeps its REAL `price` above, so the kitchen ticket prints it exactly
  // like any other line (owner decision: the KOT stays a normal KOT), and only
  // computeOrderTotals' subtotal reducer treats it differently by skipping it —
  // which is what takes its amount off the bill. Without these two keys the
  // `.strict()` parse REJECTED the whole snapshot, so a reward order could not
  // be host-printed at all and the kitchen was never told about the free dish.
  // Server-set only: `orderItemSchema` (order.schema.ts) deliberately has no
  // `reward` key, so a client can never declare one of its own lines free.
  reward: z.literal(true).optional(),
  // The marker stored beside a reward line ("Reward — free"). Snapshotted, not
  // re-derived at print time, for the same reason the GST fields are: a reprint
  // years later must reproduce the paper as it was issued.
  note: z.string().optional(),
}).strict();

export const printOrderSnapshotSchema = z.object({
  _id: z.string(),
  orderId: z.string(),
  customerName: z.string(),
  items: z.array(printOrderSnapshotItemSchema),
  subtotal: z.number(),
  discount: z.number(),
  // Read by OrderReceipt's discount line label (`discountLineLabel`) — a
  // host-printed bill must say "GST Discount" exactly like the local print.
  discountKind: z.enum(DISCOUNT_KINDS).optional(),
  // GST snapshot (receiptGst): gstMode/gstRate/gstAmount together decide the
  // tax breakdown a bill prints; chargeAmount is read back out of `total`
  // before either GST branch reasons about taxable value.
  gstAmount: z.number().optional(),
  gstRate: z.number().optional(),
  gstMode: z.enum(GST_MODES).optional(),
  chargeAmount: z.number().optional(),
  chargeLabel: z.string().optional(),
  // CB-CHG — the typed charge array. REQUIRED here even though the field is
  // optional on the order: this schema is .strict()-shaped, so a key the
  // schema does not declare is STRIPPED, and the host would print a slip
  // missing every extra-charge line while the counter's own screen showed
  // them. Carries `type` (unlike the client-facing input schema, which omits
  // it as a money fence) because this payload is SERVER-BUILT, and the host
  // renderer needs the provenance to order table-before-extras.
  charges: z
    .array(
      z.object({
        type: z.enum(ORDER_CHARGE_TYPES),
        label: z.string(),
        amount: z.number(),
      }),
    )
    .optional(),
  total: z.number(),
  paidAmount: z.number(),
  payment: z.enum(PAYMENT_MODES),
  splitCash: z.number().optional(),
  splitOnline: z.number().optional(),
  status: z.enum(ORDER_STATUSES),
  receiver: z.string(),
  tableNo: z.string().optional(),
  // billNumber/kotRounds/kotNumbers — the ticket numbers use-pos-print.ts
  // resolves onto KOTReceipt/OrderReceipt props (kotNumbers[round-1], the
  // bill's own printed number).
  billNumber: z.number().int().optional(),
  kotRounds: z.number().int(),
  kotNumbers: z.array(z.number().int()).optional(),
  // Read by OrderReceipt's *** CANCELLED *** banner and KOTReceipt's
  // cancel-notice whole-order void render.
  cancelReason: z.string().optional(),
  // KOTReceipt's default-on kitchen note (`cfg.showNotes ?? true`) — an allergy
  // note must reach a host-printed KOT exactly like the local path prints it.
  notes: z.string().optional(),
  createdAt: z.string(),
}).strict();

// `round: null` marks a whole-tab reprint (renderer leaves
// roundItems/roundLabel/roundNumber unset, mirroring `reprintKot`'s three
// resets); a number filters the snapshot's items to that round (MERGED-04).
// NULLABLE, not optional — the discriminator must always be stated.
const kotPayloadSchema = z
  .object({ kind: z.literal("kot"), snapshot: printOrderSnapshotSchema, round: z.number().int().nullable() })
  .strict();

// `reprint: true` marks a staff-requested duplicate (mirrors `kot`'s
// `round: null`) — the dedupe fence (`printJobKeyOf`) exists only to collapse
// a RETRY of the same first-time enqueue, and a reprint must ALWAYS produce a
// fresh job. `z.literal(true)` (not `z.boolean()`) so `false` isn't a
// representable third state — present-and-true or absent, nothing else.
// PH-4/PH-6's routing wrapper MUST set this on every reprint path.
const billPayloadSchema = z
  .object({ kind: z.literal("bill"), snapshot: printOrderSnapshotSchema, reprint: z.literal(true).optional() })
  .strict();

// The synthesized single line, VERBATIM as `use-pos-print.ts:70-98`'s
// `queueVoidSlip` builds it: the voided qty (not what remains), the
// preparation fields snapshotted onto the void trail entry, and that
// entry's own ticket number.
const voidPayloadSchema = z
  .object({
    kind: z.literal("void"),
    snapshot: printOrderSnapshotSchema,
    line: z
      .object({
        productId: z.string(),
        name: z.string(),
        variation: z.string().optional(),
        price: z.number(),
        qty: z.number().int(),
        modifiers: z.array(z.string()),
        instructions: z.string(),
        kotRound: z.number().int(),
        kotNumber: z.number().int().optional(),
        // CB-5B S14-remainder — mirrors printOrderSnapshotItemSchema's `reward`
        // key above: this sub-object is `.strict()`, so an unlisted key is a
        // PARSE FAILURE, not a missing field. Without it, a voided reward line
        // would reject the whole void slip outright — the exact class of
        // blocker S14 already closed for the bill/KOT snapshot.
        reward: z.literal(true).optional(),
      })
      .strict(),
    // The void entry's OWN reason/actor/moment (`entry.reason`/`.voidedBy`/`.at`,
    // use-pos-print.ts:94-96) — the slip prints THEM (KOTReceipt Reason/Staff/Time
    // lines), never the tab's opener and open time (CR1.3).
    reason: z.string(),
    voidedBy: z.string(),
    voidedAt: z.string(),
    // See billPayloadSchema's `reprint` comment — same staff-requested-
    // duplicate discriminator, same z.literal(true)-only reasoning.
    reprint: z.literal(true).optional(),
  })
  .strict();

// Client-only fields `MoveTableDialog.tsx` carries: the table moved FROM, who
// moved it, and when (the order's own tableNo is already the destination).
const movedPayloadSchema = z
  .object({
    kind: z.literal("moved"),
    snapshot: printOrderSnapshotSchema,
    from: z.string(),
    movedBy: z.string(),
    movedAt: z.string(),
    // See billPayloadSchema's `reprint` comment — same staff-requested-
    // duplicate discriminator, same z.literal(true)-only reasoning.
    reprint: z.literal(true).optional(),
  })
  .strict();

// The ONE payload exception: a live aggregate over open tabs, not an
// immutable event, so it carries NO snapshot (§B1).
const eodPayloadSchema = z
  .object({ kind: z.literal("eod"), dateKey: z.string(), dateLabel: z.string() })
  .strict();

// "Notify Kitchen" on an already-cancelled order: a whole-order void render,
// so it needs the cancel reason but no per-line synthesis (KOTReceipt's
// `variant="void"` already renders the full `items` list with no `roundItems`).
const cancelNoticePayloadSchema = z
  .object({ kind: z.literal("cancel-notice"), snapshot: printOrderSnapshotSchema, reason: z.string() })
  .strict();

export const printJobPayloadSchema = z.discriminatedUnion("kind", [
  kotPayloadSchema,
  billPayloadSchema,
  voidPayloadSchema,
  movedPayloadSchema,
  eodPayloadSchema,
  cancelNoticePayloadSchema,
]);

export type PrintOrderSnapshotInput = z.infer<typeof printOrderSnapshotSchema>;
export type PrintJobPayload = z.infer<typeof printJobPayloadSchema>;
export type KotPrintJobPayload = z.infer<typeof kotPayloadSchema>;
export type BillPrintJobPayload = z.infer<typeof billPayloadSchema>;
export type VoidPrintJobPayload = z.infer<typeof voidPayloadSchema>;
export type MovedPrintJobPayload = z.infer<typeof movedPayloadSchema>;
export type EodPrintJobPayload = z.infer<typeof eodPayloadSchema>;
export type CancelNoticePrintJobPayload = z.infer<typeof cancelNoticePayloadSchema>;
