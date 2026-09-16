import { NextResponse } from "next/server";
import {
  TELEGRAM_SECRET_HEADER,
  TELEGRAM_WEBHOOK_BODY_MAX_BYTES,
  TELEGRAM_WEBHOOK_RATE_MAX_CHAT,
  TELEGRAM_WEBHOOK_RATE_MAX_GLOBAL,
  type TelegramChatType,
} from "@pos/shared/telegram-alert";
import { failure } from "@/lib/api-helpers";
import { resolveTenantFromHost } from "@/lib/tenant";
import { getTelegramConfig } from "@/lib/telegram/config";
import { connectChat, mongooseChatStore } from "@/lib/telegram/chats";
import { hitRateLimit } from "@/lib/public-rate-limit";
import {
  dispatchUpdate,
  telegramUpdateSchema,
  verifySecretHeader,
  type WebhookPorts,
} from "@/lib/telegram/webhook-core";

export const dynamic = "force-dynamic";

// POST /api/telegram/webhook — the app's SECOND unauthenticated WRITE (the
// first is POST /api/public/order-request; §4 of the phase file names both).
// It is reachable without a session because Telegram's servers call it and
// they cannot hold one: the middleware matcher excludes /api entirely
// (middleware.ts), and this file deliberately calls NO auth helper. What
// stands in for auth is a secret WE minted and gave only to Telegram via
// setWebhook, echoed back in a request header. Controls run in this EXACT
// order; each is numbered so a reorder is visible in review:
//
//   1. Secret header PRESENCE — a request with no X-Telegram-Bot-Api-Secret-
//      Token header is rejected 401 before any DB/parse work: zero cost for
//      an attacker who doesn't even have a header value to try. A
//      present-but-WRONG value costs at most the cached telegram-config read
//      below (45s TTL) before the 401 — bounded, an accepted M0 cost, and
//      the reason that read sits BEFORE the value compare: the compare needs
//      the stored secret to compare against.
//   2. Host gate — resolveTenantFromHost + the Tier-B TENANT_ID assertion,
//      pure and DB-free, mirroring the sibling public routes; /api is outside
//      the middleware matcher, so the route must self-gate.
//   3. Secret VALUE compare — length-guarded timingSafeEqual against the
//      sealed secret from lib/telegram/config (readSettings-cached, NEVER
//      getSettings: an anonymous path must not drive the upsert getter's
//      per-call updatedAt write on a 512MB M0). Absent/unreadable creds ⇒ 401.
//      With a LEAKED secret an attacker can only forge /start and migrate
//      messages, and the damage is bounded by (a) connect requiring a 70-bit
//      single-use code that expires, and (b) migrate rewriting only a chat id
//      that is ALREADY registered.
//   4. Body size cap in UTF-8 bytes (TELEGRAM_WEBHOOK_BODY_MAX_BYTES), before
//      any parse — bounds parse/validation work, never network intake.
//   5. JSON parse + Zod on the update. Junk shape, or any update kind other
//      than `message`, is IGNORED with a 200: allowed_updates pins the
//      subscription to messages, this is defence in depth, and a non-2xx
//      would only make Telegram redeliver the same garbage.
//   6. Rate limit (the same fixed-window Mongo counter the diner surface
//      uses): per-chat bucket `tg:<chatId>` plus a global `tg:all` ceiling.
//      Over cap ⇒ 200 and nothing past the counter itself (the primitive's
//      two atomic $inc upserts — per-chat + global — are the accepted M0
//      cost of metering) — never 429, because a non-2xx invites redelivery
//      and would amplify a flood.
//   7. Dispatch: `/start <code>` consumes the invite (single-use CAS) and
//      upserts the chat row; `/start` with no payload gets a polite guide
//      reply and changes nothing; migrate_to_chat_id rewrites a registered
//      id; anything else is a silent 200. Every write is idempotent under
//      redelivery (Telegram's retry count is not documented anywhere
//      primary, so redelivery is simply assumed): consuming an invite twice
//      from the SAME chat is a replay (same reply, no second write), the chat
//      upsert is keyed on chatId with $setOnInsert for the toggle defaults,
//      and a migrate rewrite is a no-op the second time.
//   8. Always 200, fast, with a constant shape: a successful/replayed connect
//      answers via the ONE Bot API call the webhook response may carry
//      ({method:"sendMessage"}) — zero extra round trips, result unknowable.
//      Consumed / used / expired / unknown codes are never distinguished
//      by HTTP status or timing-relevant early returns; the reply BODY of a
//      successful connect necessarily differs, so code-probing exists ONLY
//      for a caller already holding the minted secret, and is bounded by
//      the 70-bit single-use codes and the rate buckets above.
//
// Deliberately NOT here, each for a reason: BotID (Telegram's servers cannot
// run a browser challenge, and checkBotId FAILS CLOSED for unlisted paths —
// registering this path would 403 Telegram); a honeypot field (there is no
// human form); a table-token rate key (the caller is one server, keyed per
// chat instead); a CSP (no HTML is served). Never throws to the caller: any
// uncaught failure degrades to a 200 with no effect, so a transient DB blip
// cannot start a redelivery storm.

