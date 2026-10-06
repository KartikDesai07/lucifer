/**
 * Print customization S6 live leg for the accept bridge, a sibling of verify-order-request-live.ts (which is far past
 * the file budget and calls runTokenAcceptLegs() inside its own try/finally: it owns the scratch-prefix guard, the
 * products, the staging helper and the final dropDatabase). Drives the REAL acceptOrderRequest against a real mongod:
 * with tokens on, an accepted QR new order gets a token; an accepted add-round on it keeps the same token and draws
 * none. (console output is intentional - this is an ops CLI script, not app code.)
 */
import Module from "node:module";
import path from "node:path";
import { Counter } from "@/models/Counter";
import { Order } from "@/models/Order";
import { Table } from "@/models/Table";
import { PrintJob } from "@/models/PrintJob";
import { Settings, type ISettings } from "@/models/Settings";
import { invalidateSettingsCache } from "@/lib/settings";
import { PRINT_AGENT_HEADER, PRINT_DEVICE_ID_HEADER, PRINT_HEADER_ON } from "@pos/shared/print-agent-wire";
import { acceptOrderRequest } from "@/lib/order-request-accept";
import { cafeDateString } from "@pos/shared/utils";

export interface TokenAcceptDeps {
  check: (label: string, ok: boolean) => void;
  /** Stages a pending one-tea request for this table and mobile, exactly as the public route does; returns its id. */
  stage: (tableNo: string, mobile: string) => Promise<string>;
}

const TOKEN_START = 201;
// printConfigOf / gstConfigOfSettings read only these off the context, so a minimal object is a faithful stand-in.
// GST off with gstRate 5 = the model default a GST-off cafe really holds: the add-round below is a live pin of the
// s82 drift fix (a raw rate compare rejected every QR add-round on such a cafe).
const ctxWith = (patch: Record<string, unknown>) => ({
  actor: "Staff A",
  settings: { gstEnabled: false, gstRate: 5, gstMode: "inclusive", ...patch } as unknown as ISettings,
  createCustomer: true,
});
const seqOf = async (key: string) => ((await Counter.findById(key).lean())?.seq as number | undefined) ?? 0;
const rawToken = async (orderId: string) => (await Order.collection.findOne({ orderId }))?.tokenNumber as number | undefined;

export async function runTokenAcceptLegs({ check, stage }: TokenAcceptDeps): Promise<void> {
  console.log("\nLeg T - accepted QR orders and tokens (print customization S6)\n");
  const day = cafeDateString(new Date()).replace(/-/g, ""); // built here, not through the counter helper
  const tokenKey = `token-${day}`;
  const kotKey = `kot-${day}`;
  await Table.create({ tableNo: "T-TOK", capacity: 4, status: "Available" });
  await Table.create({ tableNo: "T-NOTOK", capacity: 4, status: "Available" });
  const tokensOn = ctxWith({ tokenEnabled: true, tokenNumberStart: TOKEN_START });

  const tokenBefore = await seqOf(tokenKey);
  const created = await acceptOrderRequest(await stage("T-TOK", "9990011001"), tokensOn);
  if ("error" in created) throw new Error(`token leg: accept failed - ${created.error}`);
  check(`a new QR order accepted with tokens on gets token ${TOKEN_START + tokenBefore}`, created.order.tokenNumber === TOKEN_START + tokenBefore);
  check("...the raw stored order holds it, and the token counter moved by exactly 1", (await rawToken(created.order.orderId)) === created.order.tokenNumber && (await seqOf(tokenKey)) === tokenBefore + 1);

  const kotBefore = await seqOf(kotKey);
  const round = await acceptOrderRequest(await stage("T-TOK", "9990011002"), tokensOn);
  if ("error" in round) throw new Error(`token leg: add-round accept failed - ${round.error}`);
  check("an accepted add-round lands on the SAME order as round 2", round.order._id.equals(created.order._id) && round.order.kotRounds === 2);
  check("...keeps the same token, in the answer and in the raw doc", round.order.tokenNumber === created.order.tokenNumber && (await rawToken(created.order.orderId)) === created.order.tokenNumber);
  check("...draws no token (counter unchanged) but does draw its kitchen ticket", (await seqOf(tokenKey)) === tokenBefore + 1 && (await seqOf(kotKey)) === kotBefore + 1);

  const off = await acceptOrderRequest(await stage("T-NOTOK", "9990011003"), ctxWith({ tokenEnabled: false }));
  if ("error" in off) throw new Error(`token leg: tokens-off accept failed - ${off.error}`);
  check("with tokens off an accepted order has no token (answer and raw doc) and the counter is unchanged", off.order.tokenNumber === undefined && (await rawToken(off.order.orderId)) === undefined && (await seqOf(tokenKey)) === tokenBefore + 1);
}

