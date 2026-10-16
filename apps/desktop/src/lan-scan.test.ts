import { test } from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import type { NetworkInterfaceInfo } from "node:os";

import {
  LAN_SCAN_CONNECT_MS,
  LAN_SCAN_MAX_FOUND,
  LAN_SCAN_PARALLEL,
  LAN_SCAN_PORT,
  findLanPrinters,
  isVirtualAdapter,
  lanScanTargets,
  loopbackConnect,
  runLanScan,
  socketConnect,
  testLanSetting,
  type LanConnect,
} from "./lan-scan";

// Printing Phase 4 (spec 2026-10-15 §7.2): "Find network printers" on the Windows app (2.0.2). A connect-only scan of
// port 9100 on this PC's own private IPv4 networks (never a virtual adapter), only when the page asks. The interface list
// and the connector are injected here: no test ever scans a real network.

type Interfaces = NodeJS.Dict<NetworkInterfaceInfo[]>;
const v4 = (address: string, netmask = "255.255.255.0", internal = false): NetworkInterfaceInfo =>
  ({ address, netmask, family: "IPv4", internal, mac: "00:00:00:00:00:00", cidr: null }) as NetworkInterfaceInfo;
const v6 = (address: string): NetworkInterfaceInfo =>
  ({ address, netmask: "ffff:ffff:ffff:ffff::", family: "IPv6", internal: false, mac: "00:00:00:00:00:00", cidr: null, scopeid: 0 }) as NetworkInterfaceInfo;

test("a counter PC's real network is scanned; virtual adapters, link-local, public and loopback addresses are not", () => {
  const interfaces: Interfaces = {
    "vEthernet (WSL)": [v4("172.29.80.1", "255.255.240.0")],
    "VirtualBox Host-Only Network": [v4("192.168.56.1")],
    "VMware Network Adapter VMnet8": [v4("192.168.200.1")],
    Tailscale: [v4("100.101.1.2", "255.255.255.255")],
    "ZeroTier One [8056c2e21c000001]": [v4("10.147.17.5")],
    "OpenVPN Connect DCO Adapter": [v4("10.8.0.6")],
    "Ethernet 3 (TAP-Windows Adapter V9)": [v4("10.9.0.2")],
    "Loopback Pseudo-Interface 1": [v4("127.0.0.1", "255.0.0.0", true)],
    "Local Area Connection* 2": [v4("169.254.10.20", "255.255.0.0")],
    Ethernet: [v6("fe80::1"), v4("192.168.1.20")],
  };
  const plan = lanScanTargets(interfaces);
  assert.deepEqual(plan.subnets, ["192.168.1.0/24"], "only the real Ethernet network");
  assert.equal(plan.hosts.length, 253, ".1 to .254 less this PC's own address");
  assert.ok(!plan.hosts.includes("192.168.1.20"), "never its own address");
  assert.equal(plan.hosts[0], "192.168.1.1", "in address order");
});

test("each virtual adapter is recognised by its name; a real one is not", () => {
  for (const name of ["vEthernet (Default Switch)", "vEthernet (WSL (Hyper-V firewall))", "VirtualBox Host-Only Network #2", "VMware Network Adapter VMnet1", "Tailscale", "ZeroTier One [x]", "NordVPN", "TAP-Windows Adapter V9", "Hyper-V Virtual Ethernet Adapter"]) {
    assert.equal(isVirtualAdapter(name), true, `${name} is virtual`);
  }
  for (const name of ["Ethernet", "Ethernet 2", "Wi-Fi", "Wi-Fi 2", "Local Area Connection", "Realtek PCIe GbE Family Controller", "Laptop Wi-Fi"]) {
    assert.equal(isVirtualAdapter(name), false, `${name} is a real network`);
  }
});

test("192.168 networks first, at most two, each once, inside a longer prefix", () => {
  const two = lanScanTargets({ "Wi-Fi": [v4("10.0.0.5")], Ethernet: [v4("192.168.0.9")], "Ethernet 2": [v4("172.16.4.4")] });
  assert.deepEqual(two.subnets, ["192.168.0.0/24", "10.0.0.0/24"], "192.168 first; at most two");
  assert.equal(two.hosts.length, 253 + 253, "both /24s, less the own addresses");
  assert.equal(new Set(two.hosts).size, two.hosts.length, "no host twice");
  const same = lanScanTargets({ Ethernet: [v4("192.168.1.20"), v4("192.168.1.21")] });
  assert.deepEqual(same.subnets, ["192.168.1.0/24"], "one /24 once");
  assert.equal(same.hosts.length, 252, "less both own addresses");
  const small = lanScanTargets({ Ethernet: [v4("192.168.1.130", "255.255.255.192")] });
  assert.deepEqual(small.subnets, ["192.168.1.128/26"], "the network's own prefix");
  assert.equal(small.hosts.length, 61, ".129 to .190 less its own address");
  const wide = lanScanTargets({ Ethernet: [v4("172.20.31.58", "255.255.240.0")] });
  assert.deepEqual(wide.subnets, ["172.20.31.0/24"], "a /20: the /24 around the address");
});

