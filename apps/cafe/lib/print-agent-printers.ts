import { PRINT_JOBS_FOR_ME_LIMIT, type LeasedPrintJob, type PrintJobsForMe } from "@pos/shared/print-agent-wire";
import { PRINTER_PROBLEMS, printerHealthProblem, type PrinterCoverState, type PrinterPaperState, type PrinterProblem } from "@pos/shared/print-failover";
import { printerWriterDeviceId, printersModeOn, routablePrinters, type PrinterConfig } from "@pos/shared/print-printers";
import type { PrintAgentResult } from "@/lib/print-agent-types";
import type { SlipPrintTarget } from "@/lib/print-host-slips";
import { PrintWriteError, printWriteOutcomeOf } from "@/lib/print-write-outcome";
import type { DevicePrinter } from "@/lib/printer/device-printer-store";
import type { PrinterDotPrinters } from "@/lib/printer/printer-dot";
import type { PrinterStatus } from "@/lib/printer/web-printer-types";

// Printing redesign, Phase 2 Session 2C (spec §9.3, plan decision 1): the printers this device writes, and which of
// them it prints here. Session 2E (spec §9.2): a phone, a tablet or a browser tab prints one printer, its own; the
// Windows app prints each Windows printer it has, by name. Pure and client-safe; hooks/use-agent-printers.ts reads it
// on every printers read and every change of this device's printer. Session 2F1 (spec §9.2): the POS app on bridge v2
// prints each of its printers (nativePool()), by the app's id.

/** The refusal a leased job gets when its printer is not this device's printer (sent:"no", never counted). */
export const PRINTER_NOT_LOCAL_MESSAGE = "This printer is not connected to this device.";
/** The 2E gate's review (I-3), and the 2F2 review gate (M-4) for this device's own printer: what the printer panel
 *  shows instead of Remove for a printer the setup prints through this device. */
export const PRINTER_IN_SETUP_MESSAGE = "Printer setup prints slips here: to remove it, change or delete that printer in Printer setup first.";
/** Session 3B (spec §9.3): what Other printers shows instead of Remove for a network printer this device may take over. */
export const PRINTER_TAKEOVER_MESSAGE = "This device prints it while the device that prints it is offline or cannot reach it. To remove it, change or delete that printer in Printer setup.";

/** Session 2E (spec §9.2): the Windows app's printers. `named`: the app prints a slip on a printer the page names
 *  (desktopPrintsOnNamed); `names`: every printer Windows reports on this PC (null until read); `selected`: the one
 *  chosen in its picker. null for any other device. */
export interface DesktopPrinters {
  selected: string | null;
  names: readonly string[] | null;
  named: boolean;
}

/** Session 2F1 (spec §9.2): the POS app's printers on bridge v2 (nativePool()): each one's id and state. null on any
 *  other device, and on an app that speaks only v1 (the release APK), which prints its one printer as before. */
export interface NativePoolView {
  printers: readonly { id: string; status: PrinterStatus; paper?: PrinterPaperState; cover?: PrinterCoverState; error?: true; printer?: { name: string } }[];
  /** Session 3C (the 3B golden-copy review's m-7): the app's default printer, the one simple mode prints on. */
  defaultId?: string | null;
}

/** Session 2F1: the app's id a printer of the setup is, among the app's printers on bridge v2, or null. A LAN printer is
 *  "tcp:<host>:<port>"; a Bluetooth, BLE or USB printer "<transport>:<address>" (its address the bare id or the app's
 *  whole id, I-1 of 2C's final review), compared ignoring case (the app spells a MAC upper-case, the 2C gate's F-2). */
export function nativeIdOf(printer: Pick<PrinterConfig, "connection">, pool: NativePoolView | null): string | null {
  if (pool === null) return null;
  const connection = printer.connection;
  let wanted: string[];
  if (connection.kind === "lan") wanted = [`tcp:${connection.host}:${connection.port}`.toLowerCase()];
  else if (connection.transport === "bt-classic" || connection.transport === "ble" || connection.transport === "usb") {
    const address = connection.address.toLowerCase();
    wanted = [`${connection.transport}:${address}`, address];
  } else return null;
  return pool.printers.find((entry) => wanted.includes(entry.id.toLowerCase()))?.id ?? null;
}

/** A printer this device writes is printed here only when it IS one of this device's printers: a LAN printer whose
 *  host:port is the app's selected network printer, a device printer whose transport and address match the
 *  saved one, a Windows printer this PC has. Anything else would put a bar's slips on the kitchen's paper. Session
 *  2F1: on bridge v2, any of the app's printers, and only those: the app's list is the record of this device's printers
 *  (a stale device printer record never makes one local; the 2E gate's review, I-2). */
