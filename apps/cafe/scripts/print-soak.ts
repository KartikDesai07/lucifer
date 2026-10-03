/**
 * Phase 1 Session 1E (spec §14, plan Task E1 scenario 5; spec §17.3 item 5): the print soak. It drives the
 * REAL HTTP API of a running local POS (`next start`) the way an ordering device does — orders, a second
 * KOT round on every other order, and Pay Now bills, all with the agent headers — then proves nothing was
 * lost silently: every slip it caused ends printed, or visibly needs-confirm / failed, and the fake
 * printer's jobs.log matches. A local test tool: it refuses any database but pos_scratch_* and any POS
 * but localhost.
 *
 *   node --env-file=<env> --import tsx scripts/print-soak.ts --out <the fake printer's --out folder>
 *        [--orders 200] [--base http://localhost:3100] [--every-ms 1500] [--drain-s 300]
 *        [--agent 127.0.0.1:9100] [--device soak-device]
 *
 * --agent HOST:PORT  no host: the soak is its own device's print agent. It leases, writes each job to the
 *                    fake printer over TCP and asks DLE EOT 1 at the end, so a connection the printer cut
 *                    mid-slip is seen ("maybe"): a lane that can see the drop, which Android's TCP lane
 *                    cannot (gate finding G5). Start the printer with --drop-after 2000 --drop-every N.
 * without --agent    the designated host (the emulator app) prints; the soak only orders, then waits.
 *
 * It mints a staff session from the env file's AUTH_SECRET (never printed) and prints counts only: no
 * secret, no payload. (console output is intentional — this is an ops CLI script, not app code.)
 */
import net from "node:net";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import mongoose from "mongoose";
import { encode } from "next-auth/jwt";
import { PrintHost } from "@/models/PrintHost";
import { PrintJob } from "@/models/PrintJob";

const COOKIE = "authjs.session-token";
const SLIP_BYTES = 4_096;
const TAB = "soak-tab";

interface Args {
  orders: number;
  base: string;
  everyMs: number;
  drainS: number;
  agent: { host: string; port: number } | null;
  out: string;
  device: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { orders: 200, base: "http://localhost:3100", everyMs: 1_500, drainS: 300, agent: null, out: "", device: "soak-device" };
  for (let i = 0; i < argv.length; i++) {
    const value = argv[++i] ?? "";
    switch (argv[i - 1]) {
      case "--orders": args.orders = Number(value); break;
      case "--base": args.base = value; break;
      case "--every-ms": args.everyMs = Number(value); break;
      case "--drain-s": args.drainS = Number(value); break;
      case "--out": args.out = value; break;
      case "--device": args.device = value; break;
      case "--agent": {
        const [host, port] = value.split(":");
        args.agent = { host: host ?? "", port: Number(port) };
        break;
      }
      default: throw new Error(`unknown option ${argv[i - 1]}`);
    }
  }
  if (!Number.isInteger(args.orders) || args.orders < 1) throw new Error("--orders needs a whole number");
  if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(args.base)) throw new Error("refusing: --base must be a local POS");
  if (args.out === "" || !existsSync(args.out)) throw new Error("--out must be the fake printer's --out folder");
  return args;
}

type Json = { data?: Record<string, unknown>; error?: string };
const requests = new Map<string, number>();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(args: Args, cookie: string, method: string, url: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: Json }> {
  const route = `${method} ${url.replace(/[0-9a-f]{24}/g, ":id")}`;
  requests.set(route, (requests.get(route) ?? 0) + 1);
  const res = await fetch(`${args.base}${url}`, { method, headers: { "content-type": "application/json", cookie, ...headers }, body: JSON.stringify(body), redirect: "manual" });
  const text = await res.text();
  try {
    return { status: res.status, json: JSON.parse(text) as Json };
  } catch {
    return { status: res.status, json: { error: `non-JSON answer (${text.length} chars)` } };
  }
}

/** One leased job on the fake printer: the job's id first (the check reads it back), then DLE EOT 1. Its
 *  answer comes only after every byte before it was read, so a cut connection is a "maybe". */
function writeSlip(agent: NonNullable<Args["agent"]>, job: { id: string; epoch: number; kind: string }): Promise<"printed" | "maybe" | "no"> {
  return new Promise((resolve) => {
    const socket = net.connect(agent.port, agent.host);
    let connected = false;
    let settled = false;
    const done = (result: "printed" | "maybe" | "no") => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };
    socket.setTimeout(5_000, () => done(connected ? "maybe" : "no"));
    socket.on("error", () => done(connected ? "maybe" : "no"));
    socket.on("close", () => done(connected ? "maybe" : "no"));
    socket.on("data", () => done("printed"));
    socket.on("connect", () => {
      connected = true;
      const head = Buffer.from(`JOB ${job.id} ${job.epoch} ${job.kind}\n`, "utf8");
      socket.write(Buffer.concat([head, Buffer.alloc(SLIP_BYTES - head.length, 0x2e), Buffer.from([0x10, 0x04, 0x01])]));
    });
  });
}

