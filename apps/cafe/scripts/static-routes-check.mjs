// Keeps every staff screen's frame static. Run after `next build`:
//   node scripts/static-routes-check.mjs [distDir]      (distDir defaults to .next, relative to the cafe app)
// It fails (exit 1, every offender listed) when
//   - a route under app/(dashboard) was not prerendered at build time,
//   - /printers is not prerendered with a 600 s refresh,
//   - /login or any /m route WAS prerendered (they read Settings per request and must stay dynamic: a prerender
//     would freeze the cafe's name and the diner theme at build time).
import { readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// URL paths of the app/(dashboard) pages, from app-path-routes-manifest.json ("/(dashboard)/x/page" -> "/x").
export function staffRoutes(routes) {
  return Object.entries(routes)
    .filter(([key]) => key.startsWith("/(dashboard)/") && key.endsWith("/page"))
    .map(([, url]) => url);
}

// Is this URL one of the build's prerendered pages (or the source route of one)?
function isPrerendered(manifest, url) {
  const prerendered = manifest.routes ?? {};
  if (Object.hasOwn(prerendered, url)) return true;
  return Object.values(prerendered).some((r) => r && r.srcRoute === url);
}

export function nonStaticStaffRoutes(manifest, routes) {
  return staffRoutes(routes).filter((url) => !isPrerendered(manifest, url));
}

const isPublicDynamic = (url) => url === "/login" || url === "/m" || url.startsWith("/m/");

// /login and /m/* pages that came out prerendered, which they must not.
export function prerenderedPublicRoutes(manifest, routes) {
  return Object.entries(routes)
    .filter(([key, url]) => key.endsWith("/page") && isPublicDynamic(url) && isPrerendered(manifest, url))
    .map(([, url]) => url);
}

// null when /printers refreshes every 600 s as designed, else what is wrong.
export function printersRefreshProblem(manifest) {
  const entry = (manifest.routes ?? {})["/printers"];
  if (!entry) return "/printers is not prerendered (it must refresh every 600 s)";
  if (entry.initialRevalidateSeconds !== 600) {
    return `/printers refreshes every ${entry.initialRevalidateSeconds} s, not 600`;
  }
  return null;
}

function main() {
  const dist = path.resolve(process.argv[2] ?? ".next");
  const read = (name) => JSON.parse(readFileSync(path.join(dist, name), "utf8"));
  const manifest = read("prerender-manifest.json");
  const routes = read("app-path-routes-manifest.json");

  const problems = [];
  for (const url of nonStaticStaffRoutes(manifest, routes)) problems.push(`staff route not static: ${url}`);
  for (const url of prerenderedPublicRoutes(manifest, routes)) problems.push(`public route must stay dynamic but was prerendered: ${url}`);
  const printers = printersRefreshProblem(manifest);
  if (printers) problems.push(printers);

  if (problems.length > 0) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  console.log(`${staffRoutes(routes).length} staff routes static`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
