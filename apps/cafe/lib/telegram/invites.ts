import { connectDB } from "@/lib/db";
import { mintUniquePublicToken } from "@/lib/public-token";
import { sanitizePublicText, PUBLIC_TOKEN_PATTERN } from "@pos/shared/public";
import { TELEGRAM_INVITE_TTL_MS, TELEGRAM_MAX_INVITES_LIVE } from "@pos/shared/telegram-alert";
import { TelegramInvite } from "@/models/TelegramInvite";

// CR2.3b §21.4 S4 (AS AMENDED) — the invite lifecycle (mint/consume/revoke/
// prune), split out of chats.ts (which crossed the ~300-line file budget
// once the code-review amendment landed there). chats.ts re-exports every
// name below, so every existing "@/lib/telegram/chats" import keeps working
// unchanged. No console.*; every op catches its own failures rather than
// throwing into a caller.

// An invite code shares its shape with a table's public token (same
// mintUniquePublicToken default length/alphabet) — reuse the pattern, not
// the table-scoped `isPublicToken` predicate (a different resource).
const isInviteCodeShape = (v: string): boolean => PUBLIC_TOKEN_PATTERN.test(v);

// Deletes only UNUSED-expired invites — USED rows are the replay-verdict
// source for `consumeInvite` and the audit trail, so never swept.
export async function pruneInvites(now: number): Promise<void> {
  try {
    await connectDB();
    await TelegramInvite.deleteMany({ usedAt: { $exists: false }, expiresAt: { $lt: new Date(now) } });
  } catch {
    // best-effort
  }
}

export interface MintedInvite {
  code: string;
  label: string;
  expiresAt: Date;
}

// Prunes lazily, then best-effort enforces TELEGRAM_MAX_INVITES_LIVE (a
// racing count-then-insert may briefly exceed it — accepted). Returns "cap"
// at cap, "error" on any failure — never throws (matches ConnectChatVerdict's
// discriminated-result precedent, so a caller can distinguish "no room" from
// "something broke" instead of collapsing both into null).
export async function mintInvite(label: string): Promise<MintedInvite | "cap" | "error"> {
  try {
    await connectDB();
    const now = new Date();
    await pruneInvites(now.getTime());

    const liveCount = await TelegramInvite.countDocuments({ usedAt: { $exists: false }, expiresAt: { $gt: now } });
    if (liveCount >= TELEGRAM_MAX_INVITES_LIVE) return "cap";

    const code = await mintUniquePublicToken((c) => TelegramInvite.exists({ code: c }).then(Boolean));
    const sanitizedLabel = sanitizePublicText(label);
    const expiresAt = new Date(now.getTime() + TELEGRAM_INVITE_TTL_MS);
    await TelegramInvite.create({ code, label: sanitizedLabel, expiresAt });
    return { code, label: sanitizedLabel, expiresAt };
  } catch {
    return "error";
  }
}

// Revokes an UNUSED invite; charset-gated first. Never throws.
export async function revokeInvite(code: string): Promise<boolean> {
  if (!isInviteCodeShape(code)) return false;
  try {
    await connectDB();
    const result = await TelegramInvite.deleteOne({ code, usedAt: { $exists: false } });
    return result.deletedCount > 0;
  } catch {
    return false;
  }
}

export type ConsumeInviteVerdict = "connected" | "replay" | "used" | "expired" | "unknown";

// Single-use CAS (§21.4 AS AMENDED): a CAS hit is "connected"; a miss
// re-reads by code — "replay" when the SAME chat redelivers its own
// already-used code (no second write), "used" for a different chat,
// "expired" unused-but-expired, "unknown" for no row. Never throws.
export async function consumeInvite(code: string, chatId: string): Promise<ConsumeInviteVerdict> {
  if (!isInviteCodeShape(code)) return "unknown";
  try {
    await connectDB();
    const now = new Date();
    const cas = await TelegramInvite.findOneAndUpdate(
      { code, usedAt: { $exists: false }, expiresAt: { $gt: now } },
      { $set: { usedAt: now, usedChatId: chatId } },
    );
    if (cas) return "connected";

    const row = await TelegramInvite.findOne({ code }).select("usedAt usedChatId").lean();
    if (!row) return "unknown";
    if (row.usedAt) return row.usedChatId === chatId ? "replay" : "used";
    return "expired"; // exists, still unused, yet missed the CAS ⇒ must be expired
  } catch {
    return "unknown";
  }
}
