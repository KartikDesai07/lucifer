// Printing Phase 4 (spec 2026-10-15 §7.2): "Find network printers" on the counter PC. Only when the page asks
// (findLanPrinters): a TCP connect to port 9100 on each address of this PC's own private IPv4 networks, nothing sent,
// each socket closed at once. New code apart from the printing: raw-tcp.ts is not touched, and the scan never writes.
// Outgoing TCP only, so Windows Firewall asks nothing. Pure of electron, so node:test runs it with an injected interface
// list and connector (no test ever scans a real network).
import net from "node:net";
import os, { type NetworkInterfaceInfo } from "node:os";

export const LAN_SCAN_PORT = 9100;
export const LAN_SCAN_CONNECT_MS = 500;
export const LAN_SCAN_PARALLEL = 32;
export const LAN_SCAN_MAX_MS = 10_000;
export const LAN_SCAN_MAX_FOUND = 64;
export const LAN_SCAN_MAX_SUBNETS = 2;

/** The answer: the printers found and the networks looked at, or no network to look at. */
export interface LanScanAnswer {
  found: Array<{ host: string; port: typeof LAN_SCAN_PORT }>;
  subnet?: string;
  reason?: "no-network";
}

/** Asks one address whether it takes a TCP connection on `port` within `timeoutMs`. */
export type LanConnect = (host: string, port: number, timeoutMs: number) => Promise<boolean>;

type Interfaces = NodeJS.Dict<NetworkInterfaceInfo[]>;

export interface LanScanDeps {
  interfaces(): Interfaces;
  connect: LanConnect;
}

// The review's I-5: adapters that are not the cafe's network (WSL, Hyper-V, VirtualBox, VMware, VPNs, TAP, Tailscale,
// ZeroTier) can come before the real one. A VPN adapter renamed by hand is not recognised (an accepted residual: staff
// can still type the address).
const VIRTUAL_ADAPTER = /wsl|vethernet|hyper-v|virtualbox|vmware|vpn|\btap\b|tap-|tailscale|zerotier/i;

export function isVirtualAdapter(name: string): boolean {
  return VIRTUAL_ADAPTER.test(name);
}

const BITS = 32;
const SLASH_24 = 24;

function toInt(address: string): number | null {
  const parts = address.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    const octet = Number(part);
    if (!/^\d{1,3}$/.test(part) || octet > 255) return null;
    value = value * 256 + octet;
  }
  return value;
}

function dotted(value: number): string {
  return [24, 16, 8, 0].map((shift) => Math.floor(value / 2 ** shift) % 256).join(".");
}

function prefixOf(netmask: string): number | null {
  const mask = toInt(netmask);
  if (mask === null) return null;
  let prefix = 0;
  while (prefix < BITS && Math.floor(mask / 2 ** (BITS - 1 - prefix)) % 2 === 1) prefix++;
  return prefix;
}

