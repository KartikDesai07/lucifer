import { test } from "node:test";
import assert from "node:assert/strict";
import {
  dinerBannerSchema,
  dinerBannersSchema,
  settingsSchema,
} from "@pos/shared/schemas";
import {
  DINER_BANNER_MAX,
  DINER_BANNER_TITLE_MAX_LEN,
  DINER_BANNER_BODY_MAX_LEN,
  publicDinerBanners,
} from "@pos/shared/public-diner";
import { dinerBannerMongooseSchema } from "@/models/settings.subschemas";
import { SETTINGS_SECTIONS } from "./settings-sections";

// CB-6C S1 — Zod bounds on the single-row schema: title required (1..40,
// trimmed), body optional (<=90, trimmed).

test("dinerBannerSchema: rejects an empty title", () => {
  const result = dinerBannerSchema.safeParse({ title: "", body: "" });
  assert.equal(result.success, false);
});

test("dinerBannerSchema: trims title and body, accepts a title-only banner", () => {
  const result = dinerBannerSchema.safeParse({ title: "  Diwali special  ", body: "" });
  assert.ok(result.success);
  assert.equal(result.data.title, "Diwali special");
  assert.equal(result.data.body, "");
});

test("dinerBannerSchema: title over the max length is rejected", () => {
  const result = dinerBannerSchema.safeParse({
    title: "x".repeat(DINER_BANNER_TITLE_MAX_LEN + 1),
    body: "",
  });
  assert.equal(result.success, false);
});

test("dinerBannerSchema: title at exactly the max length is accepted", () => {
  const result = dinerBannerSchema.safeParse({
    title: "x".repeat(DINER_BANNER_TITLE_MAX_LEN),
    body: "",
  });
  assert.ok(result.success);
});

test("dinerBannerSchema: body over the max length is rejected", () => {
  const result = dinerBannerSchema.safeParse({
    title: "Title",
    body: "y".repeat(DINER_BANNER_BODY_MAX_LEN + 1),
  });
  assert.equal(result.success, false);
});

test("dinerBannerSchema: body at exactly the max length is accepted", () => {
  const result = dinerBannerSchema.safeParse({
    title: "Title",
    body: "y".repeat(DINER_BANNER_BODY_MAX_LEN),
  });
  assert.ok(result.success);
});

// The array bound.

test("dinerBannersSchema: is optional — absent is valid", () => {
  const result = dinerBannersSchema.safeParse(undefined);
  assert.ok(result.success);
  assert.equal(result.data, undefined);
});

test(`dinerBannersSchema: accepts exactly ${DINER_BANNER_MAX} banners, rejects one more`, () => {
  const row = { title: "T", body: "" };
  const atMax = dinerBannersSchema.safeParse(Array.from({ length: DINER_BANNER_MAX }, () => row));
  assert.ok(atMax.success);

  const overMax = dinerBannersSchema.safeParse(Array.from({ length: DINER_BANNER_MAX + 1 }, () => row));
  assert.equal(overMax.success, false);
});

test("settingsSchema carries dinerBanners as an array field", () => {
  const result = settingsSchema.shape.dinerBanners.safeParse([{ title: "T", body: "B" }]);
  assert.ok(result.success);
});

// PARITY: the Zod row shape's keys must all be declared on the Mongoose
// subschema — same "Zod-valid, Mongoose-strict drops it" hazard as
// loyalty-milestone-schema-parity.test.ts.

test("PARITY: every Zod dinerBanner field is declared on the Mongoose subschema", () => {
  const zodKeys = Object.keys(dinerBannerSchema.shape).sort();
  const mongoosePaths = new Set(Object.keys(dinerBannerMongooseSchema.paths));

  assert.deepEqual(zodKeys, ["body", "title"], "sanity: the row shape is title+body");

  const missing = zodKeys.filter((key) => !mongoosePaths.has(key));
  assert.deepEqual(
    missing,
    [],
    `Mongoose strict:true will SILENTLY DROP these on save: ${missing.join(", ")}. ` +
      "Declare them in apps/cafe/models/settings.subschemas.ts.",
  );
});

