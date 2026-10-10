// Phase 3 Session 3E (spec §9.6): a network printer written straight from the Windows app's main process, the way the
// POS app writes one (apps/mobile/.../printer/TcpTransport.kt): one TCP connection per job to the printer's port (9100)
// on a private address, the page's ESC/POS bytes unchanged, then the printer's own status (DLE EOT 1 to 4) on that
// same connection before the job reads printed (G5), then close. A connect that fails sends nothing ("no": the page
// acks "unreachable", so another device may take the printer over); a failure after any byte is "maybe" (the server
// labels the retry REPRINT). The idle check (probeRawTcp) is one connect, DLE EOT, close: it says whether the printer
// answers, and what it says of its paper, cover and errors.
//
// Pure node (net, dns): no electron import, so node:test drives it against a fake printer on the loopback.
import { lookup } from "node:dns/promises";
import net from "node:net";

export const RAW_TCP_CONNECT_TIMEOUT_MS = 5_000;
/** A connect refused at once (or its host unreachable) is tried once more this much later, inside the 5 s: a printer
 *  that takes one connection at a time refuses a second one while another device's status check holds it (the POS
 *  app's rule since the 3C review gate). A printer that is off times out instead: no retry. */
export const RAW_TCP_REFUSED_RETRY_MS = 1_000;
/** G5: the wait for the first DLE EOT answer after a job: at least this, plus the job's own printing time at a slow
 *  RAW_TCP_STATUS_BYTES_PER_MS, at most RAW_TCP_STATUS_AFTER_JOB_MAX_MS. */
export const RAW_TCP_STATUS_AFTER_JOB_MIN_MS = 5_000;
export const RAW_TCP_STATUS_AFTER_JOB_MAX_MS = 30_000;
export const RAW_TCP_STATUS_BYTES_PER_MS = 8;
/** A DLE EOT answer from a printer with nothing to print, and DLE EOT 2 to 4 once it answered DLE EOT 1. */
export const RAW_TCP_STATUS_REPLY_MS = 1_000;
export const RAW_TCP_STATUS_FOLLOW_UP_MS = 300;
/** Reading what the printer still sends after the job, so unread bytes never reset the link. */
export const RAW_TCP_DRAIN_MS = 750;
/** A whole job, at most (the POS app's 60 s watchdog): a printer that takes the connection but never reads cannot hold
 *  its line for ever; the job is then "maybe". */
export const RAW_TCP_JOB_MAX_MS = 60_000;
/** The largest job: the page's longest raster slip (16,000 rows of 72 bytes) with room to spare. */
export const RAW_TCP_DATA_MAX_BYTES = 1_500_000;
export const RAW_TCP_HOST_MAX_CHARS = 253;
const HOST_PATTERN = /^[A-Za-z0-9._-]+$/;

export const PAPER_OK = "ok";
export const PAPER_LOW = "low";
export const PAPER_OUT = "out";
export const COVER_CLOSED = "closed";
export const COVER_OPEN = "open";

/** What a printer says of itself (DLE EOT); a field it did not say is absent. The POS app's PrinterHealth, the same rule. */
export interface RawTcpHealth {
  paper?: typeof PAPER_OK | typeof PAPER_LOW | typeof PAPER_OUT;
  cover?: typeof COVER_CLOSED | typeof COVER_OPEN;
  error?: true;
}

export interface RawTcpTarget {
  host: string;
  port: number;
}

/** Why a job did not read printed: "not-connected" before any byte (sent "no"), "bad-address" a host that is not on
 *  the local network (sent "no"), "write-failed" or "cannot-print" after bytes went out (sent "maybe"). */
export type RawTcpFailure = "not-connected" | "bad-address" | "write-failed" | "cannot-print";

export class RawTcpError extends Error {
  readonly sent: "no" | "maybe";
  readonly failure: RawTcpFailure;
  /** What the printer said when it said it cannot print (paper out, cover open, an error). */
  readonly health: RawTcpHealth | null;
  constructor(message: string, failure: RawTcpFailure, health: RawTcpHealth | null = null) {
    super(message);
    this.name = "RawTcpError";
    this.failure = failure;
    this.sent = failure === "not-connected" || failure === "bad-address" ? "no" : "maybe";
    this.health = health;
  }
}

