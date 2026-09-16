import { connectDB } from "@/lib/db";
import {
  defaultAlertTypes,
  normalizeAlertTypes,
  TELEGRAM_MAX_CHATS,
  type TelegramChatType,
} from "@pos/shared/telegram-alert";
import { TelegramChat, type ITelegramChat, type TelegramChatDeactivatedReason } from "@/models/TelegramChat";
import { consumeInvite, type ConsumeInviteVerdict } from "./invites";

// CR2.3b §21.4 S4 (AS AMENDED) — the ONLY module that WRITES the Telegram
// chat registry via Mongoose (the invite registry's own reads/writes live in
// ./invites — split out to keep this file under the ~300-line budget; the
// admin invites GET reads TelegramInvite directly — a read-only, secret-free
// listing). `send.ts` depends on `ChatStore` below, never on these models, so
// its tests stay DB-free. No console.*; every op catches its own failures
// rather than throwing into a caller.

// Re-exported so every existing "@/lib/telegram/chats" import (mintInvite,
// revokeInvite, consumeInvite, pruneInvites, MintedInvite,
// ConsumeInviteVerdict) keeps working unchanged after the split above.
export { pruneInvites, mintInvite, revokeInvite, consumeInvite, type ConsumeInviteVerdict, type MintedInvite } from "./invites";

// Charset gates, checked BEFORE any query — junk never reaches Mongo.
const CHAT_ID_PATTERN = /^-?\d{1,20}$/;
const isValidChatId = (v: string): boolean => CHAT_ID_PATTERN.test(v);
const isDuplicateKeyError = (err: unknown): boolean =>
  typeof err === "object" && err !== null && (err as { code?: number }).code === 11000;
// ── The registry read/write port send.ts depends on ─────────────────────────
export interface TelegramChatRow {
  chatId: string;
  chatType: TelegramChatType;
  title: string;
  active: boolean;
  types: string[];
  connectedAt: Date;
  lastSendAt?: Date;
  lastErrorAt?: Date;
  lastErrorCode?: number;
  deactivatedReason?: TelegramChatDeactivatedReason;
}

export interface ChatStore {
  listActive(): Promise<TelegramChatRow[]>;
  recordSend(chatId: string, at: Date): Promise<void>;
  recordError(chatId: string, code: number, at: Date): Promise<void>;
  deactivate(chatId: string, reason: "blocked" | "migrated"): Promise<void>;
  rewriteChatId(oldId: string, newId: string): Promise<"rewritten" | "collision" | "unknown">;
}

type LeanChatDoc = Pick<
  ITelegramChat,
  "chatId" | "chatType" | "title" | "active" | "types" | "connectedAt" | "lastSendAt" | "lastErrorAt" | "lastErrorCode" | "deactivatedReason"
>;

function toRow(doc: LeanChatDoc): TelegramChatRow {
  const row: TelegramChatRow = {
    chatId: doc.chatId, chatType: doc.chatType, title: doc.title,
    active: doc.active, types: doc.types, connectedAt: doc.connectedAt,
  };
  if (doc.lastSendAt) row.lastSendAt = doc.lastSendAt;
  if (doc.lastErrorAt) row.lastErrorAt = doc.lastErrorAt;
  if (doc.lastErrorCode !== undefined) row.lastErrorCode = doc.lastErrorCode;
  if (doc.deactivatedReason) row.deactivatedReason = doc.deactivatedReason;
  return row;
}

// §21.4 AS AMENDED — only fires when the OLD id has a row; a row already at
// the NEW id deactivates the old one "migrated" instead of rewriting; a lost
// E11000 race collapses to the same outcome. Never throws.
async function rewriteChatId(oldId: string, newId: string): Promise<"rewritten" | "collision" | "unknown"> {
  try {
    await connectDB();
    const oldRow = await TelegramChat.findOne({ chatId: oldId }).select("_id").lean();
    if (!oldRow) return "unknown";

    const existingAtNew = await TelegramChat.findOne({ chatId: newId }).select("_id").lean();
    if (existingAtNew) {
      await TelegramChat.updateOne({ chatId: oldId }, { $set: { active: false, deactivatedReason: "migrated" } });
      return "collision";
    }
    try {
      await TelegramChat.updateOne({ chatId: oldId }, { $set: { chatId: newId } });
      return "rewritten";
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err; // a race onto the same new id ⇒ same outcome
      await TelegramChat.updateOne({ chatId: oldId }, { $set: { active: false, deactivatedReason: "migrated" } });
      return "collision";
    }
  } catch {
    return "unknown";
  }
}

// Shared by the three best-effort bookkeeping writers below — a bookkeeping
// miss must never surface to the fan-out caller.
async function bestEffortSet(chatId: string, set: Record<string, unknown>): Promise<void> {
  try {
    await connectDB();
    await TelegramChat.updateOne({ chatId }, { $set: set });
  } catch {
    // best-effort
  }
}

export const mongooseChatStore: ChatStore = {
  async listActive() {
    try {
      await connectDB();
      const docs = (await TelegramChat.find({ active: true }).lean()) as unknown as LeanChatDoc[];
      return docs.map(toRow);
    } catch {
      return [];
    }
  },
  recordSend(chatId, at) {
    return bestEffortSet(chatId, { lastSendAt: at });
  },
  recordError(chatId, code, at) {
    return bestEffortSet(chatId, { lastErrorAt: at, lastErrorCode: code });
  },
  deactivate(chatId, reason) {
    return bestEffortSet(chatId, { active: false, deactivatedReason: reason });
  },
  rewriteChatId,
};

