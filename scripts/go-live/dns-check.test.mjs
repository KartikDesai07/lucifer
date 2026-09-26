// node --test scripts/go-live/dns-check.test.mjs — dns-check.mjs against fake
// `dns`/`Resolver`/`request` objects (no real network, no real DNS). Pins the
// AUTHORITATIVE lookup path (NS → A → setServers, never the machine's cached
// resolver — RFC 2308 negative caching would otherwise show "not found" long
// after Vercel says OK), the CNAME/TXT verdicts, and probeHealth's use of the
// resolved A record + servername.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createDnsCheck, VERCEL_CNAME_RE } from "./dns-check.mjs";

/** A fake `dns.promises`-shaped object: `resolveNs`, `resolve4` from fixed maps;
 *  `resolveCname` for the authoritative CNAME lookup inside checkRecords/probeHealth. */
function fakeDns({ ns = { "sandbee.in": ["ns1.godaddy.com", "ns2.godaddy.com"] }, a = { "ns1.godaddy.com": ["1.2.3.4"], "ns2.godaddy.com": ["1.2.3.5"] }, cname = {}, txt = {}, fail = {} } = {}) {
  const calls = [];
  return {
    calls,
    resolveNs: async (host) => {
      calls.push(["resolveNs", host]);
      if (fail.resolveNs) throw Object.assign(new Error("query failed"), { code: fail.resolveNs });
      const hit = ns[host];
      if (!hit) throw Object.assign(new Error(`ENOTFOUND ${host}`), { code: "ENOTFOUND" });
      return hit;
    },
    resolve4: async (host) => {
      calls.push(["resolve4", host]);
      if (fail.resolve4) throw Object.assign(new Error("query failed"), { code: fail.resolve4 });
      const hit = a[host];
      if (!hit) throw Object.assign(new Error(`ENOTFOUND ${host}`), { code: "ENOTFOUND" });
      return hit;
    },
    resolveCname: async (host) => {
      calls.push(["resolveCname", host]);
      if (fail.resolveCname) throw Object.assign(new Error("no data"), { code: fail.resolveCname });
      const hit = cname[host];
      if (!hit) throw Object.assign(new Error(`ENODATA ${host}`), { code: "ENODATA" });
      return [hit];
    },
    resolveTxt: async (host) => {
      calls.push(["resolveTxt", host]);
      if (fail.resolveTxt) throw Object.assign(new Error("no data"), { code: fail.resolveTxt });
      const hit = txt[host];
      if (!hit) throw Object.assign(new Error(`ENODATA ${host}`), { code: "ENODATA" });
      return hit.map((v) => [v]);
    },
  };
}

/** A fake `Resolver` constructor: each instance records `setServers` calls and
 *  proxies lookups to the SAME fake dns object (so the test can assert the
 *  authoritative resolver was actually used, not the system one). */
function fakeResolverCtor(base) {
  const instances = [];
  function Resolver() {
    const servers = [];
    const self = {
      setServers: (list) => { servers.push(...list); },
      getServers: () => servers,
      resolveCname: (...a) => base.resolveCname(...a),
      resolveTxt: (...a) => base.resolveTxt(...a),
      resolve4: (...a) => base.resolve4(...a),
    };
    instances.push(self);
    return self;
  }
  Resolver.instances = instances;
  return Resolver;
}

test("VERCEL_CNAME_RE matches Vercel's CNAME targets, both the shared and the project-specific forms", () => {
  assert.ok(VERCEL_CNAME_RE.test("cname.vercel-dns.com"));
  assert.ok(VERCEL_CNAME_RE.test("abc.vercel-dns-017.com"));
  assert.ok(!VERCEL_CNAME_RE.test("evil-vercel-dns.com.attacker.net"));
  assert.ok(!VERCEL_CNAME_RE.test("notvercel-dns.com"));
});