export const NOT_CONNECTED_MESSAGE = "The printer did not answer.";
export const BAD_ADDRESS_MESSAGE = "That printer address is not on this network.";
export const WRITE_FAILED_MESSAGE = "The printer stopped answering while the slip was sent.";
export const NO_ANSWER_AFTER_MESSAGE = "The printer did not answer after the slip.";
export const CLOSED_BEFORE_ANSWER_MESSAGE = "The printer closed the link before it answered.";
export const CANNOT_PRINT_MESSAGE = "The printer cannot print now.";

/** The waits, shortened by the tests. */
export interface RawTcpWaits {
  connectMs: number;
  refusedRetryMs: number;
  afterJobMinMs: number;
  afterJobMaxMs: number;
  replyMs: number;
  followUpMs: number;
  drainMs: number;
  jobMs: number;
}

export const RAW_TCP_WAITS: RawTcpWaits = {
  connectMs: RAW_TCP_CONNECT_TIMEOUT_MS,
  refusedRetryMs: RAW_TCP_REFUSED_RETRY_MS,
  afterJobMinMs: RAW_TCP_STATUS_AFTER_JOB_MIN_MS,
  afterJobMaxMs: RAW_TCP_STATUS_AFTER_JOB_MAX_MS,
  replyMs: RAW_TCP_STATUS_REPLY_MS,
  followUpMs: RAW_TCP_STATUS_FOLLOW_UP_MS,
  drainMs: RAW_TCP_DRAIN_MS,
  jobMs: RAW_TCP_JOB_MAX_MS,
};

// ── DLE EOT (ESC/POS real-time status; Epson's bits, the POS app's DleEot) ──
const DLE = 0x10;
const EOT = 0x04;
const QUERIES = [1, 2, 3, 4] as const;
// Every status byte has bits 1 and 4 set and bits 0 and 7 clear.
const FIXED_MASK = 0x93;
const FIXED_BITS = 0x12;
const ONE_OFFLINE = 0x08;
const TWO_COVER_OPEN = 0x04;
const TWO_FEEDING = 0x08;
const TWO_PAPER_END = 0x20;
const TWO_ERROR = 0x40;
const THREE_ERRORS = 0x68;
const FOUR_NEAR_END = 0x0c;
const FOUR_END = 0x60;
const NO_ANSWER = -1;
const CLOSED = -2;

/** Whether `b` can be a status byte; anything else (an automatic status block, XON/XOFF, noise) is not one. */
export function isStatusAnswer(b: number): boolean {
  return (b & FIXED_MASK) === FIXED_BITS;
}

/** What the printer said: `answers` maps each n it answered to its byte. null when it answered none. The POS app's
 *  DleEot.healthOf, bit for bit (FEED held down is a cause, not an error: the 3C review gate's m-2). */
export function healthOfAnswers(answers: ReadonlyMap<number, number>): RawTcpHealth | null {
  if (answers.size === 0) return null;
  const one = answers.get(1);
  const two = answers.get(2);
  const three = answers.get(3);
  const four = answers.get(4);
  const paperOut = (two !== undefined && (two & TWO_PAPER_END) !== 0) || (four !== undefined && (four & FOUR_END) === FOUR_END);
  const paperLow = four !== undefined && (four & FOUR_NEAR_END) === FOUR_NEAR_END;
  const paper = paperOut ? PAPER_OUT : paperLow ? PAPER_LOW : two !== undefined || four !== undefined ? PAPER_OK : undefined;
  const coverOpen = two !== undefined && (two & TWO_COVER_OPEN) !== 0;
  const cover = two === undefined ? undefined : coverOpen ? COVER_OPEN : COVER_CLOSED;
  const offline = one !== undefined ? (one & ONE_OFFLINE) !== 0 : paperOut || coverOpen;
  const named = (three !== undefined && (three & THREE_ERRORS) !== 0) || (two !== undefined && (two & TWO_ERROR) !== 0);
  const feeding = two !== undefined && (two & TWO_FEEDING) !== 0;
  const error = offline && (named || (!paperOut && !coverOpen && !feeding));
  return { ...(paper !== undefined ? { paper } : {}), ...(cover !== undefined ? { cover } : {}), ...(error ? { error: true as const } : {}) };
}

