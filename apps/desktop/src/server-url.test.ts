// Pins for src/server-url.ts -- pure module, no electron import. The saved address itself is read by pos-url.ts (the
// Android app's rules, native apps 2.0); pos-url.test.ts pins those.
import { test } from "node:test";
import assert from "node:assert/strict";
import { START_PATH, startUrl, isSameOrigin, isExternalHttpUrl } from "./server-url";

test("startUrl: appends START_PATH to the origin", () => {
  assert.equal(START_PATH, "/pos");
  assert.equal(startUrl("https://my-pos.example.com"), "https://my-pos.example.com/pos");
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