export function printerIsLocal(printer: PrinterConfig, local: DevicePrinter | null, desktop: DesktopPrinters | null, pool: NativePoolView | null = null): boolean {
  if (pool !== null) return nativeIdOf(printer, pool) !== null;
  const connection = printer.connection;
  if (connection.kind === "lan") {
    // Ignoring case (the 2D gate's note): the server lower-cases the host, and so does the app; a hand-typed one may not.
    return local?.kind === "native" && local.transport === "tcp" && local.printerId.toLowerCase() === `tcp:${connection.host}:${connection.port}`.toLowerCase();
  }
  switch (connection.transport) {
    case "windows":
      // Session 2E: by name (saved from this PC's own list, never typed). An app that prints on a named printer prints
      // any printer Windows reports here; an older one prints only its chosen printer, so another Windows printer is
      // never printed on that paper (the 2C gate's F-3): its slips wait, and the dot says so.
      if (desktop === null) return false;
      return desktop.named ? (desktop.names ?? []).includes(connection.address) : desktop.selected === connection.address;
    case "bt-classic":
    case "ble":
    case "usb": {
      // The app names its printer "<transport>:<id>" (Kotlin PrinterIds: "bt-classic:<MAC>", "ble:<MAC>",
      // "usb:<vendor>:<product>"); the setup's address is the bare id (§6.3), or the app's whole id as it reported
      // it (Session 2C's final review, I-1). Ignoring case (the 2C review gate, F-2): the app spells a MAC
      // upper-case and a USB id lower-case, and an address typed by hand may not.
      if (local?.kind !== "native" || local.transport !== connection.transport) return false;
      const id = local.printerId.toLowerCase();
      const address = connection.address.toLowerCase();
      return id === `${connection.transport}:${address}` || id === address;
    }
    case "web-bluetooth":
      return local?.kind === "ble" && local.deviceId === connection.address;
    case "web-serial":
      // A Chrome tab drives at most one serial printer (spec §9.7), which has no stable address.
      return local?.kind === "serial";
  }
}

export interface AgentPrinters {
  /** An enabled printer takes a slip (spec §6.6): every slip is routed to printers. */
  printersMode: boolean;
  /** This device writes a routable printer: it drains and polls the wake in printers mode, host or not. */
  isWriter: boolean;
  /** The routable printers this device writes that ARE its local printers: the lines it leases and prints. */
  localIds: string[];
  /** Session 3B (spec §9.3): those of them that are network printers (a refusal before any byte is "unreachable"). */
  lanIds: string[];
  /** Session 3B (spec §9.3): those of them it may take over (another device writes them by the setup; on bridge v2). */
  takeoverIds: string[];
  /** Session 3C (the 3B review's m-1): the network printers it may take over that its app does not list (yet): its beat
   *  says it cannot print them (lib/print-agent-health.ts), so the server never picks it for one of them. */
  takeoverMissingIds: string[];
  /** Session 2E: each of them that prints on a named Windows printer, by id: its name and its paper. Session 2F1: each
   *  that is one of the POS app's printers on bridge v2: the app's id and its paper. */
  targets: Record<string, SlipPrintTarget>;
}

function printersWrittenBy(printers: readonly PrinterConfig[], deviceId: string): PrinterConfig[] {
  return deviceId === "" ? [] : routablePrinters(printers).filter((printer) => printerWriterDeviceId(printer) === deviceId);
}

/** Session 3B (spec §9.3): the network printers a POS app on bridge v2 (it says lanFailover) may take over: every
 *  routable one the setup names another device for. The page adds each to the app ahead of time (a local call, no
 *  request; the app probes a down one every 30 s), so its link is known before any takeover, it is named in a lease only
 *  while the app reaches it, and a takeover prints at once. The server grants its line only while this device writes it
 *  now (printerActiveWriter); it never makes this device a writer by the setup. */
export function takeoverPrintersOf(printers: readonly PrinterConfig[], deviceId: string, pool: NativePoolView | null): PrinterConfig[] {
  // The gate's emulator pre-run (E-1): only a device that writes a printer by the setup (P3-2: it polls the wake, so it
  // can be online for one); a device that writes nothing never adds another device's printers to its app.
  if (pool === null || printersWrittenBy(printers, deviceId).length === 0) return [];
  return routablePrinters(printers).filter((printer) => printer.connection.kind === "lan" && printerWriterDeviceId(printer) !== deviceId);
}