/** It cannot print now: out of paper, its cover open, or an error (the POS app's and the page's one rule). */
export function healthCannotPrint(health: RawTcpHealth | null): boolean {
  return health !== null && (health.paper === PAPER_OUT || health.cover === COVER_OPEN || health.error === true);
}

// ── the printer's address: on the local network only ──

/** 10/8, 172.16/12, 192.168/16, link-local 169.254/16, loopback 127/8; IPv6 fc00::/7, fe80::/10 and ::1. A typed
 *  public host can never become a way to send bytes out of the cafe (the POS app's TcpAddress rule). */
export function isPrivateAddress(address: string): boolean {
  if (net.isIPv4(address)) {
    const [a = -1, b = -1] = address.split(".").map(Number);
    return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
  }
  if (net.isIPv6(address)) {
    const lower = address.toLowerCase();
    if (lower === "::1") return true;
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped !== null) return isPrivateAddress(mapped[1] ?? "");
    return /^f[cd][0-9a-f]{0,2}:/.test(lower) || /^fe[89ab][0-9a-f]?:/.test(lower);
  }
  return false;
}

/** A host and port the app may write: a short name or address, port 1 to 65535. */
export function validTarget(target: unknown): target is RawTcpTarget {
  if (typeof target !== "object" || target === null) return false;
  const { host, port } = target as Record<string, unknown>;
  return typeof host === "string" && host.length > 0 && host.length <= RAW_TCP_HOST_MAX_CHARS && HOST_PATTERN.test(host) && Number.isInteger(port) && (port as number) >= 1 && (port as number) <= 65_535;
}

/** Every private address of the host, IPv4 first (printers listen on IPv4). bad-address when it has none. */
async function privateAddressesOf(host: string): Promise<string[]> {
  let all: Array<{ address: string; family: number }>;
  try {
    all = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new RawTcpError(NOT_CONNECTED_MESSAGE, "not-connected");
  }
  const local = all.filter((entry) => isPrivateAddress(entry.address));
  if (local.length === 0) throw new RawTcpError(BAD_ADDRESS_MESSAGE, "bad-address");
  return [...local.filter((entry) => entry.family === 4), ...local.filter((entry) => entry.family !== 4)].map((entry) => entry.address);
}

const REFUSED_CODES: ReadonlySet<string> = new Set(["ECONNREFUSED", "EHOSTUNREACH", "ENETUNREACH"]);

/** One connect to one address within `timeoutMs`: the socket, or "refused" (it said no at once), or "timeout". */
function connectTo(address: string, port: number, timeoutMs: number): Promise<net.Socket | "refused" | "timeout"> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: address, port, noDelay: true });
    // The 3D review gate's review of the gold (m-4): never a moment without an "error" listener (an error with none is
    // an uncaught exception in the Windows app's main process); the Link adds its own once connected.
    socket.on("error", () => undefined);
    const timer = setTimeout(() => {
      socket.destroy();
      resolve("timeout");
    }, Math.max(1, timeoutMs));
    const failed = (error: NodeJS.ErrnoException): void => {
      clearTimeout(timer);
      socket.destroy();
      resolve(REFUSED_CODES.has(error.code ?? "") ? "refused" : "timeout");
    };
    socket.once("error", failed);
    socket.once("connect", () => {
      clearTimeout(timer);
      socket.off("error", failed);
      resolve(socket);
    });
  });
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** A fresh connection to the printer: each private address in turn, the 5 s shared out over the ones still to try; an
 *  address that refused is asked once more a second later. not-connected when none answers. */
