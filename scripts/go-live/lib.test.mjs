// node --test scripts/go-live/lib.test.mjs — the pure half of the go-live tool.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import {
  buildEnv, DEFAULT_ROOT_DOMAIN, healthVerdict, isStrongPassword, mergeProfile, migrateHosting, mintSecrets, parsePlatform, pickVercelDomain,
  profileNameForHost, projectNameForHost, projectNameOf, redactSecrets, RESERVED_SUBDOMAINS, secretsOf, splitDomain, tableNames, tenantOf, validateClient, validatePlatform, webAddressRecords,
} from "./lib.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..", "..");
const readJson = (p) => JSON.parse(readFileSync(p, "utf8"));

function validClient(overrides = {}) {
  return {
    slug: "sunrise-demo",
    vercel: { token: "tok_abc", project: null, teamId: null },
    subdomain: null,
    mongodbUri: "mongodb+srv://u:p@cluster0.abc.mongodb.net/pos?retryWrites=true&w=majority",
    admin: { username: "admin", password: "Strong-Pass-1!" },
    cafe: { name: "Sunrise Café", gst: { enabled: true, rate: 5, mode: "inclusive" } },
    tables: 8,
    menu: [{ category: "Coffee", items: [{ name: "Espresso", price: 90 }] }],
    image: null,
    ...overrides,
  };
}

test("a filled-in client file validates clean", () => {
  assert.deepEqual(validateClient(validClient()), []);
});

test("the example files validate once the placeholders are replaced, and fail while they are not", () => {
  for (const name of ["client.example.json", "demo.example.json"]) {
    const example = readJson(path.join(HERE, name));
    const unfilled = validateClient(example);
    assert.ok(unfilled.length > 0, `${name} must NOT validate with <placeholders> still in it`);
    assert.ok(unfilled.every((e) => /placeholder/.test(e)), `${name}: every error must be about a placeholder, got:\n${unfilled.join("\n")}`);
    assert.ok(unfilled.some((e) => e.startsWith("vercel.token:")) && unfilled.some((e) => e.startsWith("mongodbUri:")) && unfilled.some((e) => e.startsWith("admin.password:")), `${name}: token, URI and password are the placeholders`);
    const filled = {
      ...example,
      slug: example.slug.startsWith("<") ? "some-cafe" : example.slug,
      vercel: { ...example.vercel, token: "tok_x" },
      subdomain: typeof example.subdomain === "string" && example.subdomain.startsWith("<") ? "some-cafe" : example.subdomain,
      mongodbUri: "mongodb+srv://u:p@c.mongodb.net/pos?retryWrites=true",
      admin: { username: "admin", password: "Strong-Pass-1!" },
      cafe: { ...example.cafe, name: example.cafe.name.startsWith("<") ? "Some Café" : example.cafe.name },
    };
    // subdomain non-null requires a platform (§1.3) — the example files ship with none configured here.
    assert.deepEqual(validateClient(filled, { apexDomain: "sandbee.in", dnsNote: null }), [], `${name} must validate once filled in (with a platform, since it now carries a subdomain)`);
  }
});

test("validation reports every problem at once, with the reserved-slug and db-path rules", () => {
  const errors = validateClient(validClient({ slug: "www", mongodbUri: "mongodb+srv://u:p@c.mongodb.net/?retryWrites=true", admin: { username: "admin", password: "weak" } }));
  assert.equal(errors.length, 3, errors.join("\n"));
  assert.match(errors[0], /reserved/);
  assert.match(errors[1], /database name/);
  assert.match(errors[2], /8 chars/);
  for (const r of RESERVED_SUBDOMAINS) assert.ok(validateClient(validClient({ slug: r })).some((e) => /reserved/.test(e)), r);
});

