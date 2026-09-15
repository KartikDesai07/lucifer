// Pins for src/server-url.ts -- pure module, no electron import.
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  START_PATH,
  LOCAL_HOSTNAMES,
  URL_EMPTY_ERROR,
  URL_INVALID_ERROR,
  URL_SCHEME_ERROR,
  URL_CREDENTIALS_ERROR,
  startUrl,
  normalizeServerUrl,
  isSameOrigin,
  isExternalHttpUrl,
} from "./server-url";

test("normalizeServerUrl: https -> origin only, path/query/hash dropped", () => {
  const result = normalizeServerUrl("https://my-pos.example.com/pos?x=1#frag");
  assert.deepEqual(result, { ok: true, origin: "https://my-pos.example.com" });
});

test("normalizeServerUrl: trims surrounding whitespace", () => {
  const result = normalizeServerUrl("   https://my-pos.example.com   ");
  assert.deepEqual(result, { ok: true, origin: "https://my-pos.example.com" });
});

test("normalizeServerUrl: host is lowercased", () => {
  const result = normalizeServerUrl("https://MY-POS.EXAMPLE.COM");
  assert.deepEqual(result, { ok: true, origin: "https://my-pos.example.com" });
});

test("normalizeServerUrl: https with a default port drops the port", () => {
  const result = normalizeServerUrl("https://my-pos.example.com:443/pos");
  assert.deepEqual(result, { ok: true, origin: "https://my-pos.example.com" });
});

test("normalizeServerUrl: http localhost is ok", () => {
  const result = normalizeServerUrl("http://localhost:3000/pos");
  assert.deepEqual(result, { ok: true, origin: "http://localhost:3000" });
});

test("normalizeServerUrl: http 127.0.0.1 is ok", () => {
  const result = normalizeServerUrl("http://127.0.0.1:3000");
  assert.deepEqual(result, { ok: true, origin: "http://127.0.0.1:3000" });
});

test("normalizeServerUrl: http remote host -> URL_SCHEME_ERROR", () => {
  const result = normalizeServerUrl("http://my-pos.example.com");
  assert.deepEqual(result, { ok: false, error: URL_SCHEME_ERROR });
});

test("normalizeServerUrl: credentials in the URL -> URL_CREDENTIALS_ERROR", () => {
  const result = normalizeServerUrl("https://user:pass@my-pos.example.com");
  assert.deepEqual(result, { ok: false, error: URL_CREDENTIALS_ERROR });
});

test("normalizeServerUrl: username only (no password) -> URL_CREDENTIALS_ERROR", () => {
  const result = normalizeServerUrl("https://user@my-pos.example.com");
  assert.deepEqual(result, { ok: false, error: URL_CREDENTIALS_ERROR });
});

test("normalizeServerUrl: empty string -> URL_EMPTY_ERROR", () => {
  const result = normalizeServerUrl("");
  assert.deepEqual(result, { ok: false, error: URL_EMPTY_ERROR });
});

test("normalizeServerUrl: blank/whitespace-only -> URL_EMPTY_ERROR", () => {
  const result = normalizeServerUrl("   \t  ");
  assert.deepEqual(result, { ok: false, error: URL_EMPTY_ERROR });
});

test("normalizeServerUrl: garbage (unparseable) -> URL_INVALID_ERROR", () => {
  const result = normalizeServerUrl("not a url at all");
  assert.deepEqual(result, { ok: false, error: URL_INVALID_ERROR });
});

test("normalizeServerUrl: file: scheme is not ok", () => {
  const result = normalizeServerUrl("file:///etc/passwd");
  assert.equal(result.ok, false);
});

test("normalizeServerUrl: javascript: scheme is not ok", () => {
  const result = normalizeServerUrl("javascript:alert(1)");
  assert.equal(result.ok, false);
});

test("startUrl: appends START_PATH to the origin", () => {
  assert.equal(START_PATH, "/pos");
  assert.equal(startUrl("https://my-pos.example.com"), "https://my-pos.example.com/pos");
});

test("LOCAL_HOSTNAMES: contains exactly localhost and 127.0.0.1", () => {
  assert.deepEqual([...LOCAL_HOSTNAMES], ["localhost", "127.0.0.1"]);
});

test("isSameOrigin: identical origin -> true", () => {
  assert.equal(
    isSameOrigin("https://my-pos.example.com/pos", "https://my-pos.example.com"),
    true,
  );
});

test("isSameOrigin: different host -> false", () => {
  assert.equal(
    isSameOrigin("https://evil.example.com/pos", "https://my-pos.example.com"),
    false,
  );
});

test("isSameOrigin: different port -> false", () => {
  assert.equal(
    isSameOrigin("https://my-pos.example.com:8080/pos", "https://my-pos.example.com"),
    false,
  );
});

test("isSameOrigin: different scheme -> false", () => {
  assert.equal(
    isSameOrigin("http://my-pos.example.com/pos", "https://my-pos.example.com"),
    false,
  );
});

test("isSameOrigin: garbage url -> false, does not throw", () => {
  assert.doesNotThrow(() => {
    assert.equal(isSameOrigin("not a url", "https://my-pos.example.com"), false);
  });
});

test("isExternalHttpUrl: http -> true", () => {
  assert.equal(isExternalHttpUrl("http://example.com"), true);
});

test("isExternalHttpUrl: https -> true", () => {
  assert.equal(isExternalHttpUrl("https://example.com"), true);
});

test("isExternalHttpUrl: file: -> false", () => {
  assert.equal(isExternalHttpUrl("file:///etc/passwd"), false);
});

test("isExternalHttpUrl: javascript: -> false", () => {
  assert.equal(isExternalHttpUrl("javascript:alert(1)"), false);
});

test("isExternalHttpUrl: about: -> false", () => {
  assert.equal(isExternalHttpUrl("about:blank"), false);
});

test("isExternalHttpUrl: mailto: -> false", () => {
  assert.equal(isExternalHttpUrl("mailto:someone@example.com"), false);
});

test("isExternalHttpUrl: garbage -> false, does not throw", () => {
  assert.doesNotThrow(() => {
    assert.equal(isExternalHttpUrl("not a url"), false);
  });
});

// Landmarks so the negative pins above are vision-guarded: the error strings
// actually exist and are distinct (a stripped/blinded module would make these
// all equal or undefined).
test("landmark: the four error messages are distinct non-empty strings", () => {
  const messages = [URL_EMPTY_ERROR, URL_INVALID_ERROR, URL_SCHEME_ERROR, URL_CREDENTIALS_ERROR];
  for (const message of messages) {
    assert.equal(typeof message, "string");
    assert.ok(message.length > 0);
  }
  assert.equal(new Set(messages).size, messages.length);
});
