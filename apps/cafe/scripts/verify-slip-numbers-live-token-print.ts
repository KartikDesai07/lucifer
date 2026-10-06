/**
 * Print customization S7 live legs - the token slip THROUGH THE REAL ROUTES. A sibling of
 * verify-slip-numbers-live.ts (which calls runTokenPrintLegs() inside its own try/finally: it owns the
 * scratch-prefix guard, the auth stub seeded BEFORE any route loads, the Product/Settings fixtures and the
 * final dropDatabase). Requests carry the agent (+ bill) headers exactly as a POS tab's agent sends them, so
 * the routes make their print jobs and the answers' `printJobs` are what the tab would act on.
 * (console output is intentional - this is an ops CLI script, not app code.)
 */
import { Order } from "@/models/Order";
import { PrintJob } from "@/models/PrintJob";
import { Counter } from "@/models/Counter";
import { Settings } from "@/models/Settings";
import { invalidateSettingsCache } from "@/lib/settings";
import { slipDayKey } from "@pos/shared/slip-day";
import {
  PRINT_AGENT_HEADER,
  PRINT_BILL_HEADER,
  PRINT_DEVICE_ID_HEADER,
  PRINT_HEADER_ON,
} from "@pos/shared/print-agent-wire";

type Check = (label: string, ok: boolean) => void;
type PrintRef = { id: string; kind: string; status: string };
type Body = { success: boolean; data?: { _id: string; tokenNumber?: number; printJobs?: PrintRef[] }; error?: string };
type Res = { status: number; body: Body };
type Routes = {
  create: typeof import("@/app/api/orders/route");
  settle: typeof import("@/app/api/orders/[id]/settle/route");
  items: typeof import("@/app/api/orders/[id]/items/route");
};

const PRODUCT = "665f000000000000000000a1"; // the main script's fixture product: Tea at PRICE
const PRICE = 120;
const TOKEN_START = 501;
const DEVICE = "live-token-pos-tab";

let routes: Routes;

function post(url: string, body: unknown, bill: boolean): Request {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    [PRINT_AGENT_HEADER]: PRINT_HEADER_ON,
    [PRINT_DEVICE_ID_HEADER]: DEVICE,
    ...(bill ? { [PRINT_BILL_HEADER]: PRINT_HEADER_ON } : {}),
  };
  return new Request(`http://live.test${url}`, { method: "POST", headers, body: JSON.stringify(body) });
}
async function answer(res: Response): Promise<Res> {
  return { status: res.status, body: (await res.json()) as Body };
}
function create(extra: Record<string, unknown>, bill: boolean): Promise<Res> {
  const payload = { customerName: "Token print leg", items: [{ productId: PRODUCT, name: "Tea", price: PRICE, qty: 1 }], subtotal: PRICE, total: PRICE, payment: "Unpaid", status: "Pending", receiver: "Live leg", ...extra };
  return routes.create.POST(post("/api/orders", payload, bill)).then(answer);
}
const payNow = () => create({ payment: "Cash", status: "Completed" }, true);
const addRound = (id: string) =>
  routes.items.POST(post(`/api/orders/${id}/items`, { items: [{ productId: PRODUCT, name: "Tea", price: PRICE, qty: 1 }] }, false), { params: Promise.resolve({ id }) }).then(answer);
const settle = (id: string) =>
  routes.settle.POST(post(`/api/orders/${id}/settle`, { payment: "Cash" }, true), { params: Promise.resolve({ id }) }).then(answer);

const kindsOf = (r: Res): string => (r.body.data?.printJobs ?? []).map((j) => j.kind).join();
const idOf = (r: Res): string => String(r.body.data?._id);
const jobsOf = (orderId: string) => PrintJob.find({ orderId }).sort({ createdAt: 1, _id: 1 }).lean();

async function setSettings(patch: Record<string, unknown>): Promise<void> {
  await Settings.updateOne({}, { $set: patch });
  invalidateSettingsCache();
}

async function p1(check: Check): Promise<void> {
  console.log("P1 tokens on, Pay Now with the agent + bill headers - kot, token, bill");
  await setSettings({ tokenEnabled: true, tokenNumberStart: TOKEN_START });
  // Today's counter already moved in the S6 legs above: the next token is the start plus what was drawn so far.
  const drawn = ((await Counter.findById(`token-${slipDayKey(new Date())}`).lean())?.seq as number | undefined) ?? 0;
  const want = TOKEN_START + drawn;
  const r = await payNow();
  const id = idOf(r);
  check(`201, the order holds the next token (${want})`, r.status === 201 && r.body.data?.tokenNumber === want);
  check("the answer's printJobs are [kot, token, bill], in that order", kindsOf(r) === "kot,token,bill");
  const rows = await jobsOf(id);
  check("the stored jobs are keyed kot:<id>:1, token:<id>, bill:<id> in createdAt order, all queued for the asking device", rows.map((j) => j.jobKey).join() === `kot:${id}:1,token:${id},bill:${id}` && rows.every((j) => j.status === "queued" && j.targetDeviceId === DEVICE));
  const token = rows[1];
  const snapshot = token ? (JSON.parse(token.payload) as { snapshot?: { tokenNumber?: number } }).snapshot : undefined;
  check("the token job's snapshot carries the order's number", snapshot?.tokenNumber === want);
}

async function p2(check: Check): Promise<void> {
  console.log("P2 tokens on, a held tab - kot, token now; its add-round, settle and bill print no second token");
  const held = await create({}, false);
  const id = idOf(held);
  check("201 and the held tab's printJobs are [kot, token]", held.status === 201 && kindsOf(held) === "kot,token");
  const round = await addRound(id);
  check("its add-round answers 200 with a KOT only", round.status === 200 && kindsOf(round) === "kot");
  const settled = await settle(id);
  check("settling it prints the bill only", settled.status === 200 && kindsOf(settled) === "bill");
  const rows = await jobsOf(id);
  check("the order ends with exactly one token job: kot:1, token, kot:2, bill", rows.filter((j) => j.kind === "token").length === 1 && rows.map((j) => j.kind).join() === "kot,token,kot,bill");
}

async function p3(check: Check): Promise<void> {
  console.log("P3 tokens off - Pay Now makes kot and bill, never a token job");
  await setSettings({ tokenEnabled: false });
  const before = await PrintJob.countDocuments({ kind: "token" });
  const r = await payNow();
  const id = idOf(r);
  check("201 with no tokenNumber, and the answer's printJobs are [kot, bill]", r.status === 201 && r.body.data?.tokenNumber === undefined && kindsOf(r) === "kot,bill");
  check("landmark: the order's two jobs exist", (await PrintJob.countDocuments({ orderId: id })) === 2);
  check("countDocuments({kind:'token'}) for this order is 0, and no token job was made anywhere since", (await PrintJob.countDocuments({ kind: "token", orderId: id })) === 0 && (await PrintJob.countDocuments({ kind: "token" })) === before);
  const raw = await Order.collection.countDocuments({ _id: (await Order.findById(id).select("_id").lean())?._id, tokenNumber: { $exists: true } });
  check("the raw stored order carries no tokenNumber", raw === 0);
}

export async function runTokenPrintLegs(check: Check): Promise<void> {
  routes = {
    create: await import("@/app/api/orders/route"),
    settle: await import("@/app/api/orders/[id]/settle/route"),
    items: await import("@/app/api/orders/[id]/items/route"),
  };
  await PrintJob.createIndexes();
  await p1(check);
  await p2(check);
  await p3(check);
}