async function connect(target: RawTcpTarget, waits: RawTcpWaits): Promise<net.Socket> {
  const addresses = await privateAddressesOf(target.host);
  const end = Date.now() + waits.connectMs;
  for (const [index, address] of addresses.entries()) {
    let refusedBefore = false;
    for (;;) {
      const left = end - Date.now();
      if (left <= 0) break;
      const got = await connectTo(address, target.port, Math.max(1, Math.floor(left / (addresses.length - index))));
      if (typeof got !== "string") return got;
      if (got !== "refused" || refusedBefore || end - Date.now() <= waits.refusedRetryMs) break;
      refusedBefore = true;
      await sleep(waits.refusedRetryMs);
    }
  }
  throw new RawTcpError(NOT_CONNECTED_MESSAGE, "not-connected");
}

/** The bytes the printer sends back on one connection, read one status answer at a time. */
class Link {
  private readonly queue: number[] = [];
  private ended = false;
  private wake: (() => void) | null = null;

  constructor(readonly socket: net.Socket) {
    socket.on("data", (chunk: Buffer) => {
      for (const b of chunk) this.queue.push(b);
      this.poke();
    });
    const end = (): void => {
      this.ended = true;
      this.poke();
    };
    socket.on("end", end);
    socket.on("close", end);
    socket.on("error", end);
  }

  private poke(): void {
    const wake = this.wake;
    this.wake = null;
    wake?.();
  }

  private waitFor(ms: number): Promise<void> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.wake = null;
        resolve();
      }, Math.max(1, ms));
      this.wake = () => {
        clearTimeout(timer);
        resolve();
      };
    });
  }

  write(data: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.ended) {
        reject(new Error("closed"));
        return;
      }
      this.socket.write(data, (error) => (error ? reject(error) : resolve()));
    });
  }

  /** Sends DLE EOT n and reads until a status byte arrives (any other byte is skipped), `waitMs` in all: the byte,
   *  NO_ANSWER, or CLOSED (the printer closed or reset the connection). */
  async ask(n: number, waitMs: number): Promise<number> {
    try {
      await this.write(Uint8Array.of(DLE, EOT, n));
    } catch {
      return CLOSED;
    }
    const end = Date.now() + waitMs;
    for (;;) {
      while (this.queue.length > 0) {
        const b = this.queue.shift() ?? 0;
        if (isStatusAnswer(b)) return b;
      }
      if (this.ended) return CLOSED;
      const left = end - Date.now();
      if (left <= 0) return NO_ANSWER;
      await this.waitFor(left);
    }
  }

  /** Half-closes, then reads until the printer closes or `ms` has passed. */
  async finish(ms: number): Promise<void> {
    this.socket.end();
    const end = Date.now() + ms;
    while (!this.ended) {
      const left = end - Date.now();
      if (left <= 0) break;
      this.queue.length = 0;
      await this.waitFor(left);
    }
  }
}

// The printers (host:port) that answered DLE EOT since the app started: only for such a printer is a job with no answer,
// or a connection closed before the answer, "maybe" (G5); one that never answers prints as before (no false REPRINT).
// An idle check with no answer forgets it. The ones whose last idle check got no answer are asked briefly after a job.
const answering = new Set<string>();
const silent = new Set<string>();
// One job or check at a time per printer.
const chains = new Map<string, Promise<unknown>>();
const busy = new Set<string>();

export function keyOf(target: RawTcpTarget): string {
  return `${target.host.toLowerCase()}:${target.port}`;
}

/** Test seam: the app just started. */
export function resetRawTcpMemory(): void {
  answering.clear();
  silent.clear();
  chains.clear();
  busy.clear();
}

function exclusive<T>(key: string, run: () => Promise<T>): Promise<T> {
  const before = chains.get(key) ?? Promise.resolve();
  const next = before.then(run, run);
  const settled = next.catch(() => undefined);
  chains.set(key, settled);
  void settled.then(() => {
    if (chains.get(key) === settled) chains.delete(key);
  });
  return next;
}

