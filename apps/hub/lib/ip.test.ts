import { test } from "node:test";
import assert from "node:assert/strict";

import { clientIp, ipInAllowlist, ipMatchesEntry } from "./ip";

// DB-free tests for the F3.4 IP allowlist (§E-3). Every malformed input must
// fail closed (match nothing), and v4/v6 families must never cross-match.

function headers(init: Record<string, string>): Headers {
  return new Headers(init);
}

test("clientIp prefers x-real-ip, then the first x-forwarded-for hop", () => {
  assert.equal(clientIp(headers({ "x-real-ip": "203.0.113.7" })), "203.0.113.7");
  assert.equal(
    clientIp(headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1, 10.0.0.2" })),
    "203.0.113.7",
  );
  // x-real-ip wins even when both present
  assert.equal(
    clientIp(headers({ "x-real-ip": "198.51.100.5", "x-forwarded-for": "203.0.113.7" })),
    "198.51.100.5",
  );
});

test("clientIp strips the IPv4-mapped IPv6 prefix and falls back to loopback", () => {
  assert.equal(clientIp(headers({ "x-real-ip": "::ffff:203.0.113.7" })), "203.0.113.7");
  assert.equal(clientIp(headers({})), "127.0.0.1");
});

test("exact IPv4 and IPv6 matches", () => {
  assert.ok(ipMatchesEntry("203.0.113.7", "203.0.113.7"));
  assert.ok(!ipMatchesEntry("203.0.113.8", "203.0.113.7"));
  assert.ok(ipMatchesEntry("2001:db8::1", "2001:db8::1"));
  assert.ok(ipMatchesEntry("2001:0db8:0000::0001", "2001:db8::1")); // canonicalization
});

test("IPv4 CIDR ranges include boundaries and exclude neighbours", () => {
  assert.ok(ipMatchesEntry("10.1.2.3", "10.0.0.0/8"));
  assert.ok(ipMatchesEntry("192.168.1.1", "192.168.1.0/24"));
  assert.ok(ipMatchesEntry("192.168.1.255", "192.168.1.0/24"));
  assert.ok(!ipMatchesEntry("192.168.2.0", "192.168.1.0/24"));
  assert.ok(ipMatchesEntry("203.0.113.7", "203.0.113.7/32"));
  assert.ok(ipMatchesEntry("8.8.8.8", "0.0.0.0/0")); // match-all
});

test("IPv6 CIDR ranges", () => {
  assert.ok(ipMatchesEntry("2001:db8:abcd:12::1", "2001:db8::/32"));
  assert.ok(!ipMatchesEntry("2001:db9::1", "2001:db8::/32"));
  assert.ok(ipMatchesEntry("2001:db8::1", "::/0"));
});

test("v4 and v6 never cross-match", () => {
  assert.ok(!ipMatchesEntry("203.0.113.7", "::/0"));
  assert.ok(!ipMatchesEntry("2001:db8::1", "0.0.0.0/0"));
  // ::ffff-mapped v4 is normalized to v4 and matches a v4 rule
  assert.ok(ipMatchesEntry("::ffff:203.0.113.7", "203.0.113.0/24"));
});

test("malformed entries and addresses fail closed", () => {
  assert.ok(!ipMatchesEntry("203.0.113.7", "203.0.113.7/33")); // prefix > 32
  assert.ok(!ipMatchesEntry("203.0.113.7", "203.0.113.7/-1"));
  assert.ok(!ipMatchesEntry("203.0.113.7", "999.0.0.1")); // octet > 255
  assert.ok(!ipMatchesEntry("203.0.113.7", "10.0.0")); // too few octets
  assert.ok(!ipMatchesEntry("203.0.113.7", "")); // empty entry
  assert.ok(!ipMatchesEntry("not-an-ip", "203.0.113.0/24"));
  assert.ok(!ipMatchesEntry("2001:db8:::1", "2001:db8::/32")); // triple colon
});

test("ipInAllowlist: empty list is never an implicit allow; any-match wins", () => {
  assert.ok(!ipInAllowlist("203.0.113.7", []));
  assert.ok(ipInAllowlist("203.0.113.7", ["10.0.0.0/8", "203.0.113.0/24"]));
  assert.ok(!ipInAllowlist("8.8.8.8", ["10.0.0.0/8", "203.0.113.0/24"]));
  // a malformed entry alongside a good one doesn't break the good one
  assert.ok(ipInAllowlist("203.0.113.7", ["garbage", "203.0.113.7"]));
});
