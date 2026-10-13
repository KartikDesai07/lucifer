// The POS address rules of the Android app, ported from apps/mobile/src/url.ts (native apps 2.0, spec §9): a bare
// workspace name means <name>.sandbee.in, an address without a scheme gets https://, http:// works only for this PC or a
// private network address, a port from 1 to 65535, no user name or password, and the same error words. pos-url.test.ts
// runs one table of inputs through both apps' functions and requires equal results. Pure (no electron import, no global
// URL): safe for node:test.

export const MIN_PORT = 1;
export const MAX_PORT = 65535;
export const MAX_HOST_CHARS = 253;
export const MAX_LABEL_CHARS = 63;

export const URL_EMPTY_ERROR = "Enter the address of your POS.";
export const URL_INVALID_ERROR =
  "That is not a valid address. Type your workspace name (like yourcafe) or the full address (like https://yourcafe.sandbee.in).";
export const URL_SCHEME_ERROR = "The address must start with https://";
export const URL_HTTP_ERROR =
  "http:// only works for this device or a computer on your own network. Use https:// for any other address.";
export const URL_CREDENTIALS_ERROR = "Remove the user name and password from the address.";
export const URL_PORT_ERROR = "The port number must be between 1 and 65535.";

const DEFAULT_PORTS: Record<string, number> = { http: 80, https: 443 };
const SCHEME_PREFIX = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]*)/;
const PORT_DIGITS = /^\d{1,5}$/;
const NUMERIC_HOST = /^[0-9.]+$/;
const LABEL = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;
const OCTET = /^(0|[1-9]\d{0,2})$/;

export type UrlParts = {
  scheme: string;
  userinfo: string | null;
  host: string;
  port: string | null;
};

export type NormalizeResult = { ok: true; origin: string } | { ok: false; error: string };

// Splits "scheme://[user@]host[:port]" without interpreting the host.
export function parseUrlParts(input: string): UrlParts | null {
  const match = SCHEME_PREFIX.exec(input);
  if (match === null) {
    return null;
  }
  const authority = match[2]!;
  const at = authority.lastIndexOf("@");
  const userinfo = at >= 0 ? authority.slice(0, at) : null;
  const hostPort = at >= 0 ? authority.slice(at + 1) : authority;
  const bracketEnd = hostPort.startsWith("[") ? hostPort.indexOf("]") : -1;
  const colon = hostPort.lastIndexOf(":");
  if (colon > bracketEnd) {
    return {
      scheme: match[1]!.toLowerCase(),
      userinfo,
      host: hostPort.slice(0, colon).toLowerCase(),
      port: hostPort.slice(colon + 1),
    };
  }
  return { scheme: match[1]!.toLowerCase(), userinfo, host: hostPort.toLowerCase(), port: null };
}

function octetsOf(host: string): number[] | null {
  const parts = host.split(".");
  if (parts.length !== 4 || !parts.every((part) => OCTET.test(part))) {
    return null;
  }
  const octets = parts.map(Number);
  return octets.every((n) => n <= 255) ? octets : null;
}

// A DNS-style name or a dotted IPv4. IPv6 literals and anything with an odd character (backslash, space, tab...) are
// rejected on purpose.
export function isValidHost(host: string): boolean {
  if (host.length === 0 || host.length > MAX_HOST_CHARS) {
    return false;
  }
  if (NUMERIC_HOST.test(host)) {
    return octetsOf(host) !== null;
  }
  return host.split(".").every((label) => label.length <= MAX_LABEL_CHARS && LABEL.test(label));
}

export function isPrivateIpv4(host: string): boolean {
  const octets = octetsOf(host);
  if (octets === null) {
    return false;
  }
  const [a, b] = octets as [number, number, number, number];
  return a === 10 || a === 127 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

// null = no port written; NaN = written but malformed.
function portNumber(port: string | null): number | null {
  if (port === null) {
    return null;
  }
  if (!PORT_DIGITS.test(port)) {
    return Number.NaN;
  }
  const value = Number(port);
  return value >= MIN_PORT && value <= MAX_PORT ? value : Number.NaN;
}

function buildOrigin(parts: UrlParts, port: number | null): string {
  const keep = port !== null && port !== DEFAULT_PORTS[parts.scheme];
  return parts.scheme + "://" + parts.host + (keep ? ":" + port : "");
}

// The Sandbee apps' rule: a bare workspace name (one DNS label with a letter in it, no dot, scheme or port; a path,
// query or hash after it is dropped later with the rest of the address) means <name>.sandbee.in. A digits-only label is
// a mistyped IP, never a name. Every full address is taken as written.
export const SANDBEE_DOMAIN = "sandbee.in";
const HAS_LETTER = /[a-z]/;
const PATH_START = /[/?#]/;

function expandWorkspaceName(input: string): string {
  const cut = input.search(PATH_START);
  const name = (cut < 0 ? input : input.slice(0, cut)).toLowerCase();
  const rest = cut < 0 ? "" : input.slice(cut);
  return name !== "localhost" && name.length <= MAX_LABEL_CHARS && LABEL.test(name) && HAS_LETTER.test(name)
    ? name + "." + SANDBEE_DOMAIN + rest
    : input;
}

export function normalizePosUrl(input: string): NormalizeResult {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: URL_EMPTY_ERROR };
  }
  const withScheme = SCHEME_PREFIX.test(trimmed) ? trimmed : "https://" + expandWorkspaceName(trimmed);
  const parts = parseUrlParts(withScheme);
  if (parts === null) {
    return { ok: false, error: URL_INVALID_ERROR };
  }
  if (parts.userinfo !== null) {
    return { ok: false, error: URL_CREDENTIALS_ERROR };
  }
  if (parts.scheme !== "https" && parts.scheme !== "http") {
    return { ok: false, error: URL_SCHEME_ERROR };
  }
  const port = portNumber(parts.port);
  if (port !== null && Number.isNaN(port)) {
    return { ok: false, error: URL_PORT_ERROR };
  }
  if (!isValidHost(parts.host)) {
    return { ok: false, error: URL_INVALID_ERROR };
  }
  if (parts.scheme === "http" && parts.host !== "localhost" && !isPrivateIpv4(parts.host)) {
    return { ok: false, error: URL_HTTP_ERROR };
  }
  return { ok: true, origin: buildOrigin(parts, port) };
}
