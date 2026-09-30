/**
 * Menu B2 live leg, cases (2), (6) and (9) — the refusal table. Split out of
 * verify-menu-orders-live.ts (300-line ceiling); that script owns the scratch
 * DB, the auth stub and the route handles, and passes the helpers in via
 * LegCtx. Every scenario runs on create AND on an add-round.
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { Order } from "@/models/Order";
import { Product } from "@/models/Product";
import { menuRefusalMessage, orderLinesRefusal, type MenuIssueReason, type MenuLineIssue } from "@/lib/order-availability";
import { checkItemRemovedModifiers, checkItemVariations, VARIATION_UNKNOWN_ERROR } from "@/lib/variations";
import type { Item, Line, LegCtx, Reply } from "./verify-menu-orders-live-race";

// Expected copy is built from the frozen rule with a HAND-WRITTEN issue, so a
// wrong verdict from the route cannot also produce the expected string.
export const issue = (reason: MenuIssueReason, label: string): MenuLineIssue => ({ index: 0, reason, label });
export const msg = (...issues: MenuLineIssue[]) => menuRefusalMessage(issues);

const CLOSED_TAB = { status: "Completed", payment: "Cash" };
const sized = [{ name: "Large", price: 150 }, { name: "Small", price: 90 }];

interface Built { lines: Line[]; expected: string; fix(): Promise<Line[]> }
interface Scenario { name: string; literal?: string; build(ctx: LegCtx): Promise<Built> }
const SCENARIOS: Scenario[] = [
  { name: "out of stock", literal: "Out of stock now: Tea. Remove them and try again.", async build({ mk, ln, setProduct }) {
    const t = await mk("Tea"); await setProduct(t, { available: false });
    return { lines: [ln(t)], expected: msg(issue("out", "Tea")), fix: async () => (await setProduct(t, { available: true }), [ln(t)]) };
  } },
  { name: "archived", literal: "No longer on the menu: Tea. Remove them and try again.", async build({ mk, ln, setProduct }) {
    const t = await mk("Tea"); await setProduct(t, { isActive: false });
    return { lines: [ln(t)], expected: msg(issue("gone", "Tea")), fix: async () => (await setProduct(t, { isActive: true }), [ln(t)]) };
  } },
  { name: "missing product id", literal: "No longer on the menu: Ghost. Remove them and try again.", async build({ ln, categoryId }) {
    const ghost: Item = { id: String(new mongoose.Types.ObjectId()), name: "Ghost", price: 100 };
    return { lines: [ln(ghost)], expected: msg(issue("gone", "Ghost")), fix: async () => (await Product.create({ _id: ghost.id, name: "Ghost", categoryId, price: 100 }), [ln(ghost)]) };
  } },
  { name: "base price drift", literal: "Price changed: Tea. Update them and try again.", async build({ mk, ln, setProduct }) {
    const t = await mk("Tea"); await setProduct(t, { price: 120 });
    return { lines: [ln(t)], expected: msg(issue("price", "Tea")), fix: async () => [ln(t, 1, { price: 120 })] };
  } },
  { name: "discount-only drift", async build({ mk, ln, setProduct }) {
    const t = await mk("Tea"); await setProduct(t, { discount: 10 });
    return { lines: [ln(t)], expected: msg(issue("price", "Tea")), fix: async () => [ln(t, 1, { price: 90 })] };
  } },
  { name: "size-price drift", async build({ mk, ln, setProduct }) {
    const l = await mk("Latte", 100, { variations: sized });
    const line = ln(l, 1, { variation: "Large", price: 150 });
    await setProduct(l, { variations: [{ name: "Large", price: 170 }, sized[1]] });
    return { lines: [line], expected: msg(issue("price", "Latte (Large)")), fix: async () => [{ ...line, price: 170 }] };
  } },
  { name: "fractional price", async build({ mk, ln }) {
    const t = await mk("Tea");
    return { lines: [ln(t, 1, { price: 99.5 })], expected: msg(issue("price", "Tea")), fix: async () => [ln(t)] };
  } },
  { name: "renamed line (Tea's id + price, name Chicken Biryani)", literal: "Renamed on the menu: Chicken Biryani. Update them and try again.", async build({ mk, ln }) {
    const t = await mk("Tea");
    return { lines: [ln(t, 1, { name: "Chicken Biryani" })], expected: msg(issue("renamed", "Chicken Biryani")), fix: async () => [ln(t)] };
  } },
  { name: "product renamed since the line was built", literal: "Renamed on the menu: Tea. Update them and try again.", async build({ mk, ln, setProduct }) {
    const t = await mk("Tea"); await setProduct(t, { name: "Tea Special" });
    return { lines: [ln(t)], expected: msg(issue("renamed", "Tea")), fix: async () => [ln(t, 1, { name: "Tea Special" })] };
  } },
  { name: "two reasons at once", literal: "Out of stock now: Tea. Price changed: Cake. Remove or update them and try again.", async build({ mk, ln, setProduct }) {
    const t = await mk("Tea"); const c = await mk("Cake"); await setProduct(t, { available: false }); await setProduct(c, { price: 130 });
    return { lines: [ln(t), ln(c)], expected: msg(issue("out", "Tea"), issue("price", "Cake")), fix: async () => (await setProduct(t, { available: true }), [ln(t), ln(c, 1, { price: 130 })]) };
  } },
];

// ── case (9) witness: recorded at refusal time, judged last ──
const witnessed: { name: string; variations: string | null; removals: string | null }[] = [];
async function fixtureWitness(ctx: LegCtx, name: string, b: Built): Promise<void> {
  const rows = await Product.find({ _id: { $in: b.lines.map((l) => l.productId) } }).lean();
  ctx.check(`${name}: the frozen rule agrees this fixture is refusable (fixture sanity, not the route)`, orderLinesRefusal(rows, b.lines) === b.expected);
  const src = rows.map((p) => ({ _id: String(p._id), name: p.name, variations: p.variations, modifiers: p.modifiers, modifiersPreselected: p.modifiersPreselected }));
  witnessed.push({ name, variations: checkItemVariations(src, b.lines), removals: checkItemRemovedModifiers(src, b.lines) });
}

async function refuseOnCreate(ctx: LegCtx, s: Scenario): Promise<void> {
  const b = await s.build(ctx);
  if (s.literal) ctx.check(`${s.name}: the copy is pinned literally: "${s.literal}"`, b.expected === s.literal);
  await fixtureWitness(ctx, `create/${s.name}`, b);
  const key = randomUUID();
  const before = await ctx.snap(key);
  const res = await ctx.create(b.lines, { idemKey: key });
  ctx.check(`create/${s.name}: 409 with the exact copy`, res.status === 409 && res.body.error === b.expected);
  ctx.check(`create/${s.name}: nothing written (Order count, idemKey count, order/kot/bill counters unchanged)`, ctx.same(await ctx.snap(key), before));
  const control = await ctx.create(await b.fix(), { idemKey: randomUUID() });
  ctx.check(`create/${s.name}: CONTROL after the fix, new key → 201`, control.status === 201);
}

async function refuseOnRound(ctx: LegCtx, s: Scenario): Promise<void> {
  const b = await s.build(ctx);
  await fixtureWitness(ctx, `round/${s.name}`, b);
  const id = await ctx.openTab();
  const [tab, c0] = [await ctx.tabSnap(id), await ctx.counters()];
  const res = await ctx.round(id, b.lines, randomUUID());
  ctx.check(`round/${s.name}: 409 with the exact copy`, res.status === 409 && res.body.error === b.expected);
  ctx.check(`round/${s.name}: tab items, kotRounds, kotNumbers, kotIdemKeys, total, updatedAt and the counters are deep-equal`, ctx.same(await ctx.tabSnap(id), tab) && ctx.same(await ctx.counters(), c0));
  const control = await ctx.round(id, await b.fix(), randomUUID());
  ctx.check(`round/${s.name}: CONTROL after the fix, new key → 200, round 2`, control.status === 200 && control.body.data?.kotRounds === 2);
}

/** Case (2): every scenario on create, plus the same refusal as an admin. */
export async function createRefusals(ctx: LegCtx): Promise<void> {
  for (const s of SCENARIOS) await refuseOnCreate(ctx, s);
  const b = await SCENARIOS[0]!.build(ctx);
  ctx.setRole("admin");
  let asAdmin: Reply;
  try {
    asAdmin = await ctx.create(b.lines, { idemKey: randomUUID() });
  } finally {
    ctx.setRole("staff"); // a throw must never leave later cases running as admin
  }
  ctx.check("the same out-of-stock refusal applies to an admin session", asAdmin.status === 409 && asAdmin.body.error === b.expected);
  await payNowRefusal(ctx);
}

