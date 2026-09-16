/**
 * CR2.3b §21.10 live leg — proves the Telegram registry/crypto/fan-out/webhook
 * modules against a REAL MongoDB. Mirrors scripts/verify-self-order-alert-live.ts's
 * own conventions (scratch-DB-prefix guard, numbered PASS/FAIL, full drop at
 * start and end) — read that file's header first.
 *
 * SCOPE — drives lib/telegram/{chats,secret,config,send,webhook-core}.ts
 * directly against real Mongoose models (TelegramChat, TelegramInvite,
 * Settings). The Telegram Bot API itself is FAKED (a fake TelegramPort, never
 * a real fetch to api.telegram.org) — this is the shape §21.10 specifies for
 * this live leg; the fetch-level parsing of lib/telegram/api.ts is a coverage
 * gap this leg does not fill (flagged in the S9 report, not this file).
 *
 *   npm run verify:telegram:live
 *   MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_telegram npm run verify:telegram:live
 *
 * SAFETY: refuses to run against any database whose name does not carry the
 * scratch prefix, and drops the WHOLE scratch database (start and end).
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import mongoose from "mongoose";
import { connectDB } from "@/lib/db";
import { Settings } from "@/models/Settings";
import { TelegramChat, telegramChatSchema } from "@/models/TelegramChat";
import { TelegramInvite, telegramInviteSchema } from "@/models/TelegramInvite";
import {
  mongooseChatStore,
  connectChat,
  mintInvite,
  consumeInvite,
  pruneInvites,
  listChats,
  updateChatToggles,
  removeChat,
} from "@/lib/telegram/chats";
import { sealSecret, openSecret } from "@/lib/telegram/secret";
import {
  getTelegramConfig,
  writeTelegramCreds,
  clearTelegramCreds,
  invalidateTelegramConfigCache,
} from "@/lib/telegram/config";
import { fanOutToChats, fanOutTelegram, type FanOutDeps } from "@/lib/telegram/send";
import { dispatchUpdate, type TelegramUpdate, type WebhookPorts } from "@/lib/telegram/webhook-core";
import type { TelegramResult, TelegramSendMessageParams } from "@/lib/telegram/api";
import type { TelegramRequestSummary } from "@/lib/telegram/format";
import { assertSchemaTtlAllowed } from "@/lib/ttl-guard";
import { TELEGRAM_MAX_CHATS, type TelegramChatType } from "@pos/shared/telegram-alert";

const SCRATCH_PREFIX = "pos_scratch_";
const DEFAULT_URI = `mongodb://127.0.0.1:27017/${SCRATCH_PREFIX}telegram`;

let passed = 0;
let failed = 0;

function check(label: string, ok: boolean): void {
  if (ok) {
    passed += 1;
    console.log(`  ok   ${label}`);
  } else {
    failed += 1;
    console.log(`  FAIL ${label}`);
  }
}

// ── shared fixtures / fakes ──────────────────────────────────────────────────

// Same webhook-route adapter shape as app/api/telegram/webhook/route.ts's own
// `ports` object — exercised here over the REAL mongooseChatStore/connectChat,
// never a second hand-rolled version of the wiring.
function webhookPorts(): WebhookPorts {
  return {
    connect(code, chat) {
      return connectChat(code, { ...chat, chatType: chat.chatType as TelegramChatType });
    },
    rewrite(oldId, newId) {
      return mongooseChatStore.rewriteChatId(oldId, newId);
    },
  };
}

interface FakePort {
  calls: TelegramSendMessageParams[];
  sendMessage(params: TelegramSendMessageParams): Promise<TelegramResult>;
}

// A scripted queue of responses, one per call — never touches real fetch.
function fakePort(responses: TelegramResult[]): FakePort {
  const queue = [...responses];
  const port: FakePort = {
    calls: [],
    async sendMessage(params) {
      port.calls.push(params);
      return queue.shift() ?? { ok: true, result: null };
    },
  };
  return port;
}

function buildSummary(): TelegramRequestSummary {
  return {
    type: "newRequest",
    shortCode: "LIVE01",
    targetKind: "table",
    tableNo: "5",
    name: "Live Diner",
    itemCount: 1,
    itemsPreview: ["1× Tea"],
    total: 100,
  };
}

// Real store, fake port, injected clock/sleep — never a real setTimeout wait.
function buildDeps(port: FakePort, sleepCalls: number[]): FanOutDeps {
  return {
    port,
    store: mongooseChatStore,
    now: () => Date.now(),
    sleep: async (ms) => {
      sleepCalls.push(ms);
    },
  };
}

const REPLY_CONNECTED = "Connected. You will get order alerts in this chat.";

// ── L1 — chat CRUD + unique chatId ──────────────────────────────────────────

async function leg1(): Promise<void> {
  console.log("\nLeg 1 — chat CRUD + unique chatId (dup insert rejected)\n");
  await TelegramChat.deleteMany({});

  const doc = await TelegramChat.create({
    chatId: "1001",
    chatType: "private",
    title: "Kitchen phone",
    types: ["newRequest"],
    connectedAt: new Date(),
  });
  check("create succeeds", !!doc);

  let dupRejected = false;
  try {
    await TelegramChat.create({
      chatId: "1001",
      chatType: "group",
      title: "Duplicate",
      types: [],
      connectedAt: new Date(),
    });
  } catch (err) {
    dupRejected = (err as { code?: number }).code === 11000;
  }
  check("a second create with the SAME chatId is rejected (E11000)", dupRejected);

  const rows = await listChats();
  check("listChats returns exactly the one row", rows.length === 1 && rows[0].chatId === "1001");

  const patched = await updateChatToggles("1001", { active: false });
  check('updateChatToggles(active:false) reports "updated"', patched === "updated");
  const afterPatch = await TelegramChat.findOne({ chatId: "1001" }).lean();
  check("the row's active flag is now false", afterPatch?.active === false);

  const removed = await removeChat("1001");
  check('removeChat reports "removed"', removed === "removed");
  check("the collection is empty again", (await TelegramChat.countDocuments({})) === 0);
}

// ── L2 — invite mint → consume → replay → used-by-another ──────────────────

async function leg2(): Promise<void> {
  console.log("\nLeg 2 — invite mint → consume(connected) → same-chat replay → other-chat used\n");
  await TelegramInvite.deleteMany({});

  const minted = await mintInvite("Kitchen phone");
  check("mintInvite returns a code", typeof minted === "object" && !!minted.code);
  if (typeof minted !== "object") throw new Error(`leg2: mintInvite unexpectedly returned "${minted}"`);

  const first = await consumeInvite(minted.code, "2001");
  check('first consume reports "connected"', first === "connected");

  const replay = await consumeInvite(minted.code, "2001");
  check('a SECOND consume from the SAME chat reports "replay"', replay === "replay");

  const usedByOther = await consumeInvite(minted.code, "2002");
  check('a consume attempt from a DIFFERENT chat reports "used"', usedByOther === "used");

  const row = await TelegramInvite.findOne({ code: minted.code }).lean();
  check("the invite's usedChatId stayed the FIRST chat, never overwritten by the second attempt", row?.usedChatId === "2001");
}

// ── L3 — expired refused; prune deletes only unused-expired ─────────────────

// PUBLIC_TOKEN_PATTERN (packages/shared/src/public.ts) requires EXACTLY 14
// characters from an alphabet that excludes I/L/O/U — consumeInvite's own
// isInviteCodeShape gate rejects anything else as "unknown" before it ever
// queries Mongo, so a hand-typed fixture code must match that shape or this
// leg would silently prove the wrong thing (caught live: an earlier draft of
// this code used a 13-char string containing "U" and got "unknown" instead
// of "expired").
const EXPIRED_UNUSED_CODE = "TG7EXPRD3K9H2M";
const EXPIRED_USED_CODE = "TG7EXPRD3K9H2N";

async function leg3(): Promise<void> {
  console.log("\nLeg 3 — expired invite refused + pruneInvites deletes ONLY unused-expired (a USED row survives)\n");
  await TelegramInvite.deleteMany({});
  const now = Date.now();

  const expiredUnused = await TelegramInvite.create({
    code: EXPIRED_UNUSED_CODE,
    label: "Expired unused",
    expiresAt: new Date(now - 1000),
  });
  const expiredUsed = await TelegramInvite.create({
    code: EXPIRED_USED_CODE,
    label: "Expired but used",
    expiresAt: new Date(now - 1000),
    usedAt: new Date(now - 500),
    usedChatId: "3001",
  });

  const verdict = await consumeInvite(EXPIRED_UNUSED_CODE, "3002");
  check('consuming an expired, unused invite reports "expired"', verdict === "expired");

  await pruneInvites(now);

  const unusedStillThere = await TelegramInvite.findById(expiredUnused._id).lean();
  check("the UNUSED expired row was deleted by prune", unusedStillThere === null);

  const usedStillThere = await TelegramInvite.findById(expiredUsed._id).lean();
  check("the USED expired row SURVIVED prune — it is the replay-verdict source and audit trail", usedStillThere !== null);
}

// ── L4 — shouldSendToChat filtering over REAL rows ──────────────────────────

async function leg4(): Promise<void> {
  console.log("\nLeg 4 — shouldSendToChat over real rows via fanOutToChats (empty types / active:false ⇒ zero port calls)\n");
  await TelegramChat.deleteMany({});
  await TelegramChat.create([
    { chatId: "4001", chatType: "private", title: "Empty types", types: [], active: true, connectedAt: new Date() },
    { chatId: "4002", chatType: "private", title: "Deactivated", types: ["newRequest"], active: false, connectedAt: new Date() },
  ]);

  const port = fakePort([]);
  const sleepCalls: number[] = [];
  const result = await fanOutToChats("newRequest", buildSummary(), buildDeps(port, sleepCalls));

  // Caught live: mongooseChatStore.listActive() queries `{ active: true }` at
  // the DB level (chats.ts), so the DEACTIVATED row (4002) never reaches
  // fanOutToChats's own `chats` array at all — it does not add to `skipped`
  // the way the empty-types row does; it is filtered a layer EARLIER than
  // shouldSendToChat. send.test.ts's fake store (whose listActive() returns
  // every row verbatim, active or not) cannot see this distinction — a real
  // discrepancy this live leg exists to surface, not a bug in either side.
  check("the empty-types ACTIVE row is skipped by shouldSendToChat", result.skipped === 1);
  check("only ONE of the two created rows was even considered (the inactive one never left the store query)", result.skipped + result.sent + result.failed + result.deactivated + result.migrated === 1);
  check("zero real port calls happen when every considered row is filtered before the port", port.calls.length === 0);
  check("nothing was sent", result.sent === 0);
}

// ── L5 — plain read carries no *Enc key; the projected read does ───────────

async function leg5(): Promise<void> {
  console.log("\nLeg 5 — a getSettings()-shaped read carries neither *Enc key; config.ts's +projection read does\n");
  await Settings.deleteMany({});
  await writeTelegramCreds({
    telegramBotTokenEnc: sealSecret("leg5-token", "bot-token") ?? "",
    telegramWebhookSecretEnc: sealSecret("leg5-secret", "webhook-secret") ?? "",
    telegramBotId: "999",
    telegramBotUsername: "leg5_bot",
    telegramValidatedAt: new Date(),
  });

  const plain = await Settings.findOne({}).lean();
  check("a plain findOne() (no projection) carries NO telegramBotTokenEnc key", !plain || !("telegramBotTokenEnc" in plain));
  check("a plain findOne() (no projection) carries NO telegramWebhookSecretEnc key", !plain || !("telegramWebhookSecretEnc" in plain));

  const projected = await Settings.findOne({}).select("+telegramBotTokenEnc +telegramWebhookSecretEnc").lean();
  check("the explicit +projection DOES carry telegramBotTokenEnc", typeof projected?.telegramBotTokenEnc === "string");
  check("the explicit +projection DOES carry telegramWebhookSecretEnc", typeof projected?.telegramWebhookSecretEnc === "string");
}

// ── L6 — seal→store→read→open roundtrip; tamper + wrong-purpose both fail ──

async function leg6(): Promise<void> {
  console.log("\nLeg 6 — sealSecret→store→read→openSecret roundtrip on the REAL Settings doc; tampered tag and wrong purpose both fail\n");
  const sealed = sealSecret("leg6-plaintext-token", "bot-token");
  check("sealSecret succeeds", typeof sealed === "string");
  if (!sealed) throw new Error("leg6: sealSecret unexpectedly returned null");

  await writeTelegramCreds({
    telegramBotTokenEnc: sealed,
    telegramWebhookSecretEnc: sealSecret("leg6-webhook-secret", "webhook-secret") ?? "",
    telegramBotId: "1000",
    telegramValidatedAt: new Date(),
  });

  const projected = await Settings.findOne({}).select("+telegramBotTokenEnc +telegramWebhookSecretEnc").lean();
  const roundtripped = projected?.telegramBotTokenEnc ? openSecret(projected.telegramBotTokenEnc, "bot-token") : null;
  check("the stored envelope opens back to the ORIGINAL plaintext", roundtripped === "leg6-plaintext-token");

  const parts = sealed.split(":");
  const tag = Buffer.from(parts[2], "base64");
  const truncatedTag = Buffer.concat([tag.subarray(0, 4)]).toString("base64");
  const tampered = [parts[0], parts[1], truncatedTag, parts[3]].join(":");
  check("a TAG-TRUNCATED envelope fails to open (never partially trusts a short tag)", openSecret(tampered, "bot-token") === null);

  check("opening a bot-token envelope under the WRONG purpose fails (AAD binding)", openSecret(sealed, "webhook-secret") === null);
}

// ── L7 — 403 ⇒ deactivate reason "blocked" ──────────────────────────────────

async function leg7(): Promise<void> {
  console.log('\nLeg 7 — fake port returns 403 ⇒ the row flips active:false, reason "blocked"\n');
  await TelegramChat.deleteMany({});
  await TelegramChat.create({
    chatId: "7001", chatType: "private", title: "Blocks the bot",
    types: ["newRequest"], active: true, connectedAt: new Date(),
  });

  const port = fakePort([{ ok: false, errorCode: 403 }]);
  const sleepCalls: number[] = [];
  const result = await fanOutToChats("newRequest", buildSummary(), buildDeps(port, sleepCalls));

  check("fanOutToChats counts one deactivation", result.deactivated === 1);
  const row = await TelegramChat.findOne({ chatId: "7001" }).lean();
  check("the row is now active:false", row?.active === false);
  check('the row carries deactivatedReason:"blocked"', row?.deactivatedReason === "blocked");
  check("no retry happened on a 403 (exactly one port call)", port.calls.length === 1);
}

// ── L8 — 429 ⇒ one bounded retry, row stays active ──────────────────────────

async function leg8(): Promise<void> {
  console.log("\nLeg 8 — fake port returns 429 with a small retry_after ⇒ exactly one retry then success, row stays active\n");
  await TelegramChat.deleteMany({});
  await TelegramChat.create({
    chatId: "8001", chatType: "private", title: "Rate-limited once",
    types: ["newRequest"], active: true, connectedAt: new Date(),
  });

  const port = fakePort([
    { ok: false, errorCode: 429, retryAfterSec: 2 },
    { ok: true, result: null },
  ]);
  const sleepCalls: number[] = [];
  const result = await fanOutToChats("newRequest", buildSummary(), buildDeps(port, sleepCalls));

  check("exactly one retry sleep was scheduled", sleepCalls.length === 1);
  check("the sleep was injected, never a real wait (2000ms requested)", sleepCalls[0] === 2000);
  check("exactly two port calls happened (original + one retry)", port.calls.length === 2);
  check("the retried send is counted as sent", result.sent === 1 && result.failed === 0);
  const row = await TelegramChat.findOne({ chatId: "8001" }).lean();
  check("the row STAYS active after a successful retry", row?.active === true);
  check("lastSendAt was recorded on the row", row?.lastSendAt instanceof Date);
}

// ── L9 — migrate from both the send side and the webhook side ──────────────

async function leg9a(): Promise<void> {
  console.log("\nLeg 9a — send-side migrate_to_chat_id ⇒ store rewrites + exactly one resend\n");
  await TelegramChat.deleteMany({});
  await TelegramChat.create({
    chatId: "9001", chatType: "private", title: "Upgrading to a group",
    types: ["newRequest"], active: true, connectedAt: new Date(),
  });

  const port = fakePort([
    { ok: false, errorCode: 400, migrateToChatId: "9002" },
    { ok: true, result: null },
  ]);
  const sleepCalls: number[] = [];
  const result = await fanOutToChats("newRequest", buildSummary(), buildDeps(port, sleepCalls));

  check("fanOutToChats counts one migration", result.migrated === 1);
  check("the resend to the NEW id is counted as sent", result.sent === 1);
  check("exactly two port calls happened (original to OLD id, resend to NEW id)", port.calls.length === 2);
  check("the second call targeted the NEW chat id", port.calls[1]?.chatId === "9002");

  const oldRow = await TelegramChat.findOne({ chatId: "9001" }).lean();
  check("the OLD chatId no longer has a row (rewritten in place)", oldRow === null);
  const newRow = await TelegramChat.findOne({ chatId: "9002" }).lean();
  check("a row now exists at the NEW chat id", newRow !== null);
  check("the rewritten row kept its lastSendAt from the successful resend", newRow?.lastSendAt instanceof Date);
}

async function leg9b(): Promise<void> {
  console.log("\nLeg 9b — webhook-side migrate_to_chat_id (dispatchUpdate over the REAL mongooseChatStore) rewrites the row\n");
  await TelegramChat.deleteMany({});
  await TelegramChat.create({
    chatId: "9101", chatType: "group", title: "Group upgrading",
    types: ["newRequest"], active: true, connectedAt: new Date(),
  });

  const update: TelegramUpdate = {
    message: { chat: { id: 9101, type: "group" }, migrate_to_chat_id: 9102 },
  } as TelegramUpdate;
  const result = await dispatchUpdate(update, webhookPorts());
  check('dispatchUpdate over REAL ports reports effect:"migrated"', result.effect === "migrated");

  const oldRow = await TelegramChat.findOne({ chatId: "9101" }).lean();
  check("the OLD chatId no longer has a row", oldRow === null);
  const newRow = await TelegramChat.findOne({ chatId: "9102" }).lean();
  check("a row now exists at the NEW chat id", newRow !== null && newRow.title === "Group upgrading");
}

async function leg9c(): Promise<void> {
  console.log('\nLeg 9c — migrate onto an id that is ALREADY registered ⇒ collision: old row deactivates reason "migrated", new row untouched\n');
  await TelegramChat.deleteMany({});
  await TelegramChat.create([
    { chatId: "9201", chatType: "group", title: "Old group", types: ["newRequest"], active: true, connectedAt: new Date() },
    { chatId: "9202", chatType: "group", title: "Already reconnected fresh", types: ["autoAccepted"], active: true, connectedAt: new Date() },
  ]);

  const verdict = await mongooseChatStore.rewriteChatId("9201", "9202");
  check('rewriteChatId reports "collision" when the NEW id already has a row', verdict === "collision");

  const oldRow = await TelegramChat.findOne({ chatId: "9201" }).lean();
  check("the OLD row is deactivated", oldRow?.active === false);
  check('the OLD row carries deactivatedReason:"migrated"', oldRow?.deactivatedReason === "migrated");

  const newRow = await TelegramChat.findOne({ chatId: "9202" }).lean();
  check("the row already at the NEW id is UNTOUCHED (still its own types)", newRow?.active === true && newRow.types.includes("autoAccepted"));
}

// ── L10 — kill switch short-circuits fanOutTelegram ─────────────────────────

async function leg10(): Promise<void> {
  console.log("\nLeg 10 — telegramPaused:true ⇒ fanOutTelegram short-circuits with zero port calls\n");
  await Settings.deleteMany({});
  await writeTelegramCreds({
    telegramBotTokenEnc: sealSecret("leg10-token", "bot-token") ?? "",
    telegramWebhookSecretEnc: sealSecret("leg10-secret", "webhook-secret") ?? "",
    telegramBotId: "1010",
    telegramValidatedAt: new Date(),
  });
  await Settings.findOneAndUpdate({}, { $set: { telegramPaused: true } });
  invalidateTelegramConfigCache();

  const config = await getTelegramConfig();
  check('config state is "ok" (creds ARE readable) — this leg proves the PAUSE check, not a broken read', config.state === "ok");
  check("config.paused reflects the stored kill switch", config.paused === true);

  const beforeCount = await TelegramChat.countDocuments({});
  const result = await fanOutTelegram("newRequest", buildSummary());
  check("fanOutTelegram returns null when paused — never reaches the port at all", result === null);
  check("no TelegramChat writes happened", (await TelegramChat.countDocuments({})) === beforeCount);
}

// ── L11 — the same /start update delivered twice over real ports ───────────

async function leg11(): Promise<void> {
  console.log("\nLeg 11 — the SAME /start update dispatched twice over real ports ⇒ one chat row, one invite consumption, same reply both times\n");
  await TelegramChat.deleteMany({});
  await TelegramInvite.deleteMany({});

  const minted = await mintInvite("Counter tablet");
  if (typeof minted !== "object") throw new Error(`leg11: mintInvite unexpectedly returned "${minted}"`);

  const update: TelegramUpdate = {
    message: { chat: { id: 11001, type: "private", first_name: "Counter" }, text: `/start ${minted.code}` },
  } as TelegramUpdate;

  const first = await dispatchUpdate(update, webhookPorts());
  const second = await dispatchUpdate(update, webhookPorts());

  check('the first delivery reports effect:"connected"', first.effect === "connected");
  check('the REDELIVERED second delivery reports effect:"replay"', second.effect === "replay");
  check("both deliveries reply with the SAME text (no oracle distinguishing replay from fresh)", first.reply?.text === second.reply?.text);
  check("that shared reply text is the real CONNECTED copy", first.reply?.text === REPLY_CONNECTED);

  check("exactly ONE chat row exists", (await TelegramChat.countDocuments({})) === 1);
  const inviteRow = await TelegramInvite.findOne({ code: minted.code }).lean();
  check("the invite's usedChatId is the chat that consumed it, stamped exactly once", inviteRow?.usedChatId === "11001");
}

// ── L12 — absent / unreadable config ⇒ silent null, zero writes ────────────

async function leg12(): Promise<void> {
  console.log("\nLeg 12 — config state absent and unreadable ⇒ fanOutTelegram returns null, zero writes\n");
  await TelegramChat.deleteMany({});
  await TelegramChat.create({
    chatId: "12001", chatType: "private", title: "Should never be touched",
    types: ["newRequest"], active: true, connectedAt: new Date(),
  });
  const beforeCount = await TelegramChat.countDocuments({});

  await clearTelegramCreds();
  const absentConfig = await getTelegramConfig();
  check('state is "absent" once creds are cleared', absentConfig.state === "absent");
  const absentResult = await fanOutTelegram("newRequest", buildSummary());
  check("fanOutTelegram returns null when config is absent", absentResult === null);

  await writeTelegramCreds({
    telegramBotTokenEnc: "not-a-real-envelope",
    telegramWebhookSecretEnc: "also-not-a-real-envelope",
    telegramBotId: "1200",
    telegramValidatedAt: new Date(),
  });
  const unreadableConfig = await getTelegramConfig();
  check('state is "unreadable" for a corrupt envelope (openSecret fails closed, never throws)', unreadableConfig.state === "unreadable");
  const unreadableResult = await fanOutTelegram("newRequest", buildSummary());
  check("fanOutTelegram returns null when config is unreadable", unreadableResult === null);

  check("no TelegramChat writes happened across either state", (await TelegramChat.countDocuments({})) === beforeCount);
}

// ── L13 — both models carry no TTL index, verified against the REAL driver ─

async function leg13(): Promise<void> {
  console.log("\nLeg 13 — both TelegramChat and TelegramInvite carry NO TTL index — live index inspection, not just the schema's own declaration\n");
  check("assertSchemaTtlAllowed(TelegramChat) does not throw", (() => {
    try {
      assertSchemaTtlAllowed("TelegramChat", telegramChatSchema);
      return true;
    } catch {
      return false;
    }
  })());
  check("assertSchemaTtlAllowed(TelegramInvite) does not throw", (() => {
    try {
      assertSchemaTtlAllowed("TelegramInvite", telegramInviteSchema);
      return true;
    } catch {
      return false;
    }
  })());

  const chatIndexes = await TelegramChat.collection.indexes();
  const inviteIndexes = await TelegramInvite.collection.indexes();
  check(
    "the REAL TelegramChat collection carries no expireAfterSeconds index",
    chatIndexes.every((ix) => !("expireAfterSeconds" in ix)),
  );
  check(
    "the REAL TelegramInvite collection carries no expireAfterSeconds index",
    inviteIndexes.every((ix) => !("expireAfterSeconds" in ix)),
  );
  check("TelegramChat has exactly the unique chatId index (plus the default _id)", chatIndexes.length === 2);
  check("TelegramInvite has exactly the unique code index (plus the default _id)", inviteIndexes.length === 2);
}

// ── L14 — cap refusal leaves the invite unused and still consumable ────────

async function leg14(): Promise<void> {
  console.log('\nLeg 14 — connectChat "cap" refusal leaves the invite UNUSED and still consumable once a slot frees up\n');
  await TelegramChat.deleteMany({});
  await TelegramInvite.deleteMany({});

  const fillRows = Array.from({ length: TELEGRAM_MAX_CHATS }, (_, i) => ({
    chatId: `14${String(i).padStart(3, "0")}`,
    chatType: "private" as const,
    title: `Filler ${i}`,
    types: ["newRequest"],
    active: true,
    connectedAt: new Date(),
  }));
  await TelegramChat.create(fillRows);
  check(
    `the registry is filled to TELEGRAM_MAX_CHATS (${TELEGRAM_MAX_CHATS})`,
    (await TelegramChat.countDocuments({ active: true })) === TELEGRAM_MAX_CHATS,
  );

  const minted = await mintInvite("One too many");
  if (typeof minted !== "object") throw new Error(`leg14: mintInvite unexpectedly returned "${minted}"`);

  const freshChatId = "14999";
  const verdict = await connectChat(minted.code, { chatId: freshChatId, chatType: "private", title: "Latecomer" });
  check('connectChat at TELEGRAM_MAX_CHATS reports "cap"', verdict === "cap");

  const inviteRow = await TelegramInvite.findOne({ code: minted.code }).lean();
  check("the invite stays UNUSED after a cap refusal — it was never burned", !inviteRow?.usedAt);
  check("no chat row was created for the refused chatId", (await TelegramChat.findOne({ chatId: freshChatId }).lean()) === null);

  // Free a slot, then the SAME still-live invite must complete the connect.
  await TelegramChat.deleteOne({ chatId: "14000" });
  const secondAttempt = await connectChat(minted.code, { chatId: freshChatId, chatType: "private", title: "Latecomer" });
  check('the SAME invite reports "connected" once a slot frees up', secondAttempt === "connected");
  check("the chat row now exists", (await TelegramChat.findOne({ chatId: freshChatId }).lean()) !== null);
}

// ── L15 — replay after an interrupted connect completes the upsert once ────

async function leg15(): Promise<void> {
  console.log('\nLeg 15 — replay after an interrupted connect (CAS landed, upsert never ran) completes the upsert exactly once, still reports "replay"\n');
  await TelegramChat.deleteMany({});
  await TelegramInvite.deleteMany({});

  const minted = await mintInvite("Interrupted connect");
  if (typeof minted !== "object") throw new Error(`leg15: mintInvite unexpectedly returned "${minted}"`);
  const chatId = "15001";

  // Simulate the CAS landing without its paired upsert (a crash between the
  // two, or the pre-amendment burn-then-cap branch) — call consumeInvite
  // directly, bypassing connectChat's own upsert entirely.
  const firstConsume = await consumeInvite(minted.code, chatId);
  check('the direct consumeInvite call reports "connected"', firstConsume === "connected");
  check("no chat row exists yet (the simulated crash point)", (await TelegramChat.findOne({ chatId }).lean()) === null);

  const verdict = await connectChat(minted.code, { chatId, chatType: "private", title: "Recovered" });
  check('connectChat over the SAME code+chatId reports "replay"', verdict === "replay");

  const row = await TelegramChat.findOne({ chatId }).lean();
  check("the interrupted connect is now completed — the chat row EXISTS", row !== null);
  check("the row was created exactly once", (await TelegramChat.countDocuments({ chatId })) === 1);
}

// ── L16 — replay against an existing DEACTIVATED row mutates nothing ───────

async function leg16(): Promise<void> {
  console.log('\nLeg 16 — replay against an existing DEACTIVATED row mutates NOTHING (active stays false, types/title/reason unchanged)\n');
  await TelegramChat.deleteMany({});
  await TelegramInvite.deleteMany({});

  const minted = await mintInvite("Already connected, later deactivated");
  if (typeof minted !== "object") throw new Error(`leg16: mintInvite unexpectedly returned "${minted}"`);
  const chatId = "16001";

  const firstConsume = await consumeInvite(minted.code, chatId);
  check('the direct consumeInvite call reports "connected"', firstConsume === "connected");

  // The chat was fully connected once, then deactivated (e.g. a 403 block) —
  // simulate that end state directly rather than driving it through send.ts.
  await TelegramChat.create({
    chatId, chatType: "private", title: "Blocked later",
    types: ["autoAccepted"], active: false, deactivatedReason: "blocked", connectedAt: new Date(),
  });

  const verdict = await connectChat(minted.code, { chatId, chatType: "private", title: "Recovered" });
  check('connectChat over the SAME code+chatId reports "replay"', verdict === "replay");

  const row = await TelegramChat.findOne({ chatId }).lean();
  check("the row's active flag STAYS false — a replay never re-activates", row?.active === false);
  check("the row's types are UNCHANGED", row?.types.length === 1 && row.types[0] === "autoAccepted");
  check("the row's title is UNCHANGED — never overwritten by the replay's derived title", row?.title === "Blocked later");
  check("the row's deactivatedReason is UNCHANGED", row?.deactivatedReason === "blocked");
}

// ── main ─────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
  const dbName = new URL(uri.replace("mongodb://", "http://")).pathname.slice(1);
  if (!dbName.startsWith(SCRATCH_PREFIX)) {
    throw new Error(`Refusing to run against "${dbName}" — the live leg only touches a database named ${SCRATCH_PREFIX}*.`);
  }

  // The crypto legs (L6, L10, L12) need real key material — set in-process so
  // this script never depends on (or leaks into) the caller's own shell env.
  process.env.AUTH_SECRET = "verify-telegram-live-scratch-secret-32bytes";

  process.env.MONGODB_URI = uri;
  await connectDB();
  await mongoose.connection.dropDatabase(); // clean slate even after a crashed prior run
  await Promise.all([TelegramChat.createIndexes(), TelegramInvite.createIndexes(), Settings.createIndexes()]);

  console.log(`\nCR2.3b §21.10 Telegram integration — live against ${dbName}\n`);

  try {
    await leg1();
    await leg2();
    await leg3();
    await leg4();
    await leg5();
    await leg6();
    await leg7();
    await leg8();
    await leg9a();
    await leg9b();
    await leg9c();
    await leg10();
    await leg11();
    await leg12();
    await leg13();
    await leg14();
    await leg15();
    await leg16();
  } finally {
    await mongoose.connection.dropDatabase();
    await mongoose.disconnect();
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