/** 10/8, 172.16/12 and 192.168/16: the ranges a cafe's own network uses. */
function isPrivate(value: number): boolean {
  const a = Math.floor(value / 2 ** 24);
  const b = Math.floor(value / 2 ** 16) % 256;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

const isIpv4 = (entry: NetworkInterfaceInfo): boolean => entry.family === "IPv4" || (entry.family as unknown) === 4;

/**
 * The /24 around each private address of a real adapter (inside the network's own range when its prefix is longer),
 * 192.168 networks first, at most two, each once; never one of this PC's own addresses, the network's or its broadcast.
 */
export function lanScanTargets(interfaces: Interfaces): { subnets: string[]; hosts: string[] } {
  const entries: Array<{ address: number; prefix: number }> = [];
  for (const [name, list] of Object.entries(interfaces)) {
    if (list === undefined || isVirtualAdapter(name)) continue;
    for (const entry of list) {
      if (entry.internal || !isIpv4(entry)) continue;
      const address = toInt(entry.address);
      const prefix = prefixOf(entry.netmask);
      if (address === null || prefix === null || !isPrivate(address)) continue;
      entries.push({ address, prefix });
    }
  }
  const own = new Set(entries.map((entry) => entry.address));
  const ordered = [...entries].sort((x, y) => Number(Math.floor(y.address / 2 ** 16) === 0xc0a8) - Number(Math.floor(x.address / 2 ** 16) === 0xc0a8));
  const subnets: string[] = [];
  const hosts: string[] = [];
  const seen = new Set<number>();
  for (const entry of ordered) {
    if (subnets.length >= LAN_SCAN_MAX_SUBNETS) break;
    const prefix = Math.min(Math.max(entry.prefix, SLASH_24), BITS);
    const size = 2 ** (BITS - prefix);
    const base = entry.address - (entry.address % size);
    const label = `${dotted(base)}/${prefix}`;
    if (subnets.includes(label)) continue;
    subnets.push(label);
    const first = size > 2 ? 1 : 0;
    const last = size > 2 ? size - 2 : size - 1;
    for (let i = first; i <= last; i++) {
      const host = base + i;
      if (own.has(host) || seen.has(host)) continue;
      seen.add(host);
      hosts.push(dotted(host));
    }
  }
  return { subnets, hosts };
}

/** The connects: LAN_SCAN_PARALLEL at a time, all within `maxMs`; the hosts that accepted by then, sorted, at most 64. */
export async function runLanScan(hosts: readonly string[], connect: LanConnect, limits: { maxMs?: number } = {}): Promise<string[]> {
  const found: string[] = [];
  let next = 0;
  let open = true;
  const worker = async (): Promise<void> => {
    while (open && next < hosts.length) {
      const host = hosts[next++];
      if (host === undefined) break;
      let accepted = false;
      try {
        accepted = await connect(host, LAN_SCAN_PORT, LAN_SCAN_CONNECT_MS);
      } catch {
        accepted = false;
      }
      if (accepted && open) found.push(host);
    }
  };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, limits.maxMs ?? LAN_SCAN_MAX_MS);
  });
  await Promise.race([Promise.all(Array.from({ length: Math.min(LAN_SCAN_PARALLEL, hosts.length) }, worker)), deadline]);
  open = false;
  clearTimeout(timer);
  return [...found].sort((x, y) => (toInt(x) ?? 0) - (toInt(y) ?? 0)).slice(0, LAN_SCAN_MAX_FOUND);
}

/** A connect and an immediate close: no byte is sent. */
export function socketConnect(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const done = (accepted: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(accepted);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    socket.on("error", () => done(false));
    socket.connect({ host, port }, () => done(true));
  });
}

/** The scan's answer, from this PC's interfaces. */
export async function findLanPrinters(deps: LanScanDeps): Promise<LanScanAnswer> {
  let targets: { subnets: string[]; hosts: string[] };
  try {
    targets = lanScanTargets(deps.interfaces());
  } catch {
    return { found: [], reason: "no-network" };
  }
  if (targets.subnets.length === 0) return { found: [], reason: "no-network" };
  const found = await runLanScan(targets.hosts, deps.connect);
  return { found: found.map((host) => ({ host, port: LAN_SCAN_PORT })), subnet: targets.subnets.join(", ") };
}

/** The test-only setting (an unpackaged app only, read in main.ts): an interface list, and the one address that stands
 *  for a fake printer on this PC's loopback. Anything unreadable is no setting. */
export function testLanSetting(raw: string | undefined): { interfaces: Interfaces; loopback: string } | null {
  if (raw === undefined || raw === "") return null;
  try {
    const parsed = JSON.parse(raw) as { interfaces?: unknown; loopback?: unknown };
    const loopback = typeof parsed.loopback === "string" ? toInt(parsed.loopback) : null;
    if (typeof parsed.interfaces !== "object" || parsed.interfaces === null || loopback === null || !isPrivate(loopback)) return null;
    return { interfaces: parsed.interfaces as Interfaces, loopback: dotted(loopback) };
  } catch {
    return null;
  }
}

/** The test-only connector: the fake printer's address reaches this PC's loopback; any other answers no, with no socket. */
export function loopbackConnect(fakeHost: string): LanConnect {
  return (host, port, timeoutMs) => (host === fakeHost ? socketConnect("127.0.0.1", port, timeoutMs) : Promise.resolve(false));
}

/** What main.ts hands the scan: this PC's interfaces and real sockets, or (an unpackaged test build only) the setting's. */
export function lanScanDeps(setting: { interfaces: Interfaces; loopback: string } | null): LanScanDeps {
  return setting === null
    ? { interfaces: () => os.networkInterfaces(), connect: socketConnect }
    : { interfaces: () => setting.interfaces, connect: loopbackConnect(setting.loopback) };
}
