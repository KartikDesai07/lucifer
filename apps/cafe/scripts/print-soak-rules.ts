/**
 * Phase 3 Session 3G (Session 2G's m-5 and m-6, the final Phase 2 gate's (a) items 5 and 6): the print soak's rules that
 * need no server, split out of scripts/print-soak.ts so node:test can drive them: its options (a malformed address is
 * refused before the first order) and the slip check (every slip the soak made must have a job, whatever its answers
 * named). A local test tool.
 */
import type { SoakAddress } from "./print-soak-agent";

export interface SoakArgs {
  orders: number;
  base: string;
  everyMs: number;
  drainS: number;
  agent: SoakAddress | null;
  printers: Array<{ name: string } & SoakAddress>;
  direct: boolean;
  outs: string[];
  device: string;
  /** How the soak's page says it prints token slips: "page" on its lease and its ack (Phase 3), "lease" on its lease only
   *  (print-customization S7 to before Phase 3), null never (before S7). */
  tokens: "page" | "lease" | null;
  /** --failover: a second soak writer (its device and its own printers) that may take the soak's network printers over;
   *  the soak's writer (--device) stops after `stopAfter` orders. null: not asked. */
  failover: { device: string; printers: Array<{ name: string } & SoakAddress>; stopAfter: number } | null;
}

function namedPrinterOf(value: string, option: string): { name: string } & SoakAddress {
  const at = value.lastIndexOf("=");
  if (at < 1) throw new Error(`${option} ${value}: give it as "NAME=HOST:PORT"`);
  return { name: value.slice(0, at), ...soakAddressOf(value.slice(at + 1), option) };
}

const HOST = /^[A-Za-z0-9._-]+$/;

/** "host:port" with a host and a port 1 to 65535; anything else stops the soak before its first order. */
export function soakAddressOf(value: string, option: string): SoakAddress {
  const at = value.lastIndexOf(":");
  const host = at < 0 ? "" : value.slice(0, at);
  const port = at < 0 ? Number.NaN : Number(value.slice(at + 1));
  if (!HOST.test(host) || !/^\d+$/.test(value.slice(at + 1)) || port < 1 || port > 65_535) throw new Error(`${option} ${value}: give the fake printer as HOST:PORT`);
  return { host, port };
}

export function parseSoakArgs(argv: readonly string[], exists: (folder: string) => boolean): SoakArgs {
  const args: SoakArgs = { orders: 200, base: "http://localhost:3100", everyMs: 1_500, drainS: 300, agent: null, printers: [], direct: false, outs: [], device: "soak-device", tokens: null, failover: null };
  let second: string | null = null;
  const secondPrinters: Array<{ name: string } & SoakAddress> = [];
  let stopAfter: number | null = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--direct") {
      args.direct = true;
      continue;
    }
    const option = argv[i] ?? "";
    const value = argv[++i] ?? "";
    switch (option) {
      case "--orders": args.orders = Number(value); break;
      case "--base": args.base = value; break;
      case "--every-ms": args.everyMs = Number(value); break;
      case "--drain-s": args.drainS = Number(value); break;
      case "--out": args.outs = value.split(",").filter((out) => out !== ""); break;
      case "--device": args.device = value; break;
      case "--agent": args.agent = soakAddressOf(value, "--agent"); break;
      case "--printer": args.printers.push(namedPrinterOf(value, "--printer")); break;
      case "--failover": second = value; break;
      case "--failover-printer": secondPrinters.push(namedPrinterOf(value, "--failover-printer")); break;
      case "--stop-after": stopAfter = Number(value); break;
      case "--tokens":
        if (value !== "page" && value !== "lease") throw new Error(`--tokens ${value}: page (its lease and ack say it) or lease (its lease only)`);
        args.tokens = value;
        break;
      default: throw new Error(`unknown option ${option}`);
    }
  }
  if (!Number.isInteger(args.orders) || args.orders < 1) throw new Error("--orders needs a whole number");
  if (!/^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(args.base)) throw new Error("refusing: --base must be a local POS");
  if (args.outs.length === 0 || args.outs.some((out) => !exists(out))) throw new Error("--out must be the fake printers' --out folders");
  if (args.agent !== null && args.printers.length > 0) throw new Error("--agent (simple mode) or --printer (printers mode), not both");
  if (args.direct && args.agent === null && args.printers.length === 0) throw new Error("--direct needs --agent or --printer");
  if (args.tokens !== null && args.agent === null && args.printers.length === 0) throw new Error("--tokens needs --agent or --printer (an ordering-only soak prints no token)");
  if (second === null) {
    if (secondPrinters.length > 0) throw new Error("--failover-printer needs --failover (the second writer's device)");
    if (stopAfter !== null) throw new Error("--stop-after needs --failover");
    return args;
  }
  if (args.printers.length === 0) throw new Error("--failover needs --printer: the soak writes the printers that fail over");
  if (secondPrinters.length === 0) throw new Error("--failover needs --failover-printer: the second writer writes a printer of its own (the 3A gate's E-1)");
  if (args.direct) throw new Error("--failover: the orders come from a device that prints nothing (no --direct)");
  if (second === args.device || second === "") throw new Error("--failover: the second writer is a device other than --device");
  const stop = stopAfter ?? Math.floor(args.orders / 2);
  if (!Number.isInteger(stop) || stop < 1 || stop >= args.orders) throw new Error("--stop-after: the soak's writer stops after an order inside the run");
  args.failover = { device: second, printers: secondPrinters, stopAfter: stop };
  return args;
}

/** The slip a job prints: its key without the printer line and part (spec §6.5: `kot:<order>:<round>`, `bill:<order>`,
 *  `token:<order>`). null for a job with no key (a reprint), which is no slip the soak made. */
export function slipOfJobKey(jobKey: string | undefined): string | null {
  if (jobKey === undefined) return null;
  const parts = jobKey.split(":");
  return parts[0] === "kot" ? parts.slice(0, 3).join(":") : parts.slice(0, 2).join(":");
}

/** The slips the soak made that no job prints: whatever the answers named, the database is asked (a slip whose answer
 *  was lost, or a routing that made no job, shows here). */
export function missingSlips(made: readonly string[], jobs: ReadonlyArray<{ jobKey?: string }>): string[] {
  const printed = new Set(jobs.map((job) => slipOfJobKey(job.jobKey)));
  return made.filter((slip) => !printed.has(slip));
}

/** The final Phase 3 gate (the 3G review's m-3): the jobs of the soak's orders that no answer named. In printers mode a
 *  slip is a job per printer line, each named in the answer that made it, so such a job is a sweep's repair or a
 *  duplicate (simple mode counts one job per slip instead). */
export function unnamedJobs(jobs: ReadonlyArray<{ _id: unknown }>, named: ReadonlySet<string>): string[] {
  return jobs.map((job) => String(job._id)).filter((id) => !named.has(id));
}
