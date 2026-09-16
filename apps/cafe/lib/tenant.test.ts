import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveTenantFromHost } from "./tenant";

// resolveTenantFromHost reads ROOT_DOMAIN at call time, so setting it here (before
// any test callback runs) makes the production cases deterministic.
process.env.ROOT_DOMAIN = "example-pos.app";

test("production subdomain → tenant", async () => {
  assert.deepEqual(await resolveTenantFromHost("cafe.example-pos.app"), {
    tenantId: "cafe",
    subdomain: "cafe",
  });
});

test("strips the port", async () => {
  assert.deepEqual(await resolveTenantFromHost("cafe.example-pos.app:443"), {
    tenantId: "cafe",
    subdomain: "cafe",
  });
});

test("is case-insensitive", async () => {
  assert.deepEqual(await resolveTenantFromHost("Cafe.Example-POS.App"), {
    tenantId: "cafe",
    subdomain: "cafe",
  });
});

test("dev: *.localhost → subdomain", async () => {
  assert.deepEqual(await resolveTenantFromHost("cafe.localhost"), {
    tenantId: "cafe",
    subdomain: "cafe",
  });
});

test("dev: bare localhost / loopback → dev tenant", async () => {
  assert.deepEqual(await resolveTenantFromHost("localhost:3000"), {
    tenantId: "dev",
    subdomain: "dev",
  });
  assert.deepEqual(await resolveTenantFromHost("127.0.0.1"), {
    tenantId: "dev",
    subdomain: "dev",
  });
});

test("preview: <sub>---<branch>.vercel.app → sub", async () => {
  assert.deepEqual(await resolveTenantFromHost("cafe---main.vercel.app"), {
    tenantId: "cafe",
    subdomain: "cafe",
  });
});

test("reserved subdomains → null", async () => {
  for (const r of ["www", "app", "api", "admin", "hub"]) {
    assert.equal(
      await resolveTenantFromHost(`${r}.example-pos.app`),
      null,
      `${r} must not resolve to a tenant`,
    );
  }
});

test("apex domain (no subdomain) → null", async () => {
  assert.equal(await resolveTenantFromHost("example-pos.app"), null);
});

test("unknown custom domain (F1 stub) → null", async () => {
  assert.equal(await resolveTenantFromHost("some-cafe.com"), null);
});

test("a bare *.vercel.app host (no ---) → null (served via the proxied hostname)", async () => {
  assert.equal(await resolveTenantFromHost("my-project.vercel.app"), null);
});

test("empty / missing host → null", async () => {
  assert.equal(await resolveTenantFromHost(""), null);
  assert.equal(await resolveTenantFromHost(null), null);
  assert.equal(await resolveTenantFromHost(undefined), null);
});
