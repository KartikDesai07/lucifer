// The shape of the offline outbox record (Printing Phase 5, spec 5.2). Strict on purpose: a record that does not
// match exactly is never guessed at, it is kept aside (offline-outbox.ts readOutbox) for staff to look at.

import { z } from "zod";

import { OFFLINE_REF_RE, offlineLineSchema } from "@pos/shared/offline-kot";

export const outboxEntrySchema = z
  .object({
    /** The round's idemKey. */
    key: z.string().min(1),
    /** The offline number, O-<n>. */
    ref: z.string().regex(OFFLINE_REF_RE),
    /** When it was taken, ms since epoch. */
    at: z.number().finite(),
    kind: z.enum(["create", "round"]),
    /** Pay Now: the sale is saved when it is sent. */
    sale: z.boolean(),
    /** A send that may already have reached the server (no answer), so the replay is the check. */
    uncertain: z.boolean(),
    /** The device's own id of the order; every round of one order made offline shares it. */
    local: z.string().min(1),
    /** The server's order id, once known (a server tab, or after its create was saved). */
    orderId: z.string().min(1).nullable(),
    table: z.string(),
    /** The request body exactly as the online send would post it. */
    body: z.unknown(),
    shownTotal: z.number().finite(),
    lines: z.array(offlineLineSchema),
    state: z.enum(["waiting", "sending", "needs-staff"]),
    /** The server's words, when it needs staff. */
    message: z.string().optional(),
  })
  .strict();

/** Keyed by the entry's `key`: refs restart at O-1 each cafe day, so a ref is not unique. */
export const outboxNoteSchema = z.object({ key: z.string().min(1), ref: z.string(), text: z.string(), at: z.number().finite() }).strict();

export const outboxRecordSchema = z
  .object({
    v: z.literal(1),
    /** The cafe day the offline numbers count in. */
    day: z.string().min(1),
    /** The next offline number. */
    next: z.number().int().min(1),
    entries: z.array(outboxEntrySchema),
    notes: z.array(outboxNoteSchema),
  })
  .strict();

export type OutboxEntry = z.infer<typeof outboxEntrySchema>;
export type OutboxNote = z.infer<typeof outboxNoteSchema>;
export type OutboxRecord = z.infer<typeof outboxRecordSchema>;
