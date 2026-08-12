/**
 * F2 §5 sweep — Steps D–E: targeted point reads + today-report single-ledger
 * routing (box 4), and recomputeCustomer authority parity + heal (box 6,
 * second half). Ops CLI harness — console output intentional.
 */
import { ObjectId } from "mongodb";

import { disconnectAll } from "@/lib/cluster-registry";
import { __resetRouterForTests } from "@/lib/cluster-router";
import { readOrderById, readOrdersInDayRange } from "@/lib/order-read";
import { recomputeCustomer } from "@/lib/customer-rollup";
import { itestDb, type Ctx } from "./util";
import { EXPECT_A } from "./steps-core";

export async function stepTargetedReads(ctx: Ctx): Promise<void> {
  const { report: r, uris } = ctx;
  r.step("D. targeted GET + today-report routing (box 4)");

  // Cold start: close every pool + drop the router's cached manifest, so the
  // opener tap shows exactly which clusters the READ path dials.
  await disconnectAll();
  __resetRouterForTests();
  const before = ctx.opens.length;

  const got = await readOrderById(ctx.orderIdsA[0]);
  const dialed = ctx.opens.slice(before).map((o) => o.uri);
  // Log db names only — URIs carry credentials (the F2.8/F2.9 redaction rule).
  const dbOf = (u: string): string => u.split("/").pop()?.split("?")[0] ?? "?";
  r.check("point read finds the order (stored shape)", got?._id === ctx.orderIdsA[0]);
  r.check(
    "point read dialed ONE ledger (tag-parsed) + CORE for the manifest — nothing else",
    dialed.includes(uris.la) &&
      dialed.every((u) => u === uris.la || u === uris.core) &&
      !dialed.includes(uris.lb),
    dialed.map(dbOf).join(", "),
  );

  const afterPoint = ctx.opens.length;
  const unknownTag = await readOrderById("ORD-Z9-20260101-001");
  const malformed = await readOrderById("not-an-order-id");
  r.check(
    "unroutable ids (unknown tag / malformed) → null with ZERO new dials",
    unknownTag === null && malformed === null && ctx.opens.length === afterPoint,
  );

  const ranged = await readOrdersInDayRange(ctx.today, ctx.today);
  r.check(
    "today range resolves DIRECT on the single active ledger (1 leg, tag A)",
    ranged.kind === "direct" && ranged.ledgers.length === 1 && ranged.ledgers[0].tag === "A",
  );
  if (ranged.kind === "direct") {
    const sortedDesc = ranged.orders.every(
      (o, i, a) => i === 0 || a[i - 1]._id > o._id,
    );
    r.check(
      "whole-day list: all 11 orders, newest-first (_id desc)",
      ranged.orders.length === 11 && sortedDesc,
    );
  }
  r.check(
    "standby was NEVER dialed by any read path",
    !ctx.opens.some((o) => o.uri === uris.lb),
  );
}

export async function stepRecomputeParity(ctx: Ctx): Promise<void> {
  const { report: r, raw } = ctx;
  r.step("E. recomputeCustomer = the fan-out authority (box 6, second half)");

  const customers = itestDb(raw, ctx.dbs.core).collection(ctx.colls.customers);
  const custFilter = { _id: new ObjectId(ctx.customerId) as never };

  const rc = await recomputeCustomer(ctx.customerId);
  r.check(
    "recompute reproduces the incremental sums EXACTLY (fan-out parity)",
    rc.applied &&
      rc.totals.visits === EXPECT_A.visits &&
      rc.totals.spendPaise === EXPECT_A.spendPaise &&
      rc.totals.duePaise === EXPECT_A.duePaise,
    JSON.stringify(rc),
  );
  const after = await customers.findOne(custFilter);
  r.check(
    "CORE doc unchanged by recompute (already converged)",
    after?.visits === EXPECT_A.visits &&
      after?.totalSpend === EXPECT_A.spendPaise / 100 &&
      after?.totalDue === EXPECT_A.duePaise / 100,
  );

  // Corrupt the projection, then prove the authority heals it from raw orders.
  await customers.updateOne(custFilter, {
    $set: { visits: 999, totalSpend: 42, totalDue: 0 },
  });
  const heal = await recomputeCustomer(ctx.customerId);
  const healed = await customers.findOne(custFilter);
  r.check(
    "recompute HEALS a corrupted CORE projection from the ledger source of truth",
    heal.applied &&
      healed?.visits === EXPECT_A.visits &&
      healed?.totalSpend === EXPECT_A.spendPaise / 100 &&
      healed?.totalDue === EXPECT_A.duePaise / 100,
  );
  r.check(
    "appliedOrders markers left untouched by the authority",
    ((healed?.appliedOrders ?? []) as string[]).length === 4,
  );
}
