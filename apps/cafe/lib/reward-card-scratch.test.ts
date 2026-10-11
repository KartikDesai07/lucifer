import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import type { DinerRevealedCardDto } from "@pos/shared/public-diner-cards";
import {
  REWARD_OPTION_KINDS,
  SCRATCH_BLOCK_ENV_VAR,
  type RewardCardSnapshot,
  type RewardOptionKind,
} from "@pos/shared/reward-levels";
import { deadlineFrom } from "@pos/shared/reward-levels-engine";
import type { ISettings } from "@/models/Settings";
import { stripComments } from "@/lib/source-pin-utils";
import {
  SCRATCH_CAS_ATTEMPTS,
  scratchFilter,
  scratchRewardCard,
  scratchUpdate,
  type RewardScratchDeps,
} from "@/lib/reward-card-scratch";

// CB-7 S4 slice B: the scratch order of operations + the CAS shape, over fake ports (DB-free). The live leg proves
// the same against a real mongod.

const NOW = new Date("2026-10-12T06:00:00.000Z");
const HOUR = 3_600_000;
const FUTURE = new Date(NOW.getTime() + 48 * HOUR);
const PAST = new Date(NOW.getTime() - 48 * HOUR);
const CID = "64b000000000000000000001";
const ID = "0123456789ab";
const OTHER_ID = "ba9876543210";

const BLOB = {
  v: 1,
  enabled: true,
  levels: [{ size: 3, slots: [{ step: 3, scratchDays: 7, useDays: 14, options: [{ kind: "bill-percent", id: "a1", weight: 1, min: 5, max: 10 }] }] }],
};
const settingsOf = (o: Record<string, unknown>): ISettings => o as unknown as ISettings;
const ON = settingsOf({ dinerAccountsEnabled: true, rewardLevels: BLOB, gstNumber: "27ABCDE1234F1Z5" });
const envOf = (o: Record<string, string>): NodeJS.ProcessEnv => o as unknown as NodeJS.ProcessEnv;

const OUTCOME: Record<RewardOptionKind, Partial<RewardCardSnapshot>> = {
  "bill-percent": { value: 12 },
  "bill-flat": { value: 50 },
  "product-percent": { value: 20, productId: "p1", productName: "Cold Coffee" },
  "category-percent": { value: 15, categoryId: "c1", categoryName: "Desserts" },
  "category-flat": { value: 40, categoryId: "c1", categoryName: "Desserts" },
  "free-item": { value: 0, productId: "p1", productName: "Cold Coffee", qty: 1 },
  points: { value: 50 },
  none: { value: 0 },
};

function card(kind: RewardOptionKind, o: Partial<RewardCardSnapshot> = {}): RewardCardSnapshot {
  return {
    id: ID,
    issueKey: "step:3",
    source: "level",
    level: 1,
    step: 3,
    optionId: "opt1",
    kind,
    pool: [{ kind: "bill-percent", label: "5–15% off the bill", weight: 1 }],
    issuedAt: new Date(NOW.getTime() - HOUR),
    scratchBy: FUTURE,
    useDays: 14,
    keepUntil: FUTURE,
    status: "ready",
    value: 0,
    ...OUTCOME[kind],
    ...o,
  };
}

interface Fake {
  deps: RewardScratchDeps;
  calls: { read: string[]; reveal: { filter: Record<string, unknown>; update: Record<string, unknown> }[]; now: number };
}

// `wallets` maps a customer id to that diner's cards; `onReveal` decides each write's matchedCount (and may mutate
// the wallet to model a concurrent winner).
function fake(
  wallets: Record<string, RewardCardSnapshot[]>,
  onReveal: (n: number) => number = () => 1,
  env: NodeJS.ProcessEnv = envOf({}),
): Fake {
  const calls: Fake["calls"] = { read: [], reveal: [], now: 0 };
  const deps: RewardScratchDeps = {
    readCard: async (cid) => {
      calls.read.push(cid);
      return wallets[cid] ?? null;
    },
    revealCard: async (filter, update) => {
      calls.reveal.push({ filter, update });
      return { matchedCount: onReveal(calls.reveal.length) };
    },
    now: () => {
      calls.now += 1;
      return NOW;
    },
    env,
  };
  return { deps, calls };
}

const untouched = (f: Fake): void => {
  assert.deepEqual(f.calls.read, []);
  assert.deepEqual(f.calls.reveal, []);
  assert.equal(f.calls.now, 0);
};

