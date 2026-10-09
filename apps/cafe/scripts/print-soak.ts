/**
 * Phase 1 Session 1E (spec §14, plan Task E1 scenario 5; spec §17.3 item 5): the print soak. It drives the
 * REAL HTTP API of a running local POS (`next start`) the way an ordering device does — orders, a second
 * KOT round on every other order, and Pay Now bills, all with the agent headers — then proves nothing was
 * lost silently: every slip it caused ends printed, or visibly needs-confirm / failed, and the fake
 * printers' jobs.log match. A local test tool: it refuses any database but pos_scratch_* and any POS
 * but localhost.
 *
 * Phase 2 Session 2G (the 2F2 review gate; spec §7.11, §8, §17.3): it measures what Phase 2 changed too. In printers
 * mode (an enabled printer exists) every slip is routed to printers, so a slip may be several jobs: the soak counts
 * the jobs its answers named. --direct: the soak's own slips are made leased to it as it asks (decision 15): it
 * prints each job an answer carries and leases only when an ack says `more` (decision 9). scripts/print-soak-agent.ts
 * holds its agent.
 *
 *   node --env-file=<env> --import tsx scripts/print-soak.ts --out <folder>[,<folder>]
 *        [--orders 200] [--base http://localhost:3100] [--every-ms 1500] [--drain-s 300]
 *        [--agent 127.0.0.1:9100 | --printer "<name>=127.0.0.1:9100" ...] [--direct] [--device soak-device]
 *        [--tokens page|lease] [--failover <device> --failover-printer "<name>=127.0.0.1:9101" ... [--stop-after N]]
 *
 * --agent HOST:PORT   simple mode, no host: the soak is its own device's print agent. It leases, writes each job to
 *                     the fake printer over TCP and asks DLE EOT 1 at the end, so a connection the printer cut
 *                     mid-slip is seen ("maybe"): a lane that can see the drop, which Android's TCP lane cannot
 *                     (gate finding G5). Start the printer with --drop-after 2000 --drop-every N.
 * --printer NAME=H:P  printers mode (repeatable): the soak writes that printer (its printing device must be
 *                     --device) on the fake printer at H:P.
 * --direct            with --agent or --printer: the lease header (and the printers it writes) on every request.
 * --tokens page|lease with --agent or --printer, when the cafe prints a token per order (print-customization S7): the
 *                     soak's page says so on its lease and its ack (page: Phase 3), or on its lease only (lease: a page
 *                     from S7 to before Phase 3, whose acks cost the server a read of its device's last word).
 * --failover DEVICE   with --printer (Session 3G): two soak writers that poll the wake as a printers-mode writer's page
 *                     does, the soak's --device (its --printer printers) and DEVICE (its --failover-printer printers, so it
 *                     may take a network printer over: lanFailover); the orders come from a third device that prints
 *                     nothing; the soak's writer stops after --stop-after orders (half of them unless said), and every
 *                     slip on its network printers is checked by P3-4's measure (scripts/print-soak-writer.ts).
 * neither             another device prints: the host (simple mode) or the printers' writer (the emulator app);
 *                     the soak only orders, then waits.
 * --out               every fake printer's --out folder, comma separated (the check reads each jobs.log).
 *
 * It mints a staff session from the env file's AUTH_SECRET (never printed) and prints counts only: no
 * secret, no payload. (console output is intentional — this is an ops CLI script, not app code.)
 *
 * Phase 3 Session 3G (Session 2G's m-5 and m-6, the final Phase 2 gate's (a) items 5 and 6): a malformed address stops it
 * before its first order (scripts/print-soak-rules.ts); its agent keeps the page's one timer, so a backoff is waited out,
 * not leased through; and every slip it made is checked against the jobs its orders hold, not only the ones its answers
 * named.
 */
import path from "node:path";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import mongoose from "mongoose";
import { encode } from "next-auth/jwt";
import { PrintHost } from "@/models/PrintHost";
import { PrintJob } from "@/models/PrintJob";
import { printerWriterDeviceId, routablePrinters, type PrinterConfig } from "@pos/shared/print-printers";
import { printRepeatLabel } from "@pos/shared/print-lifecycle";
import { leaseLines, printLeased, soakHeaders, soakNextLeaseAt, soakTimerDue, type SoakAddress, type SoakAgent, type SoakCall, type SoakJson } from "./print-soak-agent";
import { missingSlips, parseSoakArgs, type SoakArgs } from "./print-soak-rules";
import { failoverProblems, soakWriterTick, type SoakWriter } from "./print-soak-writer";

