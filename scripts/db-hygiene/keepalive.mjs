import { assertDialableUri, redactUri } from "./lib.mjs";
import { loadClusterRows, pingCluster } from "./registry.mjs";

// ─────────────────────────────────────────────────────────────────────────────
// F2 Step F2.9 — keep-alive: `db.command({ping:1})` on EVERY owned cluster
// (CORE + all ledgers + any armed standby) so no free M0 ever hits the Atlas
// inactivity auto-pause. Driven by .github/workflows/db-keepalive.yml — that
// workflow's cron is the SINGLE source of truth for the cadence (every 3–5
// days). Standby is pinged deliberately: it idles until its flip, and a paused
// standby would fail F2.7's validate-before-activate.
//
// Exit 1 if ANY cluster fails its ping — a red run is the operator signal that
// a cluster is paused/dead BEFORE a report fans out over it. All pings are
// attempted regardless (one dead archive must not shield the rest).
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const coreUri = process.env.CORE_MONGODB_URI ?? process.env.MONGODB_URI;
  const { bootstrap, rows } = await loadClusterRows(coreUri);
  if (bootstrap) {
    console.log("[keepalive] no registry doc — bootstrap era, CORE is the only cluster");
  }

  const results = await Promise.all(
    rows.map(async (row) => {
      const label = `${row.role} ${row.tag ?? row.id}`;
      try {
        assertDialableUri(row.uri, label);
        await pingCluster(row.uri);
        console.log(`[keepalive] ok    ${label} (${redactUri(row.uri)})`);
        return true;
      } catch (err) {
        // Defense-in-depth: driver specs already redact credentials from error
        // messages, but a URI embedded by ANY future error path must not leak.
        console.error(`[keepalive] FAIL  ${label}: ${redactUri(err.message)}`);
        return false;
      }
    }),
  );

  const ok = results.filter(Boolean).length;
  console.log(`[keepalive] pinged ${ok}/${rows.length} clusters ok`);
  if (ok !== rows.length) process.exitCode = 1;
}

main().catch((err) => {
  // CORE unreachable / registry read error — nothing was enumerable.
  console.error(`[keepalive] FATAL: ${redactUri(err.message)}`);
  process.exitCode = 1;
});