/** Lease this device's line until it is empty; returns when the server says to look again (or null). */
async function drainLine(args: Args, cookie: string): Promise<number | null> {
  const agent = args.agent;
  if (agent === null) return null;
  for (;;) {
    const lease = await call(args, cookie, "POST", "/api/print-jobs/lease", { deviceId: args.device, tabId: TAB });
    const jobs = (lease.json.data?.jobs as Array<{ id: string; epoch: number; kind: string }> | undefined) ?? [];
    const job = jobs[0];
    if (job === undefined) {
      const retryAt = lease.json.data?.retryAt;
      return typeof retryAt === "string" ? Date.parse(retryAt) : null;
    }
    const result = await writeSlip(agent, job);
    const body =
      result === "printed"
        ? { deviceId: args.device, epoch: job.epoch, outcome: "printed" }
        : { deviceId: args.device, epoch: job.epoch, outcome: "failed", sent: result, error: result === "no" ? "The printer is not connected." : "The printer cut the connection mid-slip." };
    await call(args, cookie, "POST", `/api/print-jobs/${job.id}/ack`, body);
  }
}

interface PrinterRecord { bytes: number; dropped: boolean; file: string | null; at: string }

function printerRecords(out: string, since: Date): PrinterRecord[] {
  const log = path.join(out, "jobs.log");
  if (!existsSync(log)) return [];
  return readFileSync(log, "utf8")
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line) => JSON.parse(line) as PrinterRecord)
    .filter((r) => r.bytes > 0 && Date.parse(r.at) >= since.getTime());
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const uri = process.env.MONGODB_URI ?? "";
  if (!/\/pos_scratch_[a-z0-9_]+$/.test(uri)) throw new Error("refusing: not a pos_scratch_* database");
  const secret = process.env.AUTH_SECRET ?? "";
  if (secret.length < 32) throw new Error("AUTH_SECRET missing from the env file");
  await mongoose.connect(uri);
  try {
    const db = mongoose.connection.db;
    if (!db) throw new Error("no db");
    const host = await PrintHost.findOne({}).select("deviceId").lean();
    if (args.agent !== null && host !== null) throw new Error("--agent needs no host: clear it in the app first (Stop printing here)");
    if (args.agent === null && host === null) throw new Error("without --agent a host must print: designate the app first");
    const staff = await db.collection("staffs").findOne({ role: "admin", isActive: { $ne: false } }, { projection: { name: 1, role: 1 } });
    if (staff === null) throw new Error("no admin to act as");
    const token = await encode({ token: { name: staff.name, id: String(staff._id), role: staff.role, lastValidated: Date.now() }, secret, salt: COOKIE });
    const cookie = `${COOKIE}=${token}`;
    // Plain items only: a sized item or one on discount needs the POS's own price rules.
    const products = await db
      .collection("products")
      .find({ available: { $ne: false }, isActive: { $ne: false }, "variations.0": { $exists: false }, discount: { $in: [0, null] } }, { projection: { name: 1, price: 1 } })
      .limit(3)
      .toArray();
    if (products.length === 0) throw new Error("no product to order");
    const line = (i: number) => {
      const p = products[i % products.length];
      return { productId: String(p?._id), name: String(p?.name), price: Number(p?.price), qty: 1, modifiers: [], instructions: "" };
    };
    const agentHeaders = { "x-pos-print-agent": "1", "x-pos-device-id": args.device };
    const startedAt = new Date(Date.now() - 1_000);
    const named = new Set<string>();
    const refuse: string[] = [];
    const counts = { orders: 0, rounds: 0, bills: 0 };
    const note = (res: { status: number; json: Json }, what: string) => {
      if (res.status >= 300) refuse.push(`${what}: ${res.status} ${res.json.error ?? ""}`.trim());
      for (const ref of (res.json.data?.printJobs as Array<{ id: string }> | undefined) ?? []) named.add(ref.id);
    };

    for (let i = 0; i < args.orders; i++) {
      const item = line(i);
      const created = await call(args, cookie, "POST", "/api/orders", { customerName: "Soak", items: [item], subtotal: item.price, discount: 0, total: item.price, payment: "Unpaid", status: "Pending", receiver: "Soak", idemKey: randomUUID() }, agentHeaders);
      note(created, `order ${i + 1}`);
      const orderId = typeof created.json.data?._id === "string" ? created.json.data._id : null;
      if (orderId === null) continue;
      counts.orders += 1;
      await drainLine(args, cookie);
      if (i % 2 === 1) {
        const round = await call(args, cookie, "POST", `/api/orders/${orderId}/items`, { items: [line(i + 1)], idemKey: randomUUID() }, agentHeaders);
        note(round, `round ${i + 1}`);
        if (round.status < 300) counts.rounds += 1;
        await drainLine(args, cookie);
      }
      const settled = await call(args, cookie, "POST", `/api/orders/${orderId}/settle`, { payment: "Cash" }, { ...agentHeaders, "x-pos-print-bill": "1" });
      note(settled, `bill ${i + 1}`);
      if (settled.status < 300) counts.bills += 1;
      await drainLine(args, cookie);
      if ((i + 1) % 20 === 0) console.log(`  ${i + 1}/${args.orders} orders`);
      await sleep(args.everyMs);
    }

    // Drain: wait until no slip of this soak is still queued or leased (a REPRINT waits for its backoff).
    const deadline = Date.now() + args.drainS * 1_000;
    const mine = { originDeviceId: args.device, createdAt: { $gte: startedAt } };
    for (;;) {
      const next = await drainLine(args, cookie);
      const open = await PrintJob.countDocuments({ ...mine, status: { $in: ["queued", "leased"] } });
      if (open === 0 || Date.now() > deadline) break;
      await sleep(Math.min(5_000, Math.max(1_000, (next ?? Date.now() + 2_000) - Date.now())));
    }

    const jobs = await PrintJob.find(mine).select("kind status labels uncertainAttempts").lean();
    const byStatus: Record<string, number> = {};
    for (const job of jobs) byStatus[job.status] = (byStatus[job.status] ?? 0) + 1;
    const problems: string[] = [...refuse];
    const ids = new Set(jobs.map((job) => String(job._id)));
    const missing = [...named].filter((id) => !ids.has(id));
    if (missing.length > 0) problems.push(`${missing.length} slip(s) an answer named are missing`);
    const expected = counts.orders + counts.rounds + counts.bills;
    if (jobs.length !== expected) problems.push(`${jobs.length} slips for ${expected} expected (orders + rounds + bills)`);
    const silent = jobs.filter((job) => job.status === "queued" || job.status === "leased" || job.status === "dismissed");
    if (silent.length > 0) problems.push(`${silent.length} slip(s) neither printed nor visibly waiting`);

    const records = printerRecords(args.out, startedAt);
    const complete = records.filter((r) => !r.dropped);
    const dropped = records.filter((r) => r.dropped);
    const printed = jobs.filter((job) => job.status === "printed");
    if (args.agent !== null) {
      const tally = new Map<string, { complete: number; dropped: number }>();
      for (const r of records) {
        if (r.file === null) continue;
        const head = readFileSync(path.join(args.out, r.file), "utf8").slice(0, 80).split("\n")[0] ?? "";
        const id = /^JOB ([0-9a-f]{24}) /.exec(head)?.[1];
        if (id === undefined) continue;
        const t = tally.get(id) ?? { complete: 0, dropped: 0 };
        if (r.dropped) t.dropped += 1;
        else t.complete += 1;
        tally.set(id, t);
      }
      for (const job of jobs) {
        const t = tally.get(String(job._id)) ?? { complete: 0, dropped: 0 };
        const want = job.status === "printed" ? 1 : 0;
        if (t.complete !== want) problems.push(`${job.kind} ${String(job._id)}: ${t.complete} full copies on paper, status ${job.status}`);
        if (t.dropped !== (job.uncertainAttempts ?? 0)) problems.push(`${job.kind} ${String(job._id)}: ${t.dropped} cut copies, ${job.uncertainAttempts ?? 0} counted`);
        if (job.status === "printed" && (job.uncertainAttempts ?? 0) > 0 && !(job.labels ?? []).includes(job.kind === "bill" ? "DUPLICATE" : "REPRINT")) {
          problems.push(`${job.kind} ${String(job._id)}: a repeat without its label`);
        }
      }
    } else if (complete.length !== printed.length || dropped.length > 0) {
      problems.push(`the printer has ${complete.length} full and ${dropped.length} cut copies for ${printed.length} printed slips`);
    }

    console.log(
      JSON.stringify(
        {
          mode: args.agent === null ? "app host prints" : "soak agent prints",
          ...counts,
          slips: jobs.length,
          byStatus,
          labelled: jobs.filter((job) => (job.labels ?? []).length > 0).length,
          printer: { complete: complete.length, dropped: dropped.length },
          requests: Object.fromEntries([...requests].sort()),
          minutes: Math.round((Date.now() - startedAt.getTime()) / 6_000) / 10,
          pass: problems.length === 0,
          problems: problems.slice(0, 20),
        },
        null,
        1,
      ),
    );
    if (problems.length > 0) process.exitCode = 1;
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "failed");
  process.exitCode = 1;
});