for (const kind of REWARD_OPTION_KINDS) {
  test(`scratch (${kind}): reveals through ONE guarded write built only from the engine patch`, async () => {
    const f = fake({ [CID]: [card(kind)] });
    const res = await scratchRewardCard(ON, CID, ID, f.deps);
    assert.equal(res.ok, true);
    if (!res.ok) return;
    const dto = res.card as DinerRevealedCardDto;
    assert.equal(f.calls.reveal.length, 1);
    assert.deepEqual(f.calls.reveal[0].filter, scratchFilter(CID, ID, NOW));
    const set = (f.calls.reveal[0].update as { $set: Record<string, unknown> }).$set;
    assert.equal(set["rewardCards.$.revealedAt"], NOW);
    if (kind === "none") {
      assert.equal(dto.status, "used");
      assert.deepEqual(set, {
        "rewardCards.$.status": "used",
        "rewardCards.$.revealedAt": NOW,
        "rewardCards.$.keepUntil": NOW,
        "rewardCards.$.usedAt": NOW,
      });
      assert.equal(dto.usedAt, NOW.getTime());
      assert.equal(dto.revealedAt, NOW.getTime());
    } else {
      const validUntil = deadlineFrom(NOW.getTime(), 14);
      assert.equal(dto.status, "revealed");
      assert.equal(dto.state, "revealed");
      assert.equal(dto.validUntil, validUntil.getTime());
      assert.deepEqual(set["rewardCards.$.validUntil"], validUntil);
      assert.deepEqual(set["rewardCards.$.keepUntil"], validUntil);
      assert.equal("rewardCards.$.usedAt" in set, false);
      assert.equal("rewardCards.$.pointsSpent" in set, kind === "points");
      if (kind === "points") {
        assert.equal(set["rewardCards.$.pointsSpent"], 0);
        assert.equal(dto.outcome.pointsLeft, 50);
      }
    }
    assert.equal(dto.outcome.kind, kind);
  });
}

test("scratchFilter / scratchUpdate: exact shapes; the expiry term is $gte at the very instant", () => {
  assert.deepEqual(scratchFilter(CID, ID, NOW), {
    _id: CID,
    rewardCards: { $elemMatch: { id: ID, status: "ready", scratchBy: { $gte: NOW } } },
  });
  const f = scratchFilter(CID, ID, NOW) as { rewardCards: { $elemMatch: { scratchBy: { $gte: Date } } } };
  assert.equal(f.rewardCards.$elemMatch.scratchBy.$gte, NOW, "the same instant the JS expiry check used");
  assert.deepEqual(scratchUpdate({ status: "revealed", revealedAt: NOW, keepUntil: FUTURE, validUntil: FUTURE, pointsSpent: 0 }), {
    $set: {
      "rewardCards.$.status": "revealed",
      "rewardCards.$.revealedAt": NOW,
      "rewardCards.$.keepUntil": FUTURE,
      "rewardCards.$.validUntil": FUTURE,
      "rewardCards.$.pointsSpent": 0,
    },
  });
});

test("scratch at EXACTLY scratchBy still succeeds; one millisecond later is refused with no write", async () => {
  const atEdge = fake({ [CID]: [card("bill-flat", { scratchBy: NOW })] });
  assert.equal((await scratchRewardCard(ON, CID, ID, atEdge.deps)).ok, true);
  assert.equal(atEdge.calls.reveal.length, 1);
  const late = fake({ [CID]: [card("bill-flat", { scratchBy: new Date(NOW.getTime() - 1) })] });
  assert.deepEqual(await scratchRewardCard(ON, CID, ID, late.deps), { ok: false, reason: "refused" });
  assert.deepEqual(late.calls.reveal, []);
});

test("replay: an already revealed / used card returns its stored outcome and writes nothing", async () => {
  const stored = card("bill-percent", { status: "revealed", revealedAt: PAST, validUntil: FUTURE });
  const f = fake({ [CID]: [stored] });
  const first = await scratchRewardCard(ON, CID, ID, f.deps);
  const again = await scratchRewardCard(ON, CID, ID, f.deps);
  assert.deepEqual(first, again);
  assert.equal(first.ok && (first.card as DinerRevealedCardDto).revealedAt, PAST.getTime(), "the ORIGINAL revealedAt, not now");
  assert.deepEqual(f.calls.reveal, []);
  const used = fake({ [CID]: [card("none", { status: "used", revealedAt: PAST, usedAt: PAST })] });
  const res = await scratchRewardCard(ON, CID, ID, used.deps);
  assert.equal(res.ok && res.card.status, "used");
  assert.deepEqual(used.calls.reveal, []);
});

test("expired, unknown id and another diner's card are ONE identical refusal (no oracle), none of them writes", async () => {
  const expired = fake({ [CID]: [card("bill-flat", { scratchBy: PAST })] });
  const unknown = fake({ [CID]: [card("bill-flat")] });
  const theirs = fake({ [CID]: [], other: [card("bill-flat")] });
  const gone = fake({});
  const results = [
    await scratchRewardCard(ON, CID, ID, expired.deps),
    await scratchRewardCard(ON, CID, OTHER_ID, unknown.deps),
    await scratchRewardCard(ON, CID, ID, theirs.deps),
    await scratchRewardCard(ON, CID, ID, gone.deps),
  ];
  for (const r of results) assert.deepEqual(r, { ok: false, reason: "refused" });
  for (const f of [expired, unknown, theirs, gone]) assert.deepEqual(f.calls.reveal, []);
  assert.deepEqual(theirs.calls.read, [CID], "the read is keyed on the SESSION customer's id only");
});

