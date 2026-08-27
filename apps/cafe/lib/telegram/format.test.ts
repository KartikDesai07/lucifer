import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  escapeTelegramHtml,
  truncateRaw,
  renderTelegramMessage,
  type TelegramRequestSummary,
} from "./format";
import {
  TELEGRAM_ALERT_REGISTRY,
  TELEGRAM_FIELD_ITEM_MAX,
  TELEGRAM_FIELD_NAME_MAX,
  TELEGRAM_FIELD_NOTE_MAX,
  TELEGRAM_SUMMARY_ITEMS_MAX,
  TELEGRAM_TEXT_MAX,
} from "@pos/shared/telegram-alert";
import { inr } from "@/lib/utils";

// CR2.3b S3 — DB-free rendering tests. No mongod, no fetch: format.ts takes a
// plain TelegramRequestSummary and returns a string.

function buildSummary(overrides: Partial<TelegramRequestSummary> = {}): TelegramRequestSummary {
  return {
    type: "newRequest",
    shortCode: "ABC123",
    targetKind: "table",
    tableNo: "12",
    name: "Diner",
    itemCount: 2,
    itemsPreview: ["2× Paneer Tikka", "1× Naan"],
    total: 350,
    ...overrides,
  };
}

function lineStartingWith(message: string, prefix: string): string | undefined {
  return message.split("\n").find((line) => line.startsWith(prefix));
}

// -- escapeTelegramHtml -------------------------------------------------------

test("escapeTelegramHtml: escapes & first, then < and >, no double-escaping the escapes' own output", () => {
  assert.equal(escapeTelegramHtml("a<&>b"), "a&lt;&amp;&gt;b");
});

test("escapeTelegramHtml: a string already containing the literal text '&amp;' escapes its own ampersand too (exact string, not idempotent)", () => {
  assert.equal(escapeTelegramHtml("&amp;b"), "&amp;amp;b");
});

// -- truncateRaw ---------------------------------------------------------------

test("truncateRaw: a string of exactly max length is left untouched (off-by-one boundary)", () => {
  const s = "A".repeat(63) + "&";
  assert.equal(truncateRaw(s, 64), s);
  assert.equal(escapeTelegramHtml(truncateRaw(s, 64)), "A".repeat(63) + "&amp;");
});

test("truncateRaw runs BEFORE escaping: an entity can never be split even when the raw cut point sits inside what would become one", () => {
  // Escaping FIRST then truncating to 64 rendered chars would cut this right
  // after "&amp" (before the trailing ";"), producing a broken entity. Raw
  // truncation first keeps the whole "&" character, then escaping grows it
  // into a complete "&amp;" — the entity is never observed half-formed.
  const name = "A".repeat(60) + "&" + "B".repeat(20);
  const message = renderTelegramMessage(buildSummary({ name }));
  const dinerLine = lineStartingWith(message, "Diner: ");
  assert.equal(dinerLine, `Diner: ${"A".repeat(60)}&amp;BBB`);
});

// -- per-field raw truncation caps ---------------------------------------------

test("renderTelegramMessage: diner name over TELEGRAM_FIELD_NAME_MAX is raw-truncated to the cap before escaping", () => {
  const name = "N".repeat(TELEGRAM_FIELD_NAME_MAX + 40);
  const message = renderTelegramMessage(buildSummary({ name }));
  assert.equal(lineStartingWith(message, "Diner: "), `Diner: ${"N".repeat(TELEGRAM_FIELD_NAME_MAX)}`);
});

test("renderTelegramMessage: an items-preview line over TELEGRAM_FIELD_ITEM_MAX is raw-truncated to the cap", () => {
  const longItem = "X".repeat(TELEGRAM_FIELD_ITEM_MAX + 30);
  const message = renderTelegramMessage(
    buildSummary({ itemCount: 1, itemsPreview: [longItem] }),
  );
  assert.equal(lineStartingWith(message, "X"), "X".repeat(TELEGRAM_FIELD_ITEM_MAX));
});

test("renderTelegramMessage: a note over TELEGRAM_FIELD_NOTE_MAX is raw-truncated to the cap before the 'Note: ' prefix", () => {
  const note = "Y".repeat(TELEGRAM_FIELD_NOTE_MAX + 50);
  const message = renderTelegramMessage(buildSummary({ note }));
  assert.equal(lineStartingWith(message, "Note: "), `Note: ${"Y".repeat(TELEGRAM_FIELD_NOTE_MAX)}`);
});

// -- items preview cap + "+N more" ---------------------------------------------

test("renderTelegramMessage: preview capped at TELEGRAM_SUMMARY_ITEMS_MAX lines, with a '+N more' line when itemCount is larger", () => {
  const itemsPreview = Array.from({ length: 8 }, (_, i) => `1× Item${i}`);
  const message = renderTelegramMessage(buildSummary({ itemCount: 8, itemsPreview }));
  const lines = message.split("\n");
  const shown = lines.filter((l) => l.startsWith("1× Item"));
  assert.equal(shown.length, TELEGRAM_SUMMARY_ITEMS_MAX);
  assert.deepEqual(shown, itemsPreview.slice(0, TELEGRAM_SUMMARY_ITEMS_MAX));
  assert.ok(lines.includes("+2 more"));
});

