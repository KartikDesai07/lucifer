/**
 * CB-DL-1 S4 — argv parsing for `migrate:links`, kept free of any DB/fs
 * import so a unit test can inject fakes (memory: parallel implementers own
 * disjoint slices — this module is the disjoint contract the entry file and
 * the test both read). All real filesystem/env/process access is injected
 * via ArgsDeps; the entry script (migrate-links.ts) wires the real ones.
 */

export interface MigrateArgs {
  uri: string;
  dbName: string;
  apply: boolean;
  backup: string | null;
  confirm: string | null;
  out: string;
  reset: string[] | null;
  createMissingCategories: boolean;
  dropLegacyCategory: boolean;
}

export interface ArgsDeps {
  env: NodeJS.ProcessEnv;
  existsSync(p: string): boolean;
  statSync(p: string): { mtimeMs: number };
  hasMongodump(): boolean;
  now: number;
  cwd: string;
}

export type ParseMigrateArgsResult =
  | { ok: true; args: MigrateArgs }
  | { ok: false; error: string };

// --apply refuses unless a backup this fresh exists and the operator repeats
// the db name — a fat-fingered `--apply` on the wrong URI must not proceed.
export const BACKUP_MAX_AGE_MS = 60 * 60 * 1000;

// The transactional collections `--reset default` expands to (D-C item 12).
// The owner confirms this exact list before DL-3; it lives here as the one
// spelling both the parser and the GO-LIVE doc point at.
export const RESET_DEFAULT_COLLECTIONS = [
  "orders",
  "duepayments",
  "orderrequests",
  "promoredemptions",
  "printjobs",
  "counters",
  "customers",
] as const;
export const RESET_DEFAULT_KEYWORD = "default";

// mongodb:// and mongodb+srv:// both put the db name as the path segment
// right after the host(s); strip a trailing query string. `new URL` cannot
// parse mongodb+srv (no dedicated parser), so this is a plain string split.
function dbNameFromUri(uri: string): string {
  const withoutScheme = uri.replace(/^mongodb(\+srv)?:\/\//, "");
  const afterHost = withoutScheme.split("/")[1] ?? "";
  const withoutQuery = afterHost.split("?")[0] ?? "";
  return withoutQuery;
}

function defaultOutPath(dbName: string, now: number, cwd: string): string {
  const stamp = new Date(now).toISOString().replace(/[:.]/g, "-");
  return `${cwd}/migrate-links-report-${dbName}-${stamp}.json`;
}

/** Parses argv for `migrate:links`. Pure aside from the injected ArgsDeps —
 * every filesystem/env/clock touch goes through `deps` so this is directly
 * unit-testable with fakes. */
export function parseMigrateArgs(argv: string[], deps: ArgsDeps): ParseMigrateArgsResult {
  let uri: string | null = deps.env.MONGODB_URI ?? null;
  let apply = false;
  let dryRunFlag = false;
  let backup: string | null = null;
  let confirm: string | null = null;
  let out: string | null = null;
  let resetRaw: string | null = null;
  let createMissingCategories = false;
  let dropLegacyCategory = false;

  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    switch (flag) {
      case "--uri":
        uri = argv[i + 1] ?? null;
        i += 1;
        break;
      case "--dry-run":
        // Default behavior — accepted as a no-op ONLY on its own. Recorded so
        // the --apply gate below can refuse the contradictory combination
        // (C33) instead of silently running the full destructive apply.
        dryRunFlag = true;
        break;
      case "--apply":
        apply = true;
        break;
      case "--backup":
        backup = argv[i + 1] ?? null;
        i += 1;
        break;
      case "--confirm":
        confirm = argv[i + 1] ?? null;
        i += 1;
        break;
      case "--out":
        out = argv[i + 1] ?? null;
        i += 1;
        break;
      case "--reset":
        resetRaw = argv[i + 1] ?? null;
        i += 1;
        break;
      case "--create-missing-categories":
        createMissingCategories = true;
        break;
      case "--drop-legacy-category":
        dropLegacyCategory = true;
        break;
      default:
        return { ok: false, error: `Unknown flag: ${flag}` };
    }
  }

  if (!uri) {
    return { ok: false, error: "Pass --uri <mongodb uri> or set MONGODB_URI" };
  }

  const dbName = dbNameFromUri(uri);
  if (!dbName) {
    return { ok: false, error: "Could not determine the database name from the URI" };
  }

  // C33: --apply and --dry-run contradict each other. --dry-run alone (never
  // writes) still works exactly as before; the moment --apply joins it, this
  // is refused rather than silently running the full destructive apply.
  if (apply && dryRunFlag) {
    return {
      ok: false,
      error: "--apply and --dry-run contradict each other: --apply runs the real pipeline, --dry-run asks for a read-only run. Pass only one.",
    };
  }

  // Resolve --reset's own grammar independent of the --apply gates below: a
  // typo'd collection name is reported the same way whether or not --apply
  // was also passed.
  let reset: string[] | null = null;
  if (resetRaw !== null) {
    if (resetRaw === RESET_DEFAULT_KEYWORD) {
      reset = [...RESET_DEFAULT_COLLECTIONS];
    } else {
      const names = resetRaw.split(",").map((n) => n.trim());
      for (const name of names) {
        if (!(RESET_DEFAULT_COLLECTIONS as readonly string[]).includes(name)) {
          return { ok: false, error: `Unknown collection in --reset: ${name}` };
        }
      }
      reset = names;
    }
  }

  if (apply) {
    if (!backup) {
      return {
        ok: false,
        error:
          "--apply needs --backup <mongodump archive> (a fresh mongodump --gzip --archive file) or --backup auto",
      };
    }
    if (backup === "auto") {
      if (!deps.hasMongodump()) {
        return {
          ok: false,
          error:
            "MongoDB Database Tools (mongodump) are not installed on this machine. Install them or pass --backup <archive>.",
        };
      }
    } else {
      if (!deps.existsSync(backup)) {
        return { ok: false, error: `Backup file not found: ${backup}` };
      }
      const { mtimeMs } = deps.statSync(backup);
      if (deps.now - mtimeMs > BACKUP_MAX_AGE_MS) {
        return { ok: false, error: "Backup is older than 60 minutes; take a fresh mongodump first" };
      }
    }
    if (!confirm) {
      return {
        ok: false,
        error: "--apply needs --confirm <dbName> (the database name in the URI)",
      };
    }
    if (confirm !== dbName) {
      return {
        ok: false,
        error: `--confirm does not match the database in the URI (${dbName})`,
      };
    }
  }

  if (reset !== null && !apply) {
    return { ok: false, error: "--reset needs --apply" };
  }

  if (createMissingCategories && !apply) {
    return { ok: false, error: "--create-missing-categories needs --apply" };
  }

  if (dropLegacyCategory && !apply) {
    return { ok: false, error: "--drop-legacy-category needs --apply" };
  }

  return {
    ok: true,
    args: {
      uri,
      dbName,
      apply,
      backup,
      confirm,
      out: out ?? defaultOutPath(dbName, deps.now, deps.cwd),
      reset,
      createMissingCategories,
      dropLegacyCategory,
    },
  };
}

