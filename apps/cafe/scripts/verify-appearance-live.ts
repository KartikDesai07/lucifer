/**
 * Appearance (CR2.4) Settings live leg — proves DB-truth the DB-free unit
 * tests cannot: that a route-shaped save round-trips the WHOLE appearance
 * subdoc through a REAL MongoDB, that ""-clears actually clear (merge-vs-
 * replace answered by DB truth, not assumption), that a partial {appearance}
 * PUT really leaves every sibling top-level field untouched, that a bare
 * appearance-only PUT really leaves every OTHER subdoc field untouched
 * (A15b), that a raw partial $set on the nested subdoc really does whatever
 * Mongoose's $isSingleNested replace semantics actually do (A15a — proved,
 * not assumed, and reported either way), that updateSettingsSchema's
 * contrast/version/completeness gates hold against a real parse, and that
 * the hero branding slot's ref only starts resolving once a Settings save
 * actually references it (A8), exactly mirroring
 * scripts/verify-branding-live.ts's own hero scenarios but from the
 * Settings/schema side rather than the asset-store side.
 *
 *   npm run verify:appearance:live            (defaults to the local stand-in)
 *   MONGODB_URI=mongodb://127.0.0.1:27017/pos_scratch_appearance npm run verify:appearance:live
 *
 * SAFETY: refuses to run against any database whose name does not carry the
 * scratch prefix, and drops both collections it touches (Settings, plus
 * BrandingAsset — scenarios 12-14 call putBrandingAsset for the logo/hero
 * slots, which creates BrandingAsset documents alongside Settings).
 * (console output is intentional — this is an ops CLI script, not app code.)
 */
import assert from "node:assert/strict";
import mongoose from "mongoose";

import { connectDB } from "@/lib/db";
import { Settings, type ISettings } from "@/models/Settings";
import { BrandingAsset } from "@/models/BrandingAsset";
import { readSettings, invalidateSettingsCache } from "@/lib/settings";
import { updateSettingsSchema } from "@/schemas";
import {
  resolveAppearance,
  APPEARANCE_SCHEMA_VERSION,
  type AppearanceInput,
} from "@pos/shared/appearance";
import { putBrandingAsset, resolveActiveVersion } from "@/lib/branding";
import { localRef } from "@/lib/images";
import { BRANDING_SLOTS, type BrandingSlot } from "@/lib/constants";

const SCRATCH_PREFIX = "pos_scratch_";
const DEFAULT_URI = `mongodb://127.0.0.1:27017/${SCRATCH_PREFIX}appearance`;
const LOGO: BrandingSlot = BRANDING_SLOTS[0];
const HERO_IMAGE: BrandingSlot = BRANDING_SLOTS[2];
const CONTENT_TYPE = "image/png";

// A full appearance object with every field but presetId deliberately
// different from DEFAULT_APPEARANCE, so a round-trip test that silently fell
// back to defaults on read (or wrote the wrong field) cannot pass by
// accident. accentOverride "#9a6a3a" is the EXACT fixture
// packages/shared/src/schemas/settings.schema.test.ts already proved passes
// checkAccent for classicBistro (both light AND dark halves) — reused
// verbatim rather than hand-picked, since checkAccent's bar (a single accent
// must clear contrast against BOTH the light and dark background/card) is
// stricter than either half's own preset-shipped accent alone.
const FULL_APPEARANCE: AppearanceInput = {
  v: APPEARANCE_SCHEMA_VERSION,
  presetId: "classicBistro",
  accentOverride: "#9a6a3a",
  fontPairKey: "classic",
  cornerRadius: "round",
  density: "roomy",
  logoPlacement: "center",
  heroImage: "",
};

let passed = 0;
let failed = 0;

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

async function reset(): Promise<void> {
  await Settings.collection.deleteMany({});
  invalidateSettingsCache();
}

// The EXACT shape app/api/settings/route.ts's PUT handler uses: parse through
// updateSettingsSchema, then findOneAndUpdate with no operator wrapper of our
// own (Mongoose's own auto-$set behavior applies, same as production), then
// invalidate the cache the same way the route does after every write.
async function routeShapedUpdate(candidate: unknown): Promise<void> {
  const parsed = updateSettingsSchema.safeParse(candidate);
  assert.ok(parsed.success, `fixture candidate must itself parse: ${!parsed.success ? JSON.stringify(parsed.error.flatten()) : ""}`);
  await Settings.findOneAndUpdate({}, parsed.data, {
    new: true,
    upsert: true,
    setDefaultsOnInsert: true,
    runValidators: true,
  }).lean();
  invalidateSettingsCache();
}

