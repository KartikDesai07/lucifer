// scripts/go-live/core.mjs — the pieces run.mjs and web-address.mjs BOTH need
// (error type, JSON read/write, the platform file, the hosting slot, the
// read-modify-write save). Kept in its own module so the two flows import from
// here instead of from each other (no module cycle).

import path from "node:path";
import { parsePlatform, PLATFORM_FILE, PRIMARY_HOST } from "./lib.mjs";

export const HEALTH_ATTEMPTS = 12;
export const HEALTH_INTERVAL_MS = 5_000;
export const PROFILES_FILE = "deploy.profiles.json";
const JSON_INDENT = 2;

export class GoLiveError extends Error {
  constructor(message, { step, hint } = {}) {
    super(message);
    this.step = step;
    this.hint = hint;
  }
}

export function readJson(deps, file, fallback) {
  if (!deps.fs.existsSync(file)) return fallback;
  try {
    return JSON.parse(deps.fs.readFileSync(file, "utf8"));
  } catch {
    throw new GoLiveError(`${path.basename(file)} is not valid JSON — fix it and re-run`, { step: "read" });
  }
}

export function writeJson(deps, file, value) {
  deps.fs.writeFileSync(file, `${JSON.stringify(value, null, JSON_INDENT)}\n`, "utf8");
}

/** `clients/_platform.json`, next to `clientPath` — null in "legacy mode"
 *  (file absent or invalid: only *.vercel.app hosts are available). */
export function readPlatform(deps, clientPath) {
  const file = path.join(path.dirname(clientPath), PLATFORM_FILE);
  if (!deps.fs.existsSync(file)) return null;
  return parsePlatform(deps.fs.readFileSync(file, "utf8"));
}

/**
 * The hosting slot a run works on. PRIMARY = the client's own `vercel` block +
 * `generated` (and the shared secrets live there). A STANDBY = one entry of
 * `standbyHosts`: its own token/team/project and its own `generated`, but the
 * same database, images and secrets — a warm spare in another Vercel account.
 */
export function slotOf(client, label) {
  if (!label || label === PRIMARY_HOST) {
    return {
      label: PRIMARY_HOST, isPrimary: true, vercel: client.vercel, domain: client.domain ?? null,
      get gen() { return client.generated ?? {}; }, set gen(v) { client.generated = v; },
    };
  }
  const entry = (client.standbyHosts ?? []).find((h) => h.label === label);
  if (!entry) throw new GoLiveError(`no standby host "${label}" in the client file`, { step: "read", hint: "add it in the console (Hosting → Standby hosts) and Save, or run without --host" });
  return {
    label, isPrimary: false, vercel: entry.vercel, domain: null, // an own domain can sit on ONE project only — it stays with the primary
    get gen() { return entry.generated ?? {}; }, set gen(v) { entry.generated = v; },
  };
}

/** Persist what this run learned — done after EVERY step that mints or learns
 *  something, so a crash never loses a secret. READ-MODIFY-WRITE: the run owns
 *  only the primary `generated` (shared secrets) and the worked slot's
 *  `generated`; everything else is re-read from disk so an edit the owner saves
 *  from the console while a job runs is never clobbered by the job. */
export function saveClient(deps, clientPath, client, slot) {
  const onDisk = readJson(deps, clientPath, null);
  // Never re-create a file that vanished mid-run (archived or deleted from the
  // console while a CLI run was going): a stub holding only `generated` would be
  // a credentials-bearing orphan next to the real record.
  if (!onDisk) throw new GoLiveError("the client file disappeared during the run (archived or deleted?) — nothing more was written", { step: "save", hint: "restore the record, then re-run; the Vercel side is idempotent" });
  const next = { ...onDisk, generated: client.generated };
  if (slot && !slot.isPrimary) {
    const hosts = Array.isArray(onDisk.standbyHosts) ? onDisk.standbyHosts : [];
    const i = hosts.findIndex((h) => h && h.label === slot.label);
    if (i < 0) throw new GoLiveError(`standby host "${slot.label}" was removed from the file during the run — nothing more was written`, { step: "save" });
    next.standbyHosts = hosts.map((h, k) => (k === i ? { ...h, generated: slot.gen } : h));
  }
  writeJson(deps, clientPath, next);
}
