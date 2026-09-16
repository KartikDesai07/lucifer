import { writeFileSync } from "node:fs";

import {
  assertDialableUri,
  backupFileName,
  backupKey,
  backupSetFor,
  istParts,
  pruneBeforeDate,
  redactUri,
} from "./lib.mjs";
import { loadClusterRows } from "./registry.mjs";

// ─────────────────────────────────────────────────────────────────────────────
// F2 Step F2.9 — emit tonight's backup manifest for db-backup.yml: which
// clusters to `mongodump` (the lib.mjs stagger plan), the local file / object
// key per cluster, and the prune cutoff. The manifest FILE carries credentialed
// URIs for the bash loop (which masks them via ::add-mask:: before use) —
// stdout carries only redacted lines.
//
// Env: CORE_MONGODB_URI (or MONGODB_URI), TENANT_ID (default "dev"),
// BACKUP_RETENTION_DAYS (default 14), FORCE_ALL=1 (workflow_dispatch drill).
// Usage: node backup-manifest.mjs [out.json]
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  const outPath = process.argv[2] ?? "backup-manifest.json";
  const coreUri = process.env.CORE_MONGODB_URI ?? process.env.MONGODB_URI;
  const tenant = process.env.TENANT_ID ?? "dev";
  const retentionDays = Number(process.env.BACKUP_RETENTION_DAYS || 14);
  const forceAll = process.env.FORCE_ALL === "1";
  const prefix = `db-backups/${tenant}`;
  const now = new Date();
  const { date } = istParts(now);

  const { bootstrap, rows } = await loadClusterRows(coreUri);
  if (bootstrap) {
    console.log("[backup] no registry doc — bootstrap era, CORE is the only cluster");
  }
  const plan = backupSetFor(rows, now, forceAll);
  const due = plan.filter((r) => r.due);
  // Fail BEFORE any dump if a stored URI is vault-ciphertext (see lib.mjs).
  for (const r of due) assertDialableUri(r.uri, `${r.role} ${r.tag ?? r.id}`);

  const manifest = {
    generatedAt: now.toISOString(),
    istDate: date,
    tenant,
    prefix,
    retentionDays,
    pruneBeforeDate: pruneBeforeDate(now, retentionDays),
    clusters: due.map((r) => ({
      id: r.id,
      tag: r.tag ?? r.id,
      role: r.role,
      uri: r.uri,
      file: backupFileName(r, date),
      key: backupKey(prefix, r, date),
    })),
  };
  writeFileSync(outPath, JSON.stringify(manifest));

  for (const r of plan) {
    const mark = r.due ? "dump " : "skip ";
    console.log(
      `[backup] ${mark} ${r.role.padEnd(7)} ${(r.tag ?? r.id).padEnd(6)} ${r.reason} (${redactUri(r.uri)})`,
    );
  }
  console.log(
    `[backup] manifest → ${outPath}: ${due.length}/${plan.length} clusters due, prune < ${manifest.pruneBeforeDate}`,
  );
}

main().catch((err) => {
  // redactUri is defense-in-depth (driver specs already redact credentials).
  console.error(`[backup] FATAL: ${redactUri(err.message)}`);
  process.exitCode = 1;
});