/** Pay Now: the body use-pos-tab confirmPayment sends (status Completed, payment Cash, paidAmount omitted = paid in full). */
async function payNowRefusal(ctx: LegCtx): Promise<void> {
  const b = await SCENARIOS[0]!.build(ctx);
  const sale = { status: "Completed", payment: "Cash" };
  const key = randomUUID();
  const before = await ctx.snap(key);
  const res = await ctx.create(b.lines, { ...sale, idemKey: key });
  ctx.check("Pay Now + an out-of-stock line → 409 with the exact copy", res.status === 409 && res.body.error === b.expected);
  ctx.check("Pay Now refusal: Order count, idemKey count and the order/kot/BILL counters unchanged (no bill number burned)", ctx.same(await ctx.snap(key), before));
  const control = await ctx.create(await b.fix(), { ...sale, idemKey: randomUUID() });
  const billed = (control.body.data as { billNumber?: number } | undefined)?.billNumber;
  ctx.check("Pay Now CONTROL after the fix, new key → 201 with a bill number", control.status === 201 && typeof billed === "number");
}

/** Case (6): every scenario on a round, then the rounds that must NOT be refused / keep their own message. */
export async function roundCases(ctx: LegCtx): Promise<void> {
  const { mk, ln, create, round, openTab, setProduct } = ctx;
  for (const s of SCENARIOS) await refuseOnRound(ctx, s);
  const fired = await mk("Fired Tea");
  const fresh = await mk("Fresh Cake");
  const tab = String((await create([ln(fired)])).body.data?._id);
  await setProduct(fired, { available: false, price: 999 });
  const ok = await round(tab, [ln(fresh)], randomUUID());
  const kept = (await Order.findById(tab).lean())?.items.filter((i) => String(i.productId) === fired.id).length;
  ctx.check("a fired line whose item is now out of stock AND repriced + a new in-stock line → 200 (old lines are never re-judged)", ok.status === 200 && ok.body.data?.kotRounds === 2 && kept === 1);
  const closedTab = await openTab();
  await Order.updateOne({ _id: closedTab }, { $set: CLOSED_TAB });
  const t = await mk("Closed Tea");
  await setProduct(t, { available: false });
  const closed = await round(closedTab, [ln(t)], randomUUID());
  ctx.check('closed tab + out-of-stock line → "Can only add items to an open tab" (its own message wins)', closed.status === 409 && closed.body.error === "Can only add items to an open tab");
  // Keyless: no idemKey, so no replay re-check runs — the refusal must still stand and write nothing.
  const keylessTab = await openTab();
  const keylessLine = await mk("Keyless Tea");
  await setProduct(keylessLine, { available: false });
  const tabBefore = await ctx.tabSnap(keylessTab);
  const c0 = await ctx.counters();
  const keyless = await round(keylessTab, [ln(keylessLine)]);
  ctx.check("keyless round (no idemKey) + an out-of-stock line → 409 with the exact copy", keyless.status === 409 && keyless.body.error === msg(issue("out", "Keyless Tea")));
  ctx.check("keyless refusal: the tab and the counters are deep-equal", ctx.same(await ctx.tabSnap(keylessTab), tabBefore) && ctx.same(await ctx.counters(), c0));
  await setProduct(keylessLine, { available: true });
  const keylessOk = await round(keylessTab, [ln(keylessLine)]);
  ctx.check("keyless CONTROL after restocking → 200, round 2", keylessOk.status === 200 && keylessOk.body.data?.kotRounds === 2);
  const l = await mk("Sized Latte", 100, { variations: sized });
  await setProduct(l, { variations: [sized[1]] });
  const line = ln(l, 1, { variation: "Large", price: 150 });
  const gone = await round(await openTab(), [line], randomUUID());
  const goneNew = await create([line], { idemKey: randomUUID() });
  const want = VARIATION_UNKNOWN_ERROR("Sized Latte", "Large");
  ctx.check("removed variation → the variation 400 on the round and on create (not a B2 409)", gone.status === 400 && gone.body.error === want && goneNew.status === 400 && goneNew.body.error === want);
}

/** Case (9): none of the refused payloads trips the older 400 checks. */
export async function witnessCase(ctx: LegCtx): Promise<void> {
  ctx.check(`landmark: ${witnessed.length} refused payloads were recorded (${SCENARIOS.length} scenarios x create+round)`, witnessed.length === SCENARIOS.length * 2);
  const dirty = witnessed.filter((w) => w.variations !== null || w.removals !== null);
  ctx.check("none of them trips checkItemVariations / checkItemRemovedModifiers (the refusal must come from B2)", dirty.length === 0);
  for (const w of dirty) console.log(`       older check fired for ${w.name}: ${w.variations ?? w.removals}`);
}
