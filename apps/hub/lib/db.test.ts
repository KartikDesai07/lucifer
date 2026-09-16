import { test } from "node:test";
import assert from "node:assert/strict";

import { connectDB } from "@/lib/db";

// DB-free guard: connectDB reads HUB_MONGODB_URI lazily and fails with a clear,
// non-leaky error when it is unset (so importing the module during `next build`
// never crashes, and a misconfigured deploy fails loudly). The live connect +
// HubUser round-trip runs against a scratch registry db in the integration leg.

test("connectDB rejects with a clear message when HUB_MONGODB_URI is unset", async () => {
  const saved = process.env.HUB_MONGODB_URI;
  delete process.env.HUB_MONGODB_URI;
  try {
    await assert.rejects(
      connectDB(),
      /HUB_MONGODB_URI environment variable is not set/,
    );
  } finally {
    if (saved !== undefined) process.env.HUB_MONGODB_URI = saved;
  }
});
