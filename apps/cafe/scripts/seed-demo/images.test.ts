/**
 * DB-free, network-free test of the demo photo pipeline (scripts/seed-demo/images.ts):
 * sharp downscale → content-addressed R2 key → presigned PUT. The fetch and the
 * R2 config are injected; the photos are generated here with sharp, so the test
 * never depends on the owner's Downloads folder.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { uploadDemoImages } from "./images";
import type { DemoProduct } from "./types";
import type { R2Config } from "@/lib/r2";
import { MAX_IMAGE_BYTES } from "@/lib/constants";

const SOURCE_W = 900;
const SOURCE_H = 700;
const MAX_EDGE = 600;
const EXPECTED_H = Math.round((SOURCE_H * MAX_EDGE) / SOURCE_W); // 467 — aspect preserved, long edge capped

const CFG: R2Config = {
  accountId: "0123456789abcdef0123456789abcdef",
  accessKeyId: "test-access-key",
  secretAccessKey: "test-secret-key",
  bucket: "demo-bucket",
  keyPrefix: "",
};

type SharpFactory = typeof import("sharp");
async function loadSharp(): Promise<SharpFactory> {
  return ((await import("sharp")) as unknown as { default: SharpFactory }).default;
}

interface RecordedPut {
  url: string;
  method: string;
  contentType: string | undefined;
  body: Uint8Array;
}

function recordingFetch(store: RecordedPut[]): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers);
    const body = init?.body instanceof Uint8Array ? init.body : new Uint8Array();
    store.push({ url: String(input), method: init?.method ?? "GET", contentType: headers.get("content-type") ?? undefined, body });
    return new Response(null, { status: 200 });
  }) as typeof fetch;
}

function product(name: string, imageFile?: string): DemoProduct {
  return { name, category: "Thick Shakes", price: 100, weight: 5, ...(imageFile ? { imageFile } : {}) };
}

test("uploadDemoImages: downscales to ≤600px webp, content-addresses the key, PUTs with the grant headers, skips a missing file", async () => {
  const sharp = await loadSharp();
  const dir = mkdtempSync(join(tmpdir(), "seed-demo-images-"));
  try {
    const png = await sharp({ create: { width: SOURCE_W, height: SOURCE_H, channels: 3, background: { r: 200, g: 40, b: 40 } } }).png().toBuffer();
    writeFileSync(join(dir, "a.png"), png);
    writeFileSync(join(dir, "b.png"), png); // identical bytes → identical key (content-addressed)

    const puts: RecordedPut[] = [];
    const logs: string[] = [];
    const result = await uploadDemoImages(
      [product("A", "a.png"), product("B", "b.png"), product("C", "missing.png"), product("No image")],
      dir,
      (line) => logs.push(line),
      { fetchImpl: recordingFetch(puts), r2: CFG },
    );

    assert.equal(result.uploaded, 2);
    assert.equal(result.skipped, 1, "the missing file is skipped, the image-less product is not counted");
    assert.equal(result.note, undefined);
    assert.ok(logs.some((l) => l.includes("WARNING") && l.includes("missing.png")), "a missing file is warned about by name");

    const refA = result.refs.get("a.png");
    const refB = result.refs.get("b.png");
    assert.ok(refA && refB);
    assert.match(refA, /^r2:products\/[0-9a-f]{32}\.webp$/);
    assert.equal(refA, refB, "same bytes → same content-addressed key");
    assert.equal(result.refs.has("missing.png"), false);

    assert.equal(puts.length, 2);
    for (const put of puts) {
      assert.equal(put.method, "PUT");
      assert.equal(put.contentType, "image/webp");
      assert.ok(put.url.includes(refA.slice("r2:".length)), "the PUT targets the key the ref points at");
      assert.ok(put.url.includes(`${CFG.accountId}.r2.cloudflarestorage.com/${CFG.bucket}/`), "the PUT goes to the cafe's own bucket");
      assert.ok(put.body.length > 0 && put.body.length <= MAX_IMAGE_BYTES);
      const meta = await sharp(Buffer.from(put.body)).metadata();
      assert.equal(meta.format, "webp");
      assert.equal(meta.width, MAX_EDGE);
      assert.equal(meta.height, EXPECTED_H);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("uploadDemoImages: no folder or no R2 → every image skipped with an explanatory note, nothing fetched", async () => {
  const puts: RecordedPut[] = [];
  const products = [product("A", "a.png"), product("B", "b.png")];

  const noDir = await uploadDemoImages(products, null, () => {}, { fetchImpl: recordingFetch(puts), r2: CFG });
  assert.equal(noDir.uploaded, 0);
  assert.equal(noDir.skipped, 2);
  assert.match(noDir.note ?? "", /no images folder/);

  const dir = mkdtempSync(join(tmpdir(), "seed-demo-images-"));
  try {
    const noR2 = await uploadDemoImages(products, dir, () => {}, { fetchImpl: recordingFetch(puts), r2: null });
    assert.equal(noR2.uploaded, 0);
    assert.equal(noR2.skipped, 2);
    assert.match(noR2.note ?? "", /R2 is not configured/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  assert.equal(puts.length, 0, "nothing is fetched when images are skipped");
});