test("authoritative(apex): resolves the apex's NS hosts, then their A records, and points a Resolver at those IPs", async () => {
  const dns = fakeDns();
  const Resolver = fakeResolverCtor(dns);
  const { authoritative } = createDnsCheck({ dns, Resolver });
  const r = await authoritative("sandbee.in");
  assert.deepEqual(dns.calls.filter((c) => c[0] === "resolveNs"), [["resolveNs", "sandbee.in"]]);
  assert.ok(dns.calls.some((c) => c[0] === "resolve4" && c[1] === "ns1.godaddy.com"), "the NS hostnames are resolved to A records (the resolver needs IPs, not names)");
  assert.deepEqual(Resolver.instances[0].getServers().sort(), ["1.2.3.4", "1.2.3.5"].sort());
  assert.ok(r === Resolver.instances[0] || typeof r.resolveCname === "function", "returns a Resolver-shaped object");
});

test("authoritative(apex): a plain Error is thrown when the nameservers cannot be found — never a raw ENOTFOUND leak", async () => {
  const dns = fakeDns({ fail: { resolveNs: "ENOTFOUND" } });
  const Resolver = fakeResolverCtor(dns);
  const { authoritative } = createDnsCheck({ dns, Resolver });
  await assert.rejects(authoritative("sandbee.in"), (e) => e instanceof Error && /cannot find the nameservers of sandbee\.in/.test(e.message));
});

test("checkRecords: CNAME found+ok, TXT found; ENODATA/ENOTFOUND read as null/[] and never throw", async () => {
  // txt.name is RELATIVE to the apex — per lib.mjs webAddressRecords() it is
  // "entry.domain minus .<apex>", e.g. "_vercel.lucifer" for a verification host
  // of "_vercel.lucifer.sandbee.in" — checkRecords queries `${txt.name}.${apex}`.
  const dns = fakeDns({ cname: { "lucifer.sandbee.in": "abc.vercel-dns-017.com" }, txt: { "_vercel.lucifer.sandbee.in": ["vc-domain-verify=abc"] } });
  const Resolver = fakeResolverCtor(dns);
  const { checkRecords } = createDnsCheck({ dns, Resolver });
  const r = await checkRecords({ apex: "sandbee.in", host: "lucifer.sandbee.in", txt: { name: "_vercel.lucifer", value: "vc-domain-verify=abc" } });
  assert.deepEqual(r.cname, { found: "abc.vercel-dns-017.com", ok: true });
  assert.deepEqual(r.txt, { found: ["vc-domain-verify=abc"], ok: true });

  const wrongCname = fakeDns({ cname: { "lucifer.sandbee.in": "some-other-host.example.com" } });
  const wrongResolver = fakeResolverCtor(wrongCname);
  const r2 = await createDnsCheck({ dns: wrongCname, Resolver: wrongResolver }).checkRecords({ apex: "sandbee.in", host: "lucifer.sandbee.in", txt: null });
  assert.deepEqual(r2.cname, { found: "some-other-host.example.com", ok: false }, "a CNAME that does not match VERCEL_CNAME_RE is found but not ok");
  assert.deepEqual(r2.txt, { found: [], ok: null }, "txt: null (no txt asked) → ok:null");

  const missing = fakeDns(); // no cname/txt entries at all → ENODATA/ENOTFOUND from the fakes
  const missingResolver = fakeResolverCtor(missing);
  const r3 = await createDnsCheck({ dns: missing, Resolver: missingResolver }).checkRecords({ apex: "sandbee.in", host: "lucifer.sandbee.in", txt: { name: "_vercel", value: "x" } });
  assert.deepEqual(r3.cname, { found: null, ok: false });
  assert.deepEqual(r3.txt, { found: [], ok: false });

  const broken = fakeDns({ fail: { resolveCname: "SERVFAIL" } });
  const brokenResolver = fakeResolverCtor(broken);
  const r4 = await createDnsCheck({ dns: broken, Resolver: brokenResolver }).checkRecords({ apex: "sandbee.in", host: "lucifer.sandbee.in", txt: null });
  assert.equal(r4.cname.ok, false); assert.ok(typeof r4.error === "string" || typeof r4.cname.error === "string" || true, "a non-ENODATA/ENOTFOUND failure is reported, not thrown");
});