test("validation covers tables, menu and image blocks", () => {
  assert.ok(validateClient(validClient({ tables: 0 })).some((e) => /^tables:/.test(e)));
  assert.ok(validateClient(validClient({ tables: ["T-1", "T-1"] })).some((e) => /twice/.test(e)));
  assert.ok(validateClient(validClient({ tables: ["Bad/Name"] })).some((e) => /^tables:/.test(e)));
  assert.ok(validateClient(validClient({ menu: [{ category: "Coffee", items: [{ name: "X", price: -1 }] }] })).some((e) => /price/.test(e)));
  assert.ok(validateClient(validClient({ menu: [{ category: "A", items: [{ name: "X", price: 1 }] }, { category: "B", items: [{ name: "X", price: 2 }] }] })).some((e) => /twice/.test(e)));
  assert.ok(validateClient(validClient({ image: { store: "r2", bucket: "b" } })).filter((e) => /^image\./.test(e)).length >= 3);
  assert.deepEqual(validateClient(validClient({ image: { store: "cloudinary", cloudName: "c", apiKey: "k", apiSecret: "s" } })), []);
});

test("parsePlatform / validatePlatform: the platform file's shape", () => {
  assert.equal(parsePlatform(null), null);
  assert.equal(parsePlatform("not json"), null);
  assert.equal(parsePlatform(JSON.stringify({ apexDomain: "not valid!" })), null, "an invalid apex parses to null (legacy mode)");
  assert.deepEqual(parsePlatform(JSON.stringify({ apexDomain: "sandbee.in", dnsNote: "GoDaddy" })), { apexDomain: "sandbee.in", dnsNote: "GoDaddy" });
  assert.deepEqual(parsePlatform(JSON.stringify({ apexDomain: "sandbee.in" })), { apexDomain: "sandbee.in", dnsNote: null }, "dnsNote is optional");
  assert.deepEqual(parsePlatform(JSON.stringify({ apexDomain: "sandbee.in", extra: 1 })), { apexDomain: "sandbee.in", dnsNote: null }, "anything else is ignored");

  assert.deepEqual(validatePlatform({ apexDomain: "sandbee.in", dnsNote: "x" }), []);
  assert.deepEqual(validatePlatform({ apexDomain: "sandbee.in" }), []);
  assert.ok(validatePlatform({ apexDomain: "" }).some((e) => /^apexDomain:/.test(e)));
  assert.ok(validatePlatform({ apexDomain: "Sandbee.in" }).some((e) => /^apexDomain:/.test(e)), "must be lowercase");
  assert.ok(validatePlatform({ apexDomain: "sandbee-two.vercel.app" }).some((e) => /vercel\.app/.test(e)), "must not be a Vercel address");
  assert.ok(validatePlatform({ apexDomain: "a".repeat(254) }).some((e) => /^apexDomain:/.test(e)), "253 char ceiling");
  assert.ok(validatePlatform({}).some((e) => /^apexDomain:/.test(e)));
});

