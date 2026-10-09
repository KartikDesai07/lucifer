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
  const args: SoakArgs = { orders: 200, base: "http://localhost:3100", everyMs: 1_500, drainS: 300, agent: null, printers: [], direct: false, outs: [], device: "soak-device", tokens: null };
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
      case "--printer": {
        const at = value.lastIndexOf("=");
        if (at < 1) throw new Error(`--printer ${value}: give it as "NAME=HOST:PORT"`);
        args.printers.push({ name: value.slice(0, at), ...soakAddressOf(value.slice(at + 1), "--printer") });
        break;
      }
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
