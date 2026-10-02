import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  ADDRESS_LABEL_MAX_CHARS,
  ADDRESS_MAX_CHARS,
  ADDRESS_MESSAGE,
  isValidPrinterHost,
  splitHostPort,
} from "@/lib/printer/network-address";

// W-AA: the web form must reject exactly what the POS app rejects, and split a
// pasted "host:port" into the two fields.

test("valid hosts: dotted IPv4 (each part 0-255) and DNS names, in any case", () => {
  for (const host of ["192.168.1.50", "10.0.0.1", "0.0.0.0", "255.255.255.255", "printer", "kitchen-printer.local", "Printer.LOCAL", "a", "a1.b2.c3"]) {
    assert.equal(isValidPrinterHost(host), true, host);
  }
});

test("invalid hosts: empty, bad octets, host:port, IPv6, odd characters, bad labels, too long", () => {
  const bad = [
    "", "256.1.1.1", "1.2.3", "1.2.3.4.5", "01.2.3.4", "1..2.3", "192.168.1.50:9100", "::1", "[::1]", "fe80::1",
    "printer name", "printer\\name", "-printer", "printer-", "pr_inter", "printer.", ".printer", "http://printer", "printer/x",
  ];
  for (const host of bad) assert.equal(isValidPrinterHost(host), false, JSON.stringify(host));
  assert.equal(isValidPrinterHost("a".repeat(ADDRESS_LABEL_MAX_CHARS)), true);
  assert.equal(isValidPrinterHost("a".repeat(ADDRESS_LABEL_MAX_CHARS + 1)), false, "a label over 63 characters");
  assert.equal(isValidPrinterHost(`${"a".repeat(ADDRESS_LABEL_MAX_CHARS)}.`.repeat(4).slice(0, ADDRESS_MAX_CHARS + 1)), false, "a name over 253 characters");
});

test("splitHostPort: a pasted host:port becomes two fields; anything else is left alone", () => {
  assert.deepEqual(splitHostPort("192.168.1.50:9100"), { host: "192.168.1.50", port: "9100" });
  assert.deepEqual(splitHostPort("  printer.local:515 "), { host: "printer.local", port: "515" });
  for (const text of ["192.168.1.50", "", ":9100", "192.168.1.50:", "192.168.1.50:abc", "::1", "[::1]:9100", "a:1:2", "a b:1", "host:123456"]) {
    assert.equal(splitHostPort(text), null, JSON.stringify(text));
  }
});

test("the message is plain English with an example address", () => {
  assert.equal(ADDRESS_MESSAGE, "Enter the printer's IP address, like 192.168.1.50.");
});

// ---- parity with the app (read as text, like the other cross-app pins) ----------

const REPO_ROOT = path.resolve(__dirname, "..", "..", "..", "..");
const readApp = (rel: string): string => readFileSync(path.join(REPO_ROOT, rel), "utf8").replace(/\r\n/g, "\n");

test("parity: the host rule constants equal apps/mobile/src/url.ts", () => {
  const app = readApp("apps/mobile/src/url.ts");
  const web = readApp("apps/cafe/lib/printer/network-address.ts");
  assert.ok(app.includes("export function isValidHost("), "landmark: the app rule is the one read");
  assert.ok(app.includes(`MAX_HOST_CHARS = ${ADDRESS_MAX_CHARS};`), "max host chars");
  assert.ok(app.includes(`MAX_LABEL_CHARS = ${ADDRESS_LABEL_MAX_CHARS};`), "max label chars");
  for (const regex of ["const NUMERIC_HOST = /^[0-9.]+$/;", "const LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;", "const OCTET = /^(0|[1-9]\\d{0,2})$/;"]) {
    assert.ok(app.includes(regex), `app has ${regex}`);
    assert.ok(web.includes(regex), `web has ${regex}`);
  }
  assert.ok(app.includes("host.toLowerCase()") || readApp("apps/mobile/src/bridge/validate.ts").includes("host.toLowerCase()"), "the app folds case before checking, as the web helper does");
});