async function answersAfter(link: Link, first: number, waits: RawTcpWaits): Promise<Map<number, number>> {
  const answers = new Map<number, number>([[1, first]]);
  for (const n of QUERIES) {
    if (n === 1) continue;
    const b = await link.ask(n, Math.min(waits.replyMs, waits.followUpMs));
    if (b === CLOSED) break;
    if (b !== NO_ANSWER) answers.set(n, b);
  }
  return answers;
}

/** G5: the printer's own answer on the job's connection, before the job reads printed. */
async function afterJob(link: Link, key: string, bytes: number, waits: RawTcpWaits): Promise<RawTcpHealth | null> {
  const answers = answering.has(key);
  const wait = silent.has(key) ? waits.replyMs : Math.min(waits.afterJobMaxMs, waits.afterJobMinMs + Math.floor(bytes / RAW_TCP_STATUS_BYTES_PER_MS));
  const first = await link.ask(1, wait);
  if (first < 0) {
    if (answers) throw new RawTcpError(first === CLOSED ? CLOSED_BEFORE_ANSWER_MESSAGE : NO_ANSWER_AFTER_MESSAGE, "write-failed");
    return null;
  }
  answering.add(key);
  silent.delete(key);
  const health = healthOfAnswers(await answersAfter(link, first, waits));
  if (healthCannotPrint(health)) throw new RawTcpError(CANNOT_PRINT_MESSAGE, "cannot-print", health);
  return health;
}

/** One job: connect, write every byte, the printer's answer (G5), close. Resolves with what the printer said of itself
 *  (null when it answers no DLE EOT); throws RawTcpError ("no" before any byte, "maybe" after). */
export function printRawTcp(target: RawTcpTarget, data: Uint8Array, waits: RawTcpWaits = RAW_TCP_WAITS): Promise<{ health: RawTcpHealth | null }> {
  const key = keyOf(target);
  return exclusive(key, async () => {
    busy.add(key);
    try {
      const socket = await connect(target, waits);
      const link = new Link(socket);
      let expired = false;
      const deadline = setTimeout(() => {
        expired = true;
        socket.destroy();
      }, waits.jobMs);
      try {
        try {
          await link.write(data);
        } catch {
          throw new RawTcpError(WRITE_FAILED_MESSAGE, "write-failed");
        }
        const health = await afterJob(link, key, data.length, waits);
        await link.finish(waits.drainMs);
        if (expired) throw new RawTcpError(WRITE_FAILED_MESSAGE, "write-failed");
        return { health };
      } catch (error) {
        throw expired ? new RawTcpError(WRITE_FAILED_MESSAGE, "write-failed") : error;
      } finally {
        clearTimeout(deadline);
        socket.destroy();
      }
    } finally {
      busy.delete(key);
    }
  });
}

/** The idle check: one connect, DLE EOT, close. "disconnected" when it does not answer the connect; else what it said
 *  (health null: it answers no DLE EOT). null when a job holds the printer now (that job's answer says it). */
export async function probeRawTcp(
  target: RawTcpTarget,
  waits: RawTcpWaits = RAW_TCP_WAITS,
): Promise<{ link: "connected" | "disconnected"; health: RawTcpHealth | null } | null> {
  const key = keyOf(target);
  if (busy.has(key)) return null;
  return exclusive(key, async () => {
    let socket: net.Socket;
    try {
      socket = await connect(target, waits);
    } catch {
      return { link: "disconnected" as const, health: null };
    }
    const link = new Link(socket);
    try {
      const first = await link.ask(1, waits.replyMs);
      if (first < 0) {
        answering.delete(key);
        silent.add(key);
        return { link: "connected" as const, health: null };
      }
      answering.add(key);
      silent.delete(key);
      const health = healthOfAnswers(await answersAfter(link, first, waits));
      await link.finish(Math.min(waits.drainMs, waits.followUpMs));
      return { link: "connected" as const, health };
    } finally {
      socket.destroy();
    }
  });
}