// ── Chats ────────────────────────────────────────────────────────────────────
export type ConnectChatVerdict = ConsumeInviteVerdict | "cap";

export interface ConnectingChat {
  chatId: string;
  chatType: TelegramChatType;
  title: string;
}

// The existing-row-lookup + cap check, followed by the re-runnable upsert.
// `active` lives ONLY in `$set` (never also `$setOnInsert` — Mongo rejects
// one field in both operators of an update); `$set` already covers the
// insert branch too. Shared by connectChat's two call sites below (a fresh
// "connected" verdict, and a "replay" verdict whose upsert never landed) —
// never throws (the caller wraps it in its own try/catch).
async function upsertConnectedChat(chat: ConnectingChat): Promise<"connected" | "cap"> {
  const existing = await TelegramChat.findOne({ chatId: chat.chatId }).select("_id").lean();
  if (!existing) {
    const activeCount = await TelegramChat.countDocuments({ active: true });
    if (activeCount >= TELEGRAM_MAX_CHATS) return "cap";
  }

  const now = new Date();
  await TelegramChat.findOneAndUpdate(
    { chatId: chat.chatId },
    {
      $setOnInsert: { types: defaultAlertTypes(), connectedAt: now },
      $set: { title: chat.title, chatType: chat.chatType, active: true },
      $unset: { deactivatedReason: "" },
    },
    { upsert: true },
  );
  return "connected";
}

// CR2.3b §21.4 AS AMENDED (code-review amendment) — two semantics:
//
// 1. The existing-row lookup + TELEGRAM_MAX_CHATS cap check run BEFORE
//    consumeInvite is ever called. A cap hit with no existing row for this
//    chatId returns "cap" WITHOUT consuming the invite — the invite stays
//    live and reusable once a slot frees up. (A racing pair of connects may
//    still slip past this best-effort check — same accepted class as
//    mintInvite's own cap.)
//
// 2. A "replay" verdict from consumeInvite normally mutates NOTHING on the
//    chat row (the guarantee that protects an admin's toggles from a
//    re-tapped deep link) — UNLESS no chat row exists yet, which means a
//    PRIOR connect's CAS landed but its own upsert never ran (a crash
//    between the two, or a pre-amendment burn-then-cap hit). In that case
//    the replay falls through to the SAME cap-checked upsert path to
//    complete the interrupted connect, then still reports "replay" — the
//    reply text a caller sees must never change (anti-oracle).
export async function connectChat(code: string, chat: ConnectingChat): Promise<ConnectChatVerdict> {
  try {
    await connectDB();
    const existing = await TelegramChat.findOne({ chatId: chat.chatId }).select("_id").lean();
    if (!existing) {
      const activeCount = await TelegramChat.countDocuments({ active: true });
      if (activeCount >= TELEGRAM_MAX_CHATS) return "cap";
    }
  } catch {
    return "unknown";
  }

  const verdict = await consumeInvite(code, chat.chatId);
  if (verdict !== "connected" && verdict !== "replay") return verdict;

  try {
    await connectDB();
    if (verdict === "replay") {
      const rowExists = await TelegramChat.exists({ chatId: chat.chatId });
      if (rowExists) return "replay";
      const result = await upsertConnectedChat(chat);
      return result === "cap" ? "cap" : "replay";
    }
    return await upsertConnectedChat(chat);
  } catch {
    return "unknown";
  }
}

export async function listChats(): Promise<TelegramChatRow[]> {
  try {
    await connectDB();
    const docs = (await TelegramChat.find({}).lean()) as unknown as LeanChatDoc[];
    return docs.map(toRow);
  } catch {
    return [];
  }
}

export interface ChatTogglePatch {
  types?: unknown;
  active?: boolean;
}

// Three-way discriminated result (never throws — a caller can tell "no such
// row" apart from "the write itself broke"): "missing" for an invalid-shape
// chatId or a matchedCount of 0; "error" only on a caught failure.
export type UpdateChatTogglesResult = "updated" | "missing" | "error";

// `active: true` also `$unset`s `deactivatedReason` (re-activation).
export async function updateChatToggles(chatId: string, patch: ChatTogglePatch): Promise<UpdateChatTogglesResult> {
  if (!isValidChatId(chatId)) return "missing";

  const set: Record<string, unknown> = {};
  const unset: Record<string, ""> = {};
  if (patch.types !== undefined) set.types = normalizeAlertTypes(patch.types);
  if (patch.active !== undefined) {
    set.active = patch.active;
    if (patch.active === true) unset.deactivatedReason = "";
  }
  if (Object.keys(set).length === 0 && Object.keys(unset).length === 0) return "updated";

  try {
    await connectDB();
    const update: Record<string, unknown> = {};
    if (Object.keys(set).length > 0) update.$set = set;
    if (Object.keys(unset).length > 0) update.$unset = unset;
    const result = await TelegramChat.updateOne({ chatId }, update);
    return result.matchedCount > 0 ? "updated" : "missing";
  } catch {
    return "error";
  }
}

// Same three-way shape as UpdateChatTogglesResult above ("removed" instead
// of "updated"): "missing" for an invalid-shape chatId or a deletedCount of
// 0, "error" only on a caught failure — never throws.
export type RemoveChatResult = "removed" | "missing" | "error";

export async function removeChat(chatId: string): Promise<RemoveChatResult> {
  if (!isValidChatId(chatId)) return "missing";
  try {
    await connectDB();
    const result = await TelegramChat.deleteOne({ chatId });
    return result.deletedCount > 0 ? "removed" : "missing";
  } catch {
    return "error";
  }
}