const URI_PLACEHOLDER = "<uri>";
const CREDENTIALS_PLACEHOLDER = "//<credentials>@";
const CREDENTIAL_TOKEN_PLACEHOLDER = "<credentials>";
// Any `//user:secret@` fragment (greedy to the LAST @ of the token, so a
// password containing @ is swallowed whole rather than half-printed).
const CREDENTIAL_FRAGMENT = /\/\/\S*@/g;
// The userinfo of the URI itself: everything between `//` and the LAST `@`
// before the path (a `?` is allowed — an unescaped `?` in the username is
// exactly the malformed case the driver reports by quoting the username).
const USERINFO_OF_URI = /^[^/]+:\/\/([^/#]*)@/;

// The driver quotes the BARE username ("Username contains unescaped
// characters <username>"), not the whole uri — so the uri's own userinfo,
// username and password (raw and percent-decoded) are scrubbed as tokens.
function credentialTokens(uri: string): string[] {
  const match = USERINFO_OF_URI.exec(uri);
  if (!match) return [];
  const userinfo = match[1];
  const colon = userinfo.indexOf(":");
  const parts = colon >= 0 ? [userinfo, userinfo.slice(0, colon), userinfo.slice(colon + 1)] : [userinfo];
  const tokens = new Set<string>();
  for (const part of parts) {
    if (!part) continue;
    tokens.add(part);
    try {
      const decoded = decodeURIComponent(part);
      if (decoded) tokens.add(decoded);
    } catch {
      // not percent-encoded — the raw token is enough
    }
  }
  // Longest first, so a username that is a prefix of the userinfo does not
  // leave the tail of a longer token behind.
  return [...tokens].sort((a, b) => b.length - a.length);
}

// Removes the connection URI, its credential tokens, and any `//user:secret@`
// fragment from a message before it is printed. The mongodb driver's
// connection-string parser quotes the RAW uri (or the bare username) in its
// MongoParseError messages, so a mistyped --uri would otherwise echo the
// owner's credentials into the terminal. Pure, so it is unit-tested without a
// connection.
export function scrubUri(message: string, uri: string): string {
  let out = uri ? message.split(uri).join(URI_PLACEHOLDER) : message;
  for (const token of credentialTokens(uri)) {
    out = out.split(token).join(CREDENTIAL_TOKEN_PLACEHOLDER);
  }
  return out.replace(CREDENTIAL_FRAGMENT, CREDENTIALS_PLACEHOLDER);
}
