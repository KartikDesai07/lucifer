/**
 * F2 §5 integration-pass plumbing (no '@/lib' imports — loadable before env
 * bootstrap). Console output is intentional: this is an ops CLI harness, not
 * app code (the seed-script precedent).
 */
import { MongoClient, type Db } from "mongodb";

/** Swap the db-name path segment of a mongodb/mongodb+srv URI, keeping query params. */
export function deriveDbUri(baseUri: string, dbName: string): string {
  const m = /^(mongodb(?:\+srv)?:\/\/[^/?]+)(?:\/([^?]*))?(\?.*)?$/.exec(baseUri);
  if (!m) throw new Error("MONGODB_URI is not parseable");
  return `${m[1]}/${dbName}${m[3] ?? ""}`;
}

/** Every db this pass may create/drop MUST carry this prefix — the teardown guard. */
export const ITEST_DB_PREFIX = "f2itest_";

export class FailError extends Error {}

/** Sequential PASS/FAIL reporter. A failed check THROWS (later boxes depend on
 *  earlier state); the summary still prints via main's finally. */
export class Reporter {
  readonly results: Array<{ step: string; label: string; ok: boolean; detail?: string }> = [];
  private current = "(init)";

  step(name: string): void {
    this.current = name;
    console.log(`\n━━━ ${name} ━━━`);
  }

  check(label: string, cond: boolean, detail?: string): void {
    this.results.push({ step: this.current, label, ok: cond, detail });
    const suffix = detail ? ` — ${detail}` : "";
    if (cond) {
      console.log(`  ✓ ${label}${suffix}`);
    } else {
      console.error(`  ✗ ${label}${suffix}`);
      throw new FailError(`[${this.current}] ${label}${suffix}`);
    }
  }

  /** A non-fatal observation (owner-blocked legs, environment notes). */
  note(label: string): void {
    console.log(`  · ${label}`);
  }

  summary(): { passed: number; failed: number } {
    const passed = this.results.filter((r) => r.ok).length;
    const failed = this.results.length - passed;
    console.log(`\n━━━ SUMMARY: ${passed} passed, ${failed} failed ━━━`);
    return { passed, failed };
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Poll until `fn` resolves truthy; throws on timeout. */
export async function poll(
  label: string,
  fn: () => Promise<boolean>,
  timeoutMs = 15_000,
  everyMs = 250,
): Promise<void> {
  const t0 = Date.now();
  for (;;) {
    if (await fn()) return;
    if (Date.now() - t0 > timeoutMs) throw new FailError(`poll timed out: ${label}`);
    await sleep(everyMs);
  }
}

/** Drop an integration db — refuses anything outside the f2itest_ namespace. */
export async function dropItestDb(raw: MongoClient, name: string): Promise<void> {
  if (!name.startsWith(ITEST_DB_PREFIX)) {
    throw new FailError(`refusing to drop non-itest db '${name}'`);
  }
  await raw.db(name).dropDatabase();
}

export function itestDb(raw: MongoClient, name: string): Db {
  if (!name.startsWith(ITEST_DB_PREFIX)) {
    throw new FailError(`refusing raw access to non-itest db '${name}'`);
  }
  return raw.db(name);
}

/** The shared context threaded through the step modules. */
export interface Ctx {
  raw: MongoClient;
  uris: { core: string; la: string; lb: string; lc: string; dead: string };
  dbs: { core: string; la: string; lb: string; lc: string };
  colls: { orders: string; counters: string; customers: string; rollup: string; pdc: string };
  customerId: string;
  /** Cafe-day key (YYYYMMDD) of the run, read back from the first created orderId. */
  today: string;
  tomorrow: string;
  orderIdsA: string[];
  orderIdsA2: string[];
  report: Reporter;
  /** Opener-wrap tracking: every pool open (uri + the opts it was dialed with). */
  opens: Array<{ uri: string; maxPoolSize?: number }>;
  /** CMAP operational sockets created, keyed by URI. */
  sockets: Map<string, number>;
}

/** YYYYMMDD + 1 day (UTC math on the day key — no TZ dependence). */
export function nextDayKey(day: string): string {
  const d = new Date(
    Date.UTC(Number(day.slice(0, 4)), Number(day.slice(4, 6)) - 1, Number(day.slice(6, 8))),
  );
  d.setUTCDate(d.getUTCDate() + 1);
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(d.getUTCDate()).padStart(2, "0");
  return `${d.getUTCFullYear()}${mm}${dd}`;
}