// ── S7: the accepted QR order's token SLIP, through the REAL accept route (owner R13: QR self-orders print it too) ──

const PRINT_TOKEN_START = 301;
const AGENT_DEVICE = "live-token-accept-tab";
const STAFF_ID = "665f0000000000000000beef";

/** Seeds the signed-in stub into the CJS module cache BEFORE the route (and so @/lib/api-helpers) first loads. */
function stubAuth(): void {
  const file = path.join(__dirname, "..", "lib", "auth.ts");
  const stub = new Module(file);
  stub.filename = file;
  stub.loaded = true;
  stub.exports = {
    auth: async () => ({ user: { id: STAFF_ID, name: "Live leg", role: "admin" } }),
    handlers: {},
    signIn: async () => undefined,
    signOut: async () => undefined,
  };
  require.cache[file] = stub;
}

type AcceptBody = { success: boolean; error?: string; data?: { order: { _id: string; orderId: string; tokenNumber?: number; kotRounds: number }; printJobs?: Array<{ kind: string }> } };

export async function runTokenAcceptPrintLegs({ check, stage }: TokenAcceptDeps): Promise<void> {
  console.log("\nLeg T2 - the accept route makes the token slip job (print customization S7, owner R13)\n");
  stubAuth();
  const route = await import("@/app/api/order-requests/[id]/accept/route");
  await Table.create({ tableNo: "T-TOKP", capacity: 4, status: "Available" });
  await Table.create({ tableNo: "T-TOKQ", capacity: 4, status: "Available" });
  await Table.create({ tableNo: "T-TOKR", capacity: 4, status: "Available" });
  const accept = async (id: string, agent: boolean): Promise<AcceptBody> => {
    const headers: Record<string, string> = { "content-type": "application/json", ...(agent ? { [PRINT_AGENT_HEADER]: PRINT_HEADER_ON, [PRINT_DEVICE_ID_HEADER]: AGENT_DEVICE } : {}) };
    const res = await route.POST(new Request(`http://live.test/api/order-requests/${id}/accept`, { method: "POST", headers }), { params: Promise.resolve({ id }) });
    return (await res.json()) as AcceptBody;
  };
  const kinds = (b: AcceptBody) => (b.data?.printJobs ?? []).map((j) => j.kind).join();
  const setTokens = async (patch: Record<string, unknown>) => {
    await Settings.updateOne({}, { $set: patch }, { upsert: true });
    invalidateSettingsCache();
  };

  // GST off with the model default gstRate 5 left stored: the round-2 accept below is the route-level pin of the s82 drift fix.
  await setTokens({ tokenEnabled: true, tokenNumberStart: PRINT_TOKEN_START, gstEnabled: false, gstRate: 5 });
  const first = await accept(await stage("T-TOKP", "9990022001"), true);
  const order = first.data?.order;
  check("staff accept of a NEW self-order with tokens on and the agent header: 200, a token on the order", first.success && typeof order?.tokenNumber === "number");
  check("...its printJobs are [kot, token] (QR self-orders print the slip too)", kinds(first) === "kot,token");
  const rows = await PrintJob.find({ orderId: order?._id }).sort({ createdAt: 1, _id: 1 }).lean();
  check("...stored as kot:<id>:1 then token:<id>, queued for the asking device", rows.map((r) => r.jobKey).join() === `kot:${order?._id}:1,token:${order?._id}` && rows.every((r) => r.status === "queued" && r.targetDeviceId === AGENT_DEVICE));
  const snap = rows[1] ? (JSON.parse(rows[1].payload) as { snapshot?: { tokenNumber?: number } }).snapshot : undefined;
  check("...the token job's snapshot carries the order's number", snap?.tokenNumber === order?.tokenNumber);

  const round = await accept(await stage("T-TOKP", "9990022002"), true);
  check("an accept that adds a round lands on the SAME order (round 2) and makes the KOT only", round.data?.order._id === order?._id && round.data?.order.kotRounds === 2 && kinds(round) === "kot");
  check("...the order still has exactly one token job", (await PrintJob.countDocuments({ orderId: order?._id, kind: "token" })) === 1);

  const noAgent = await accept(await stage("T-TOKQ", "9990022003"), false);
  check("without the agent header the accept makes no print jobs at all (a tab that prints its own slips)", noAgent.success && noAgent.data?.printJobs === undefined && (await PrintJob.countDocuments({ orderId: noAgent.data?.order._id })) === 0);

  await setTokens({ tokenEnabled: false });
  const off = await accept(await stage("T-TOKR", "9990022004"), true);
  check("tokens off: a new order's accept answers [kot] only, with no token and no token job", off.success && off.data?.order.tokenNumber === undefined && kinds(off) === "kot" && (await PrintJob.countDocuments({ orderId: off.data?.order._id, kind: "token" })) === 0);
}