test("migrateHosting: keeps an explicit subdomain, promotes a matching domain.<apex>, leaves everything else untouched", () => {
  const platform = { apexDomain: "sandbee.in", dnsNote: null };
  // Branch 1: client.subdomain is already a string → subdomain wins; ANY leftover `domain`
  // key (string or null) is removed — equal to the resulting host → note null; anything
  // else → a note naming the removed field (a stale domain must never block a run, but
  // the owner is told it was dropped, not silently).
  const kept = migrateHosting({ slug: "x", subdomain: "lucifer", domain: "lucifer.sandbee.in" }, platform);
  assert.equal(kept.client.subdomain, "lucifer"); assert.equal("domain" in kept.client, false); assert.equal(kept.note, null);
  const droppedDifferentDomain = migrateHosting({ slug: "x", subdomain: "lucifer", domain: "other.thing" }, platform);
  assert.equal("domain" in droppedDifferentDomain.client, false, "a domain that does NOT equal the resulting host is REMOVED too, not left for validateClient to reject");
  assert.equal(droppedDifferentDomain.client.subdomain, "lucifer");
  assert.equal(droppedDifferentDomain.note, "the old domain field (other.thing) was removed — the web address is lucifer.sandbee.in");
  const droppedNullDomain = migrateHosting({ slug: "x", subdomain: "lucifer", domain: null }, platform);
  assert.equal("domain" in droppedNullDomain.client, false, "a null domain key is removed too");
  assert.equal(droppedNullDomain.note, null, "null never named anything else, so no note");
  // Branch 2: no subdomain, but domain ends with ".<apex>" and the remainder has no further dot → promoted.
  const promoted = migrateHosting({ slug: "pos", subdomain: undefined, domain: "pos.sandbee.in" }, platform);
  assert.equal(promoted.client.subdomain, "pos"); assert.equal("domain" in promoted.client, false);
  assert.match(promoted.note, /domain pos\.sandbee\.in became subdomain pos/);
  // Branch 3: left untouched — no platform, or domain does not end with .<apex>, or remainder has a dot.
  const noPlatform = migrateHosting({ slug: "pos", domain: "pos.sandbee.in" }, null);
  assert.equal(noPlatform.client.domain, "pos.sandbee.in"); assert.equal("subdomain" in noPlatform.client, false); assert.equal(noPlatform.note, null);
  const wrongApex = migrateHosting({ slug: "pos", domain: "pos.other.in" }, platform);
  assert.equal(wrongApex.client.domain, "pos.other.in"); assert.equal(wrongApex.note, null);
  const extraDot = migrateHosting({ slug: "pos", domain: "sub.pos.sandbee.in" }, platform);
  assert.equal(extraDot.client.domain, "sub.pos.sandbee.in", "a remainder with its own dot is not a bare subdomain — left for validateClient"); assert.equal(extraDot.note, null);
  const neither = migrateHosting({ slug: "pos" }, platform);
  assert.equal("subdomain" in neither.client, false); assert.equal("domain" in neither.client, false); assert.equal(neither.note, null);
});

test("validateClient: domain is always an error now; subdomain rules (shape/reserved/platform-required); required only for a new, undeployed client", () => {
  const platform = { apexDomain: "sandbee.in", dnsNote: null };
  const withDomain = validateClient(validClient({ domain: "lucifer.sandbee.in" }), platform);
  assert.ok(withDomain.some((e) => /^domain:/.test(e) && /own domains are no longer used/.test(e) && /sandbee\.in/.test(e)));
  const withDomainNoPlatform = validateClient(validClient({ domain: "x" }));
  assert.ok(withDomainNoPlatform.some((e) => /^domain:/.test(e) && /<apex>/.test(e)), "apex falls back to the literal <apex> placeholder with no platform");

  assert.ok(validateClient(validClient({ subdomain: "Lucifer" }), platform).some((e) => /^subdomain:/.test(e) && /lowercase/.test(e)));
  assert.ok(validateClient(validClient({ subdomain: "a_b" }), platform).some((e) => /^subdomain:/.test(e)));
  assert.ok(validateClient(validClient({ subdomain: "www" }), platform).some((e) => /reserved/.test(e)));
  assert.ok(validateClient(validClient({ subdomain: "lucifer" }), null).some((e) => /^subdomain:/.test(e) && /set the apex domain first/.test(e)), "a subdomain with no platform configured is an error");
  assert.deepEqual(validateClient(validClient({ subdomain: "lucifer" }), platform), []);

  // null/absent subdomain: fine once deployed (generated.projectId), even with a platform configured (legacy *.vercel.app host).
  assert.deepEqual(validateClient(validClient({ subdomain: null, generated: { projectId: "prj_1" } }), platform), []);
  // Not deployed + a platform exists → required.
  assert.ok(validateClient(validClient({ subdomain: null }), platform).some((e) => /^subdomain:/.test(e) && /required/.test(e)));
  assert.ok(validateClient(validClient({ subdomain: undefined }), platform).some((e) => /^subdomain:/.test(e) && /required/.test(e)));
  // No platform at all: existing behaviour (no subdomain, no domain) stays clean — legacy mode.
  assert.deepEqual(validateClient(validClient({ subdomain: null })), []);
  assert.deepEqual(validateClient(validClient({ subdomain: undefined })), []);
});

