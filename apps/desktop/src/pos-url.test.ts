// Native apps 2.0 (spec §9): the Windows address window reads an address exactly as the Android start screen does. One
// table of inputs, the way people type them, runs through this app's normalizePosUrl and through the Android app's own
// (apps/mobile/src/url.ts, loaded by path: it has no imports); the results must be equal. A few fixed expectations keep
// both from drifting together.
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  normalizePosUrl,
  URL_CREDENTIALS_ERROR,
  URL_EMPTY_ERROR,
  URL_HTTP_ERROR,
  URL_INVALID_ERROR,
  URL_PORT_ERROR,
  URL_SCHEME_ERROR,
  type NormalizeResult,
} from "./pos-url";

type AndroidUrl = {
  normalizePosUrl(input: string): NormalizeResult;
  URL_EMPTY_ERROR: string;
  URL_INVALID_ERROR: string;
  URL_SCHEME_ERROR: string;
  URL_HTTP_ERROR: string;
  URL_CREDENTIALS_ERROR: string;
  URL_PORT_ERROR: string;
};

const ANDROID_URL = path.join(__dirname, "..", "..", "mobile", "src", "url.ts");

async function android(): Promise<AndroidUrl> {
  return (await import(pathToFileURL(ANDROID_URL).href)) as AndroidUrl;
}

const LONG_LABEL = "a".repeat(64);
const LONG_HOST = Array.from({ length: 64 }, () => "abc").join(".") + ".in";

const INPUTS = [
  "mycafe",
  "MyCafe ",
  "  mycafe  ",
  "mycafe/pos",
  "mycafe?x=1",
  "mycafe.sandbee.in",
  "https://mycafe.sandbee.in/pos",
  "HTTPS://MyCafe.Sandbee.in",
  "http://mycafe.sandbee.in",
  "http://localhost:3000",
  "HTTP://LOCALHOST:3110",
  "http://127.0.0.1:3110",
  "http://192.168.1.20:3000",
  "http://192.168.1.20:3000/pos?x=1",
  "http://10.0.0.5",
  "http://172.16.0.1",
  "http://172.32.0.1",
  "http://8.8.8.8",
  "https://8.8.8.8",
  "1234",
  "192.168.1.20",
  "localhost",
  "https://user:pw@mycafe.sandbee.in",
  "https://mycafe.sandbee.in:0",
  "https://mycafe.sandbee.in:65536",
  "https://mycafe.sandbee.in:443",
  "https://mycafe.sandbee.in:8443",
  "mycafe.sandbee.in:8443",
  "ftp://mycafe.sandbee.in",
  "javascript:alert(1)",
  "my_cafe",
  "-mycafe",
  "mycafe-",
  LONG_LABEL,
  "https://" + LONG_HOST,
  "[::1]",
  "https://[::1]",
  "mycafé",
  "",
  "   ",
  "my\tcafe",
  "https://mycafe.sandbee.in#x",
  "mycafe.sandbee.in/",
  "https://mycafe.sandbee.in./",
  "https://pos.mycafe.example.com",
];

test("parity: every input gives the Android app's result, origin or error", async () => {
  assert.ok(INPUTS.length >= 40, "at least 40 inputs");
  assert.ok(LONG_HOST.length > 253, "the long host is over 253 characters");
  const { normalizePosUrl: onAndroid } = await android();
  for (const input of INPUTS) {
    assert.deepEqual(normalizePosUrl(input), onAndroid(input), JSON.stringify(input));
  }
});

test("the rules themselves, so both apps cannot drift together", () => {
  const ok = (origin: string): NormalizeResult => ({ ok: true, origin });
  const no = (error: string): NormalizeResult => ({ ok: false, error });
  assert.deepEqual(normalizePosUrl("MyCafe "), ok("https://mycafe.sandbee.in"));
  assert.deepEqual(normalizePosUrl("mycafe/pos"), ok("https://mycafe.sandbee.in"));
  assert.deepEqual(normalizePosUrl("http://192.168.1.20:3000"), ok("http://192.168.1.20:3000"));
  assert.deepEqual(normalizePosUrl("https://mycafe.sandbee.in:443"), ok("https://mycafe.sandbee.in"));
  assert.deepEqual(normalizePosUrl("http://8.8.8.8"), no(URL_HTTP_ERROR));
  assert.deepEqual(normalizePosUrl("1234"), no(URL_INVALID_ERROR));
  assert.deepEqual(normalizePosUrl("https://user:pw@mycafe.sandbee.in"), no(URL_CREDENTIALS_ERROR));
  assert.deepEqual(normalizePosUrl("https://mycafe.sandbee.in:65536"), no(URL_PORT_ERROR));
  assert.deepEqual(normalizePosUrl("ftp://mycafe.sandbee.in"), no(URL_SCHEME_ERROR));
  assert.deepEqual(normalizePosUrl("   "), no(URL_EMPTY_ERROR));
});

test("the error words are the Android app's, and all different", async () => {
  const a = await android();
  const ours = [URL_EMPTY_ERROR, URL_INVALID_ERROR, URL_SCHEME_ERROR, URL_HTTP_ERROR, URL_CREDENTIALS_ERROR, URL_PORT_ERROR];
  const theirs = [a.URL_EMPTY_ERROR, a.URL_INVALID_ERROR, a.URL_SCHEME_ERROR, a.URL_HTTP_ERROR, a.URL_CREDENTIALS_ERROR, a.URL_PORT_ERROR];
  assert.deepEqual(ours, theirs);
  assert.equal(new Set(ours).size, ours.length);
});