/** Session 2E: a Windows printer this PC prints by name (only on an app that can), drawn for its own paper. Session
 *  2F1: one of the POS app's printers on bridge v2, by the app's id, drawn for its own paper. */
function targetsOf(printers: readonly PrinterConfig[], desktop: DesktopPrinters | null, pool: NativePoolView | null): Record<string, SlipPrintTarget> {
  const targets: Record<string, SlipPrintTarget> = {};
  for (const printer of printers) {
    const nativeId = nativeIdOf(printer, pool);
    if (nativeId !== null) targets[printer.id] = { nativeId, paper: `${printer.paper}mm` };
    else if (desktop?.named === true && printer.connection.kind === "device" && printer.connection.transport === "windows") {
      targets[printer.id] = { printerName: printer.connection.address, paper: `${printer.paper}mm` };
    }
  }
  return targets;
}

export function agentPrintersOf(printers: readonly PrinterConfig[], deviceId: string, local: DevicePrinter | null, desktop: DesktopPrinters | null, pool: NativePoolView | null = null): AgentPrinters {
  const mine = printersWrittenBy(printers, deviceId);
  // Session 3B: a network printer it may take over prints here once the app has it.
  const candidates = takeoverPrintersOf(printers, deviceId, pool);
  const takeover = candidates.filter((printer) => nativeIdOf(printer, pool) !== null);
  const here = [...mine.filter((printer) => printerIsLocal(printer, local, desktop, pool)), ...takeover];
  return {
    printersMode: printersModeOn(printers),
    isWriter: mine.length > 0,
    localIds: here.map((printer) => printer.id),
    lanIds: here.filter((printer) => printer.connection.kind === "lan").map((printer) => printer.id),
    takeoverIds: takeover.map((printer) => printer.id),
    takeoverMissingIds: candidates.filter((printer) => nativeIdOf(printer, pool) === null).map((printer) => printer.id),
    targets: targetsOf(here, desktop, pool),
  };
}

/** Session 2F1 (spec §9.2): of the printers this device prints here, those that can print right now: one of the POS
 *  app's printers (bridge v2) by its own state; any other (a Windows printer, the one printer of every other device)
 *  when this device's own printer can print (canPrintNow), as before. Session 3C (spec §10): not one the app says cannot
 *  print (`cannotPrint`: out of paper, cover open, an error), so its slips wait with no lease or ack until it can. */
export function readyPrinterIdsOf(
  localIds: readonly string[],
  targets: Record<string, SlipPrintTarget>,
  canPrint: boolean,
  statusOf: (nativeId: string) => PrinterStatus,
  cannotPrint: (nativeId: string) => boolean = () => false,
): string[] {
  return localIds.filter((id) => {
    const nativeId = targets[id]?.nativeId;
    return nativeId === undefined ? canPrint : statusOf(nativeId) === "connected" && !cannotPrint(nativeId);
  });
}

const STATUS_WORSE: readonly PrinterStatus[] = ["connected", "connecting", "needs-tap", "elsewhere", "disconnected", "none"];
/** Session 3B (spec §10): what turns the dot red although every printer answers. Low paper still prints. */
const DOT_PROBLEMS: readonly PrinterProblem[] = ["paper-out", "cover-open", "error"];

/** Session 2D (spec §10): what the top-bar dot needs: printers mode, whether this device writes a printer, and
 *  whether it prints every printer it writes (a printer it writes that is not its own never prints here). Session
 *  2F1: on bridge v2, the worst state among the app's printers it prints. Session 3B: a printer it may take over counts
 *  only while the wake says it writes it now (`takenOver`). */
