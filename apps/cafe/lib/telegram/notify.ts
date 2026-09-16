import { fanOutTelegram } from "./send";
import type { TelegramRequestSummary } from "./format";
import { TELEGRAM_SUMMARY_ITEMS_MAX, type TelegramAlertType } from "@pos/shared/telegram-alert";

// CR2.3b §21.4 S4 — the event seam S8 calls from `after()` on the two public
// order-request routes. Builders here map the order-request domain
// (models/OrderRequest.ts's IOrderRequestItem/OrderRequestDraft shape, as
// read by app/api/public/order-request/route.ts and its [shortCode] PATCH
// sibling) onto §21.6d's EXACT `TelegramRequestSummary` field set — nothing
// more (see format.ts's own header comment on the one field deliberately
// excluded from that set).

export interface TelegramSummaryItemInput {
  name: string;
  qty: number;
}

// The fields both S8 call sites can supply cheaply: the create route already
// holds `buildRequestDoc`'s `OrderRequestDraft` (targetKind/items/quotedTotal/
// tableNo/note/name); the edit route holds the loaded `OrderRequest` doc plus
// its own freshly re-quoted `items`/`quotedTotal`. Neither site needs to do
// extra work to produce this shape.
export interface TelegramSummaryFields {
  shortCode: string;
  targetKind: "table" | "parcel";
  tableNo?: string;
  name: string;
  items: TelegramSummaryItemInput[];
  total: number; // rupees — quotedTotal, never the ledger's paise
  note?: string;
}

// "qty× name" lines, capped BEFORE format.ts ever sees them (format.ts's own
// slice is a belt-and-braces second cap, not a substitute for this one) —
// itemCount always carries the TRUE count so the "+N more" line is correct.
function buildItemsPreview(items: TelegramSummaryItemInput[]): string[] {
  return items.slice(0, TELEGRAM_SUMMARY_ITEMS_MAX).map((item) => `${item.qty}× ${item.name}`);
}

function buildSummary(type: TelegramAlertType, fields: TelegramSummaryFields): TelegramRequestSummary {
  const summary: TelegramRequestSummary = {
    type,
    shortCode: fields.shortCode,
    targetKind: fields.targetKind,
    name: fields.name,
    itemCount: fields.items.length,
    itemsPreview: buildItemsPreview(fields.items),
    total: fields.total,
  };
  if (fields.tableNo !== undefined) summary.tableNo = fields.tableNo;
  if (fields.note !== undefined) summary.note = fields.note;
  return summary;
}

export interface TelegramCreateSummaryInput extends TelegramSummaryFields {
  // The create route already knows which of the two "new request" alert
  // types applies (settings.selfOrderMode === "auto" ⇒ "autoAccepted") —
  // carrying it here keeps `notifyRequestEvent`'s own first argument and
  // this summary's rendered header from ever being called with different types.
  type: "newRequest" | "autoAccepted";
}

export function telegramSummaryOfCreate(input: TelegramCreateSummaryInput): TelegramRequestSummary {
  return buildSummary(input.type, input);
}

// The edit route only ever fires "editedRequest" (§21.0.1) — no `type` field
// to carry, unlike the create builder above.
export type TelegramEditSummaryInput = TelegramSummaryFields;

export function telegramSummaryOfEdit(input: TelegramEditSummaryInput): TelegramRequestSummary {
  return buildSummary("editedRequest", input);
}

/**
 * The event seam. Called from `after(() => ...)` on a request path (S8, not
 * this slice) — MUST NEVER throw or reject into that callback, so any
 * failure inside `fanOutTelegram` (config read, port, store) is swallowed
 * here rather than propagated. No console.* (the swallow is deliberate and
 * silent, matching `fanOutTelegram`'s own silent no-op states).
 */
export async function notifyRequestEvent(type: TelegramAlertType, summary: TelegramRequestSummary): Promise<void> {
  try {
    await fanOutTelegram(type, summary);
  } catch {
    // swallowed — a request path must never fail because Telegram did
  }
}