async function readAppearanceField(): Promise<AppearanceInput | null> {
  const doc = (await Settings.findOne().lean()) as ISettings | null;
  return (doc?.appearance as AppearanceInput | undefined) ?? null;
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
    Settings.collection.drop().catch(() => undefined),
    BrandingAsset.collection.drop().catch(() => undefined),
  ]);
  await Promise.all([Settings.createIndexes(), BrandingAsset.createIndexes()]);

  console.log(`\nappearance settings live — live against ${dbName}\n`);

  try {
    await scenario(
      1,
      "route-shaped full save round-trips every appearance key through a REAL Settings.findOneAndUpdate + readSettings",
      async () => {
        await reset();
        await routeShapedUpdate({ appearance: FULL_APPEARANCE });
        const settings = await readSettings();
        assert.deepEqual(settings?.appearance, FULL_APPEARANCE, "every key of the saved appearance object must round-trip unchanged");
      },
    );

    await scenario(
      2,
      "resolveAppearance(the stored raw field) reproduces the exact same ResolvedAppearance that was saved — storage and the resolver agree",
      async () => {
        await reset();
        await routeShapedUpdate({ appearance: FULL_APPEARANCE });
        const settings = await readSettings();
        assert.deepEqual(resolveAppearance(settings?.appearance), FULL_APPEARANCE);
      },
    );

    await scenario(
      3,
      '""-clears: after a save with accentOverride/heroImage non-empty, a second full save with both "" actually clears both — merge-vs-replace answered by DB truth',
      async () => {
        await reset();
        await routeShapedUpdate({
          appearance: { ...FULL_APPEARANCE, accentOverride: "#9a6a3a", heroImage: localRef(HERO_IMAGE, "abcdef123456") },
        });
        const before = await readAppearanceField();
        assert.notEqual(before?.accentOverride, "");
        assert.notEqual(before?.heroImage, "");

        await routeShapedUpdate({ appearance: { ...FULL_APPEARANCE, accentOverride: "", heroImage: "" } });
        const after = await readAppearanceField();
        assert.equal(after?.accentOverride, "", 'accentOverride must read back "" after the clearing save');
        assert.equal(after?.heroImage, "", 'heroImage must read back "" after the clearing save');
      },
    );

    await scenario(
      4,
      "partial {appearance}-only PUT leaves restaurantName and promoCodes completely untouched",
      async () => {
        await reset();
        await routeShapedUpdate({
          restaurantName: "Test Cafe",
          promoCodes: [{ code: "SAVE10", kind: "percent", value: 10, active: true }],
        });
        await routeShapedUpdate({ appearance: FULL_APPEARANCE });

        const settings = await readSettings();
        assert.equal(settings?.restaurantName, "Test Cafe", "restaurantName must survive an appearance-only PUT");
        assert.equal(settings?.promoCodes?.length, 1, "promoCodes must survive an appearance-only PUT");
        assert.equal(settings?.promoCodes?.[0].code, "SAVE10");
      },
    );

    await scenario(
      5,
      "(A15b) a PUT that OMITS appearance entirely leaves the stored appearance subdoc byte-identical to its prior value",
      async () => {
        await reset();
        await routeShapedUpdate({ appearance: FULL_APPEARANCE });
        const before = await readAppearanceField();

        await routeShapedUpdate({ restaurantName: "A Different Name" }); // no `appearance` key at all
        const after = await readAppearanceField();
        assert.deepEqual(after, before, "appearance must be untouched by a PUT that never mentions it");
      },
    );

    await scenario(
      6,
      "(A15a) DIRECT-MODEL replace-semantics probe: a raw partial appearance $set either WIPES sibling keys (whole-subdoc replace) or is REJECTED by Mongoose's required-path validators — assert whichever the DB actually does, and that a rejection leaves the prior value untouched",
      async () => {
        await reset();
        await routeShapedUpdate({ appearance: FULL_APPEARANCE });
        const before = await readAppearanceField();
        assert.deepEqual(before, FULL_APPEARANCE, "setup must land the full appearance object before the probe");

        let rejected = false;
        try {
          // Bypasses Zod entirely (the route's own gate) — this is the SAME
          // findOneAndUpdate/runValidators shape production code uses, fed a
          // partial subdoc no Zod layer would ever let through.
          await Settings.findOneAndUpdate(
            {},
            { appearance: { presetId: "freshMint" } },
            { new: true, upsert: true, setDefaultsOnInsert: true, runValidators: true },
          );
        } catch (error) {
          rejected = true;
          assert.ok(
            error instanceof mongoose.Error.ValidationError,
            "a rejection must be a genuine Mongoose ValidationError, not some other failure mode",
          );
        }
        invalidateSettingsCache();

        const after = await readAppearanceField();
        if (rejected) {
          console.log("       (probed truth: Mongoose's required-path validators reject a partial appearance subdoc outright)");
          assert.deepEqual(after, FULL_APPEARANCE, "a rejected update must leave the prior appearance object completely untouched");
        } else {
          console.log("       (probed truth: $set replaced the appearance subdoc WHOLE — every sibling key is gone)");
          assert.equal(after?.presetId, "freshMint");
          assert.equal(after?.accentOverride, undefined, "sibling keys must be wiped/absent after a bare partial $set — proving the Zod all-keys rule is load-bearing");
        }
      },
    );

    await scenario(7, "schema gate: a low-contrast accentOverride is REJECTED with a failing-pair message", async () => {
      // "#fefdfb" (near-white) against classicBistro's near-white background —
      // the exact known-rejected fixture from settings.schema.test.ts, reused
      // rather than hand-picked so this scenario's premise is provably true.
      const parsed = updateSettingsSchema.safeParse({
        appearance: { ...FULL_APPEARANCE, accentOverride: "#fefdfb" },
      });
      assert.equal(parsed.success, false, "a near-white accent must fail checkAccent against classicBistro's own near-white background/card");
      if (parsed.success) return;
      const message = parsed.error.flatten().fieldErrors.appearance?.join(" ") ?? "";
      assert.match(message, /vs accent|vs (light|dark) (background|card)/i, "the rejection message must name the failing contrast pair");
    });

    await scenario(8, "schema gate: appearance.v !== APPEARANCE_SCHEMA_VERSION is REJECTED", () => {
      const parsed = updateSettingsSchema.safeParse({ appearance: { ...FULL_APPEARANCE, v: 999 } });
      assert.equal(parsed.success, false, "a stale/future schema version must not silently parse");
      return Promise.resolve();
    });

    await scenario(9, "schema gate: a partial appearance object (missing keys) is REJECTED", () => {
      const parsed = updateSettingsSchema.safeParse({ appearance: { presetId: "classicBistro" } });
      assert.equal(parsed.success, false, "appearance must require every key once the object is present at all — a partial subdoc would defeat the whole-replace guard (A15)");
      return Promise.resolve();
    });

    await scenario(10, "schema gate: an empty patch {} is ACCEPTED (appearance itself stays optional)", () => {
      const parsed = updateSettingsSchema.safeParse({});
      assert.equal(parsed.success, true, "an empty patch must still parse — appearance is optional at the top level");
      return Promise.resolve();
    });

    await scenario(
      11,
      'schema gate: a full appearance object with accentOverride === "" (use-preset-accent) is ACCEPTED — the superRefine short-circuits before ever calling checkAccent',
      () => {
        const parsed = updateSettingsSchema.safeParse({ appearance: { ...FULL_APPEARANCE, accentOverride: "" } });
        assert.equal(parsed.success, true, 'accentOverride:"" must always parse regardless of the preset');
        return Promise.resolve();
      },
    );

    let heroVersion = "";
    let logoVersion = "";

    await scenario(
      12,
      '(A8) hero ref flow, step 1: with a logo already saved, uploading hero bytes alone does NOT make resolveActiveVersion("heroImage") resolve — nothing is "live" until a Settings save actually references the upload',
      async () => {
        await reset();
        const logoBytes = Buffer.from("appearance-live-logo", "utf8");
        const logoPut = await putBrandingAsset(LOGO, logoBytes, CONTENT_TYPE);
        logoVersion = logoPut.version;
        await routeShapedUpdate({ logo: localRef(LOGO, logoVersion) });
        assert.equal(await resolveActiveVersion(LOGO), logoVersion, "the saved logo must resolve before the hero flow even starts (setup sanity)");

        const heroBytes = Buffer.from("appearance-live-hero-v1", "utf8");
        const heroPut = await putBrandingAsset(HERO_IMAGE, heroBytes, CONTENT_TYPE);
        heroVersion = heroPut.version;
        assert.equal(await resolveActiveVersion(HERO_IMAGE), null, "an upload with no Settings save yet must resolve to null");
      },
    );

    await scenario(
      13,
      "(A8) hero ref flow, step 2: once a route-shaped save writes appearance.heroImage to that upload's ref, resolveActiveVersion returns the NEW version",
      async () => {
        assert.ok(heroVersion, "scenario 12 must have recorded a hero upload version to reference here");
        await routeShapedUpdate({ appearance: { ...FULL_APPEARANCE, heroImage: localRef(HERO_IMAGE, heroVersion) } });
        assert.equal(await resolveActiveVersion(HERO_IMAGE), heroVersion, "resolveActiveVersion must now return the saved hero version");
      },
    );

    await scenario(
      14,
      "(A8) hero ref flow, step 3: settings.logo's own resolution is undisturbed by the appearance-only save above — the flat logo field and the nested appearance.heroImage field never cross-wire",
      async () => {
        assert.ok(logoVersion, "scenario 12 must have recorded a logo version to reference here");
        // Mutation this catches: an appearance save implemented as a
        // full-document replace instead of a partial $set — that would wipe
        // every sibling top-level field, logo included, even though this
        // scenario's own routeShapedUpdate (in scenario 13) never mentioned it.
        assert.equal(await resolveActiveVersion(LOGO), logoVersion, "logo must still resolve to its saved version after an appearance-only save");
      },
    );
  } finally {
    // Scenarios 12-14 call putBrandingAsset for both the logo and hero slots,
    // creating BrandingAsset documents that reset() (Settings-only, by design
    // — see its own comment) never touches — drop them here so a repeat run
    // starts from a genuinely clean scratch DB.
    await Promise.all([
      Settings.collection.drop().catch(() => undefined),
      BrandingAsset.collection.drop().catch(() => undefined),
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
