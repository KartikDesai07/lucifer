/**
 * Print customization S10 live legs - the GST invoice serial on the REAL modules and routes. A sibling of
 * verify-slip-numbers-live.ts (which calls runInvoiceLegs() inside its own try/finally: it owns the scratch-prefix
 * guard, the auth stub seeded BEFORE any route loads, the Product/Settings fixtures and the final dropDatabase).
 * Counters are read with the same real keys the code draws from (invoiceCounterKey); the routes run with their exact
 * validators, CAS and numbering. The legs run in this order so I3 sees a fresh counter: I1, I3, I2, I4, I5..I9.
 * (console output is intentional - this is an ops CLI script, not app code.)
 */
import mongoose from "mongoose";
import { Order } from "@/models/Order";
import { Counter, invoiceCounterKey, nextInvoiceSequence } from "@/models/Counter";
import { Settings } from "@/models/Settings";
import { getSettings, invalidateSettingsCache } from "@/lib/settings";
import { printConfigOf } from "@/lib/print";
import { billNumberingPlan, planHasWork } from "@/lib/gst-invoice";
import { BILL_NUMBERS_DEPS, issueBillNumbers } from "@/lib/slip-numbers";
import { invoiceFyLabel as fyLabel, invoiceFyOf, invoiceLabelOf } from "@pos/shared/invoice-number";

type Check = (label: string, ok: boolean) => void;
type Data = { _id: string; billNumber?: number; invoiceNumber?: number; invoiceFy?: number };
type Res = { status: number; body: { success: boolean; data?: Data; error?: string } };
type Routes = {
  create: typeof import("@/app/api/orders/route");
  settle: typeof import("@/app/api/orders/[id]/settle/route");
};

const PRODUCT = "665f000000000000000000a1"; // the main script's fixture product: Tea at PRICE
const PRICE = 120;
const GST_RATE = 5;
const PARALLEL = 10;
const SETTLERS = 5;
const FAR_FY = 2031; // an FY no other leg draws from: I1 owns invoice-3132
const FY_OF_BOUNDARY_BEFORE = 2026;
const FY_OF_BOUNDARY_AFTER = 2027;
// Instants around 1 April 2027 00:00 IST (= 31 March 18:30:00Z).
const LAST_SECOND = new Date("2027-03-31T18:29:59.000Z");
const FIRST_SECOND = new Date("2027-03-31T18:30:00.000Z");
const MINUTE_BEFORE = new Date("2027-03-31T18:29:00.000Z");
const MINUTE_AFTER = new Date("2027-03-31T18:31:00.000Z");