const NO_SECRET_MESSAGE = "Not authenticated";
const RATE_BUCKET_ALL = "tg:all";

// Mirrors the sibling public routes' noStore helper — every response here is
// uncacheable and nosniff, success or not.
function noStore<T extends { headers: Headers }>(res: T): T {
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("X-Content-Type-Options", "nosniff");
  return res;
}

function ignore(): NextResponse {
  return noStore(NextResponse.json({}, { status: 200 }));
}

// Thin adapter: chats.ts's connectChat/rewriteChatId already return the
// EXACT verdict unions WebhookPorts promises — the only gap is chatType,
// which webhook-core keeps as a plain `string` (it must not import the
// Mongoose-side TelegramChatType) but connectChat requires narrowed. Safe to
// cast here: dispatchUpdate already checked `chat.type` against
// TELEGRAM_CHAT_TYPES before ever calling ports.connect.
const ports: WebhookPorts = {
  connect(code, chat) {
    return connectChat(code, { ...chat, chatType: chat.chatType as TelegramChatType });
  },
  rewrite(oldId, newId) {
    return mongooseChatStore.rewriteChatId(oldId, newId);
  },
};

export async function POST(req: Request): Promise<NextResponse> {
  try {
    // 1. Secret header presence — before any DB/parse work.
    const header = req.headers.get(TELEGRAM_SECRET_HEADER);
    if (!header) return noStore(failure(NO_SECRET_MESSAGE, 401));

    // 2. Host gate — same tenant + Tier-B assertion as the sibling public
    // routes, run by hand because /api is outside the middleware's matcher.
    const tenant = await resolveTenantFromHost(req.headers.get("host"));
    const configuredTenant = process.env.TENANT_ID;
    if (!tenant || (configuredTenant && tenant.tenantId !== configuredTenant)) {
      return noStore(new NextResponse("Not found", { status: 404 }));
    }

    // 3. Config + secret VALUE compare.
    const config = await getTelegramConfig();
    if (config.state !== "ok" || !verifySecretHeader(header, config.webhookSecret ?? "")) {
      return noStore(failure(NO_SECRET_MESSAGE, 401));
    }

    // 4. Body size cap, in UTF-8 bytes, before any parse.
    const raw = await req.text();
    if (Buffer.byteLength(raw, "utf8") > TELEGRAM_WEBHOOK_BODY_MAX_BYTES) return ignore();

    // 5. Parse + Zod. Any failure, or an update with no `message`, is a
    // silent 200 — never a non-2xx (that would invite redelivery).
    let body: unknown;
    try {
      body = JSON.parse(raw);
    } catch {
      return ignore();
    }
    const parsed = telegramUpdateSchema.safeParse(body);
    if (!parsed.success) return ignore();
    const update = parsed.data;
    if (!update.message) return ignore();
    const chatId = String(update.message.chat.id);

    // 6. Rate limit — per-chat bucket, then the global ceiling. Over either
    // ⇒ 200, nothing past the counter itself.
    const now = Date.now();
    const perChat = await hitRateLimit(`tg:${chatId}`, TELEGRAM_WEBHOOK_RATE_MAX_CHAT, now);
    if (!perChat.allowed) return ignore();
    const global = await hitRateLimit(RATE_BUCKET_ALL, TELEGRAM_WEBHOOK_RATE_MAX_GLOBAL, now);
    if (!global.allowed) return ignore();

    // 7. Dispatch — pure core, injected ports.
    const result = await dispatchUpdate(update, ports);

    // 8. Always 200, constant shape.
    if (result.reply) {
      return noStore(
        NextResponse.json(
          {
            method: "sendMessage",
            chat_id: result.reply.chatId,
            text: result.reply.text,
            parse_mode: "HTML",
          },
          { status: 200 },
        ),
      );
    }
    return ignore();
  } catch {
    // Never throws to the caller — a transient DB blip must not start a
    // redelivery storm.
    return ignore();
  }
}