test("renderTelegramMessage: no '+N more' line when itemCount fits within the shown preview", () => {
  const itemsPreview = ["1× A", "1× B", "1× C"];
  const message = renderTelegramMessage(buildSummary({ itemCount: 3, itemsPreview }));
  assert.ok(!message.split("\n").some((l) => l.endsWith(" more")));
});

// -- alert-type headers + target line ------------------------------------------

test("renderTelegramMessage: each alert type renders its own distinct header from TELEGRAM_ALERT_REGISTRY", () => {
  for (const meta of TELEGRAM_ALERT_REGISTRY) {
    const message = renderTelegramMessage(buildSummary({ type: meta.type }));
    assert.equal(message.split("\n")[0], `<b>${escapeTelegramHtml(meta.label)}</b>`);
  }
  const headers = new Set(
    TELEGRAM_ALERT_REGISTRY.map((meta) => renderTelegramMessage(buildSummary({ type: meta.type })).split("\n")[0]),
  );
  assert.equal(headers.size, TELEGRAM_ALERT_REGISTRY.length);
});

test("renderTelegramMessage: a table target renders a 'Table: ' line; a parcel target renders 'Parcel order' with no table line", () => {
  const tableMessage = renderTelegramMessage(buildSummary({ targetKind: "table", tableNo: "7" }));
  assert.equal(lineStartingWith(tableMessage, "Table: "), "Table: 7");

  const parcelMessage = renderTelegramMessage(
    buildSummary({ targetKind: "parcel", tableNo: undefined }),
  );
  assert.ok(parcelMessage.split("\n").includes("Parcel order"));
  assert.equal(lineStartingWith(parcelMessage, "Table: "), undefined);
});

// -- note omission + total rendering -------------------------------------------

test("renderTelegramMessage: note is omitted entirely (no 'Note: ' line) when absent", () => {
  const message = renderTelegramMessage(buildSummary({ note: undefined }));
  assert.equal(lineStartingWith(message, "Note: "), undefined);
});

test("renderTelegramMessage: total is rendered through the house money helper (inr), not a bare number", () => {
  const message = renderTelegramMessage(buildSummary({ total: 1234 }));
  assert.equal(lineStartingWith(message, "Total: "), `Total: ${escapeTelegramHtml(inr(1234))}`);
});

// -- hard cap + tag allow-list --------------------------------------------------

test("renderTelegramMessage: an unbounded field (tableNo has no per-field cap) still leaves the final message ≤ TELEGRAM_TEXT_MAX", () => {
  const message = renderTelegramMessage(
    buildSummary({ targetKind: "table", tableNo: "T".repeat(10_000) }),
  );
  assert.ok(message.length <= TELEGRAM_TEXT_MAX);
  assert.equal(message.length, TELEGRAM_TEXT_MAX);
});

test("renderTelegramMessage: a full summary contains no '<' outside the static <b>/</b> tag allow-list", () => {
  const message = renderTelegramMessage(
    buildSummary({
      name: "<script>alert(1)</script>",
      note: "please <b>rush</b> it & make it spicy",
      itemsPreview: ["1× <i>Spicy</i> Noodles"],
    }),
  );
  const tags = message.match(/<[^>]*>/g) ?? [];
  assert.ok(tags.length > 0, "expected at least the static header tags");
  for (const tag of tags) assert.match(tag, /^<\/?[bi]>$/);
});

// -- source pins ----------------------------------------------------------------

test("source pin: format.ts and api.ts contain no 'mobile' reference and no console.*", () => {
  const formatSrc = readFileSync(fileURLToPath(new URL("./format.ts", import.meta.url)), "utf8");
  const apiSrc = readFileSync(fileURLToPath(new URL("./api.ts", import.meta.url)), "utf8");
  for (const src of [formatSrc, apiSrc]) {
    assert.equal(/mobile/i.test(src), false, "must not reference mobile in any form");
    assert.equal(/console\./.test(src), false, "must never use console.*");
  }
});

test("source pin: api.ts's TelegramResult type and return builders never carry a description field", () => {
  const apiSrc = readFileSync(fileURLToPath(new URL("./api.ts", import.meta.url)), "utf8");
  // A prose comment is allowed to name the reason (why `description` is
  // dropped); what must never exist is a `description:` field definition/
  // assignment or a `.description` read off the parsed Telegram response —
  // either would be an actual passthrough.
  assert.equal(/description\s*:/.test(apiSrc), false, "no object/type field literally named description");
  assert.equal(/\.description\b/.test(apiSrc), false, "must never read Telegram's description field off a parsed response");
});