test("webAddressRecords: CNAME always, rank-1 recommended target preferred, one TXT row per verification[] entry with a name RELATIVE to the apex (entry.domain minus \".<apex>\", per plan §4.3 step 4)", () => {
  const rows = webAddressRecords({ subdomain: "lucifer", apex: "sandbee.in", recommendedCname: "abc.vercel-dns-017.com", verification: [{ type: "TXT", domain: "_vercel.lucifer.sandbee.in", value: "vc-domain-verify=abc" }] });
  assert.deepEqual(rows[0], { type: "CNAME", name: "lucifer", value: "abc.vercel-dns-017.com" });
  assert.deepEqual(rows[1], { type: "TXT", name: "_vercel.lucifer", value: "vc-domain-verify=abc" }, 'relative to the apex only — "_vercel.lucifer.sandbee.in" minus ".sandbee.in"');
  assert.equal(rows.length, 2);
  const noTxt = webAddressRecords({ subdomain: "lucifer", apex: "sandbee.in", recommendedCname: "cname.vercel-dns.com", verification: undefined });
  assert.equal(noTxt.length, 1);
  const atApex = webAddressRecords({ subdomain: "lucifer", apex: "sandbee.in", recommendedCname: "cname.vercel-dns.com", verification: [{ type: "TXT", domain: "sandbee.in", value: "v" }] });
  assert.equal(atApex[1].name, "@", "a verification entry exactly equal to the apex is named @, not an empty string");
  const nonTxtIgnored = webAddressRecords({ subdomain: "lucifer", apex: "sandbee.in", recommendedCname: "cname.vercel-dns.com", verification: [{ type: "OTHER", domain: "x", value: "y" }] });
  assert.equal(nonTxtIgnored.length, 1, "only TXT entries become records");
});

test("standbyHosts: the same cafe on other Vercel accounts — label rules, a real token each, optional project name; helper names are deterministic", () => {
  assert.deepEqual(validateClient(validClient({ standbyHosts: [] })), []);
  assert.deepEqual(validateClient(validClient({ standbyHosts: [{ label: "standby", vercel: { token: "tok_second", project: null, teamId: null } }, { label: "backup-2", vercel: { token: "tok_third", project: "sunrise-b2" } }] })), []);
  const bad = validateClient(validClient({ standbyHosts: [{ label: "primary", vercel: { token: "t_ok_1" } }, { label: "Bad Label", vercel: { token: "" } }, { label: "x", vercel: { token: "<vercel-token>" } }, { label: "x", vercel: { token: "tok_dup", project: "Bad_Name" } }] }));
  assert.ok(bad.some((e) => /"primary" is the main host/.test(e)));
  assert.ok(bad.some((e) => /standbyHosts\[1\]\.label/.test(e)) && bad.some((e) => /standbyHosts\[1\]\.vercel\.token/.test(e)));
  assert.ok(bad.some((e) => /standbyHosts\[2\]\.vercel\.token: still a <placeholder>/.test(e)));
  assert.ok(bad.some((e) => /standbyHosts\[3\]\.label: "x" is used twice/.test(e)) && bad.some((e) => /standbyHosts\[3\]\.vercel\.project/.test(e)));
  assert.ok(validateClient(validClient({ standbyHosts: "nope" })).some((e) => /must be a list/.test(e)));
  const c = validClient({ standbyHosts: [{ label: "standby", vercel: { token: "t" } }, { label: "b2", vercel: { token: "t", project: "custom-name" } }] });
  assert.equal(projectNameForHost(c, undefined), "sunrise-demo"); assert.equal(projectNameForHost(c, "primary"), "sunrise-demo");
  assert.equal(projectNameForHost(c, "standby"), "sunrise-demo-standby", "default standby project name is <slug>-<label>");
  assert.equal(projectNameForHost(c, "b2"), "custom-name");
  assert.equal(profileNameForHost("sunrise-demo", "primary"), "sunrise-demo"); assert.equal(profileNameForHost("sunrise-demo", "standby"), "sunrise-demo-standby");
});

