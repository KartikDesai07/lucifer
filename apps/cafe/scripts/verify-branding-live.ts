/**
 * Branding asset store live leg — proves the CONTENT-ADDRESSED logo store's
 * additive-upload, prune-bound, corruption-detection, and enum-guard behavior
 * against a REAL MongoDB, which the DB-free unit tests cannot: that an upload
 * the admin never saved really cannot change the logo the cafe is actively
 * printing (the review finding this redesign fixes — see scenario 2), that
 * the prune really bounds a slot to at most two documents on a 512MB M0, that
 * the version hash really matches Mongo's own round-tripped bytes, and that
 * the storage enums really reject an out-of-enum value THROUGH THE SAME
 * findByIdAndUpdate upsert shape production code uses (not create(), a path
 * no production code takes). Exercises the REAL `putBrandingAsset` /
 * `getBrandingBytes` / `resolveActiveVersion` (lib/branding.ts) and the REAL
 * `BrandingAsset` / `Settings` models — nothing here is a fake standing in
 * for the write logic itself.
 *
 * CR2.4 S4 (A8/A14/A16) adds the third `heroImage` slot — whose ref is
 * NESTED under `Settings.appearance`, not a top-level field — plus the
 * prune's grace window (BRANDING_PRUNE_GRACE_MS) and its own byte cap
 * (BRANDING_SLOT_MAX_BYTES.heroImage). Scenarios 3/4 now backdate a pruned
 * document's `updatedAt` (via `{ timestamps: false }`) so the grace window
 * doesn't make those counts time-sensitive against a real wall clock.
 *
 *   npm run verify:branding:live            (defaults to the local stand-in)
 *   MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_branding npm run verify:branding:live
 *
 * SAFETY: refuses to run against any database whose name does not carry the
 * scratch prefix, and drops only the two collections it creates.
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import assert from "node:assert/strict";
import mongoose from "mongoose";

import { connectDB } from "@/lib/db";
import { BrandingAsset } from "@/models/BrandingAsset";
import { Settings, type ISettings } from "@/models/Settings";
import { putBrandingAsset, getBrandingBytes, brandingVersion, resolveActiveVersion } from "@/lib/branding";
import cache, { TTL } from "@/lib/cache";
import { invalidateSettingsCache, SETTINGS_CACHE_KEY } from "@/lib/settings";
import { localRef } from "@/lib/images";
import { DEFAULT_APPEARANCE } from "@pos/shared/appearance";
import {
  BRANDING_SLOTS,
  MAX_BRANDING_BYTES,
  BRANDING_SLOT_MAX_BYTES,
  BRANDING_PRUNE_GRACE_MS,
  BRANDING_PRUNE_MAX_PENDING,
  BRANDING_VERSION_LEN,
  IMAGE_CONTENT_TYPES,
  type BrandingSlot,
} from "@/lib/constants";

const SCRATCH_PREFIX = "pos_scratch_";
const DEFAULT_URI = `mongodb://127.0.0.1:27017/${SCRATCH_PREFIX}branding`;
const LOGO: BrandingSlot = BRANDING_SLOTS[0];
const PRODUCT_LOGO: BrandingSlot = BRANDING_SLOTS[1];
const HERO_IMAGE: BrandingSlot = BRANDING_SLOTS[2];
const CONTENT_TYPE = "image/png";
// A fixture version string of the real length, used only where a scenario
// needs a syntactically-valid-looking version it never actually derived from
// bytes (the corruption and enum-guard scenarios write documents directly).
const FIXTURE_VERSION = "abc123abc123".slice(0, BRANDING_VERSION_LEN);

let passed = 0;
let failed = 0;

// Numbered so a failure's console output points straight at the scenario in
// this file (and in the brief that specified it) rather than a bare label.
async function scenario(n: number, name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed += 1;
    console.log(`  ok   ${n}. ${name}`);
  } catch (error) {
    failed += 1;
    console.log(`  FAIL ${n}. ${name}`);
    console.log(`       ${error instanceof Error ? error.message : String(error)}`);
  }
}

// Every scenario starts from a clean slate — both the asset store AND
// Settings (whose saved ref drives the prune) — so scenarios never depend on
// each other's leftover state.
async function reset(): Promise<void> {
  await Promise.all([BrandingAsset.collection.deleteMany({}), Settings.collection.deleteMany({})]);
  invalidateSettingsCache();
}

// Writes Settings directly (bypassing getSettings()'s upsert-and-cache path,
// which is server-render code this script has no business calling) and then
// invalidates the cache.
//
// CACHE TRAP: resolveActiveVersion() reads Settings through readSettings(),
// which caches the document in-process for 45s (lib/settings.ts TTL.SETTINGS).
// putBrandingAsset() does its OWN uncached, projected Settings read for its
// prune (A14, CR2.4) — it never goes through readSettings() — but a scenario
// that writes Settings here and then calls resolveActiveVersion() DIRECTLY
// still needs a fresh cache, or it asserts against a stale cached document and
// passes or fails for the wrong reason. This helper is the ONLY place in this
// file that writes Settings, so that invalidation can never be forgotten at a
// call site.
async function seedSettings(
  fields: Partial<Pick<ISettings, "logo" | "productLogo" | "appearance">>,
): Promise<void> {
  await Settings.findOneAndUpdate({}, { $set: fields }, { upsert: true });
  invalidateSettingsCache();
}

async function main(): Promise<void> {
  const uri = process.env.MONGODB_URI ?? DEFAULT_URI;
  const dbName = new URL(uri.replace("mongodb://", "http://")).pathname.slice(1);
  if (!dbName.startsWith(SCRATCH_PREFIX)) {
    throw new Error(
      `Refusing to run against "${dbName}" — the live leg only touches a database named ${SCRATCH_PREFIX}*.`,
    );
  }

  process.env.MONGODB_URI = uri;
  await connectDB();
  await Promise.all([
    BrandingAsset.collection.drop().catch(() => undefined),
    Settings.collection.drop().catch(() => undefined),
  ]);
  await Promise.all([BrandingAsset.createIndexes(), Settings.createIndexes()]);

  console.log(`\nbranding asset store live — live against ${dbName}\n`);

  try {
    await scenario(
      1,
      "put on an empty slot stores one document; getBrandingBytes returns the SAME bytes, contentType, and version",
      async () => {
        await reset();
        const original = Buffer.from("logo-bytes-v1", "utf8");
        const put = await putBrandingAsset(LOGO, original, CONTENT_TYPE);
        assert.equal(put.bytes, original.length);
        assert.equal(put.version, brandingVersion(original));
        assert.equal(await BrandingAsset.countDocuments({ slot: LOGO }), 1);

        const stored = await getBrandingBytes(LOGO, put.version);
        assert.ok(stored !== null);
        assert.ok(stored.bytes.equals(original), "round-tripped bytes must equal what was written");
        assert.equal(stored.contentType, CONTENT_TYPE);
        assert.equal(stored.version, put.version);
      },
    );

    // THE REGRESSION TEST for the review finding: keying documents by slot
    // alone made an upload destructive in place — picking a file in Settings
    // replaced the logo the cafe was actively printing, before the admin
    // pressed Save, with no undo. This proves the fix: the version Settings
    // has SAVED keeps resolving to its ORIGINAL bytes even after a second,
    // never-saved upload lands.
    await scenario(
      2,
      "REGRESSION: an upload the admin never saved cannot change the logo the cafe is currently printing",
      async () => {
        await reset();
        const v1Bytes = Buffer.from("the logo the cafe is actively printing", "utf8");
        const putV1 = await putBrandingAsset(LOGO, v1Bytes, CONTENT_TYPE);
        await seedSettings({ logo: localRef(LOGO, putV1.version) });

        const v2Bytes = Buffer.from("a different upload the admin has not saved yet", "utf8");
        const putV2 = await putBrandingAsset(LOGO, v2Bytes, CONTENT_TYPE);
        assert.notEqual(putV2.version, putV1.version, "different bytes must produce a different version");

        assert.equal(
          await BrandingAsset.countDocuments({ slot: LOGO }),
          2,
          "both the saved version and the new upload must still be stored",
        );
        const stillPrinting = await getBrandingBytes(LOGO, putV1.version);
        assert.ok(stillPrinting !== null);
        assert.ok(
          stillPrinting.bytes.equals(v1Bytes),
          "the SAVED version's bytes must be unchanged by the unsaved upload",
        );
      },
    );

    await scenario(
      3,
      "prune bound: with Settings still pointing at v1, a third upload prunes the middle version once it clears the grace window — exactly [v1 saved, v3 newest] remain",
      async () => {
        await reset();
        const v1 = Buffer.from("prune-bound-v1", "utf8");
        const v2 = Buffer.from("prune-bound-v2", "utf8");
        const v3 = Buffer.from("prune-bound-v3", "utf8");
        const putV1 = await putBrandingAsset(LOGO, v1, CONTENT_TYPE);
        await seedSettings({ logo: localRef(LOGO, putV1.version) });
        const putV2 = await putBrandingAsset(LOGO, v2, CONTENT_TYPE);
        // A14's grace window (BRANDING_PRUNE_GRACE_MS) only prunes a document
        // once it has sat unreferenced long enough that a concurrent Settings
        // save could have landed — backdate v2's updatedAt past that window so
        // this scenario proves the eventual prune deterministically instead of
        // racing a 15-minute wait. `{ timestamps: false }` is Mongoose's own
        // documented escape hatch for exactly this ("allows you to overwrite
        // timestamps") — schema-level `timestamps: true` would otherwise
        // re-stamp updatedAt to now on every update query, undoing the backdate.
        await BrandingAsset.updateMany(
          { _id: `${LOGO}:${putV2.version}` },
          { $set: { updatedAt: new Date(Date.now() - BRANDING_PRUNE_GRACE_MS - 1000) } },
          { timestamps: false },
        );
        const putV3 = await putBrandingAsset(LOGO, v3, CONTENT_TYPE);

        const remaining = await BrandingAsset.find({ slot: LOGO }).select("version").lean();
        const versions = remaining.map((doc) => doc.version).sort();
        assert.deepEqual(versions, [putV1.version, putV3.version].sort(), "exactly the saved + newest versions must remain");
        assert.equal(await getBrandingBytes(LOGO, brandingVersion(v2)), null, "the pruned middle version must be gone");
      },
    );

    await scenario(
      4,
      "with NO saved ref for the slot, two successive puts leave exactly ONE document (the newest) once the first clears the grace window",
      async () => {
        await reset(); // Settings has no doc at all → resolveActiveVersion(LOGO) is null: nothing to preserve.
        const v1 = Buffer.from("nothing-to-preserve-v1", "utf8");
        const v2 = Buffer.from("nothing-to-preserve-v2", "utf8");
        const putV1 = await putBrandingAsset(LOGO, v1, CONTENT_TYPE);
        // See scenario 3: backdate (via `{ timestamps: false }`) so the grace
        // window (A14) has already cleared by the time the second put's prune runs.
        await BrandingAsset.updateMany(
          { _id: `${LOGO}:${putV1.version}` },
          { $set: { updatedAt: new Date(Date.now() - BRANDING_PRUNE_GRACE_MS - 1000) } },
          { timestamps: false },
        );
        const putV2 = await putBrandingAsset(LOGO, v2, CONTENT_TYPE);

        assert.equal(
          await BrandingAsset.countDocuments({ slot: LOGO }),
          1,
          "nothing to preserve, and the abandoned first upload has cleared the grace window",
        );
        const stored = await getBrandingBytes(LOGO, putV2.version);
        assert.ok(stored !== null && stored.bytes.equals(v2));
        assert.equal(await getBrandingBytes(LOGO, brandingVersion(v1)), null);
      },
    );

    await scenario(
      5,
      "identical bytes re-uploaded yield the SAME version and do not create a second document",
      async () => {
        await reset();
        const bytes = Buffer.from("logo-bytes-unchanged", "utf8");
        const first = await putBrandingAsset(PRODUCT_LOGO, bytes, CONTENT_TYPE);
        const second = await putBrandingAsset(PRODUCT_LOGO, Buffer.from(bytes), CONTENT_TYPE); // a distinct Buffer, same content
        assert.equal(second.version, first.version);
        assert.equal(await BrandingAsset.countDocuments({ slot: PRODUCT_LOGO }), 1);
      },
    );

    await scenario(
      6,
      "the two slots are independent — writing logo never disturbs productLogo's documents",
      async () => {
        await reset();
        const productLogoBytes = Buffer.from("the product's own mark", "utf8");
        const putProductLogo = await putBrandingAsset(PRODUCT_LOGO, productLogoBytes, CONTENT_TYPE);
        await seedSettings({ productLogo: localRef(PRODUCT_LOGO, putProductLogo.version) });

        await putBrandingAsset(LOGO, Buffer.from("this cafe's own logo", "utf8"), CONTENT_TYPE);
        await putBrandingAsset(LOGO, Buffer.from("a second logo upload", "utf8"), CONTENT_TYPE); // prunes LOGO only

        assert.equal(
          await BrandingAsset.countDocuments({ slot: PRODUCT_LOGO }),
          1,
          "productLogo's document count must be untouched by logo writes",
        );
        const stillThere = await getBrandingBytes(PRODUCT_LOGO, putProductLogo.version);
        assert.ok(stillThere !== null && stillThere.bytes.equals(productLogoBytes));
      },
    );

    await scenario(7, "getBrandingBytes for a version that was never stored returns null (not a throw)", async () => {
      await reset();
      const neverStored = brandingVersion(Buffer.from("never uploaded", "utf8"));
      assert.equal(await getBrandingBytes(LOGO, neverStored), null);
    });

    await scenario(
      8,
      "corruption is detected, not served: a stored dataB64/bytes length mismatch makes getBrandingBytes THROW",
      async () => {
        await reset();
        // Buffer.from(s, "base64") accepts malformed input silently, so the
        // stored DECODED length is the only proof the round-trip held — write
        // the corrupt document directly (bypassing putBrandingAsset, which
        // would never itself produce this shape) to prove getBrandingBytes
        // catches it on read.
        const shortPayload = Buffer.from("short", "utf8").toString("base64"); // decodes to 5 bytes
        await BrandingAsset.create({
          _id: `${LOGO}:${FIXTURE_VERSION}`,
          slot: LOGO,
          contentType: CONTENT_TYPE,
          dataB64: shortPayload,
          bytes: 9999, // deliberately wrong — the doc claims 9999 decoded bytes
          version: FIXTURE_VERSION,
        });
        await assert.rejects(() => getBrandingBytes(LOGO, FIXTURE_VERSION), /corrupt/i);
      },
    );

    await scenario(
      9,
      "binary fidelity: a round-trip of real non-UTF8 bytes (0x00 and 0xFF included) is byte-exact",
      async () => {
        await reset();
        // The full byte range, so 0x00 (a null byte a naive string path could
        // truncate on) and 0xFF (a byte no UTF-8 continuation accepts alone)
        // are both exercised, not just typical ASCII text.
        const binary = Buffer.from(Array.from({ length: 256 }, (_, i) => i));
        assert.ok(binary.includes(0x00) && binary.includes(0xff));

        const put = await putBrandingAsset(PRODUCT_LOGO, binary, CONTENT_TYPE);
        const stored = await getBrandingBytes(PRODUCT_LOGO, put.version);
        assert.ok(stored !== null);
        assert.ok(stored.bytes.equals(binary), "every byte 0x00-0xFF must survive the base64-in-a-String round trip");
      },
    );

    await scenario(
      10,
      "resolveActiveVersion: saved version, empty field, unparseable ref, and cross-slot ref (the anti-cross-wiring guard) all resolve correctly",
      async () => {
        await reset();
        const put = await putBrandingAsset(LOGO, Buffer.from("resolve-active-version", "utf8"), CONTENT_TYPE);

        await seedSettings({ logo: localRef(LOGO, put.version) });
        assert.equal(await resolveActiveVersion(LOGO), put.version, "must return the SAVED version");

        await seedSettings({ logo: "" });
        assert.equal(await resolveActiveVersion(LOGO), null, "an empty field must resolve to null");

        await seedSettings({ logo: "not-a-parseable-ref!!" });
        assert.equal(await resolveActiveVersion(LOGO), null, "an unparseable ref must resolve to null");

        // The guard against cross-wiring the restaurant logo into the browser
        // tab: a ref that parses fine but names the OTHER slot must not resolve.
        await seedSettings({ logo: localRef(PRODUCT_LOGO, put.version) });
        assert.equal(
          await resolveActiveVersion(LOGO),
          null,
          "a ref naming the OTHER slot must resolve to null, not adopt that slot's version",
        );
      },
    );

    await scenario(
      11,
      "storage enums are enforced through the PRODUCTION WRITER SHAPE (findByIdAndUpdate upsert+runValidators), not create()",
      async () => {
        await reset();
        const invalidSlot = "not-a-real-slot";
        assert.ok(
          !(BRANDING_SLOTS as readonly string[]).includes(invalidSlot),
          "the fixture slot must genuinely be outside BRANDING_SLOTS for this to prove anything",
        );

        await assert.rejects(
          () =>
            BrandingAsset.findByIdAndUpdate(
              `${invalidSlot}:${FIXTURE_VERSION}`,
              {
                $set: {
                  slot: invalidSlot,
                  contentType: CONTENT_TYPE,
                  dataB64: Buffer.from("x").toString("base64"),
                  bytes: 1,
                  version: FIXTURE_VERSION,
                },
              },
              { upsert: true, runValidators: true },
            ),
          (error: unknown) => error instanceof mongoose.Error.ValidationError,
        );
        assert.equal(
          await BrandingAsset.countDocuments({ _id: `${invalidSlot}:${FIXTURE_VERSION}` }),
          0,
          "a validation-rejected upsert must not have landed a document",
        );

        const invalidContentType = "application/x-not-an-image";
        assert.ok(
          !Object.hasOwn(IMAGE_CONTENT_TYPES, invalidContentType),
          "the fixture content type must genuinely be outside IMAGE_CONTENT_TYPES for this to prove anything",
        );
        await assert.rejects(
          () =>
            BrandingAsset.findByIdAndUpdate(
              `${LOGO}:${FIXTURE_VERSION}`,
              {
                $set: {
                  slot: LOGO,
                  contentType: invalidContentType,
                  dataB64: Buffer.from("x").toString("base64"),
                  bytes: 1,
                  version: FIXTURE_VERSION,
                },
              },
              { upsert: true, runValidators: true },
            ),
          (error: unknown) => error instanceof mongoose.Error.ValidationError,
        );
        assert.equal(
          await BrandingAsset.countDocuments({ _id: `${LOGO}:${FIXTURE_VERSION}` }),
          0,
          "a validation-rejected upsert must not have landed a document",
        );
      },
    );

    await scenario(12, "an asset of exactly MAX_BRANDING_BYTES round-trips and stores that exact bytes value", async () => {
      await reset();
      const maxBytes = Buffer.from(Array.from({ length: MAX_BRANDING_BYTES }, (_, i) => i % 256));
      const put = await putBrandingAsset(LOGO, maxBytes, CONTENT_TYPE);
      assert.equal(put.bytes, MAX_BRANDING_BYTES);
      assert.equal(put.version.length, BRANDING_VERSION_LEN);

      const stored = await getBrandingBytes(LOGO, put.version);
      assert.ok(stored !== null);
      assert.equal(stored.bytes.length, MAX_BRANDING_BYTES);
      assert.ok(stored.bytes.equals(maxBytes));
    });

    // ── CR2.4 S4 — hero slot (A8/A14/A16) ──────────────────────────────────

    await scenario(
      13,
      "HERO PRUNE-PRESERVATION (A8): a hero upload the admin never saved cannot change the hero the cafe is currently showing — mirrors scenario 2, but through the NESTED appearance.heroImage ref",
      async () => {
        await reset();
        const heroV1 = Buffer.from("the hero banner currently live", "utf8");
        const putV1 = await putBrandingAsset(HERO_IMAGE, heroV1, CONTENT_TYPE);
        await seedSettings({
          appearance: { ...DEFAULT_APPEARANCE, heroImage: localRef(HERO_IMAGE, putV1.version) },
        });

        const heroV2 = Buffer.from("a different hero upload not yet saved", "utf8");
        const putV2 = await putBrandingAsset(HERO_IMAGE, heroV2, CONTENT_TYPE);
        assert.notEqual(putV2.version, putV1.version, "different bytes must produce a different version");

        assert.equal(
          await BrandingAsset.countDocuments({ slot: HERO_IMAGE }),
          2,
          "both the saved hero and the new, never-saved upload must still be stored",
        );
        const stillShowing = await getBrandingBytes(HERO_IMAGE, putV1.version);
        assert.ok(stillShowing !== null);
        assert.ok(
          stillShowing.bytes.equals(heroV1),
          "the SAVED hero's bytes must be unchanged by the unsaved upload",
        );
      },
    );

    await scenario(
      14,
      'resolveActiveVersion("heroImage") is null with no Settings doc at all, null again when a doc exists with no `appearance` subdoc (every pre-CR2.4 document), and null again when heroImage is explicitly cleared to ""',
      async () => {
        await reset();
        assert.equal(
          await resolveActiveVersion(HERO_IMAGE),
          null,
          "no Settings doc at all must resolve to null",
        );

        // A doc that predates CR2.4 has no `appearance` key at all — seed a
        // different field so a doc exists, but never touch appearance.
        await seedSettings({ logo: "" });
        assert.equal(
          await resolveActiveVersion(HERO_IMAGE),
          null,
          "a Settings doc with no `appearance` subdoc at all must resolve to null",
        );

        await seedSettings({ appearance: { ...DEFAULT_APPEARANCE, heroImage: "" } });
        assert.equal(
          await resolveActiveVersion(HERO_IMAGE),
          null,
          "an explicit empty heroImage must resolve to null",
        );
      },
    );

    await scenario(
      15,
      "POISONED CACHE (A14): a stale cached Settings copy (the pre-save shape) must not fool putBrandingAsset's prune — it reads the active ref UNCACHED",
      async () => {
        await reset();
        const heroV1 = Buffer.from("poisoned-cache-hero-v1", "utf8");
        const putV1 = await putBrandingAsset(HERO_IMAGE, heroV1, CONTENT_TYPE);
        await seedSettings({
          appearance: { ...DEFAULT_APPEARANCE, heroImage: localRef(HERO_IMAGE, putV1.version) },
        });

        // Poison the in-process cache with the PRE-SAVE shape (appearance
        // absent) — the same object readSettings() would have cached a moment
        // before the save above landed. If putBrandingAsset's prune read this
        // cache instead of a fresh, uncached Settings query, it would see no
        // active ref at all and prune the version Settings just pointed at.
        cache.set(SETTINGS_CACHE_KEY, { appearance: undefined } as unknown as ISettings, TTL.SETTINGS);

        // Post-review fix: heroV1 is only milliseconds old here, so the grace
        // clause (BRANDING_PRUNE_GRACE_MS) would ALONE keep it alive even under
        // the forbidden cached read this scenario exists to catch — backdate it
        // past the grace window (same pattern as scenarios 3/4) so the ONLY
        // thing keeping it alive is the uncached keep-list read this scenario
        // is actually testing.
        await BrandingAsset.updateMany(
          { _id: `${HERO_IMAGE}:${putV1.version}` },
          { $set: { updatedAt: new Date(Date.now() - BRANDING_PRUNE_GRACE_MS - 1000) } },
          { timestamps: false },
        );

        const heroV2 = Buffer.from("poisoned-cache-hero-v2", "utf8");
        await putBrandingAsset(HERO_IMAGE, heroV2, CONTENT_TYPE);

        assert.equal(
          await BrandingAsset.countDocuments({ slot: HERO_IMAGE }),
          2,
          "the saved version must survive even though the in-process cache was poisoned with a pre-save copy",
        );
        const stillLive = await getBrandingBytes(HERO_IMAGE, putV1.version);
        assert.ok(stillLive !== null && stillLive.bytes.equals(heroV1));
      },
    );

    await scenario(
      16,
      "per-slot byte caps are genuinely independent (A16): a payload between LOGO's cap and HERO's larger one stores fine for heroImage — the 413 REJECTION itself is enforced in the route (BRANDING_SLOT_MAX_BYTES[slot]), pinned as a source-read assertion (branding-paths.test.ts) since no live leg in this repo invokes an admin-gated route handler",
      async () => {
        await reset();
        assert.ok(
          BRANDING_SLOT_MAX_BYTES.heroImage > BRANDING_SLOT_MAX_BYTES.logo,
          "heroImage's cap must be strictly larger than logo's cap",
        );
        const overLogoCapSize = BRANDING_SLOT_MAX_BYTES.logo + 1024;
        assert.ok(
          overLogoCapSize < BRANDING_SLOT_MAX_BYTES.heroImage,
          "the fixture size must genuinely sit between the two caps for this to prove anything",
        );
        const bytes = Buffer.from(Array.from({ length: overLogoCapSize }, (_, i) => i % 256));
        const put = await putBrandingAsset(HERO_IMAGE, bytes, CONTENT_TYPE);
        const stored = await getBrandingBytes(HERO_IMAGE, put.version);
        assert.ok(stored !== null && stored.bytes.length === overLogoCapSize);
      },
    );
    await scenario(
      17,
      "COUNT BOUND (post-review fix, BRANDING_PRUNE_MAX_PENDING): 6 same-slot uploads inside the grace window (auditioning, never saved) cap the slot at <= 2 kept + MAX_PENDING documents, and the SAVED version always survives; once the pending docs age past the grace window, the next put collects them down to just the 2 kept",
      async () => {
        await reset();
        const savedBytes = Buffer.from("hero-count-bound-saved", "utf8");
        const putSaved = await putBrandingAsset(HERO_IMAGE, savedBytes, CONTENT_TYPE);
        await seedSettings({
          appearance: { ...DEFAULT_APPEARANCE, heroImage: localRef(HERO_IMAGE, putSaved.version) },
        });

        // Audition 6 more heroes in quick succession — none ever gets saved,
        // exactly the "audition several, save none yet" flow that used to grow
        // this slot without bound.
        let lastVersion = putSaved.version;
        for (let i = 0; i < 6; i++) {
          const put = await putBrandingAsset(HERO_IMAGE, Buffer.from(`audition-${i}`, "utf8"), CONTENT_TYPE);
          lastVersion = put.version;
        }

        const countAfterAuditions = await BrandingAsset.countDocuments({ slot: HERO_IMAGE });
        assert.ok(
          countAfterAuditions <= 2 + BRANDING_PRUNE_MAX_PENDING,
          `expected at most ${2 + BRANDING_PRUNE_MAX_PENDING} documents (2 kept + ${BRANDING_PRUNE_MAX_PENDING} pending), got ${countAfterAuditions}`,
        );
        const savedStillLive = await getBrandingBytes(HERO_IMAGE, putSaved.version);
        assert.ok(
          savedStillLive !== null && savedStillLive.bytes.equals(savedBytes),
          "the SAVED hero must survive the count-bound prune regardless of how many auditions followed it",
        );

        // Backdate every document except the SAVED one past the grace window
        // — simulating the whole audition window elapsing with no further
        // saves — and prove the NEXT put's grace pass collects them all down
        // to exactly the 2 kept documents (saved + newest). `lastVersion` is
        // deliberately included here: it is only "kept" DURING its own put
        // call, never afterward, so it must age out like any other orphan.
        assert.ok(lastVersion !== putSaved.version, "the fixture must genuinely have created a distinct last audition version");
        await BrandingAsset.updateMany(
          { slot: HERO_IMAGE, version: { $ne: putSaved.version } },
          { $set: { updatedAt: new Date(Date.now() - BRANDING_PRUNE_GRACE_MS - 1000) } },
          { timestamps: false },
        );
        const putFinal = await putBrandingAsset(HERO_IMAGE, Buffer.from("hero-count-bound-final", "utf8"), CONTENT_TYPE);

        assert.equal(
          await BrandingAsset.countDocuments({ slot: HERO_IMAGE }),
          2,
          "once every pending document has aged past the grace window, the next put must collect the slot down to just the 2 kept documents",
        );
        const savedStillLiveAfter = await getBrandingBytes(HERO_IMAGE, putSaved.version);
        assert.ok(savedStillLiveAfter !== null && savedStillLiveAfter.bytes.equals(savedBytes));
        const newestStillLive = await getBrandingBytes(HERO_IMAGE, putFinal.version);
        assert.ok(newestStillLive !== null);
      },
    );
  } finally {
    await Promise.all([
      BrandingAsset.collection.drop().catch(() => undefined),
      Settings.collection.drop().catch(() => undefined),
    ]);
    await mongoose.disconnect();
  }

  console.log(`\n${passed} passed, ${failed} failed\n`);
  if (failed > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
