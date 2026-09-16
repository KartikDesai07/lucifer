#!/usr/bin/env node
// The owner console: a local page over clients/*.json — every client's cafe
// details, Vercel/Atlas logins, tokens, admin credentials and notes in one place,
// with Dry run / Go live / Redeploy / Health buttons and a live log.
//
//   npm run go-live:ui             → http://127.0.0.1:4848 (opens the browser)
//   npm run go-live:ui -- --port 5000 --no-open
//
// Owner-only, loopback-only. The files it edits hold LIVE credentials in plain
// text on this disk (clients/ is gitignored + .vercelignore'd) — keep the folder
// out of shared drives and screenshots. Never part of the product.

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createServer } from "./ui-server.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const DEFAULT_PORT = 4848;
const args = process.argv.slice(2);
const portIdx = args.indexOf("--port");
const port = portIdx >= 0 ? Number(args[portIdx + 1]) : DEFAULT_PORT;
const open = !args.includes("--no-open");
if (!Number.isInteger(port) || port <= 0) {
  console.error("go-live:ui: --port needs a number");
  process.exit(2);
}

const console_ = createServer({ root: ROOT, clientsDir: process.env.GO_LIVE_CLIENTS_DIR ?? path.join(ROOT, "clients"), spawn, port });
console_.listen().then((bound) => {
  const url = `http://127.0.0.1:${bound}`;
  console.log(`owner console  ${url}   (clients folder: ${process.env.GO_LIVE_CLIENTS_DIR ?? path.join(ROOT, "clients")})`);
  console.log("Ctrl+C stops it. Nothing here leaves this machine except the deploys you click.");
  if (open) {
    const opener = process.platform === "win32" ? { cmd: "cmd", args: ["/c", "start", "", url] } : process.platform === "darwin" ? { cmd: "open", args: [url] } : { cmd: "xdg-open", args: [url] };
    spawn(opener.cmd, opener.args, { stdio: "ignore", detached: true, windowsHide: true }).on("error", () => {}).unref();
  }
}).catch((err) => {
  console.error(`go-live:ui failed to start: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
