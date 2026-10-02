// Pure URL validation for the saved POS address. No global URL (React Native's
// polyfill is partial), no react-native import: safe for node:test.
// Mirrors apps/desktop/src/server-url.ts, plus the private-network http rule.

export const START_PATH = '/pos';
export const MIN_PORT = 1;
export const MAX_PORT = 65535;
export const MAX_HOST_CHARS = 253;
export const MAX_LABEL_CHARS = 63;

export const URL_EMPTY_ERROR = 'Enter the address of your POS.';
export const URL_INVALID_ERROR =
  'That is not a valid web address. It should look like https://your-pos.example.com';
export const URL_SCHEME_ERROR = 'The address must start with https://';
export const URL_HTTP_ERROR =
  'http:// only works for this device or a computer on your own network. Use https:// for any other address.';
export const URL_CREDENTIALS_ERROR =
  'Remove the user name and password from the address.';
export const URL_PORT_ERROR = 'The port number must be between 1 and 65535.';

const DEFAULT_PORTS: Record<string, number> = { http: 80, https: 443 };
const SCHEME_PREFIX = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]*)/;
const SCHEME_ONLY = /^([a-zA-Z][a-zA-Z0-9+.-]*):/;
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

export type NormalizeResult =
  | { ok: true; origin: string }
  | { ok: false; error: string };

export type NavigationVerdict = 'allow' | 'external' | 'deny';

export function startUrl(origin: string): string {
  return origin + START_PATH;
}

// Splits "scheme://[user@]host[:port]" without interpreting the host.
export function parseUrlParts(input: string): UrlParts | null {
  const match = SCHEME_PREFIX.exec(input);
  if (match === null) {
    return null;
  }
  const authority = match[2];
  const at = authority.lastIndexOf('@');
  const userinfo = at >= 0 ? authority.slice(0, at) : null;
  const hostPort = at >= 0 ? authority.slice(at + 1) : authority;
  const bracketEnd = hostPort.startsWith('[') ? hostPort.indexOf(']') : -1;
  const colon = hostPort.lastIndexOf(':');
  if (colon > bracketEnd) {
    return {
      scheme: match[1].toLowerCase(),
      userinfo,
      host: hostPort.slice(0, colon).toLowerCase(),
      port: hostPort.slice(colon + 1),
    };
  }
  return {
    scheme: match[1].toLowerCase(),
    userinfo,
    host: hostPort.toLowerCase(),
    port: null,
  };
}

function octetsOf(host: string): number[] | null {
  const parts = host.split('.');
  if (parts.length !== 4 || !parts.every(part => OCTET.test(part))) {
    return null;
  }
  const octets = parts.map(Number);
  return octets.every(n => n <= 255) ? octets : null;
}

// A DNS-style name or a dotted IPv4. IPv6 literals and anything with an
// odd character (backslash, space, tab...) are rejected on purpose.
export function isValidHost(host: string): boolean {
  if (host.length === 0 || host.length > MAX_HOST_CHARS) {
    return false;
  }
  if (NUMERIC_HOST.test(host)) {
    return octetsOf(host) !== null;
  }
  return host
    .split('.')
    .every(label => label.length <= MAX_LABEL_CHARS && LABEL.test(label));
}

export function isPrivateIpv4(host: string): boolean {
  const octets = octetsOf(host);
  if (octets === null) {
    return false;
  }
  const [a, b] = octets;
  return (
    a === 10 ||
    a === 127 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168)
  );
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
  return parts.scheme + '://' + parts.host + (keep ? ':' + port : '');
}

