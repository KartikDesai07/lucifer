import { execSync } from "node:child_process";
import { writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Uploads the Worker's server-side secrets from .env.local to Cloudflare in one
// shot (via `wrangler secret bulk`). Run AFTER `npx wrangler login` and AFTER the
// first `npm run deploy` (so the "lucifer-cafe" Worker exists). Values are read
// from .env.local (loaded by `--env-file`), written to a 0600 temp file outside
// the repo, and deleted immediately after upload — never committed, never logged.
//
//   npm run cf:secrets

const KEYS = [
  "MONGODB_URI",
  "NEXTAUTH_SECRET",
  "CLOUDINARY_CLOUD_NAME",
  "CLOUDINARY_API_KEY",
  "CLOUDINARY_API_SECRET",
] as const;

const payload: Record<string, string> = {};
const missing: string[] = [];
for (const key of KEYS) {
  const value = process.env[key];
  if (value && value.trim()) payload[key] = value;
  else missing.push(key);
}

if (missing.length) {
  console.error(`Missing in .env.local: ${missing.join(", ")}`);
  process.exit(1);
}

const tmp = join(tmpdir(), "lucifer-cf-secrets.json");
writeFileSync(tmp, JSON.stringify(payload), { mode: 0o600 });

console.log(`Uploading ${KEYS.length} secrets to the lucifer-cafe Worker...`);
try {
  execSync(`npx wrangler secret bulk "${tmp}"`, { stdio: "inherit" });
} finally {
  rmSync(tmp, { force: true });
}
console.log(`Done. Secrets set: ${KEYS.join(", ")}`);
