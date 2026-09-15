/**
 * Upload the demo menu's reference photos into the cafe's own R2 bucket.
 * Mirrors the browser uploader's downscale (≤600px, webp quality 82) with
 * `sharp` so the seeded product images are the same shape live uploads
 * produce. Never logs a presigned URL — it carries the PUT signature.
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import { MAX_IMAGE_BYTES } from "@/lib/constants";
import { r2Config, presignProductImagePut, type R2Config } from "@/lib/r2";
import { r2Ref, productImageUrl } from "@/lib/images";
import type { DemoProduct } from "./types";

// Mirrors the browser canvas-downscale (CLAUDE.md images rule): ≤600px on the
// long edge, webp quality 82.
const DEMO_IMAGE_MAX_PX = 600;
const DEMO_IMAGE_WEBP_QUALITY = 82;

// Small pool — enough to overlap network latency without hammering R2's free
// tier or the local disk reads.
const UPLOAD_CONCURRENCY = 4;

// content-addressed key suffix length — re-seeding the same photo overwrites
// the same object key instead of leaving an orphan behind each run.
const HEX_SLICE_LEN = 32;

export interface UploadDemoImagesResult {
  refs: Map<string, string>; // imageFile -> stored ref ("r2:products/<hex>.webp")
  uploaded: number;
  skipped: number;
  note?: string;
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    const info = await stat(path);
    return info.isDirectory();
  } catch {
    return false;
  }
}

// Bounded-concurrency map — small hand-rolled pool rather than a dependency
// (house rule: no new deps for this slice).
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  async function run(): Promise<void> {
    for (;;) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return results;
}

/** Injection seams for the DB-free unit test: a recording fetch and a fixed R2 config. */
export interface UploadDemoImagesDeps {
  fetchImpl?: typeof fetch;
  // `undefined` → read R2_* from the environment; `null` → behave as unconfigured.
  r2?: R2Config | null;
}

async function uploadOne(
  product: DemoProduct,
  imagesDir: string,
  cfg: R2Config,
  log: (line: string) => void,
  fetchImpl: typeof fetch,
): Promise<{ imageFile: string; ref: string } | null> {
  const imageFile = product.imageFile;
  if (!imageFile) return null;

  const filePath = join(imagesDir, imageFile);
  let bytes: Buffer;
  try {
    bytes = await readFile(filePath);
  } catch {
    log(`WARNING: image file not found, skipping: "${imageFile}"`);
    return null;
  }

  // Imported dynamically: sharp resolves from the hoisted root node_modules
  // (installed for Next's image pipeline), not this workspace's own deps.
  // sharp's types are a CJS `export =` (no `.default` member) — the dynamic
  // import's namespace object IS the callable factory at runtime under
  // esModuleInterop, so it is cast through the module's own type instead.
  let sharpFactory: typeof import("sharp");
  try {
    sharpFactory = ((await import("sharp")) as unknown as { default: typeof import("sharp") }).default;
  } catch {
    throw new Error("sharp is not installed — run npm install at the repo root");
  }

  const resized = await sharpFactory(bytes)
    .rotate()
    .resize({ width: DEMO_IMAGE_MAX_PX, height: DEMO_IMAGE_MAX_PX, fit: "inside", withoutEnlargement: true })
    .webp({ quality: DEMO_IMAGE_WEBP_QUALITY })
    .toBuffer();

  if (resized.length > MAX_IMAGE_BYTES) {
    throw new Error(`Resized image for "${imageFile}" exceeds the ${MAX_IMAGE_BYTES} byte limit`);
  }

  const randomHex = createHash("sha256").update(resized).digest("hex").slice(0, HEX_SLICE_LEN);
  const grant = await presignProductImagePut("image/webp", resized.length, cfg, { randomHex });

  // Node's fetch (undici) accepts a Buffer body at runtime; the DOM lib's
  // BodyInit type just doesn't declare it — Uint8Array is in that union.
  const res = await fetchImpl(grant.uploadUrl, { method: "PUT", headers: grant.headers, body: new Uint8Array(resized) });
  if (!res.ok) {
    // Never print grant.uploadUrl — it carries the request signature.
    throw new Error(`R2 upload failed for "${imageFile}" with status ${res.status}`);
  }

  return { imageFile, ref: r2Ref(grant.key) };
}

/**
 * Upload every catalogued product photo, returning a ref for each one that
 * made it to the bucket. Products without `imageFile` are ignored entirely
 * (they never wanted an image). `imagesDir` null / not a directory, or R2
 * unconfigured, skips ALL images with an explanatory note — never a partial
 * failure.
 */
export async function uploadDemoImages(
  products: DemoProduct[],
  imagesDir: string | null,
  log: (line: string) => void,
  deps: UploadDemoImagesDeps = {},
): Promise<UploadDemoImagesResult> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const refs = new Map<string, string>();
  const wanted = products.filter((p) => p.imageFile);

  if (!imagesDir || !(await isDirectory(imagesDir))) {
    return {
      refs,
      uploaded: 0,
      skipped: wanted.length,
      note: "images skipped — no images folder given (--images <dir> or DEMO_IMAGES_DIR)",
    };
  }

  const cfg = deps.r2 === undefined ? r2Config() : deps.r2;
  if (!cfg) {
    return {
      refs,
      uploaded: 0,
      skipped: wanted.length,
      note: "images skipped — R2 is not configured (image store on the client file)",
    };
  }

  const outcomes = await mapWithConcurrency(wanted, UPLOAD_CONCURRENCY, (product) =>
    uploadOne(product, imagesDir, cfg, log, fetchImpl),
  );

  let uploaded = 0;
  for (const outcome of outcomes) {
    if (!outcome) continue;
    refs.set(outcome.imageFile, outcome.ref);
    uploaded += 1;
  }
  const skipped = wanted.length - uploaded;

  // Best-effort readability check — a WARNING, never a failure: a private
  // bucket only means photos won't render, not that seeding should abort.
  const publicBase = process.env.NEXT_PUBLIC_R2_PUBLIC_BASE_URL;
  if (publicBase && uploaded > 0) {
    const firstRef = outcomes.find((o) => o !== null)?.ref;
    const url = firstRef ? productImageUrl(firstRef) : null;
    if (url) {
      try {
        const head = await fetchImpl(url, { method: "HEAD" });
        if (!head.ok) {
          log(`WARNING: the R2 bucket does not appear to be publicly readable (photos will not render) — HEAD returned ${head.status}`);
        }
      } catch {
        log("WARNING: could not reach the R2 public base URL to verify the bucket is publicly readable");
      }
    }
  }

  return { refs, uploaded, skipped };
}