export function normalizePosUrl(input: string): NormalizeResult {
  const trimmed = input.trim();
  if (trimmed.length === 0) {
    return { ok: false, error: URL_EMPTY_ERROR };
  }
  const withScheme = SCHEME_PREFIX.test(trimmed)
    ? trimmed
    : 'https://' + trimmed;
  const parts = parseUrlParts(withScheme);
  if (parts === null) {
    return { ok: false, error: URL_INVALID_ERROR };
  }
  if (parts.userinfo !== null) {
    return { ok: false, error: URL_CREDENTIALS_ERROR };
  }
  if (parts.scheme !== 'https' && parts.scheme !== 'http') {
    return { ok: false, error: URL_SCHEME_ERROR };
  }
  const port = portNumber(parts.port);
  if (port !== null && Number.isNaN(port)) {
    return { ok: false, error: URL_PORT_ERROR };
  }
  if (!isValidHost(parts.host)) {
    return { ok: false, error: URL_INVALID_ERROR };
  }
  if (
    parts.scheme === 'http' &&
    parts.host !== 'localhost' &&
    !isPrivateIpv4(parts.host)
  ) {
    return { ok: false, error: URL_HTTP_ERROR };
  }
  return { ok: true, origin: buildOrigin(parts, port) };
}

// The strict origin of an http(s) URL, or null when the string is not one we
// would trust (credentials, odd host characters, bad port, other scheme).
export function originOf(url: string): string | null {
  const parts = parseUrlParts(url);
  if (parts === null || parts.userinfo !== null) {
    return null;
  }
  if (parts.scheme !== 'https' && parts.scheme !== 'http') {
    return null;
  }
  const port = portNumber(parts.port);
  if ((port !== null && Number.isNaN(port)) || !isValidHost(parts.host)) {
    return null;
  }
  return buildOrigin(parts, port);
}

export function isSameOrigin(url: string, origin: string): boolean {
  const found = originOf(url);
  return found !== null && found === origin;
}

function schemeOf(url: string): string | null {
  const match = SCHEME_ONLY.exec(url);
  return match === null ? null : match[1].toLowerCase();
}

// Top frame: the saved origin stays in the app, other web pages go to the
// system browser, everything else is refused. Sub-frames may load web content
// and the inert about:/data:/blob: schemes (the injected bridge only runs in
// the main frame, and the router also checks the posting origin).
export function classifyNavigation(
  url: string,
  origin: string,
  isTopFrame: boolean,
): NavigationVerdict {
  const scheme = schemeOf(url);
  if (isTopFrame) {
    if (isSameOrigin(url, origin)) {
      return 'allow';
    }
    if (url === 'about:blank') {
      return 'allow';
    }
    return scheme === 'http' || scheme === 'https' ? 'external' : 'deny';
  }
  const inert = ['http', 'https', 'about', 'data', 'blob'];
  return scheme !== null && inert.includes(scheme) ? 'allow' : 'deny';
}

export type BackstopAction = 'none' | 'recover' | 'recover-and-open';

// The top-frame backstop behind onShouldStartLoadWithRequest. On Android the
// library answers that callback from a cache (and defaults to ALLOW after a
// short wait), so a foreign page can still start loading. onLoadStart and
// onNavigationStateChange report such a page afterwards: stop it, and bring the
// WebView back to the start page. Only http(s) pages may be opened outside the
// app. No url (or the blank page) means there is no document to judge.
export function topFrameBackstop(url: string, origin: string): BackstopAction {
  if (url === '') {
    return 'none';
  }
  const verdict = classifyNavigation(url, origin, true);
  if (verdict === 'allow') {
    return 'none';
  }
  return verdict === 'external' ? 'recover-and-open' : 'recover';
}

export const HTTP_ERROR_MIN_STATUS = 400;

// True when the POS start page itself answered with an HTTP error. Other pages
// of the POS may legitimately answer 4xx (the web app renders its own screen),
// so only the start page counts as "could not open the POS".
export function isStartPageFailure(
  url: string,
  statusCode: number,
  origin: string,
): boolean {
  if (statusCode < HTTP_ERROR_MIN_STATUS || !isSameOrigin(url, origin)) {
    return false;
  }
  const prefix = SCHEME_PREFIX.exec(url);
  if (prefix === null) {
    return false;
  }
  const path = url.slice(prefix[0].length).split(/[?#]/)[0];
  return path === START_PATH || path === START_PATH + '/';
}