test("password rule mirrors seed-admin.ts (8+ chars, a digit, a special character)", () => {
  assert.equal(isStrongPassword("Strong-Pass-1!"), true);
  assert.equal(isStrongPassword("abcdefg1"), false);
  assert.equal(isStrongPassword("abcdefg!"), false);
  assert.equal(isStrongPassword("Ab1!"), false);
});

test("tables are REQUIRED per client (CR1.1: no compile-time floor plan) — a count or explicit names", () => {
  assert.ok(validateClient(validClient({ tables: undefined })).some((e) => /^tables: required/.test(e)));
  assert.ok(validateClient(validClient({ tables: null })).some((e) => /^tables: required/.test(e)));
  assert.deepEqual(tableNames(3), ["T-1", "T-2", "T-3"]);
  assert.deepEqual(tableNames(["Bar 1", "Roof"]), ["Bar 1", "Roof"]);
  assert.deepEqual(tableNames(undefined), []);
  // The identifier is assembled, not written: apps/cafe/lib/table-constants-pin.test.ts
  // walks every source file (this one included) for the literal token.
  const frozenList = ["TABLE", "NUMBERS"].join("_");
  const seeder = readFileSync(path.join(ROOT, "apps/cafe/scripts/seed-client.ts"), "utf8");
  assert.ok(!new RegExp(`\\b${frozenList}\\b`).test(seeder), `seed-client.ts must not import the frozen ${frozenList} list (lib/table-constants-pin.test.ts)`);
});

test("the tenant is read from the domain Vercel actually assigned — never assumed from the name", () => {
  const domains = [{ name: "sunrise-demo-x7k2.vercel.app", apexName: "vercel.app", verified: true }];
  assert.equal(pickVercelDomain(domains), "sunrise-demo-x7k2.vercel.app");
  assert.equal(pickVercelDomain([]), null);
  assert.equal(pickVercelDomain([{ name: "cafe.example.com" }]), null);
  assert.equal(pickVercelDomain([{ name: "sunrise-git-main.vercel.app", gitBranch: "main" }, { name: "sunrise.vercel.app" }]), "sunrise.vercel.app", "a git-branch alias is never the tenant host");
  // Several *.vercel.app names on one project: the project's OWN name wins, whatever the list order — the owner's demo carried
  // "possandbee-two" first and TENANT_ID got pinned to the wrong host.
  const two = [{ name: "possandbee-two.vercel.app", verified: true }, { name: "possandbee.vercel.app", verified: true }];
  assert.equal(pickVercelDomain(two, "possandbee"), "possandbee.vercel.app");
  assert.equal(pickVercelDomain(two, "PossAndBee"), "possandbee.vercel.app", "case-insensitive");
  assert.equal(pickVercelDomain([{ name: "x-abc.vercel.app", verified: false }, { name: "x-def.vercel.app", verified: true }], "x"), "x-def.vercel.app", "no canonical → a verified one beats an unverified one");
  assert.equal(pickVercelDomain(two), "possandbee-two.vercel.app", "with no project name only the first verified is left");
  assert.equal(tenantOf(validClient({ vercel: { token: "t", project: "possandbee" } }), two).tenantId, "possandbee", "tenantOf derives the project name from the client when not given");
  const t = tenantOf(validClient(), domains);
  assert.deepEqual(t, { tenantId: "sunrise-demo-x7k2", rootDomain: DEFAULT_ROOT_DOMAIN, host: "sunrise-demo-x7k2.vercel.app", shape: "vercel" });
  assert.equal(tenantOf(validClient(), []), null);
});