const COOKIE = "authjs.session-token";

const requests = new Map<string, number>();
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function call(args: SoakArgs, cookie: string, method: string, url: string, body: unknown, headers: Record<string, string> = {}): Promise<{ status: number; json: SoakJson }> {
  const route = `${method} ${url.replace(/[0-9a-f]{24}/g, ":id")}`;
  requests.set(route, (requests.get(route) ?? 0) + 1);
  const res = await fetch(`${args.base}${url}`, { method, headers: { "content-type": "application/json", cookie, ...headers }, body: JSON.stringify(body), redirect: "manual" });
  const text = await res.text();
  try {
    return { status: res.status, json: JSON.parse(text) as SoakJson };
  } catch {
    return { status: res.status, json: { error: `non-JSON answer (${text.length} chars)` } };
  }
}

interface PrinterRecord { bytes: number; dropped: boolean; file: string | null; at: string; out: string; statusOnly?: boolean }

function printerRecords(outs: readonly string[], since: Date): PrinterRecord[] {
  return outs.flatMap((out) => {
    const log = path.join(out, "jobs.log");
    if (!existsSync(log)) return [];
    return readFileSync(log, "utf8")
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => ({ ...(JSON.parse(line) as Omit<PrinterRecord, "out">), out }))
      // Phase 3 Session 3C: a POS app's idle status check (DLE EOT only) is not a slip.
      .filter((r) => r.bytes > 0 && r.statusOnly !== true && Date.parse(r.at) >= since.getTime());
  });
}

