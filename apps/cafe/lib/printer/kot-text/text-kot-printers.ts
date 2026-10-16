import type { PrinterConfig } from "@pos/shared/print-printers";
import type { AgentPrinters } from "@/lib/print-agent-printers";
import type { Settings } from "@/types";
import { textKotRouteOf, type TextKotEnv, type TextKotRoute } from "./text-kot-print";

// Printing Phase 4 (spec 2026-10-15 §5.1): the printers the "Fast text KOTs (English only)" section lists on this device,
// each with the same key, paper and writer its kitchen slips use (text-kot-print.ts), so the text test prints where the
// slips will. In simple mode: this device's own printer. In printers mode: each printer of the setup this device writes
// that takes kitchen slips (its stations, a full copy or the notices); never one it only takes over for another device
// (spec §5.3: a failover writer prints pictures). A printer whose slips print here another way (the browser's print
// window, the Windows driver, an app before 2.0.2) is not listed; with none, the section is not shown.

export interface TextKotPrinter extends TextKotRoute {
  /** The printer's name as staff know it. */
  name: string;
}

/** The printer takes kitchen slips: its stations' KOTs, a full copy of every KOT, or the void, moved and cancel notices. */
export function printerTakesKots(printer: Pick<PrinterConfig, "slips">): boolean {
  return printer.slips.kotAll || printer.slips.kotStations.length > 0 || printer.slips.notices;
}

export interface TextKotPrintersInput {
  printers: readonly PrinterConfig[];
  agent: Pick<AgentPrinters, "printersMode" | "localIds" | "takeoverIds" | "targets">;
  settings: Settings | null | undefined;
  env: TextKotEnv;
}

export function textKotPrintersOf({ printers, agent, settings, env }: TextKotPrintersInput): TextKotPrinter[] {
  if (!agent.printersMode) {
    const route = textKotRouteOf({ printerId: undefined, target: undefined, settings, env });
    if (route === null) return [];
    return [{ ...route, name: env.desktop()?.chosen ?? env.devicePrinter().printer?.name ?? "" }];
  }
  const out: TextKotPrinter[] = [];
  for (const id of agent.localIds) {
    const printer = printers.find((entry) => entry.id === id);
    if (printer === undefined || agent.takeoverIds.includes(id) || !printerTakesKots(printer)) continue;
    const route = textKotRouteOf({ printerId: id, target: agent.targets[id], settings, env });
    if (route !== null) out.push({ ...route, name: printer.name });
  }
  return out;
}