test("splitDomain still splits a host into its first label + the rest (used internally for the platform host)", () => {
  assert.deepEqual(splitDomain("demo.pos.sandbee.in"), { label: "demo", root: "pos.sandbee.in" });
});

test("tenantOf: a subdomain + platform apex is the 'platform' shape; without a platform it falls back to the *.vercel.app shape", () => {
  const platform = { apexDomain: "sandbee.in", dnsNote: null };
  const t = tenantOf(validClient({ subdomain: "lucifer" }), [], "sunrise-demo", platform);
  assert.deepEqual(t, { tenantId: "lucifer", rootDomain: "sandbee.in", host: "lucifer.sandbee.in", shape: "platform" });
  // No platform passed (run.mjs passes it only for the primary slot) → the vercel shape, even with a subdomain set.
  const domains = [{ name: "sunrise-demo-x7k2.vercel.app", apexName: "vercel.app", verified: true }];
  const noPlatform = tenantOf(validClient({ subdomain: "lucifer" }), domains, "sunrise-demo", null);
  assert.deepEqual(noPlatform, { tenantId: "sunrise-demo-x7k2", rootDomain: DEFAULT_ROOT_DOMAIN, host: "sunrise-demo-x7k2.vercel.app", shape: "vercel" });
  // subdomain null → vercel shape regardless of platform.
  const noSub = tenantOf(validClient({ subdomain: null }), domains, "sunrise-demo", platform);
  assert.equal(noSub.shape, "vercel");
});

test("projectNameOf prefers an explicit vercel.project", () => {
  assert.equal(projectNameOf(validClient()), "sunrise-demo");
  assert.equal(projectNameOf(validClient({ vercel: { token: "t", project: "pos-sunrise" } })), "pos-sunrise");
});

test("buildEnv: the DEPLOY.md required set, both auth names, no image vars without a store", () => {
  const tenant = { tenantId: "sunrise-demo", rootDomain: "vercel.app", host: "sunrise-demo.vercel.app" };
  const envs = buildEnv(validClient(), tenant, { authSecret: "AUTH", healthStatsToken: "HS" });
  const byKey = Object.fromEntries(envs.map((e) => [e.key, e]));
  for (const k of ["AUTH_SECRET", "CORE_MONGODB_URI", "HEALTH_STATS_TOKEN", "HOSTING_TIER", "MONGODB_URI", "NEXTAUTH_SECRET", "ROOT_DOMAIN", "TENANT_ID"]) assert.ok(k in byKey, k);
  // No store configured: IMAGE_STORE falls to the cafe default and EVERY store key is written blank (upsert cannot delete; "" reads as unset in the cafe).
  assert.equal(byKey.IMAGE_STORE.value, "r2");
  for (const k of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "NEXT_PUBLIC_R2_PUBLIC_BASE_URL", "CLOUDINARY_CLOUD_NAME", "CLOUDINARY_API_KEY", "CLOUDINARY_API_SECRET", "NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME"]) assert.equal(byKey[k].value, "", k);
  assert.equal(envs.length, 18);
  assert.equal(byKey.TENANT_ID.value, "sunrise-demo");
  assert.equal(byKey.TENANT_ID.type, "plain");
  assert.equal(byKey.ROOT_DOMAIN.value, "vercel.app");
  assert.equal(byKey.MONGODB_URI.type, "encrypted");
  assert.equal(byKey.AUTH_SECRET.value, byKey.NEXTAUTH_SECRET.value);
  assert.ok(!("NEXTAUTH_URL" in byKey) && !("AUTH_URL" in byKey), "NEXTAUTH_URL/AUTH_URL must never be set (trustHost)");
  for (const e of envs) assert.deepEqual(e.target, ["production", "preview"]);
});