let routes: Routes;
const post = (url: string, body: unknown) =>
  new Request(`http://live.test${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
async function answer(res: Response): Promise<Res> {
  return { status: res.status, body: (await res.json()) as Res["body"] };
}
function create(extra: Record<string, unknown> = {}): Promise<Res> {
  const payload = { customerName: "Invoice leg", items: [{ productId: PRODUCT, name: "Tea", price: PRICE, qty: 1 }], subtotal: PRICE, total: PRICE, payment: "Unpaid", status: "Pending", receiver: "Live leg", ...extra };
  return routes.create.POST(post("/api/orders", payload)).then(answer);
}
const payNow = () => create({ payment: "Cash", status: "Completed" });
const settle = (id: string, body: Record<string, unknown> = { payment: "Cash" }) =>
  routes.settle.POST(post(`/api/orders/${id}/settle`, body), { params: Promise.resolve({ id }) }).then(answer);
async function openTab(): Promise<string> {
  const r = await create();
  if (r.status !== 201 || !r.body.data) throw new Error(`fixture tab failed: ${r.status} ${r.body.error}`);
  return String(r.body.data._id);
}
async function setSettings(patch: Record<string, unknown>): Promise<void> {
  await Settings.updateOne({}, { $set: patch });
  invalidateSettingsCache();
}
const gst = (on: boolean) => setSettings({ gstEnabled: on, gstRate: GST_RATE, gstMode: "exclusive" });
const seqOf = async (fy: number) => ((await Counter.findById(invoiceCounterKey(fy)).lean())?.seq as number | undefined) ?? 0;
const raw = (id: string) => Order.collection.findOne({ _id: new mongoose.Types.ObjectId(id) });
async function backdate(id: string, createdAt: Date): Promise<void> {
  await Order.collection.updateOne({ _id: new mongoose.Types.ObjectId(id) }, { $set: { createdAt } });
}
/** Every invoice-* counter document as "key=seq", sorted: one string that moves when ANY invoice series moves. */
async function invoiceCounters(): Promise<string> {
  const docs = await Counter.find({ _id: /^invoice-/ }).lean();
  return docs.map((d) => `${d._id}=${d.seq}`).sort().join();
}
/** The settle route's CAS, as its filter and update shape it, so a leg can then number the landed bill by hand. */
async function settleShaped(id: string) {
  const tab = await Order.findById(id).lean();
  return Order.findOneAndUpdate({ _id: id, status: "Pending", total: tab!.total }, { $set: { status: "Completed", payment: "Cash", paidAmount: tab!.total } }, { new: true, runValidators: true }).lean();
}
const planOf = async (order: NonNullable<Awaited<ReturnType<typeof settleShaped>>>) => billNumberingPlan(order, printConfigOf(await getSettings()).bill);

async function i1(check: Check): Promise<void> {
  console.log("I1 the real $inc on invoice-<yyzz> (an FY nothing else uses)");
  const key = invoiceCounterKey(FAR_FY);
  const first = await nextInvoiceSequence(FAR_FY);
  const second = await nextInvoiceSequence(FAR_FY);
  const doc = await Counter.collection.findOne({ _id: key as never });
  check("the key is invoice-3132 and two draws give 1, 2 with the counter document at 2", key === "invoice-3132" && first === 1 && second === 2 && doc?.seq === 2);
  const burst = await Promise.all(Array.from({ length: PARALLEL }, () => nextInvoiceSequence(FAR_FY)));
  check(`${PARALLEL} concurrent draws are 3..${PARALLEL + 2}, all distinct (one atomic $inc each)`, new Set(burst).size === PARALLEL && Math.min(...burst) === 3 && Math.max(...burst) === PARALLEL + 2);
  check("no slip or order counter was touched by an invoice draw", (await Counter.countDocuments({ _id: { $regex: /^invoice-/ } })) === 1);
}

async function i3(check: Check): Promise<void> {
  console.log("I3 ten concurrent Pay Now GST orders through the create route");
  await gst(true);
  const fy = invoiceFyOf(new Date());
  const before = await seqOf(fy);
  const results = await Promise.all(Array.from({ length: PARALLEL }, () => payNow()));
  const serials = results.map((r) => r.body.data?.invoiceNumber ?? -1).sort((a, b) => a - b);
  check("all 201, each answer carries its serial and the FY it was drawn in", results.every((r) => r.status === 201 && r.body.data?.invoiceFy === fy));
  check(`the counter was fresh (${before}) and the serials are exactly 1..${PARALLEL}, distinct`, before === 0 && serials.every((n, i) => n === i + 1));
  const stored = await Order.find({ invoiceFy: fy }).select("invoiceNumber billNumber").lean();
  check("the stored orders hold the same ten serials, and the counter ends at ten", stored.length === PARALLEL && (await seqOf(fy)) === PARALLEL && new Set(stored.map((o) => o.invoiceNumber)).size === PARALLEL);
  check("each also holds its daily bill number (Show bill number is on): distinct", new Set(stored.map((o) => o.billNumber)).size === PARALLEL && stored.every((o) => typeof o.billNumber === "number"));
}

async function i2(check: Check): Promise<void> {
  console.log("I2 the settle-shaped CAS, then issueBillNumbers on the real deps; then the real settle route");
  const fy = invoiceFyOf(new Date());
  const id = await openTab();
  const updated = await settleShaped(id);
  const plan = await planOf(updated!);
  check("the plan for the landed GST bill asks for BOTH numbers (invoice at createdAt, daily number)", plan.invoiceAt?.getTime() === new Date(updated!.createdAt as Date).getTime() && plan.bill !== undefined);
  const before = await seqOf(fy);
  const doc = await issueBillNumbers(id, plan);
  const stored = await Order.findById(id).lean();
  check("the returned doc AND the stored order hold the bill number and the invoice serial", doc?.billNumber === stored?.billNumber && doc?.invoiceNumber === before + 1 && stored?.invoiceNumber === before + 1 && stored?.invoiceFy === fy && typeof stored?.billNumber === "number");
  check("a re-plan from the stored bill is empty and a re-issue draws nothing", !planHasWork(await planOf(stored as never)) && (await issueBillNumbers(id, await planOf(stored as never))) === null && (await seqOf(fy)) === before + 1);

  const routeId = await openTab();
  const r = await settle(routeId);
  const routeStored = await Order.findById(routeId).lean();
  check("through the REAL settle route: 200 whose answer carries the serial, the FY and the daily number", r.status === 200 && r.body.data?.invoiceNumber === before + 2 && r.body.data?.invoiceFy === fy && typeof r.body.data?.billNumber === "number");
  check("the stored order matches, and its printed label is the FY label plus the padded serial", routeStored?.invoiceNumber === before + 2 && invoiceLabelOf(routeStored ?? {}) === `${fyLabel(fy)}/${String(before + 2).padStart(6, "0")}`);
}

async function i4(check: Check): Promise<void> {
  console.log("I4 five concurrent issuers on ONE order - exactly one serial is stored");
  const fy = invoiceFyOf(new Date());
  const id = await openTab();
  const updated = await settleShaped(id);
  const before = await seqOf(fy);
  const plan = { invoiceAt: new Date(updated!.createdAt as Date) };
  const outcomes = await Promise.allSettled(Array.from({ length: SETTLERS }, () => issueBillNumbers(id, plan)));
  const docs = outcomes.flatMap((o) => (o.status === "fulfilled" && o.value ? [o.value] : []));
  const stored = await Order.findById(id).lean();
  check("no issuer rejected, and the order holds ONE serial", outcomes.every((o) => o.status === "fulfilled") && typeof stored?.invoiceNumber === "number");
  check("every issuer's answer is the stored serial (the losers adopted it), never their own drawn number", docs.length === SETTLERS && docs.every((d) => d.invoiceNumber === stored?.invoiceNumber && d.invoiceFy === fy));
  check(`the counter moved by ${SETTLERS}: the ${SETTLERS - 1} losers burned a number (an accepted, reported gap)`, (await seqOf(fy)) - before === SETTLERS);
  check("exactly one order holds that (fy, serial) pair", (await Order.countDocuments({ invoiceFy: fy, invoiceNumber: stored?.invoiceNumber })) === 1);
}

async function i5(check: Check): Promise<void> {
  console.log("I5 the financial-year boundary: createdAt decides the series, in IST");
  const cases: Array<[string, Date, number]> = [
    ["31 Mar 23:59 IST", MINUTE_BEFORE, FY_OF_BOUNDARY_BEFORE],
    ["31 Mar 23:59:59 IST", LAST_SECOND, FY_OF_BOUNDARY_BEFORE],
    ["1 Apr 00:00:00 IST", FIRST_SECOND, FY_OF_BOUNDARY_AFTER],
    ["1 Apr 00:01 IST", MINUTE_AFTER, FY_OF_BOUNDARY_AFTER],
  ];
  const old0 = await seqOf(FY_OF_BOUNDARY_BEFORE);
  const new0 = await seqOf(FY_OF_BOUNDARY_AFTER);
  const got: number[] = [];
  for (const [, at] of cases) {
    const id = await openTab();
    await backdate(id, at);
    const r = await settle(id);
    got.push(r.status === 200 ? (r.body.data?.invoiceFy ?? -1) : -r.status);
  }
  check("the four orders land in FY 2026, 2026, 2027, 2027 (a UTC reading would split them differently)", got.join() === cases.map((c) => c[2]).join());
  check("invoice-2627 moved by 2 and invoice-2728 by 2: the two keys are separate series", (await seqOf(FY_OF_BOUNDARY_BEFORE)) - old0 === 2 && (await seqOf(FY_OF_BOUNDARY_AFTER)) - new0 === 2 && new0 === 0);
  check("the new series starts at 000001", (await Order.countDocuments({ invoiceFy: FY_OF_BOUNDARY_AFTER, invoiceNumber: 1 })) === 1);
}

async function i6(check: Check): Promise<void> {
  console.log("I6 a non-GST order draws no invoice");
  await gst(false);
  const before = await invoiceCounters();
  const paid = await payNow();
  const tab = await openTab();
  const settled = await settle(tab);
  const paidDoc = await raw(String(paid.body.data?._id));
  const tabDoc = await raw(tab);
  check("a non-GST Pay Now and a non-GST settle both succeed and the daily bill number still drew", paid.status === 201 && settled.status === 200 && typeof paid.body.data?.billNumber === "number" && typeof settled.body.data?.billNumber === "number");
  check("no invoice counter moved and neither stored order has an invoice key", (await invoiceCounters()) === before && paidDoc !== null && tabDoc !== null && !("invoiceNumber" in paidDoc) && !("invoiceFy" in paidDoc) && !("invoiceNumber" in tabDoc) && !("invoiceFy" in tabDoc));
}

async function i7(check: Check): Promise<void> {
  console.log("I7 the order's own GST snapshot decides, not the live settings");
  const fy = invoiceFyOf(new Date());
  await gst(true);
  const snapshotGst = await openTab();
  await gst(false);
  const a = await settle(snapshotGst);
  check("created with GST on, settled with GST OFF in Settings: it still gets its invoice", a.status === 200 && typeof a.body.data?.invoiceNumber === "number" && a.body.data?.invoiceFy === fy);
  const snapshotPlain = await openTab();
  await gst(true);
  const before = await invoiceCounters();
  const b = await settle(snapshotPlain);
  check("created with GST off, settled with GST ON in Settings: no invoice, no counter moved", b.status === 200 && b.body.data?.invoiceNumber === undefined && (await invoiceCounters()) === before);
  await setSettings({ billShowNumber: false });
  const noDaily = await openTab();
  const c = await settle(noDaily);
  check("with Show bill number OFF a GST bill still takes its invoice and takes no daily number", c.status === 200 && typeof c.body.data?.invoiceNumber === "number" && c.body.data?.billNumber === undefined);
  await setSettings({ billShowNumber: true });
}

async function i8(check: Check): Promise<void> {
  console.log("I8 the Order validators refuse a bad serial on the real write");
  const id = await openTab();
  await settleShaped(id);
  const fy = invoiceFyOf(new Date());
  const refused = async (run: () => Promise<unknown>) => {
    try {
      await run();
      return false;
    } catch (error) {
      return error instanceof mongoose.Error.ValidationError;
    }
  };
  const set = (n: number, year = fy) => BILL_NUMBERS_DEPS.setInvoiceIfAbsent(id, year, n);
  check("invoiceNumber 0, 1.5, -1 and one past the 16-character limit each reject with a ValidationError", (await refused(() => set(0))) && (await refused(() => set(1.5))) && (await refused(() => set(-1))) && (await refused(() => set(100000000000))));
  check("invoiceFy 999 and 2026.5 reject too, and a bare update with validators on rejects 0", (await refused(() => set(1, 999))) && (await refused(() => set(1, 2026.5))) && (await refused(() => Order.updateOne({ _id: id }, { $set: { invoiceNumber: 0 } }, { runValidators: true }))));
  const untouched = await raw(id);
  check("nothing was stored by any of the refused writes", untouched !== null && !("invoiceNumber" in untouched) && !("invoiceFy" in untouched));
  const ok = await set(1);
  check("landmark: serial 1 in a valid FY IS accepted by the same call", ok?.invoiceNumber === 1 && ok?.invoiceFy === fy);
}

async function i9(check: Check): Promise<void> {
  console.log("I9 a CAS loser or a refused settle draws nothing");
  await gst(true);
  const fy = invoiceFyOf(new Date());
  const id = await openTab();
  const tab = await Order.findById(id).lean();
  const before = await seqOf(fy);
  const results = await Promise.all(Array.from({ length: SETTLERS }, () => settle(id, { payment: "Cash", expectedTotal: tab!.total })));
  const winners = results.filter((r) => r.status === 200);
  const stored = await Order.findById(id).lean();
  check(`${SETTLERS} overlapping settles: one 200 and ${SETTLERS - 1} x 409`, winners.length === 1 && results.filter((r) => r.status === 409).length === SETTLERS - 1);
  check("the invoice counter moved by exactly 1, and the winner's answer is the stored serial (no burn from a loser)", (await seqOf(fy)) - before === 1 && winners[0]?.body.data?.invoiceNumber === stored?.invoiceNumber && typeof stored?.invoiceNumber === "number");

  const open = await openTab();
  const mid = await invoiceCounters();
  const stale = await settle(open, { payment: "Cash", expectedTotal: tab!.total + 1 });
  const due = await settle(open, { payment: "Due", expectedTotal: tab!.total });
  const gone = await openTab();
  await Order.updateOne({ _id: gone }, { $set: { status: "Cancelled" } });
  const cancelled = await settle(gone);
  const again = await settle(id);
  check("stale echo 409, Due-without-customer 400, a cancelled tab 409 and a re-settle 409: the counter is unchanged", stale.status === 409 && due.status === 400 && cancelled.status === 409 && again.status === 409 && (await invoiceCounters()) === mid);
}

export async function runInvoiceLegs(check: Check): Promise<void> {
  routes = {
    create: await import("@/app/api/orders/route"),
    settle: await import("@/app/api/orders/[id]/settle/route"),
  };
  await Counter.createCollection().catch(() => undefined);
  await i1(check);
  await i3(check);
  await i2(check);
  await i4(check);
  await i5(check);
  await i6(check);
  await i7(check);
  await i8(check);
  await i9(check);
  await gst(false);
}