test("PARITY: title is required on the Mongoose subschema, body is not", () => {
  const titlePath = dinerBannerMongooseSchema.path("title") as unknown as { isRequired?: boolean };
  const bodyPath = dinerBannerMongooseSchema.path("body") as unknown as { isRequired?: boolean };
  assert.ok(titlePath.isRequired, "title must be required — an empty row is not a real banner");
  assert.ok(
    !bodyPath.isRequired,
    "body must NOT be required — Mongoose String required rejects '' and a title-only banner's body is ''",
  );
});

// publicDinerBanners — the READ-side normaliser.

test("publicDinerBanners: non-array input returns []", () => {
  assert.deepEqual(publicDinerBanners(undefined), []);
  assert.deepEqual(publicDinerBanners(null), []);
  assert.deepEqual(publicDinerBanners("not an array"), []);
});

test("publicDinerBanners: drops rows with an empty/whitespace-only title", () => {
  const result = publicDinerBanners([
    { title: "  ", body: "kept out" },
    { title: "Real", body: "kept in" },
  ]);
  assert.deepEqual(result, [{ title: "Real", body: "kept in" }]);
});

test("publicDinerBanners: trims title and body", () => {
  const result = publicDinerBanners([{ title: "  Spaced  ", body: "  also spaced  " }]);
  assert.deepEqual(result, [{ title: "Spaced", body: "also spaced" }]);
});

test("publicDinerBanners: clamps title and body to their max lengths", () => {
  const longTitle = "a".repeat(DINER_BANNER_TITLE_MAX_LEN + 20);
  const longBody = "b".repeat(DINER_BANNER_BODY_MAX_LEN + 20);
  const result = publicDinerBanners([{ title: longTitle, body: longBody }]);
  assert.equal(result[0]!.title.length, DINER_BANNER_TITLE_MAX_LEN);
  assert.equal(result[0]!.body.length, DINER_BANNER_BODY_MAX_LEN);
});

test(`publicDinerBanners: caps the result at ${DINER_BANNER_MAX} banners`, () => {
  const raw = Array.from({ length: DINER_BANNER_MAX + 5 }, (_, i) => ({ title: `T${i}`, body: "" }));
  const result = publicDinerBanners(raw);
  assert.equal(result.length, DINER_BANNER_MAX);
});

test("publicDinerBanners: a row with no body defaults to empty string", () => {
  const result = publicDinerBanners([{ title: "Only title" }]);
  assert.deepEqual(result, [{ title: "Only title", body: "" }]);
});

test("publicDinerBanners: returns FRESH objects, never the input rows", () => {
  const inputRow = { title: "Original", body: "Body" };
  const result = publicDinerBanners([inputRow]);
  assert.notEqual(result[0], inputRow, "must not return the same object reference as the input row");
  result[0]!.title = "Mutated";
  assert.equal(inputRow.title, "Original", "mutating the result must not affect the input");
});

// settings-sections partition — this slice's edit (adding "dinerBanners" to
// qr-ordering) must keep the exactly-one-owner pin green.

test("PIN: settings-sections partition stays exact after adding dinerBanners", () => {
  const schemaKeys = new Set(Object.keys(settingsSchema.shape));
  const sectionKeys = SETTINGS_SECTIONS.flatMap((s) => s.fields);
  assert.ok(schemaKeys.has("dinerBanners"), "sanity: settingsSchema must carry dinerBanners");
  assert.equal(
    sectionKeys.filter((k) => k === "dinerBanners").length,
    1,
    "dinerBanners must belong to exactly one section",
  );
  const qrSection = SETTINGS_SECTIONS.find((s) => s.slug === "qr-ordering");
  assert.ok(qrSection, "qr-ordering section must exist");
  assert.ok(qrSection!.fields.includes("dinerBanners"), "qr-ordering must own dinerBanners");
});