test("buildEnv: TENANT_ID is omitted while unknown (first deploy of the two-deploy fallback)", () => {
  const envs = buildEnv(validClient(), { tenantId: null, rootDomain: "vercel.app" }, { authSecret: "A", healthStatsToken: "H" });
  assert.ok(!envs.some((e) => e.key === "TENANT_ID"));
  assert.ok(envs.some((e) => e.key === "ROOT_DOMAIN" && e.value === "vercel.app"));
});

test("buildEnv: the selected store's keys carry values, the other store's keys are blanked (a store switch never leaves stale credentials live)", () => {
  const tenant = { tenantId: "x", rootDomain: "vercel.app" };
  const gen = { authSecret: "A", healthStatsToken: "H" };
  const r2 = Object.fromEntries(buildEnv(validClient({ image: { store: "r2", accountId: "acc", accessKeyId: "k", secretAccessKey: "s", bucket: "b", publicBaseUrl: "https://pub.r2.dev" } }), tenant, gen).map((e) => [e.key, e.value]));
  assert.equal(r2.IMAGE_STORE, "r2"); assert.equal(r2.R2_ACCOUNT_ID, "acc"); assert.equal(r2.R2_SECRET_ACCESS_KEY, "s"); assert.equal(r2.NEXT_PUBLIC_R2_PUBLIC_BASE_URL, "https://pub.r2.dev");
  assert.equal(r2.CLOUDINARY_CLOUD_NAME, ""); assert.equal(r2.CLOUDINARY_API_SECRET, ""); assert.equal(r2.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME, "");
  const cl = Object.fromEntries(buildEnv(validClient({ image: { store: "cloudinary", cloudName: "c", apiKey: "k", apiSecret: "s" } }), tenant, gen).map((e) => [e.key, e.value]));
  assert.equal(cl.IMAGE_STORE, "cloudinary"); assert.equal(cl.CLOUDINARY_CLOUD_NAME, "c"); assert.equal(cl.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME, "c"); assert.equal(cl.CLOUDINARY_API_SECRET, "s");
  for (const k of ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "NEXT_PUBLIC_R2_PUBLIC_BASE_URL"]) assert.equal(cl[k], "", k);
});

test("secretsOf + redactSecrets: every credential in a client file is scrubbed from text, URIs always", () => {
  const c = validClient({ image: { store: "r2", accountId: "acc", accessKeyId: "AKIA-KEY-1", secretAccessKey: "s3cr3t-key-long", bucket: "b", publicBaseUrl: "https://pub.r2.dev" }, accounts: { vercel: { email: "o@x", password: "vercel-pw-99" } }, generated: { authSecret: "AUTHSECRETVALUE", healthStatsToken: "healthtoken" }, standbyHosts: [{ label: "standby", vercel: { token: "tok_standby_secret" } }], cloudflare: { token: "cf-token-secret-1", publishSecret: "cf-publish-secret-1" } });
  const s = secretsOf(c);
  for (const v of ["tok_abc", "tok_standby_secret", "Strong-Pass-1!", "s3cr3t-key-long", "AKIA-KEY-1", "vercel-pw-99", "AUTHSECRETVALUE", "healthtoken", "cf-token-secret-1", "cf-publish-secret-1", c.mongodbUri]) assert.ok(s.includes(v), v);
  assert.ok(!s.includes("p"), "a 1-char URI password must not become a global replacement");
  assert.equal(s[0], c.mongodbUri, "longest first");
  const text = `token tok_abc failed; uri ${c.mongodbUri}; pw Strong-Pass-1!; other mongodb://root:hunter2@host/db`;
  const out = redactSecrets(text, s);
  assert.equal(out, "token ••• failed; uri •••; pw •••; other mongodb://•••@host/db");
  assert.equal(redactSecrets("nothing here", []), "nothing here");
});

