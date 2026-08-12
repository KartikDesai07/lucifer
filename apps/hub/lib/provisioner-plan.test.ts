import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  assertProvisionableSlug,
  atlasClusterName,
  atlasProjectName,
  buildClusterRegistryDoc,
  buildCoreMirror,
  buildOrdersLedgerEntry,
  buildTenantEnv,
  CLUSTER_REGISTRY_COLLECTION,
  CLUSTER_REGISTRY_ID,
  CORE_TAG,
  domainFor,
  ORDERS_LEDGER_TAG,
  RESERVED_SUBDOMAINS,
  sealDocUri,
  STEP_DONE,
  STEP_ORDER,
  stepsAfter,
  vercelProjectName,
} from "./provisioner-plan";

// DB-free unit tests for the PURE provisioner plan module + the cross-app
// contract parity guards (R7/R8 from the pre-code critique).

// ── step machine ─────────────────────────────────────────────────────────────
test("stepsAfter: intake/unknown ⇒ every step; done ⇒ none; a middle step ⇒ the tail", () => {
  assert.deepEqual(stepsAfter("intake"), [...STEP_ORDER]);
  assert.deepEqual(stepsAfter(undefined), [...STEP_ORDER]);
  assert.deepEqual(stepsAfter(STEP_DONE), []);
  assert.deepEqual(stepsAfter("db.orders"), ["image", "host.active", "host.standby", "domain", "seed", "invite"]);
  assert.deepEqual(stepsAfter("invite"), []);
});

// ── deterministic names ───────────────────────────────────────────────────────
test("resource names are deterministic per slug+role (the resume adoption key)", () => {
  assert.equal(atlasProjectName("lucifer-cafe", "primary"), "pos-lucifer-cafe-core");
  assert.equal(atlasProjectName("lucifer-cafe", "orders"), "pos-lucifer-cafe-orders-a");
  assert.equal(atlasClusterName("primary"), "pos-core");
  assert.equal(atlasClusterName("orders"), "pos-orders-a");
  assert.equal(vercelProjectName("lucifer-cafe"), "pos-lucifer-cafe");
  assert.equal(domainFor("lucifer-cafe", "pos.example"), "lucifer-cafe.pos.example");
});

// ── slug guard (R6) ───────────────────────────────────────────────────────────
test("assertProvisionableSlug rejects reserved subdomains + bad charsets, allows real slugs", () => {
  for (const bad of RESERVED_SUBDOMAINS) {
    assert.throws(() => assertProvisionableSlug(bad), /reserved/, `"${bad}" must be rejected`);
  }
  assert.throws(() => assertProvisionableSlug("Bad Slug"), /valid subdomain/);
  assert.throws(() => assertProvisionableSlug("café"), /valid subdomain/);
  assert.doesNotThrow(() => assertProvisionableSlug("lucifer-cafe"));
  assert.doesNotThrow(() => assertProvisionableSlug("cafe123"));
});

// ── buildTenantEnv (IMAGE_STORE gap + no org key + no ledger URI) ─────────────
test("buildTenantEnv: r2 tenant sets IMAGE_STORE=r2 + R2_* + CORE URI; never ATLAS_SA_* nor a ledger URI", () => {
  const env = buildTenantEnv({
    slug: "lucifer-cafe",
    rootDomain: "pos.example",
    coreSrv: "mongodb+srv://u:p@core.mongodb.net/pos",
    authSecret: "auth-secret",
    healthStatsToken: "health-token",
    image: { store: "r2", accountId: "acc", accessKeyId: "ak", secretAccessKey: "sk", bucket: "bkt", publicBaseUrl: "https://pub.r2.dev" },
  });
  const map = new Map(env.map((e) => [e.key, e]));
  assert.equal(map.get("IMAGE_STORE")?.value, "r2"); // the confirmed silent-500 gap
  assert.equal(map.get("CORE_MONGODB_URI")?.value, "mongodb+srv://u:p@core.mongodb.net/pos");
  assert.equal(map.get("MONGODB_URI")?.value, "mongodb+srv://u:p@core.mongodb.net/pos");
  assert.equal(map.get("TENANT_ID")?.value, "lucifer-cafe");
  assert.equal(map.get("ROOT_DOMAIN")?.value, "pos.example"); // R2: domain is not optional
  assert.equal(map.get("HOSTING_TIER")?.value, "B");
  assert.equal(map.get("AUTH_SECRET")?.value, "auth-secret");
  assert.equal(map.get("NEXTAUTH_SECRET")?.value, "auth-secret");
  assert.equal(map.get("R2_ACCESS_KEY_ID")?.type, "sensitive");
  assert.equal(map.get("NEXT_PUBLIC_R2_PUBLIC_BASE_URL")?.value, "https://pub.r2.dev");
  // dec 4: never leak an org-scoped key into a tenant app.
  assert.ok(![...map.keys()].some((k) => k.startsWith("ATLAS_SA")), "no ATLAS_SA_* in tenant env");
  // The orders URI rides the CORE doc, never env (F3.8 "no redeploy" invariant).
  assert.ok(![...map.keys()].some((k) => k.includes("ORDERS")), "no ledger/orders URI in env");
});

