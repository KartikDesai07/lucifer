// scripts/go-live/dns-check.mjs — checks whether the owner's DNS records for a
// platform subdomain are live, and whether the host answers over HTTPS. Every
// lookup is deps-injected (dns/Resolver/https.request) so run.test.mjs and
// dns-check.test.mjs drive this against fakes; nothing here ever calls the
// real network in a test.
//
// Why "authoritative": a lookup made BEFORE the record existed is negatively
// cached by the machine's resolver (RFC 2308) for up to the zone's SOA minimum
// — the owner could see "not found" long after Vercel already says OK. Both
// checkRecords and probeHealth resolve straight against the apex's OWN
// nameservers, sidestepping that stale local cache.

import nodeDns from "node:dns";
import https from "node:https";

const HEALTH_PATH = "/api/health";
const DNS_MISS_CODES = new Set(["ENODATA", "ENOTFOUND"]);

/** Matches Vercel's CNAME targets: cname.vercel-dns.com, or a project-specific
 *  xxxx.vercel-dns-017.com. */
export const VERCEL_CNAME_RE = /(^|\.)vercel-dns(-\d+)?\.com$/i;

export function createDnsCheck({ dns = nodeDns.promises, Resolver = nodeDns.promises.Resolver, request = https.request, timeoutMs = 8000 } = {}) {
  /** A resolver pointed at the apex's OWN nameservers (never the machine's
   *  configured/cached resolver): NS the apex, A each NS host, use those IPs. */
  async function authoritative(apex) {
    let nsHosts;
    try {
      nsHosts = await dns.resolveNs(apex);
    } catch {
      throw new Error(`cannot find the nameservers of ${apex}`);
    }
    const ips = [];
    for (const host of nsHosts) {
      try {
        ips.push(...(await dns.resolve4(host)));
      } catch {
        /* one NS host failing to resolve is not fatal — others may still answer */
      }
    }
    if (ips.length === 0) throw new Error(`cannot find the nameservers of ${apex}`);
    const resolver = new Resolver();
    resolver.setServers(ips);
    return resolver;
  }

  async function resolveCname(resolver, host) {
    try {
      const found = await resolver.resolveCname(host);
      return found[0] ?? null;
    } catch (err) {
      if (DNS_MISS_CODES.has(err && err.code)) return null;
      throw err;
    }
  }

  /** DNS as seen by the apex's own nameservers — never the falsely-cached view. */
  async function checkRecords({ apex, host, txt }) {
    const resolver = await authoritative(apex);
    let cnameFound = null;
    let cnameError = null;
    try {
      cnameFound = await resolveCname(resolver, host);
    } catch (err) {
      cnameError = err instanceof Error ? err.message : String(err);
    }
    const cname = cnameError
      ? { found: null, ok: false, error: cnameError }
      : { found: cnameFound, ok: cnameFound !== null && VERCEL_CNAME_RE.test(String(cnameFound).replace(/\.+$/, "")) };

    let txtResult = { found: [], ok: null };
    if (txt) {
      const txtHost = txt.name === "@" ? apex : `${txt.name}.${apex}`;
      try {
        const rows = await resolver.resolveTxt(txtHost);
        const found = rows.map((chunks) => chunks.join(""));
        txtResult = { found, ok: found.includes(txt.value) };
      } catch (err) {
        if (DNS_MISS_CODES.has(err && err.code)) txtResult = { found: [], ok: false };
        else txtResult = { found: [], ok: false, error: err instanceof Error ? err.message : String(err) };
      }
    }
    return { cname, txt: txtResult };
  }

  /** GET /api/health on `host`, resolved through the AUTHORITATIVE CNAME chain
   *  (never the PC's cache) — proves DNS + TLS + routing to the right project
   *  before the owner is told to press "Check". Never throws. */
  async function probeHealth(host, apex) {
    // The apex comes from clients/_platform.json — never guessed from the host (the
    // last two labels are wrong for public suffixes such as co.in).
    if (typeof apex !== "string" || apex.length === 0) return { status: null, body: null, error: "probeHealth needs the apex domain" };
    let target = host;
    try {
      const resolver = await authoritative(apex);
      const cname = await resolveCname(resolver, host);
      target = cname ?? host;
    } catch {
      /* fall through with target === host — the caller sees the resulting error/miss */
    }
    let ips;
    try {
      ips = await dns.resolve4(target);
    } catch (err) {
      return { status: null, body: null, error: err instanceof Error ? err.message : String(err) };
    }
    if (!ips || ips.length === 0) return { status: null, body: null, error: `no A record for ${target}` };
    return new Promise((resolve) => {
      // Own timer as well as the socket `timeout` option: the socket event only fires
      // once a connection exists, and a fake `request` in tests never fires it.
      let req = null;
      const timer = setTimeout(() => { resolve({ status: null, body: null, error: `timed out after ${timeoutMs} ms` }); try { if (req) req.destroy(new Error("timed out")); } catch { /* already gone */ } }, timeoutMs);
      req = request({
        hostname: host,
        path: HEALTH_PATH,
        servername: host,
        // Node 20+ connects with `autoSelectFamily` on by default, and that path
        // calls the custom lookup with `{ all: true }` expecting an ARRAY of
        // `{ address, family }` — a bare string there surfaced as "Invalid IP
        // address: undefined" and made EVERY address read "https not ready"
        // (pending-cert) even while the site served fine. Answer both shapes
        // and pin the family selection off, so the pinned IP is what connects.
        lookup: (_h, options, cb) => (options && options.all ? cb(null, [{ address: ips[0], family: 4 }]) : cb(null, ips[0], 4)),
        autoSelectFamily: false,
        headers: { accept: "application/json" },
        timeout: timeoutMs,
      }, (res) => {
        let raw = "";
        res.on("data", (chunk) => { raw += chunk; });
        res.on("end", () => {
          let body = null;
          try { body = JSON.parse(raw); } catch { body = null; }
          clearTimeout(timer);
          resolve({ status: res.statusCode, body, error: null });
        });
      });
      req.on("timeout", () => req.destroy(new Error("timed out")));
      req.on("error", (err) => { clearTimeout(timer); resolve({ status: null, body: null, error: err instanceof Error ? err.message : String(err) }); });
      req.end();
    });
  }

  return { authoritative, checkRecords, probeHealth };
}