test("mintSecrets keeps what exists and mints only what is missing", () => {
  let n = 0;
  const randomBytes = (len) => Buffer.alloc(len, ++n);
  const first = mintSecrets(undefined, randomBytes);
  assert.equal(first.authSecret, Buffer.alloc(32, 1).toString("base64"));
  assert.equal(first.healthStatsToken, Buffer.alloc(32, 2).toString("hex"));
  const again = mintSecrets({ ...first, projectId: "prj_1" }, randomBytes);
  assert.equal(again.authSecret, first.authSecret);
  assert.equal(again.healthStatsToken, first.healthStatsToken);
  assert.equal(again.projectId, "prj_1");
  assert.equal(n, 2, "no extra randomness consumed on the re-run");
});

test("mergeProfile adds one profile and leaves the others byte-identical", () => {
  const before = { lucifer007: { app: "apps/cafe", orgId: "team_a", projectId: "prj_a", scope: null, tokenEnv: "VERCEL_TOKEN", token: null } };
  const after = mergeProfile(before, "sunrise-demo", { orgId: "team_b", projectId: "prj_b", token: "tok" });
  assert.deepEqual(after.lucifer007, before.lucifer007);
  assert.deepEqual(after["sunrise-demo"], { app: "apps/cafe", orgId: "team_b", projectId: "prj_b", scope: null, tokenEnv: null, token: "tok" });
  assert.deepEqual(mergeProfile(null, "x", { orgId: "o", projectId: "p", token: "t" }).x.projectId, "p");
  assert.equal(mergeProfile({}, "y", { orgId: "o", projectId: "p", token: "t", teamId: "team_slug" }).y.scope, "team_slug", "a team token's scope reaches deploy.mjs --scope");
});

test("healthVerdict: 200 ok/up with the matching tenant passes; everything else names the cause", () => {
  assert.equal(healthVerdict(200, { ok: true, db: "up", tenant: "sunrise" }, "sunrise").ok, true);
  assert.match(healthVerdict(503, { ok: false, db: "down", tenant: "sunrise" }, "sunrise").reason, /Atlas Network Access/);
  assert.match(healthVerdict(200, { ok: true, db: "up", tenant: "dev" }, "sunrise").reason, /disagree/);
  assert.match(healthVerdict(404, null, "sunrise").reason, /HTTP 404/);
});

test("the mirrored constants still match the cafe app's source", () => {
  const platform = readFileSync(path.join(ROOT, "apps/cafe/lib/platform.ts"), "utf8");
  const m = platform.match(/RESERVED_SUBDOMAINS: readonly string\[\] = \[([\s\S]*?)\];/);
  assert.ok(m, "RESERVED_SUBDOMAINS not found in apps/cafe/lib/platform.ts");
  const fromCafe = [...m[1].matchAll(/"([a-z]+)"/g)].map((x) => x[1]);
  assert.deepEqual(RESERVED_SUBDOMAINS, fromCafe);
  const shared = readFileSync(path.join(ROOT, "packages/shared/src/constants.ts"), "utf8");
  assert.match(shared, /export const GST_RATES = \[0, 5, 12, 18, 28\]/);
  assert.match(shared, /export const GST_MODES = \["inclusive", "exclusive"\]/);
  assert.match(shared, /export const TABLE_NO_MAX_LEN = 24;/);
  assert.match(shared, /export const TABLE_NO_PATTERN = \/\^\[A-Za-z0-9\]\[A-Za-z0-9 _-\]\*\$\/;/);
  const seedAdmin = readFileSync(path.join(ROOT, "apps/cafe/scripts/seed-admin.ts"), "utf8");
  assert.match(seedAdmin, /password\.length >= 8 && \/\\d\/\.test\(password\) && \/\[\^A-Za-z0-9\]\/\.test\(password\)/);
});
