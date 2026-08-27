import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { stripComments } from "@/lib/source-pin-utils";

// CR2.3b code-review fixes — regression pins, part 2. Same source-read
// technique as lib/telegram-paths.test.ts, which holds the §21.10 W1-W10
// threat pins; this file exists separately only because that one already
// sits over the ~300-line cap and these 7 pins would push it further over.
// Every pin below was checked against the LANDED fix source before being
// written — a pin that passes while the protected behaviour is broken is
// worse than none.

const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));
const readSrc = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8");

// Pins forbid/require CODE shapes, so they must look at code and not at
// prose — a comment explaining the rule would otherwise trip the very pin
// meant to enforce it (repo memory: this bit lib/telegram/format.test.ts).

const SETTINGS_ROUTE = "apps/cafe/app/api/settings/route.ts";
const ORDER_REQUEST_CREATE_ROUTE = "apps/cafe/app/api/public/order-request/route.ts";
const ORDER_REQUEST_EDIT_ROUTE = "apps/cafe/app/api/public/order-request/[shortCode]/route.ts";
const TELEGRAM_CHATS_LIST = "apps/cafe/components/settings/TelegramChatsList.tsx";
const USE_TELEGRAM_HOOK = "apps/cafe/hooks/use-telegram.ts";
const TELEGRAM_SETUP_CARD = "apps/cafe/components/settings/TelegramSetupCard.tsx";

