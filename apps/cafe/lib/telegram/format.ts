import { sanitizePublicText } from "@pos/shared/public";
import {
  TELEGRAM_ALERT_REGISTRY,
  TELEGRAM_FIELD_ITEM_MAX,
  TELEGRAM_FIELD_NAME_MAX,
  TELEGRAM_FIELD_NOTE_MAX,
  TELEGRAM_SUMMARY_ITEMS_MAX,
  TELEGRAM_TEXT_MAX,
  type TelegramAlertType,
} from "@pos/shared/telegram-alert";
import { inr } from "@/lib/utils";

// CR2.3b S3 — pure message rendering (§21.6d). No DB/fetch/env here: every
// input arrives as a plain `TelegramRequestSummary` built by
// `lib/telegram/notify.ts` (S4, not this slice). §21.8: ~170 lines.
//
// EXACT field set per §21.6d — nothing more. In particular, the diner's
// phone number carries NO field here at all, masked or otherwise: a
// Telegram chat has no staff `role` for the panel's own masking helper to
// check, so that contact detail is omitted from every Telegram message
// (owner decision, one-line reversible — the panel is where staff read it).
//
// Money-unit finding (flagged per the task spec): the phase file's draft
// named this field `totalPaise`, but `models/OrderRequest.ts` stores
// `quotedTotal` as a plain RUPEE number (its header comment: "pre-money...
// never needs the ledger's paise/sharding discipline" — unlike the Order
// ledger, which IS Int32 paise). The staff tray renders it with `inr()`
// (`@pos/shared/utils`), never `inrPaise()`. This module follows that house
// convention: the field is `total` (rupees) and is rendered via `inr()`.
export interface TelegramRequestSummary {
  type: TelegramAlertType;
  shortCode: string;
  targetKind: "table" | "parcel"; // mirrors ORDER_REQUEST_TARGET_KINDS (models/OrderRequest.ts)
  tableNo?: string; // present only for targetKind "table"
  name: string;
  itemCount: number;
  itemsPreview: string[]; // pre-built "2× Paneer Tikka" lines, notify.ts's job to build
  total: number; // rupees — see the money-unit note above; render via inr()
  note?: string;
}

/** Escapes the three characters Telegram's HTML parse mode treats specially.
 *  Order matters: `&` FIRST, or escaping `<`/`>` first would have its own
 *  output (`&lt;`/`&gt;`) re-escaped into `&amp;lt;`. Nothing else is
 *  escaped — Telegram HTML mode has no attribute contexts here to worry about. */
export function escapeTelegramHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Plain slice on the RAW string, always BEFORE escaping. Truncating after
 *  escaping could cut an entity in half (e.g. stop mid-`&amp;`); truncating
 *  the raw string first and escaping second can never split an entity,
 *  because escaping only ever GROWS a string, never shrinks or reorders it. */
export function truncateRaw(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}

// sanitizePublicText → truncateRaw → escapeTelegramHtml, in that order, for
// every diner-authored field (name/note/item lines) — §21.4 S3 pin.
function prepareDinerField(raw: string, max: number): string {
  return escapeTelegramHtml(truncateRaw(sanitizePublicText(raw), max));
}

// One label per alert type, sourced from TELEGRAM_ALERT_REGISTRY (§21.6b) so
// the message header and the admin toggle label can never drift apart. Built
// once, not re-derived per call — the registry is a `const`, not a mutable
// arg like the fields above.
const HEADER_BY_TYPE: Record<TelegramAlertType, string> = (() => {
  const map = {} as Record<TelegramAlertType, string>;
  for (const meta of TELEGRAM_ALERT_REGISTRY) map[meta.type] = meta.label;
  return map;
})();

/** Renders one Telegram HTML-mode message for a request-event summary.
 *  Structure (§21.4 S3): bold static header, then the table/parcel line,
 *  diner name, an items preview (capped, with a "+N more" line if there's
 *  more than the cap), the total, and an optional note. ONLY `<b>` is used
 *  as a tag — no `<a>`, no dynamic attribute values anywhere. A final
 *  belt-and-braces hard-slice enforces `TELEGRAM_TEXT_MAX` regardless of how
 *  the lines above summed up. */
export function renderTelegramMessage(summary: TelegramRequestSummary): string {
  const lines: string[] = [];

  lines.push(`<b>${escapeTelegramHtml(HEADER_BY_TYPE[summary.type])}</b>`);
  lines.push(`Code: ${escapeTelegramHtml(summary.shortCode)}`);
  lines.push(
    summary.targetKind === "table"
      ? `Table: ${escapeTelegramHtml(summary.tableNo ?? "?")}`
      : "Parcel order",
  );
  lines.push(`Diner: ${prepareDinerField(summary.name, TELEGRAM_FIELD_NAME_MAX)}`);

  const shownItems = summary.itemsPreview.slice(0, TELEGRAM_SUMMARY_ITEMS_MAX);
  for (const item of shownItems) lines.push(prepareDinerField(item, TELEGRAM_FIELD_ITEM_MAX));
  const remaining = summary.itemCount - shownItems.length;
  if (remaining > 0) lines.push(`+${remaining} more`);

  lines.push(`Total: ${escapeTelegramHtml(inr(summary.total))}`);

  if (summary.note) {
    lines.push(`Note: ${prepareDinerField(summary.note, TELEGRAM_FIELD_NOTE_MAX)}`);
  }

  const text = lines.join("\n");
  return truncateRaw(text, TELEGRAM_TEXT_MAX);
}