test("buildTenantEnv: cloudinary tenant sets IMAGE_STORE=cloudinary + CLOUDINARY_* (never defaults to r2)", () => {
  const env = buildTenantEnv({
    slug: "c", rootDomain: "pos.example", coreSrv: "mongodb+srv://u:p@core/pos", authSecret: "a", healthStatsToken: "h",
    image: { store: "cloudinary", cloudName: "cn", apiKey: "ak", apiSecret: "as" },
  });
  const map = new Map(env.map((e) => [e.key, e.value]));
  assert.equal(map.get("IMAGE_STORE"), "cloudinary");
  assert.equal(map.get("CLOUDINARY_CLOUD_NAME"), "cn");
  assert.equal(map.get("NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME"), "cn");
  assert.ok(!map.has("R2_ACCOUNT_ID"));
});

// ── runtime clusterRegistry doc (R1 + R8 shape invariants) ────────────────────
test("buildClusterRegistryDoc produces exactly one ACTIVE ledger resolving to the orders cluster", () => {
  const orders = buildOrdersLedgerEntry("pos-orders-a", "mongodb+srv://u:p@orders/pos");
  const core = buildCoreMirror("pos-core", "mongodb+srv://u:p@core/pos");
  const doc = buildClusterRegistryDoc(orders, core);
  assert.equal(doc._id, CLUSTER_REGISTRY_ID);
  assert.equal(doc.core.tag, CORE_TAG);
  assert.equal(doc.ledgers.length, 1);
  const active = doc.ledgers.filter((l) => l.active === true);
  assert.equal(active.length, 1, "activeEntryOf requires exactly one active ledger");
  assert.equal(active[0].id, "pos-orders-a");
  assert.equal(active[0].tag, ORDERS_LEDGER_TAG);
  assert.equal(active[0].from, null);
  assert.equal(active[0].to, null);
  assert.deepEqual(doc.standby, []);
});

test("sealDocUri is identity today (cafe decryptStoredUri is identity; F3.8 owns crypto)", () => {
  assert.equal(sealDocUri("mongodb+srv://u:p@h/pos"), "mongodb+srv://u:p@h/pos");
});

// ── cross-app contract parity (R8): pin against the SHIPPED cafe source ───────
function cafeSource(rel: string): string {
  return readFileSync(new URL(`../../cafe/lib/${rel}`, import.meta.url), "utf8");
}
function constOf(src: string, name: string): string | undefined {
  return new RegExp(`${name}\\s*=\\s*"([^"]+)"`).exec(src)?.[1];
}

test("PARITY: hub registry-doc constants match the cafe cluster-router (drift silently misroutes orders)", () => {
  const src = cafeSource("cluster-router.ts");
  assert.equal(CLUSTER_REGISTRY_ID, constOf(src, "CLUSTER_REGISTRY_ID"), "CLUSTER_REGISTRY_ID drift");
  assert.equal(CLUSTER_REGISTRY_COLLECTION, constOf(src, "CLUSTER_REGISTRY_COLLECTION"), "collection drift");
  assert.equal(CORE_TAG, constOf(src, "CORE_TAG"), "CORE_TAG drift");
  // The hub's day-one orders ledger tag must equal the cafe's bootstrap ledger tag.
  assert.equal(ORDERS_LEDGER_TAG, constOf(src, "BOOTSTRAP_LEDGER_TAG"), "ledger tag drift");
});

test("PARITY: hub RESERVED_SUBDOMAINS matches the cafe platform reject-set", () => {
  const src = cafeSource("platform.ts");
  // Match the `= [ … ]` assignment (not the `string[]` type annotation).
  const block = /RESERVED_SUBDOMAINS[^=]*=\s*\[([^\]]*)\]/.exec(src)?.[1] ?? "";
  const cafeList = [...block.matchAll(/"([^"]+)"/g)].map((m) => m[1]).sort();
  assert.deepEqual([...RESERVED_SUBDOMAINS].sort(), cafeList, "reserved-subdomain drift → cafe 404 on its own subdomain");
});