async function main(): Promise<void> {
  const args = parseSoakArgs(process.argv.slice(2), existsSync);
  const uri = process.env.MONGODB_URI ?? "";
  // A local scratch database only, and (below) the first order must land in it: the POS at --base might use
  // another database (the Phase 1 final gate, M8).
  if (!/^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\/pos_scratch_[a-z0-9_]+$/.test(uri)) throw new Error("refusing: not a local pos_scratch_* database");
  const secret = process.env.AUTH_SECRET ?? "";
  if (secret.length < 32) throw new Error("AUTH_SECRET missing from the env file");
  await mongoose.connect(uri);
  try {
    const db = mongoose.connection.db;
    if (!db) throw new Error("no db");
    // Printers mode as the server decides it (printersModeOn: a routable printer exists). The host plays no part then.
    const printerDocs = await db.collection("printers").find({}).toArray();
    const routable = routablePrinters(printerDocs.map((p) => ({ id: String(p._id), name: String(p.name), connection: p.connection, primaryDeviceId: p.primaryDeviceId, order: Number(p.order ?? 0), paper: p.paper, slips: p.slips, copies: p.copies, enabled: p.enabled === true }) as PrinterConfig));
    const printersMode = routable.length > 0;
    const lines = new Map<string, SoakAddress>();
    if (printersMode) {
      if (args.agent !== null) throw new Error("printers mode: the soak writes printers with --printer, not --agent");
      for (const wanted of args.printers) {
        const printer = routable.find((p) => p.name === wanted.name);
        if (printer === undefined || printerWriterDeviceId(printer) !== args.device) throw new Error(`--printer ${wanted.name}: no routable printer of that name printed by --device`);
        lines.set(printer.id, { host: wanted.host, port: wanted.port });
      }
    } else {
      if (args.printers.length > 0) throw new Error("--printer needs printers mode (set printers up first)");
      const host = await PrintHost.findOne({}).select("deviceId").lean();
      if (args.agent !== null && host !== null) throw new Error("--agent needs no host: clear it in the app first (Stop printing here)");
      if (args.agent === null && host === null) throw new Error("without --agent a host must print: designate the app first");
      if (args.agent !== null) lines.set("", args.agent);
    }
    const tokens = args.tokens !== null ? { tokens: args.tokens } : {};
    // The final Phase 3 gate (the 3G review's m-1): the setup's network printers, where the soak's page acks a refusal before
    // any byte "unreachable", as a Phase 3 page does; --tokens lease stands for a page from before Phase 3, which never says it.
    const network: ReadonlySet<string> = new Set(args.tokens === "lease" ? [] : routable.filter((p) => p.connection.kind === "lan").map((p) => p.id));
    // Session 3G (--failover): the soak's printers are written by its writer (--device), a page that polls the wake; a
    // second writer writes its own printers and may take any other network printer over; the orders come from a third
    // device that prints nothing, so every slip is leased by its writer (Session 2G's P4).
    const writers: SoakWriter[] = [];
    if (args.failover !== null) {
      const second = args.failover;
      const own = new Map<string, SoakAddress>();
      for (const wanted of second.printers) {
        const printer = routable.find((p) => p.name === wanted.name);
        if (printer === undefined || printerWriterDeviceId(printer) !== second.device) throw new Error(`--failover-printer ${wanted.name}: no routable printer of that name printed by ${second.device}`);
        own.set(printer.id, { host: wanted.host, port: wanted.port });
      }
      const networkBut = (mine: ReadonlyMap<string, SoakAddress>) => new Map(routable.flatMap((p): Array<[string, SoakAddress]> => (p.connection.kind === "lan" && !mine.has(p.id) ? [[p.id, { host: p.connection.host, port: p.connection.port }]] : [])));
      if (networkBut(new Map()).size === 0 || [...lines.keys()].every((id) => !networkBut(own).has(id))) throw new Error("--failover: the soak writes no network printer the second writer may take over");
      writers.push({ device: args.device, own: new Map(lines), candidates: networkBut(lines), ...tokens, network, stopped: false, lastJobAt: null, takenOver: [] });
      writers.push({ device: second.device, own, candidates: networkBut(own), ...tokens, network, stopped: false, lastJobAt: null, takenOver: [] });
      lines.clear();
    }
    const agent: SoakAgent = { lines, device: writers.length > 0 ? `${args.device}-orders` : args.device, direct: args.direct, ...tokens, timerAt: null, network };
    // Session 3G: with tokens on (print-customization S7) every order makes a token slip, which is never printed at once
    // (it waits for a lease that says tokenSlips): a soak that prints must say how its page says so.
    const settings = await db.collection("settings").findOne({}, { projection: { tokenEnabled: 1 } });
    const tokensOn = settings?.tokenEnabled === true;
    if (tokensOn && (lines.size > 0 || writers.length > 0) && args.tokens === null) throw new Error("tokens are on: say how the soak's page prints them (--tokens page or --tokens lease)");
    const staff = await db.collection("staffs").findOne({ role: "admin", isActive: { $ne: false } }, { projection: { name: 1, role: 1 } });
    if (staff === null) throw new Error("no admin to act as");
    const token = await encode({ token: { name: staff.name, id: String(staff._id), role: staff.role, lastValidated: Date.now() }, secret, salt: COOKIE });
    const cookie = `${COOKIE}=${token}`;
    const soakCall: SoakCall = (method, url, body) => call(args, cookie, method, url, body);
    // The writers' pages (--failover): each polls the wake at its cadence until the soak has drained; a stopped one is closed.
    let writing = true;
    let stopAt: number | null = null;
    const loops = writers.map(async (w) => {
      while (writing && !w.stopped) {
        let wait: number;
        try {
          wait = await soakWriterTick(w, soakCall, Date.now);
        } catch {
          wait = 15_000;
        }
        const until = Date.now() + wait;
        while (writing && !w.stopped && Date.now() < until) await sleep(Math.min(250, until - Date.now()));
      }
    });
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
    const startedAt = new Date(Date.now() - 1_000);
    const named = new Set<string>();
    // Session 3G ((a) item 5): every slip the soak made, by its key, and the orders it made them for.
    const made: string[] = [];
    const orderIds: string[] = [];
    const refuse: string[] = [];
    const counts = { orders: 0, rounds: 0, bills: 0 };
    const note = (res: { status: number; json: SoakJson }, what: string) => {
      if (res.status >= 300) refuse.push(`${what}: ${res.status} ${res.json.error ?? ""}`.trim());
      for (const ref of (res.json.data?.printJobs as Array<{ id: string }> | undefined) ?? []) named.add(ref.id);
    };

    for (let i = 0; i < args.orders; i++) {
      // The page's one timer fires between taps: a slip back in line is leased when its backoff is up, not before.
      if (soakTimerDue(agent, Date.now())) {
        agent.timerAt = null;
        await leaseLines(agent, soakCall);
      }
      const item = line(i);
      const created = await call(args, cookie, "POST", "/api/orders", { customerName: "Soak", items: [item], subtotal: item.price, discount: 0, total: item.price, payment: "Unpaid", status: "Pending", receiver: "Soak", idemKey: randomUUID() }, soakHeaders(agent, false));
      note(created, `order ${i + 1}`);
      const orderId = typeof created.json.data?._id === "string" ? created.json.data._id : null;
      if (orderId === null) continue;
      if (counts.orders === 0 && (await db.collection("orders").findOne({ _id: new mongoose.Types.ObjectId(orderId) })) === null) {
        throw new Error("refusing: the POS at --base writes to another database than MONGODB_URI");
      }
      counts.orders += 1;
      orderIds.push(orderId);
      made.push(`kot:${orderId}:1`, ...(tokensOn ? [`token:${orderId}`] : []));
      if (await printLeased(agent, soakCall, created)) await leaseLines(agent, soakCall);
      if (i % 2 === 1) {
        const round = await call(args, cookie, "POST", `/api/orders/${orderId}/items`, { items: [line(i + 1)], idemKey: randomUUID() }, soakHeaders(agent, false));
        note(round, `round ${i + 1}`);
        if (round.status < 300) {
          counts.rounds += 1;
          made.push(`kot:${orderId}:2`);
        }
        if (await printLeased(agent, soakCall, round)) await leaseLines(agent, soakCall);
      }
      const settled = await call(args, cookie, "POST", `/api/orders/${orderId}/settle`, { payment: "Cash" }, soakHeaders(agent, true));
      note(settled, `bill ${i + 1}`);
      if (settled.status < 300) {
        counts.bills += 1;
        made.push(`bill:${orderId}`);
      }
      const primary = writers[0];
      if (primary !== undefined && stopAt === null && counts.orders === args.failover?.stopAfter) {
        // --failover: the soak's writer stops here, as a tablet that is switched off: no wake, no lease, no ack. The stop's
        // time is taken once the request it had in flight is done (the gold review's #3: a lease in flight stamped after
        // the stop read as "printed by the stopped writer").
        primary.stopped = true;
        await loops[0];
        stopAt = Date.now();
        console.log(`  the soak's writer (${primary.device}) stopped after ${counts.orders} orders`);
      }
      if (await printLeased(agent, soakCall, settled)) await leaseLines(agent, soakCall);
      if ((i + 1) % 20 === 0) console.log(`  ${i + 1}/${args.orders} orders`);
      await sleep(args.everyMs);
    }

    // Drain: wait until no slip of this soak is still queued or leased (a REPRINT waits for its backoff). Session 2G: a
    // lease only while one is open, so the measured run holds no request the page would not make. Session 3G (m-6): at
    // the page's cadence: its one timer (a backoff, a "not due yet"), else its next pulse; another device's slips are
    // only watched (a database read, no request).
    const deadline = Date.now() + args.drainS * 1_000;
    const mine = { orderId: { $in: orderIds } };
    for (;;) {
      const open = await PrintJob.countDocuments({ ...mine, status: { $in: ["queued", "leased"] } });
      if (open === 0 || Date.now() > deadline) break;
      if (lines.size === 0) {
        await sleep(2_000);
        continue;
      }
      await sleep(Math.max(0, Math.min(soakNextLeaseAt(agent, Date.now()), deadline) - Date.now()));
      await leaseLines(agent, soakCall);
    }
    writing = false;
    await Promise.all(loops);

    const jobs = await PrintJob.find(mine).select("kind status labels uncertainAttempts copies jobKey").lean();
    const byStatus: Record<string, number> = {};
    for (const job of jobs) byStatus[job.status] = (byStatus[job.status] ?? 0) + 1;
    const problems: string[] = [...refuse];
    const ids = new Set(jobs.map((job) => String(job._id)));
    const missing = [...named].filter((id) => !ids.has(id));
    if (missing.length > 0) problems.push(`${missing.length} slip(s) an answer named are missing`);
    // Session 3G ((a) item 5): every slip the soak made has its jobs, read from its orders (a printers-mode slip is a job
    // per printer line), whatever the answers named; simple mode makes one job per slip.
    const unmade = missingSlips(made, jobs);
    if (unmade.length > 0) problems.push(`${unmade.length} slip(s) the soak made have no job (${unmade.slice(0, 3).join(", ")})`);
    if (!printersMode && jobs.length !== made.length) problems.push(`${jobs.length} jobs for ${made.length} slips (simple mode: one job per slip)`);
    const silent = jobs.filter((job) => job.status === "queued" || job.status === "leased" || job.status === "dismissed");
    if (silent.length > 0) problems.push(`${silent.length} slip(s) neither printed nor visibly waiting`);

    const records = printerRecords(args.outs, startedAt);
    const complete = records.filter((r) => !r.dropped);
    const dropped = records.filter((r) => r.dropped);
    const printed = jobs.filter((job) => job.status === "printed");
    const copiesOf = (job: { copies?: number }) => job.copies ?? 1;
    if (lines.size > 0 || writers.length > 0) {
      const tally = new Map<string, { complete: number; dropped: number }>();
      for (const r of records) {
        if (r.file === null) continue;
        const head = readFileSync(path.join(r.out, r.file), "utf8").slice(0, 80).split("\n")[0] ?? "";
        const id = /^JOB ([0-9a-f]{24}) /.exec(head)?.[1];
        if (id === undefined) continue;
        const t = tally.get(id) ?? { complete: 0, dropped: 0 };
        if (r.dropped) t.dropped += 1;
        else t.complete += 1;
        tally.set(id, t);
      }
      for (const job of jobs) {
        const t = tally.get(String(job._id)) ?? { complete: 0, dropped: 0 };
        const want = job.status === "printed" ? copiesOf(job) : 0;
        if (t.complete !== want) problems.push(`${job.kind} ${String(job._id)}: ${t.complete} full copies on paper, status ${job.status}`);
        if (t.dropped !== (job.uncertainAttempts ?? 0)) problems.push(`${job.kind} ${String(job._id)}: ${t.dropped} cut copies, ${job.uncertainAttempts ?? 0} counted`);
        if (job.status === "printed" && (job.uncertainAttempts ?? 0) > 0 && !(job.labels ?? []).includes(printRepeatLabel(job.kind))) {
          problems.push(`${job.kind} ${String(job._id)}: a repeat without its label`);
        }
      }
    } else {
      const want = printed.reduce((sum, job) => sum + copiesOf(job), 0);
      if (complete.length !== want || dropped.length > 0) problems.push(`the printers have ${complete.length} full and ${dropped.length} cut copies for ${printed.length} printed jobs (${want} copies)`);
    }

    // --failover: P3-4's measure over the slips on the stopped writer's network printers.
    let failover: ReturnType<typeof failoverProblems>["report"] | null = null;
    const [first, second] = writers;
    if (first !== undefined && second !== undefined && stopAt !== null) {
      const network = new Set([...first.own.keys()].filter((id) => routable.find((p) => p.id === id)?.connection.kind === "lan"));
      const theirs = await PrintJob.find({ ...mine, printerId: { $in: [...network] } }).select("printerId createdAt status log").lean();
      const checked = failoverProblems({ stopAt, primary: first.device, second: second.device, printerIds: network, jobs: theirs });
      problems.push(...checked.problems);
      failover = checked.report;
    }

    console.log(
      JSON.stringify(
        {
          mode: `${printersMode ? "printers mode" : "simple mode"}, ${writers.length > 0 ? `two soak writers, the first stopped after ${args.failover?.stopAfter ?? 0} orders (failover)` : lines.size > 0 ? "soak agent prints" : printersMode ? "the printers' writer prints" : "app host prints"}${args.direct ? ", direct" : ""}${tokensOn ? `, a token per order${args.tokens !== null ? ` (says it: ${args.tokens})` : ""}` : ""}`,
          ...counts,
          tokens: tokensOn ? counts.orders : 0,
          slips: made.length,
          jobs: jobs.length,
          byStatus,
          labelled: jobs.filter((job) => (job.labels ?? []).length > 0).length,
          printer: { complete: complete.length, dropped: dropped.length },
          requests: Object.fromEntries([...requests].sort()),
          ...(failover !== null ? { failover } : {}),
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
