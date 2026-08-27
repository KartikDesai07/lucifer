import { getTelegramConfig } from "./config";
import { createTelegramPort, type TelegramPort, type TelegramSendMessageParams } from "./api";
import { renderTelegramMessage, type TelegramRequestSummary } from "./format";
import { mongooseChatStore, type ChatStore } from "./chats";
import {
  shouldSendToChat,
  TELEGRAM_FANOUT_BUDGET_MS,
  TELEGRAM_RETRY_AFTER_MAX_SEC,
  type TelegramAlertType,
} from "@pos/shared/telegram-alert";

// CR2.3b §21.4 S4 — the fan-out core. Injected over TWO ports (`TelegramPort`
// from S3, `ChatStore` from chats.ts in this slice) so `send.test.ts` can run
// entirely DB-free and fetch-free: no Mongoose import here at all. Sequential
// sends only — a cafe has at most TELEGRAM_MAX_CHATS rows, so there is no
// concurrency win worth the added complexity, and sequential keeps the
// single 429-retry rule simple to reason about. Never throws — every branch
// below is a caught, recorded outcome, so a fan-out can never turn a
// request's `after()` callback into an unhandled rejection.

export interface FanOutDeps {
  port: Pick<TelegramPort, "sendMessage">;
  store: ChatStore;
  now(): number;
  sleep(ms: number): Promise<void>;
}

export interface FanOutResult {
  sent: number;
  failed: number;
  deactivated: number;
  migrated: number;
  skipped: number;
}

function emptyResult(): FanOutResult {
  return { sent: 0, failed: 0, deactivated: 0, migrated: 0, skipped: 0 };
}

async function sendOnce(port: FanOutDeps["port"], chatId: string, text: string) {
  const params: TelegramSendMessageParams = { chatId, text, parseMode: "HTML" };
  return port.sendMessage(params);
}

/** One chat's send, including the single bounded 429 retry and a migrate
 *  resend. Mutates `result` in place and never throws — every Telegram
 *  outcome (ok / 403 / 429 / migrate / other) maps to exactly one bucket. */
async function sendToChat(
  chatId: string,
  text: string,
  deps: FanOutDeps,
  budgetEndsAt: number,
  result: FanOutResult,
): Promise<void> {
  let outcome = await sendOnce(deps.port, chatId, text);

  if (!outcome.ok && outcome.errorCode === 429) {
    const retryAfterSec = outcome.retryAfterSec;
    const canRetry =
      typeof retryAfterSec === "number" &&
      retryAfterSec <= TELEGRAM_RETRY_AFTER_MAX_SEC &&
      deps.now() < budgetEndsAt;
    if (canRetry) {
      await deps.sleep(retryAfterSec * 1000);
      outcome = await sendOnce(deps.port, chatId, text);
    }
  }

  if (outcome.ok) {
    result.sent++;
    await deps.store.recordSend(chatId, new Date(deps.now()));
    return;
  }

  if (outcome.errorCode === 403) {
    result.deactivated++;
    await deps.store.deactivate(chatId, "blocked");
    return;
  }

  if (outcome.migrateToChatId) {
    const verdict = await deps.store.rewriteChatId(chatId, outcome.migrateToChatId);
    if (verdict === "rewritten") {
      // The id itself DID migrate regardless of the resend's own outcome —
      // `migrated` tracks that fact; `sent`/`failed` track the resend.
      result.migrated++;
      const resend = await sendOnce(deps.port, outcome.migrateToChatId, text);
      if (resend.ok) {
        result.sent++;
        await deps.store.recordSend(outcome.migrateToChatId, new Date(deps.now()));
      } else {
        result.failed++;
        await deps.store.recordError(outcome.migrateToChatId, resend.errorCode, new Date(deps.now()));
      }
    } else if (verdict === "collision") {
      result.deactivated++;
    } else {
      result.failed++;
    }
    return;
  }

  // Second 429 after one retry, a transport error, or any other Telegram
  // error (400 included — we cannot isolate "chat not found" from the numeric
  // code alone, and mass-deactivating on a template bug would be worse; the
  // row stays visible via lastErrorCode instead).
  result.failed++;
  await deps.store.recordError(chatId, outcome.errorCode, new Date(deps.now()));
}

/** The DB-free fan-out core. `store.listActive()` is the only read; every
 *  chat is filtered by `shouldSendToChat` BEFORE any port call; the message
 *  is rendered exactly once; sends run sequentially under
 *  TELEGRAM_FANOUT_BUDGET_MS — once the budget is spent, every remaining
 *  chat is counted `skipped` with zero port calls. Never rejects: any thrown
 *  dependency failure is caught per-chat and counted as `failed`. */
export async function fanOutToChats(
  type: TelegramAlertType,
  summary: TelegramRequestSummary,
  deps: FanOutDeps,
): Promise<FanOutResult> {
  const result = emptyResult();
  let chats: Awaited<ReturnType<ChatStore["listActive"]>>;
  try {
    chats = await deps.store.listActive();
  } catch {
    return result;
  }

  const targets = chats.filter((chat) => {
    if (shouldSendToChat(chat, type)) return true;
    result.skipped++;
    return false;
  });
  if (targets.length === 0) return result;

  const text = renderTelegramMessage(summary);
  const budgetEndsAt = deps.now() + TELEGRAM_FANOUT_BUDGET_MS;

  for (const chat of targets) {
    if (deps.now() > budgetEndsAt) {
      result.skipped++;
      continue;
    }
    try {
      await sendToChat(chat.chatId, text, deps, budgetEndsAt, result);
    } catch {
      result.failed++;
    }
  }
  return result;
}

/** The production wrapper: resolves config + kill switch, builds real
 *  deps, and delegates to `fanOutToChats`. Silent no-op (`null`) when creds
 *  aren't readable or the cafe paused sends — never throws. */
export async function fanOutTelegram(
  type: TelegramAlertType,
  summary: TelegramRequestSummary,
): Promise<FanOutResult | null> {
  const config = await getTelegramConfig();
  if (config.state !== "ok" || config.paused || !config.token) return null;

  const deps: FanOutDeps = {
    port: createTelegramPort(config.token),
    store: mongooseChatStore,
    now: () => Date.now(),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  };
  return fanOutToChats(type, summary, deps);
}