export function dotPrintersOf(
  printers: readonly PrinterConfig[],
  deviceId: string,
  local: DevicePrinter | null,
  desktop: DesktopPrinters | null,
  pool: NativePoolView | null = null,
  takenOver: readonly string[] = [],
): PrinterDotPrinters {
  const agent = agentPrintersOf(printers, deviceId, local, desktop, pool);
  const counted = Object.entries(agent.targets).filter(([id]) => !agent.takeoverIds.includes(id) || takenOver.includes(id));
  const states = counted.flatMap(([, target]) => pool?.printers.filter((entry) => entry.id === target.nativeId).map((entry) => entry.status) ?? []);
  const worst = states.reduce<PrinterStatus | undefined>((acc, status) => (acc === undefined || STATUS_WORSE.indexOf(status) > STATUS_WORSE.indexOf(acc) ? status : acc), undefined);
  // Session 3B (spec §10): the worst paper, cover or error the app says of a printer it counts, by that printer's name.
  const problems = counted.flatMap(([id, target]) => {
    const entry = pool?.printers.find((candidate) => candidate.id === target.nativeId);
    const problem = entry === undefined ? null : printerHealthProblem({ link: "connected", paper: entry.paper, cover: entry.cover, error: entry.error });
    const name = printers.find((printer) => printer.id === id)?.name;
    return problem !== null && DOT_PROBLEMS.includes(problem) && name !== undefined ? [{ name, problem }] : [];
  });
  // Session 3C (the 3B golden-copy review's m-7): in simple mode this device prints on its POS app's own printer (the
  // app's default), so that printer's paper, cover or error turns the dot red too, by the app's name for it.
  const own = agent.printersMode ? undefined : pool?.printers.find((entry) => entry.id === pool.defaultId);
  const ownProblem = own === undefined ? null : printerHealthProblem({ link: "connected", paper: own.paper, cover: own.cover, error: own.error });
  if (own !== undefined && ownProblem !== null && DOT_PROBLEMS.includes(ownProblem)) problems.push({ name: own.printer?.name ?? "The printer", problem: ownProblem });
  const problem = problems.sort((a, b) => PRINTER_PROBLEMS.indexOf(a.problem) - PRINTER_PROBLEMS.indexOf(b.problem))[0];
  return {
    printersMode: agent.printersMode,
    isWriter: agent.isWriter,
    allLocal: agent.localIds.filter((id) => !agent.takeoverIds.includes(id)).length === printersWrittenBy(printers, deviceId).length,
    ...(worst !== undefined ? { worst } : {}),
    ...(problem !== undefined ? { problem } : {}),
  };
}

/** Session 2F1 (spec §9.2): the network printers this device writes that the POS app (bridge v2) does not have yet: it
 *  adds each (a local call to the app, no request), so naming a tablet a network printer's printing device is enough.
 *  Session 3B: then every network printer it may take over, ahead of time (takeoverPrintersOf). */
export function lanPrintersToAdd(printers: readonly PrinterConfig[], deviceId: string, pool: NativePoolView | null): Array<{ host: string; port: number }> {
  if (pool === null) return [];
  const out: Array<{ host: string; port: number }> = [];
  for (const printer of printersWrittenBy(printers, deviceId)) {
    const connection = printer.connection;
    if (connection.kind === "lan" && nativeIdOf(printer, pool) === null) out.push({ host: connection.host.toLowerCase(), port: connection.port });
  }
  // The gate's emulator pre-run (E-1): never into an app with no printer (the first printer of an empty app becomes its
  // default, this device's own printer: never another device's). Session 3C (the 3B gate review's m-A): its own goes in
  // alone, and the ones it may take over follow once the app lists it, so a refused select of its own lets none in first.
  if (pool.printers.length === 0) return out;
  for (const printer of takeoverPrintersOf(printers, deviceId, pool)) {
    const connection = printer.connection;
    if (connection.kind === "lan" && nativeIdOf(printer, pool) === null) out.push({ host: connection.host.toLowerCase(), port: connection.port });
  }
  return out;
}

/** The 2F2 review gate (m-3): network printers the page added to the POS app by itself (`added`: the app's ids it
 *  recorded when lanPrintersToAdd asked for them) that no printer of the setup this device writes names any more
 *  (deleted, re-addressed, moved to another device, switched off): removed again, so the app stops probing them every
 *  30 s and its notification never names a printer nothing prints on. Never one staff added (it was not recorded), and
 *  never the app's default (this device's own printer prints the slips no printer of the setup takes). `record`: what
 *  stays recorded, the ids the setup still names (added, or being added), the app's default, and one asked to go that
 *  the app still lists (the final Phase 2 gate, m-4: a removal that failed or timed out is asked again next time).
 *  Session 3B: a network printer it may take over is still named (it stays), and one a job is being written to now
 *  (`writing`, the app's ids) waits until that print is done (the final Phase 2 gate, (a) item 4). */