// Finds the JSX tag's closing `>` starting at `start` (index of a `<Tag`),
// skipping any `>` that sits inside a quoted string or a brace-delimited JSX
// expression container (so `onClick={() => ...}` never fools this into
// closing the tag early on the arrow's `>`).
function findTagEnd(src: string, start: number): number {
  let i = start;
  let braceDepth = 0;
  let quote: string | null = null;
  while (i < src.length) {
    const ch = src[i];
    if (quote) {
      if (ch === quote) quote = null;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (ch === "{") {
      braceDepth++;
    } else if (ch === "}") {
      braceDepth--;
    } else if (ch === ">" && braceDepth === 0) {
      return i;
    }
    i++;
  }
  return -1;
}

// ── Settings-PUT invalidates the telegram config cache ─────────────────────

test("PIN: PUT /api/settings calls invalidateTelegramConfigCache() — telegramPaused rides this PUT but getTelegramConfig() caches the resolved config for 45s, so skipping the invalidation would leave a just-toggled pause/unpause stale on the webhook route for up to 45s (review finding)", () => {
  const src = stripComments(readSrc(SETTINGS_ROUTE));
  const putIdx = src.indexOf("export async function PUT(");
  assert.ok(putIdx >= 0, "app/api/settings/route.ts must export a PUT handler");
  const invalidateIdx = src.indexOf("invalidateTelegramConfigCache(");
  assert.ok(
    invalidateIdx >= 0,
    "app/api/settings/route.ts must call invalidateTelegramConfigCache( somewhere",
  );
  assert.ok(
    invalidateIdx > putIdx,
    "invalidateTelegramConfigCache( must be called INSIDE the PUT handler, not only imported",
  );
});

// ── W6 placement — after( fires only once the write it reports on is real ──

test("PIN W6 placement: in the create route, after( fires strictly AFTER both the honeypot branch (`if (hpFilled)`) and the write it reports on (`OrderRequest.create(`); in the edit route, after( fires strictly AFTER both the honeypot branch and the CAS-miss check (`matchedCount`) — firing earlier would notify Telegram about a write that was skipped (honeypot) or never landed (lost CAS race)", () => {
  const createSrc = stripComments(readSrc(ORDER_REQUEST_CREATE_ROUTE));
  const createAfterIdx = createSrc.indexOf("after(");
  const createHoneypotIdx = createSrc.indexOf("if (hpFilled)");
  const createWriteIdx = createSrc.indexOf("OrderRequest.create(");
  assert.ok(createAfterIdx >= 0, "the create route must call after(");
  assert.ok(createHoneypotIdx >= 0, "the create route must have an `if (hpFilled)` honeypot branch");
  assert.ok(createWriteIdx >= 0, "the create route must call OrderRequest.create(");
  assert.ok(
    createAfterIdx > createHoneypotIdx,
    "the create route's after( must appear AFTER the honeypot branch (`if (hpFilled)`) in source order",
  );
  assert.ok(
    createAfterIdx > createWriteIdx,
    "the create route's after( must appear AFTER OrderRequest.create( — Telegram must never be notified about a write that has not happened yet",
  );

  const editSrc = stripComments(readSrc(ORDER_REQUEST_EDIT_ROUTE));
  const editAfterIdx = editSrc.indexOf("after(");
  const editHoneypotIdx = editSrc.indexOf("if (hpFilled)");
  const editCasIdx = editSrc.indexOf("matchedCount");
  assert.ok(editAfterIdx >= 0, "the edit route must call after(");
  assert.ok(editHoneypotIdx >= 0, "the edit route must have an `if (hpFilled)` honeypot branch");
  assert.ok(editCasIdx >= 0, "the edit route must check matchedCount (the CAS-miss check)");
  assert.ok(
    editAfterIdx > editHoneypotIdx,
    "the edit route's after( must appear AFTER the honeypot branch (`if (hpFilled)`) in source order",
  );
  assert.ok(
    editAfterIdx > editCasIdx,
    "the edit route's after( must appear AFTER the CAS-miss check (matchedCount) — a lost race must never notify Telegram about an edit that never landed",
  );
});

// ── Invites list offline honesty ────────────────────────────────────────────

test("PIN: TelegramChatsList's invites section checks invites.isPaused and invites.isLoadingError, and BOTH come before the empty state ('No pending invites.') — a paused (offline) or errored query must never be shown as truthfully empty (repo memory: a paused TanStack v5 query reads as no-data/no-error)", () => {
  const src = stripComments(readSrc(TELEGRAM_CHATS_LIST));
  const pausedIdx = src.indexOf("invites.isPaused");
  const errorIdx = src.indexOf("invites.isLoadingError");
  const emptyIdx = src.indexOf("No pending invites.");
  assert.ok(pausedIdx >= 0, "TelegramChatsList must check invites.isPaused");
  assert.ok(errorIdx >= 0, "TelegramChatsList must check invites.isLoadingError");
  assert.ok(emptyIdx >= 0, "TelegramChatsList must render the 'No pending invites.' empty state");
  assert.ok(
    pausedIdx < emptyIdx,
    "invites.isPaused must be checked BEFORE the 'No pending invites.' empty state, or an offline diner sees a false empty list",
  );
  assert.ok(
    errorIdx < emptyIdx,
    "invites.isLoadingError must be checked BEFORE the 'No pending invites.' empty state, or a failed fetch is shown as truthfully empty",
  );
});

// ── Mutation results are data, not just a 2xx ───────────────────────────────

test("PIN: use-telegram.ts's mutation onSuccess handlers branch on the RESULT payload (data.removed / data.updated / data.webhookDeleted / data.webhookSet), never on the request having merely succeeded — each of these routes can answer {success:true, data:{...:false}} for an outcome the caller must still surface as a failure", () => {
  const src = stripComments(readSrc(USE_TELEGRAM_HOOK));
  assert.ok(
    src.includes("data.removed"),
    "useRemoveTelegramChat must branch on data.removed — otherwise a chat that failed to delete is reported as removed",
  );
  assert.ok(
    src.includes("data.updated"),
    "useUpdateTelegramChat must branch on data.updated — otherwise a toggle that silently no-oped is reported as saved",
  );
  assert.ok(
    src.includes("data.webhookDeleted"),
    "useDisconnectTelegram must branch on data.webhookDeleted — otherwise a still-registered webhook is reported as fully disconnected",
  );
  assert.ok(
    src.includes("data.webhookSet"),
    "useRepairWebhook must branch on data.webhookSet — otherwise a webhook Telegram refused is reported as repaired",
  );
});

test("PIN: useUpdateTelegramChat's onSettled RETURNS Promise.all([...]) rather than firing invalidateQueries as an unreturned side effect — TanStack v5 awaits a returned onSettled promise, which keeps isPending (and the disabled checkboxes) true through the refetch instead of re-enabling on stale cached data (repo memory lesson)", () => {
  const src = stripComments(readSrc(USE_TELEGRAM_HOOK));
  const start = src.indexOf("export function useUpdateTelegramChat()");
  const end = src.indexOf("export function useRemoveTelegramChat()");
  assert.ok(start >= 0, "useUpdateTelegramChat must be declared");
  assert.ok(end > start, "useRemoveTelegramChat must be declared AFTER useUpdateTelegramChat (this pin slices between the two)");
  const fnSrc = src.slice(start, end);
  assert.match(
    fnSrc,
    /onSettled:\s*\(\)\s*=>\s*Promise\.all\(/,
    "useUpdateTelegramChat's onSettled must be written as `onSettled: () => Promise.all(...)` — a block-bodied onSettled with no return resolves immediately, ungating isPending before the refetch actually lands",
  );
});

// ── Residual-webhook remediation copy ───────────────────────────────────────

test("PIN: TelegramSetupCard renders the residual-webhook remediation copy ('webhook may still be registered') — a disconnect whose webhookDeleted comes back false must tell the operator the webhook may still be live, or Telegram keeps delivering to a dead endpoint with no signal", () => {
  const src = stripComments(readSrc(TELEGRAM_SETUP_CARD));
  assert.ok(
    src.includes("webhook may still be registered"),
    "TelegramSetupCard must render the 'webhook may still be registered' remediation copy",
  );
});

// ── type="button" discipline ────────────────────────────────────────────────

test('PIN: every <Button in TelegramSetupCard.tsx carries type="button" — the card renders inside SettingsForm\'s <form>, where a button with no explicit type defaults to type="submit" and would double-fire the settings PUT', () => {
  const src = stripComments(readSrc(TELEGRAM_SETUP_CARD));
  const opens: number[] = [];
  let idx = src.indexOf("<Button");
  while (idx !== -1) {
    opens.push(idx);
    idx = src.indexOf("<Button", idx + 1);
  }
  assert.ok(
    opens.length >= 3,
    `TelegramSetupCard must render at least the 3 known <Button elements for this pin to mean anything, found ${opens.length}`,
  );
  for (const openIdx of opens) {
    const closeIdx = findTagEnd(src, openIdx);
    assert.ok(closeIdx > openIdx, "every <Button opening tag must have a findable closing >");
    const tagSrc = src.slice(openIdx, closeIdx);
    assert.ok(
      tagSrc.includes('type="button"'),
      `<Button at source offset ${openIdx} must carry type="button" (missing it lets the default type="submit" double-fire the settings PUT): ${tagSrc}`,
    );
  }
});