test("the run answers the hosts that accept, sorted, at most 64, port 9100 and 500 ms each, at most 32 at once", async () => {
  let busy = 0;
  let most = 0;
  const asked = new Set<string>();
  const connect: LanConnect = async (host, port, timeoutMs) => {
    asked.add(`${port}/${timeoutMs}`);
    busy++;
    most = Math.max(most, busy);
    await new Promise((resolve) => setTimeout(resolve, 2));
    busy--;
    return Number(host.split(".")[3]) % 2 === 1;
  };
  const hosts = Array.from({ length: 200 }, (_, i) => `192.168.1.${i + 1}`).reverse();
  const found = await runLanScan(hosts, connect);
  assert.equal(found.length, LAN_SCAN_MAX_FOUND, "100 accept, at most 64 answered");
  assert.equal(found[0], "192.168.1.1", "the lowest first");
  assert.equal(found[63], "192.168.1.127", "the 64 lowest");
  assert.deepEqual([...asked], [`${LAN_SCAN_PORT}/${LAN_SCAN_CONNECT_MS}`], "port 9100, 500 ms");
  assert.ok(most <= LAN_SCAN_PARALLEL, `never more than 32 at once (saw ${most})`);
});

test("the run stops at its time limit and answers what accepted by then", async () => {
  const started = Date.now();
  const slow: LanConnect = (host) => new Promise((resolve) => setTimeout(() => resolve(true), host.endsWith(".1") ? 5 : 400));
  const found = await runLanScan(["10.0.0.1", "10.0.0.2", "10.0.0.3"], slow, { maxMs: 100 });
  assert.ok(Date.now() - started < 1_000, "answers by its limit");
  assert.deepEqual(found, ["10.0.0.1"], "only the probe done in time");
});

test("no host is probed after the time limit: a probe still out then starts no other (the 4C review's m-4)", async () => {
  let returned = false;
  let late = 0;
  const slow: LanConnect = async () => {
    if (returned) late++;
    await new Promise((resolve) => setTimeout(resolve, 200));
    return false;
  };
  const hosts = Array.from({ length: 200 }, (_, i) => `10.0.0.${i + 1}`);
  await runLanScan(hosts, slow, { maxMs: 100 });
  returned = true;
  await new Promise((resolve) => setTimeout(resolve, 500));
  assert.equal(late, 0, `no probe starts after the limit (saw ${late})`);
});

test("a probe connects, sends nothing and closes at once; a closed port is not found", async () => {
  const server = net.createServer();
  const received: number[] = [];
  const closed = new Promise<void>((resolve) => {
    server.on("connection", (socket) => {
      socket.on("data", (chunk) => received.push(chunk.length));
      socket.on("close", () => resolve());
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as net.AddressInfo).port;
  assert.equal(await socketConnect("127.0.0.1", port, LAN_SCAN_CONNECT_MS), true, "a listening port is found");
  await closed;
  assert.deepEqual(received, [], "no byte reached the printer");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  assert.equal(await socketConnect("127.0.0.1", port, LAN_SCAN_CONNECT_MS), false, "the same port closed: not found");
});

test("the answer: the printers found and the networks, or no network to look at", async () => {
  const connect: LanConnect = async (host) => host === "192.168.1.50";
  assert.deepEqual(await findLanPrinters({ interfaces: () => ({ Ethernet: [v4("192.168.1.20")] }), connect }), { found: [{ host: "192.168.1.50", port: 9100 }], subnet: "192.168.1.0/24" });
  assert.deepEqual(await findLanPrinters({ interfaces: () => ({ "vEthernet (WSL)": [v4("172.29.80.1")] }), connect }), { found: [], reason: "no-network" }, "only virtual adapters");
  assert.deepEqual(await findLanPrinters({ interfaces: () => { throw new Error("os"); }, connect }), { found: [], reason: "no-network" }, "an interface list that cannot be read");
});

test("the test-only setting: an interface list and one fake printer on this PC's loopback, nothing else", async () => {
  assert.equal(testLanSetting(undefined), null, "absent");
  assert.equal(testLanSetting("{"), null, "unreadable");
  assert.equal(testLanSetting('{"interfaces":{},"loopback":"8.8.8.8"}'), null, "a fake that is not a private address");
  const setting = testLanSetting('{"interfaces":{"Ethernet":[{"address":"192.168.77.10","netmask":"255.255.255.0","family":"IPv4","internal":false}]},"loopback":"192.168.77.50"}');
  assert.ok(setting !== null, "a test list and its fake printer");
  assert.deepEqual(lanScanTargets(setting.interfaces).subnets, ["192.168.77.0/24"], "the test list's network");
  const server = net.createServer((socket) => socket.end());
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as net.AddressInfo).port;
  let connections = 0;
  server.on("connection", () => connections++);
  const connect = loopbackConnect(setting.loopback);
  assert.equal(await connect("192.168.77.50", port, LAN_SCAN_CONNECT_MS), true, "the fake printer's address reaches the loopback");
  assert.equal(await connect("192.168.77.51", port, LAN_SCAN_CONNECT_MS), false, "any other address: no socket at all");
  assert.equal(connections, 1, "one connection, the fake's");
  await new Promise<void>((resolve) => server.close(() => resolve()));
});