export function lanPrintersToRemove(
  printers: readonly PrinterConfig[],
  deviceId: string,
  pool: NativePoolView | null,
  defaultId: string | null,
  added: readonly string[],
  writing: readonly string[] = [],
): { remove: string[]; record: string[] } {
  if (pool === null) return { remove: [], record: [...added] };
  const named = [...printersWrittenBy(printers, deviceId), ...takeoverPrintersOf(printers, deviceId, pool)];
  const wanted = new Set(named.flatMap((printer) => (printer.connection.kind === "lan" ? [`tcp:${printer.connection.host}:${printer.connection.port}`.toLowerCase()] : [])));
  const recorded = new Set(added.map((id) => id.toLowerCase()));
  const listed = new Set(pool.printers.map((entry) => entry.id.toLowerCase()));
  const busy = new Set(writing.map((id) => id.toLowerCase()));
  const own = defaultId?.toLowerCase() ?? null;
  return {
    remove: pool.printers
      .filter((entry) => entry.id.toLowerCase() !== own && recorded.has(entry.id.toLowerCase()) && !wanted.has(entry.id.toLowerCase()) && !busy.has(entry.id.toLowerCase()))
      .map((entry) => entry.id),
    record: added.filter((id) => wanted.has(id.toLowerCase()) || id.toLowerCase() === own || listed.has(id.toLowerCase())),
  };
}

/** The 2F2 review gate (M-4): this device's own printer (the POS app's default on bridge v2; the one printer of any
 *  other device) is a printer the setup prints through this device. The panel then offers no Remove for it, and on
 *  bridge v2 its Change printer keeps it in the app, so a setup printer never leaves the app from the page (and the
 *  network printers the page adds by itself are never re-added after a staff action: the 2E gate's I-3). */
export function ownPrinterInSetup(printers: readonly PrinterConfig[], deviceId: string, local: DevicePrinter | null, pool: NativePoolView | null, defaultId: string | null): boolean {
  const agent = agentPrintersOf(printers, deviceId, local, null, pool);
  if (pool !== null) return defaultId !== null && Object.values(agent.targets).some((target) => target.nativeId === defaultId);
  return agent.localIds.length > 0;
}

/** Session 2C (the 2C gate's review, I-2, and its emulator run): the device's printer list is stale when a missed
 *  print-setup frame left it behind the setup. Either a printer job aimed at it is on a printer it does not print
 *  on (it was just made that printer's writer), or the wake says the setup no longer names a writer it believes
 *  it is (its printer removed or moved). A host in simple mode is not a writer, so the wake's false means nothing. */
export function printerListLooksStale(input: {
  ready: readonly string[];
  isWriter: boolean;
  jobsForMe?: PrintJobsForMe;
  writesPrinters?: boolean;
}): boolean {
  if (input.jobsForMe?.printerIds?.some((id) => !input.ready.includes(id)) === true) return true;
  return input.isWriter && input.writesPrinters === false;
}

/** Session 2C's final review (I-2): jobs-for-me counts every job aimed at the device, including ones on a printer
 *  it does not print on (a second printer it writes, before Session 2E; a printer whose address is not its own),
 *  which its lease never names. A kick on those leased nothing on every pulse and every wake, and kept the wake's
 *  fast cadence: only its own line's jobs, or a printer it prints here, kick it. A printer it does not know of yet
 *  is read again by printerListLooksStale; the new list nudges the agent. */
export function jobsForMeLeasable(jobs: PrintJobsForMe | undefined, ready: readonly string[]): boolean {
  if (jobs === undefined || jobs.count === 0) return false;
  if (jobs.printerIds === undefined || jobs.ownLine === true) return true;
  // A full answer names only the oldest jobs: one it can lease may wait behind them (the 2C review gate, F-1).
  if (jobs.count >= PRINT_JOBS_FOR_ME_LIMIT) return true;
  return jobs.printerIds.some((id) => ready.includes(id));
}

/** One leased job on this device (spec §6.3 copies, plan decision 2): a printer job is refused (sent:"no", never
 *  counted) when its printer is not this device's printer; otherwise every copy is written in its one lease, one
 *  after another. A failure after the first copy may already have put paper out, so it is "maybe" (the REPRINT
 *  repeats every copy, labelled). A job of the device's own simple-mode line prints once, as today. */
export async function printJobCopies(
  job: Pick<LeasedPrintJob, "printerId" | "copies">,
  localIds: readonly string[],
  printOnce: () => Promise<PrintAgentResult>,
): Promise<PrintAgentResult> {
  if (job.printerId !== undefined && !localIds.includes(job.printerId)) return { ok: false, error: new PrintWriteError(PRINTER_NOT_LOCAL_MESSAGE, "no") };
  const copies = job.copies ?? 1;
  for (let copy = 1; copy <= copies; copy++) {
    const result = await printOnce();
    if (!result.ok) return copy === 1 ? result : { ok: false, error: new PrintWriteError(printWriteOutcomeOf(result.error).message, "maybe") };
  }
  return { ok: true };
}