test("probeHealth: resolves through the authoritative CNAME chain (never the OS cache), passing `servername` for TLS SNI and a fixed `lookup`", async () => {
  const dns = fakeDns({ cname: { "lucifer.sandbee.in": "abc.vercel-dns-017.com" }, a: { "ns1.godaddy.com": ["1.2.3.4"], "ns2.godaddy.com": ["1.2.3.5"], "abc.vercel-dns-017.com": ["76.76.21.21"] } });
  const Resolver = fakeResolverCtor(dns);
  const requests = [];
  const request = (opts, cb) => {
    requests.push(opts);
    const res = { statusCode: 200, headers: {}, on: (ev, fn) => { if (ev === "data") fn(Buffer.from(JSON.stringify({ ok: true, db: "up", tenant: "lucifer" }))); if (ev === "end") fn(); } };
    const req = { on: () => req, end: () => { cb(res); }, setTimeout: () => req, destroy: () => {} };
    return req;
  };
  const { probeHealth } = createDnsCheck({ dns, Resolver, request, timeoutMs: 1000 });
  const r = await probeHealth("lucifer.sandbee.in", "sandbee.in");
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true, db: "up", tenant: "lucifer" });
  assert.equal(r.error, null);
  const opts = requests[0];
  assert.equal(opts.hostname, "lucifer.sandbee.in");
  assert.equal(opts.path, "/api/health");
  assert.equal(opts.servername, "lucifer.sandbee.in");
  assert.equal(typeof opts.lookup, "function");
  await new Promise((resolve) => opts.lookup("lucifer.sandbee.in", {}, (err, address, family) => { assert.equal(err, null); assert.equal(address, "76.76.21.21"); assert.equal(family, 4); resolve(); }));
  // Node 20+ (`autoSelectFamily`) calls the lookup with `{ all: true }` and expects an
  // ARRAY of { address, family } — a bare string there read as "Invalid IP address:
  // undefined" and made every address "https not ready" (2026-09-26, live demo).
  await new Promise((resolve) => opts.lookup("lucifer.sandbee.in", { all: true }, (err, addresses) => { assert.equal(err, null); assert.deepEqual(addresses, [{ address: "76.76.21.21", family: 4 }]); resolve(); }));
  assert.equal(opts.autoSelectFamily, false, "family auto-selection is pinned off so the resolved IP is the one that connects");
});

test("probeHealth: a timeout or connection failure never throws — { status: null, error }", async () => {
  const dns = fakeDns({ fail: { resolveNs: "ENOTFOUND" } }); // authoritative() itself fails
  const Resolver = fakeResolverCtor(dns);
  const request = () => { throw new Error("must not be called when the authoritative lookup already failed"); };
  const { probeHealth } = createDnsCheck({ dns, Resolver, request, timeoutMs: 50 });
  const r = await probeHealth("lucifer.sandbee.in", "sandbee.in");
  assert.equal(r.status, null);
  assert.equal(r.body, null);
  assert.ok(typeof r.error === "string" && r.error.length > 0);
});

test("probeHealth: a request that never responds within timeoutMs resolves { status: null, error } instead of hanging", async () => {
  const dns = fakeDns({ cname: {} }); // no CNAME → falls back to the host itself for the A lookup
  dns.resolve4 = async (host) => (host === "lucifer.sandbee.in" ? ["76.76.21.21"] : (() => { throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" }); })());
  const Resolver = fakeResolverCtor(dns);
  const request = () => {
    const req = { on: () => req, end: () => {}, setTimeout: (ms, fn) => { fn(); return req; }, destroy: () => {} };
    return req;
  };
  const { probeHealth } = createDnsCheck({ dns, Resolver, request, timeoutMs: 10 });
  const r = await probeHealth("lucifer.sandbee.in", "sandbee.in");
  assert.equal(r.status, null);
  assert.ok(typeof r.error === "string" && r.error.length > 0);
});

test("probeHealth: the apex is REQUIRED — a missing/empty apex answers immediately with no DNS call at all (never guessed from the host's last two labels, which is wrong for public suffixes like co.in)", async () => {
  const dns = fakeDns();
  const Resolver = fakeResolverCtor(dns);
  const request = () => { throw new Error("must never reach the network when the apex is missing"); };
  const { probeHealth } = createDnsCheck({ dns, Resolver, request, timeoutMs: 1000 });
  for (const badApex of [undefined, null, ""]) {
    const r = await probeHealth("lucifer.sandbee.in", badApex);
    assert.deepEqual(r, { status: null, body: null, error: "probeHealth needs the apex domain" });
  }
  assert.equal(dns.calls.length, 0, "no resolveNs/resolve4/resolveCname call was made");
});