test("malformed ids, a paused cafe (env / GSTIN 33 / switched off / no blob) answer with ZERO port calls", async () => {
  for (const bad of ["", "xyz", "0123456789AB", "0123456789abc", "0123456789a", "../../etc", "0123456789a;"]) {
    const f = fake({ [CID]: [card("bill-flat")] });
    assert.deepEqual(await scratchRewardCard(ON, CID, bad, f.deps), { ok: false, reason: "refused" }, JSON.stringify(bad));
    untouched(f);
  }
  const paused: [string, ISettings | null, NodeJS.ProcessEnv][] = [
    ["env flag", ON, envOf({ [SCRATCH_BLOCK_ENV_VAR]: "true" })],
    ["GSTIN 33", settingsOf({ ...ON, gstNumber: "33ABCDE1234F1Z5" }), envOf({})],
    ["switched off", settingsOf({ dinerAccountsEnabled: true, rewardLevels: { ...BLOB, enabled: false } }), envOf({})],
    ["no blob", settingsOf({ dinerAccountsEnabled: true }), envOf({})],
    ["accounts off", settingsOf({ rewardLevels: BLOB }), envOf({})],
    ["null settings", null, envOf({})],
  ];
  for (const [why, settings, env] of paused) {
    const f = fake({ [CID]: [card("bill-flat")] }, () => 1, env);
    assert.deepEqual(await scratchRewardCard(settings, CID, ID, f.deps), { ok: false, reason: "paused" }, why);
    untouched(f);
  }
});

test("CAS miss then a concurrent reveal: the re-read returns the ONE stored outcome, and we write once", async () => {
  const wallet = [card("bill-percent")];
  const winner = card("bill-percent", { status: "revealed", revealedAt: PAST, validUntil: FUTURE });
  const f = fake({ [CID]: wallet }, () => {
    wallet[0] = winner; // the twin's write lands between our read and our CAS
    return 0;
  });
  const res = await scratchRewardCard(ON, CID, ID, f.deps);
  assert.equal(res.ok && (res.card as DinerRevealedCardDto).revealedAt, PAST.getTime());
  assert.equal(f.calls.reveal.length, 1, "no second write after the winner's");
  assert.equal(f.calls.read.length, 2);
});

test("CAS miss then the card is gone: refused (not busy)", async () => {
  const wallet = [card("bill-percent")];
  const f = fake({ [CID]: wallet }, () => {
    wallet.length = 0;
    return 0;
  });
  assert.deepEqual(await scratchRewardCard(ON, CID, ID, f.deps), { ok: false, reason: "refused" });
  assert.equal(f.calls.reveal.length, 1);
});

test("CAS miss then it expired between the attempts: refused", async () => {
  const wallet = [card("bill-percent")];
  const f = fake({ [CID]: wallet }, () => {
    wallet[0] = card("bill-percent", { scratchBy: PAST });
    return 0;
  });
  assert.deepEqual(await scratchRewardCard(ON, CID, ID, f.deps), { ok: false, reason: "refused" });
});

test("a card that stays ready but misses every CAS is BUSY after exactly SCRATCH_CAS_ATTEMPTS tries", async () => {
  assert.equal(SCRATCH_CAS_ATTEMPTS, 2);
  const f = fake({ [CID]: [card("bill-percent")] }, () => 0);
  assert.deepEqual(await scratchRewardCard(ON, CID, ID, f.deps), { ok: false, reason: "busy" });
  assert.equal(f.calls.reveal.length, SCRATCH_CAS_ATTEMPTS);
  assert.equal(f.calls.read.length, SCRATCH_CAS_ATTEMPTS);
});

test("ONE clock reading feeds every attempt (both writes carry the same instant)", async () => {
  const f = fake({ [CID]: [card("bill-percent")] }, () => 0);
  await scratchRewardCard(ON, CID, ID, f.deps);
  assert.equal(f.calls.now, 1);
  assert.deepEqual(f.calls.reveal[0], f.calls.reveal[1]);
});

test("a thrown port error PROPAGATES (the route answers a fixed 500)", async () => {
  const f = fake({ [CID]: [card("bill-percent")] });
  const deps: RewardScratchDeps = { ...f.deps, revealCard: async () => { throw new Error("db down"); } };
  await assert.rejects(scratchRewardCard(ON, CID, ID, deps), /db down/);
});

test("SOURCE PIN: the real read filters on the customer id and asks for +rewardCards; the guard is status ready + $gte", () => {
  const src = stripComments(readFileSync(path.join(process.cwd(), "lib", "reward-card-scratch.ts"), "utf8"));
  assert.ok(src.includes("Customer.findById(customerId)"), "the read is keyed on the session customer");
  assert.ok(src.includes('.select("cardSteps +rewardCards")'), "the exact projection: id + cardSteps + cards, never the whole customer row");
  assert.equal(src.includes('.select("+rewardCards")'), false, "a bare +rewardCards keeps every default field");
  assert.ok(src.includes('status: "ready"'), "landmark: the guard names the ready status");
  assert.ok(src.includes("$gte: now"), "the expiry term is $gte at the instant");
  assert.equal(src.includes("$gt: now"), false, "never the strict form");
});
