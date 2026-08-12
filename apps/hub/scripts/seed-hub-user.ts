/**
 * Seed the single owner HubUser (F3.1 verify + SETUP.md F3.15 ops step).
 *   HUB_OWNER_EMAIL='you@example.com' \
 *   HUB_OWNER_IP_ALLOWLIST='203.0.113.7,2001:db8::/48' \
 *   npm run seed:hub-user --workspace apps/hub
 * (reads apps/hub/.env.local → HUB_MONGODB_URI + HUB_OWNER_EMAIL + the allowlist).
 *
 * Idempotent upsert-by-email — re-running is a no-op for identity, but ALWAYS
 * re-applies the IP allowlist so an owner can update it here. Console output is
 * intentional (ops CLI, not app code — CLAUDE.md §5).
 *
 * §E-3 IP allowlist is REQUIRED (F3.4): the panel gate fails CLOSED on an empty
 * allowlist unless HUB_ALLOW_ANY_IP=1 (a local-dev/bootstrap flag). So in prod
 * you MUST set HUB_OWNER_IP_ALLOWLIST here BEFORE first login. A broad CIDR is
 * allowed for dynamic-IP owners; recovery for IP drift is re-running this script.
 */
import mongoose from "mongoose";

import { connectDB } from "@/lib/db";
import { HubUser } from "@/models/HubUser";

export async function seedHubUser() {
  const raw = process.env.HUB_OWNER_EMAIL;
  if (!raw) {
    throw new Error(
      "HUB_OWNER_EMAIL is required. Set the owner account email, e.g.\n" +
        "  HUB_OWNER_EMAIL='you@example.com' npm run seed:hub-user --workspace apps/hub",
    );
  }
  const email = raw.trim().toLowerCase();

  const allowlistRaw = process.env.HUB_OWNER_IP_ALLOWLIST?.trim();
  const allowAnyIp = process.env.HUB_ALLOW_ANY_IP === "1";
  if (!allowlistRaw && !allowAnyIp) {
    throw new Error(
      "HUB_OWNER_IP_ALLOWLIST is required (§E-3 fails closed on an empty allowlist).\n" +
        "  Set a comma-separated list of IPs/CIDRs, e.g. '203.0.113.7,2001:db8::/48'.\n" +
        "  For local dev only, set HUB_ALLOW_ANY_IP=1 instead.",
    );
  }
  // Only (re)apply the allowlist when one was explicitly provided. Re-running
  // WITHOUT the env var (e.g. just to confirm the user exists, or with the dev
  // flag set) must NOT silently wipe a previously-configured allowlist and lock
  // the owner out — omit the $set entirely in that case.
  const ipAllowlist = allowlistRaw
    ? allowlistRaw.split(",").map((s) => s.trim()).filter(Boolean)
    : null;

  await connectDB();

  // Build the update so `ipAllowlist` never appears in BOTH $set and $setOnInsert
  // (Mongo rejects that conflict). Provided → $set (applies on insert AND update);
  // absent → $setOnInsert to [] (insert only, never overwrites an existing list).
  const update = ipAllowlist
    ? { $setOnInsert: { email, role: "owner", isActive: true }, $set: { ipAllowlist } }
    : { $setOnInsert: { email, role: "owner", isActive: true, ipAllowlist: [] } };

  const res = await HubUser.updateOne({ email }, update, { upsert: true });
  const created = res.upsertedCount > 0;
  const user = await HubUser.findOne({ email }).select("_id email role ipAllowlist").lean();

  console.log(
    created
      ? `Created owner HubUser: ${email} (id ${user?._id}).`
      : `Owner HubUser already exists: ${email} (id ${user?._id}).`,
  );
  const effective = user?.ipAllowlist ?? [];
  console.log(
    effective.length > 0
      ? `IP allowlist: ${effective.join(", ")}`
      : "IP allowlist EMPTY — allowed only because HUB_ALLOW_ANY_IP=1 (dev/bootstrap).",
  );
  console.log("Next: enrol TOTP with `npm run enrol:totp` (F3.4), then sign in at /login.");
}

// Run standalone when invoked directly.
const isMain = (process.argv[1] ?? "")
  .replace(/\\/g, "/")
  .endsWith("scripts/seed-hub-user.ts");
if (isMain) {
  seedHubUser()
    .then(() => mongoose.disconnect())
    .then(() => process.exit(0))
    .catch((error) => {
      console.error(error instanceof Error ? error.message : error);
      process.exit(1);
    });
}
